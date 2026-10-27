// `yaw sessions import` (#174): read the session history the agents keep on this machine and load the sessions of
// one project into the registry (~/.yaw/yaw.db). Metadata only: ids, times, working folder, branch, model and
// token/cost figures. Prompt, response, tool and file content is parsed line by line and dropped, never stored
// or printed. Idempotent: a session is keyed by '<agent>:<agent session id>', a second import updates it in place.
//
//   Claude Code  ~/.claude/projects/<encoded project path>/<session>.jsonl   ($CLAUDE_CONFIG_DIR)
//   Codex        ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl                ($CODEX_HOME)
//   Copilot CLI  ~/.copilot/session-state/<session>/{workspace.yaml,events.jsonl}
//   Gemini CLI   ~/.gemini/tmp/<project folder or sha256 of its path>/chats/session-*.json
//
// Each agent's folder is a "source" (Global settings → Sessions): the defaults below, or the paths the user chose.

import { createReadStream, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, join, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { NATIVE_ID, clean, realRoot, resumeCommand, sessionId } from './registry.js';

const MAX_LINE = 4 * 1024 * 1024; // longer lines (pasted files, images) are skipped without parsing
const MAX_FILES = 20000;

const isFile = (p) => {
  try {
    const st = lstatSync(p);
    return st.isFile();
  } catch {
    return false;
  }
};
const isDir = (p) => {
  try {
    return lstatSync(p).isDirectory();
  } catch {
    return false;
  }
};
const list = (dir) => {
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
};
// Size and modification time of the files a session was read from: unchanged stamps let a caller reuse its saved row.
export function fileStamp(...paths) {
  return paths.map((p) => {
    try {
      const st = lstatSync(p);
      return st.isFile() ? `${st.size}:${Math.trunc(st.mtimeMs)}` : '-';
    } catch {
      return '-';
    }
  }).join('|');
}
// `reuse(path, stamp)` may return a saved session for an unchanged file; it is kept only when it still belongs to the project.
async function readOne(found, path, stamp, project, reuse, read) {
  const hit = reuse?.(path, stamp);
  if (hit) {
    if (inProject(hit.cwd, project)) found.push({ ...hit, stamp });
    return;
  }
  try {
    const s = await read();
    if (s) found.push(reuse ? { ...s, stamp } : s);
  } catch (e) {
    if (project !== null) throw e; // a rotating/unreadable history file must not hide other projects
  }
}
const num = (v) => (Number.isFinite(v) && v >= 0 ? v : 0);
const iso = (v) => {
  const t = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

async function eachJson(file, fn) {
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (line.length === 0 || line.length > MAX_LINE) continue;
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      if (o && typeof o === 'object' && fn(o) === false) break;
    }
  } finally {
    rl.close();
  }
}

// Does a session that ran in `cwd` belong to the project? The project folder itself or a folder below it.
export function inProject(cwd, project) {
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) return false;
  if (project === null) return true; // explicit all-project metadata discovery; no registry write
  const candidates = new Set([cwd]);
  try {
    candidates.add(realpathSync(cwd));
  } catch { /* a deleted folder still matches by its recorded path */ }
  return [...candidates].some((c) => c === project || c.startsWith(project + sep));
}

class Usage {
  constructor() {
    this.models = new Map();
    this.tokensIn = 0;
    this.tokensOut = 0;
    this.first = null;
    this.last = null;
  }

  time(t) {
    const s = iso(t);
    if (!s) return;
    if (this.first === null || s < this.first) this.first = s;
    if (this.last === null || s > this.last) this.last = s;
  }

  // weight: output tokens where known, so a model that did the work wins over many small helper calls
  model(name, weight = 1) {
    if (typeof name !== 'string' || name === '' || name.startsWith('<')) return;
    this.models.set(name, (this.models.get(name) ?? 0) + weight);
  }

  topModel() {
    let best = null;
    for (const [m, n] of this.models) if (best === null || n > best[1]) best = [m, n];
    return best ? clean(best[0]).slice(0, 80) : null;
  }
}

const session = ({ agent, native, cwd, branch, usage, cost, transcript }) => ({
  agent, native, cwd, branch: branch ? clean(branch).slice(0, 200) : null,
  started: usage.first, ended: usage.last, model: usage.topModel(),
  tokensIn: usage.tokensIn || null, tokensOut: usage.tokensOut || null,
  costUsd: Number.isFinite(cost) && cost >= 0 ? Math.round(cost * 10000) / 10000 : null, transcript,
});

// ------------------------------------------------------------------------------------------ Claude Code

// Claude Code names the folder after the path with every non-alphanumeric character replaced by "-".
export const claudeFolder = (project) => project.replace(/[^A-Za-z0-9]/g, '-');

export async function readClaude(file, project) {
  let native = null;
  let cwd = null;
  let branch = null;
  let cost = null;
  const usage = new Usage();
  const perMessage = new Map(); // one API message is split over several lines, each repeating its usage
  await eachJson(file, (o) => {
    if (typeof o.sessionId === 'string' && native === null) native = o.sessionId;
    if (typeof o.cwd === 'string' && cwd === null) cwd = o.cwd;
    if (typeof o.gitBranch === 'string' && o.gitBranch !== '' && o.gitBranch !== 'HEAD') branch = o.gitBranch;
    if (o.timestamp && (o.type === 'user' || o.type === 'assistant')) usage.time(o.timestamp);
    if (o.type === 'assistant' && o.message && typeof o.message === 'object') {
      const m = o.message;
      const u = m.usage ?? {};
      perMessage.set(m.id ?? `${perMessage.size}`, {
        model: m.model,
        in: num(u.input_tokens) + num(u.cache_creation_input_tokens) + num(u.cache_read_input_tokens),
        out: num(u.output_tokens),
      });
    }
    if (o.type === 'cost-state' && Number.isFinite(o.totalCostUSD)) cost = o.totalCostUSD;
  });
  if (!inProject(cwd, project) || !NATIVE_ID.test(native ?? '') || usage.first === null) return null;
  for (const m of perMessage.values()) {
    usage.model(m.model, m.out + 1);
    usage.tokensIn += m.in;
    usage.tokensOut += m.out;
  }
  return session({ agent: 'claude', native, cwd, branch, usage, cost, transcript: file });
}

async function claude(base, project, reuse) {
  const projects = join(base, 'projects');
  if (!isDir(base) || !isDir(projects)) return [];
  const dirs = project === null ? list(projects).filter((n) => isDir(join(projects, n))).map((n) => join(projects, n)) : [join(projects, claudeFolder(project))];
  const found = [];
  let inspected = 0;
  for (const dir of dirs) {
    if (!isDir(dir)) continue;
    for (const name of list(dir).filter((n) => n.endsWith('.jsonl'))) {
      if (inspected++ >= MAX_FILES) return found;
      const file = join(dir, name);
      if (!isFile(file)) continue;
      await readOne(found, file, fileStamp(file), project, reuse, () => readClaude(file, project));
    }
  }
  return found;
}

// ------------------------------------------------------------------------------------------ Codex

export async function readCodex(file, project) {
  let native = null;
  let cwd = null;
  let branch = null;
  let tokens = null;
  let mismatch = false;
  const usage = new Usage();
  await eachJson(file, (o) => {
    const p = o.payload && typeof o.payload === 'object' ? o.payload : {};
    if (o.type === 'session_meta') {
      native ??= p.id ?? p.session_id ?? null;
      cwd ??= p.cwd ?? null;
      if (typeof p.git?.branch === 'string') branch = p.git.branch;
      usage.time(p.timestamp);
      if (!inProject(cwd, project)) {
        mismatch = true;
        return false; // another project: stop reading this file
      }
    }
    if (o.timestamp) usage.time(o.timestamp);
    if (o.type === 'turn_context') usage.model(p.model);
    if (o.type === 'event_msg' && p.type === 'token_count' && p.info?.total_token_usage) tokens = p.info.total_token_usage;
    return undefined;
  });
  if (mismatch || !inProject(cwd, project) || !NATIVE_ID.test(native ?? '') || usage.first === null) return null;
  if (tokens) {
    usage.tokensIn = num(tokens.input_tokens);
    usage.tokensOut = num(tokens.output_tokens);
  }
  return session({ agent: 'codex', native, cwd, branch, usage, cost: null, transcript: file });
}

function codexFiles(dir, depth = 0, out = []) {
  for (const name of list(dir)) {
    if (out.length >= MAX_FILES) break;
    const p = join(dir, name);
    if (depth < 3 && isDir(p)) codexFiles(p, depth + 1, out);
    else if (depth === 3 && /^rollout-.*\.jsonl$/.test(name) && isFile(p)) out.push(p);
  }
  return out;
}

async function codex(base, project, reuse) {
  if (!isDir(base) || !isDir(join(base, 'sessions'))) return [];
  const found = [];
  for (const file of codexFiles(join(base, 'sessions'))) {
    await readOne(found, file, fileStamp(file), project, reuse, () => readCodex(file, project));
  }
  return found;
}

// ------------------------------------------------------------------------------------------ Copilot CLI

// Only the plain top-level keys we need; the session name and summary are never read.
export function workspaceFields(text) {
  const out = {};
  for (const line of String(text).split('\n')) {
    const m = /^(id|cwd|git_root|branch|created_at|updated_at):\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

export async function readCopilot(dir, project) {
  const ws = join(dir, 'workspace.yaml');
  if (!isFile(ws)) return null;
  let fields;
  try {
    fields = workspaceFields(readFileSync(ws, 'utf8').slice(0, 64 * 1024));
  } catch {
    return null;
  }
  const cwd = [fields.cwd, fields.git_root].find((c) => inProject(c, project));
  if (!cwd) return null;
  const usage = new Usage();
  usage.time(fields.created_at);
  usage.time(fields.updated_at);
  let branch = fields.branch || null;
  let selected = null;
  const events = join(dir, 'events.jsonl');
  if (isFile(events)) {
    await eachJson(events, (o) => {
      const d = o.data && typeof o.data === 'object' ? o.data : {};
      if (o.timestamp) usage.time(o.timestamp);
      if (o.type === 'session.start') {
        usage.time(d.startTime);
        selected = d.selectedModel ?? selected;
        if (typeof d.context?.branch === 'string' && d.context.branch !== '') branch = d.context.branch;
      }
      if (o.type === 'session.usage_record' && d.usage && typeof d.usage === 'object') {
        usage.model(d.usage.model, num(d.usage.outputTokens) + 1);
        usage.tokensIn += num(d.usage.inputTokens) + num(d.usage.cacheReadTokens) + num(d.usage.cacheWriteTokens);
        usage.tokensOut += num(d.usage.outputTokens);
      }
    });
  }
  if (usage.models.size === 0) usage.model(selected);
  const native = fields.id || dir.split(sep).pop();
  if (!NATIVE_ID.test(native) || usage.first === null) return null;
  return session({ agent: 'copilot', native, cwd, branch, usage, cost: null, transcript: isFile(events) ? events : null });
}

async function copilot(home, project, reuse) {
  const base = join(home, 'session-state');
  if (!isDir(home) || !isDir(base)) return [];
  const found = [];
  for (const name of list(base).slice(0, MAX_FILES)) {
    const dir = join(base, name);
    if (!isDir(dir)) continue;
    await readOne(found, dir, fileStamp(join(dir, 'workspace.yaml'), join(dir, 'events.jsonl')), project, reuse, () => readCopilot(dir, project));
  }
  return found;
}

// ------------------------------------------------------------------------------------------ Gemini CLI

const sha = (text) => createHash('sha256').update(text).digest('hex');
const MAX_GEMINI = 64 * 1024 * 1024;

// One chat file is a single JSON document. Message text is dropped here; only times, model and token counts are kept.
export function readGemini(file, project, cwd) {
  let chat;
  try {
    const st = lstatSync(file);
    if (!st.isFile() || st.size > MAX_GEMINI) return null;
    chat = JSON.parse(readFileSync(file, 'utf8'));
  } catch { return null; }
  if (!chat || typeof chat !== 'object' || !Array.isArray(chat.messages)) return null;
  const native = typeof chat.sessionId === 'string' ? chat.sessionId : null;
  if (!inProject(cwd, project) || !NATIVE_ID.test(native ?? '')) return null;
  const usage = new Usage();
  usage.time(chat.startTime); usage.time(chat.lastUpdated);
  for (const m of chat.messages) {
    if (!m || typeof m !== 'object') continue;
    if (m.type === 'user' || m.type === 'gemini') usage.time(m.timestamp);
    if (m.type !== 'gemini') continue;
    const t = m.tokens && typeof m.tokens === 'object' ? m.tokens : {};
    usage.model(m.model, num(t.output) + 1);
    usage.tokensIn += num(t.input) + num(t.cached);
    usage.tokensOut += num(t.output) + num(t.thoughts);
  }
  if (usage.first === null) return null;
  return session({ agent: 'gemini', native, cwd, branch: null, usage, cost: null, transcript: file });
}

// A chat folder is named after the project, or after the sha256 of the project path. `.project_root` says which;
// without it the folder only belongs to a project whose path hashes to its name (a project we were asked about or know).
async function gemini(base, project, reuse, known = []) {
  const tmp = join(base, 'tmp');
  if (!isDir(base) || !isDir(tmp)) return [];
  const byHash = new Map([...known, ...(project ? [project] : [])].map((p) => [sha(p), p]));
  const found = [];
  let inspected = 0;
  for (const name of list(tmp)) {
    const chats = join(tmp, name, 'chats');
    if (!isDir(chats)) continue;
    let cwd = null;
    try { cwd = readFileSync(join(tmp, name, '.project_root'), 'utf8').trim().split('\n')[0]; } catch { /* hashed folder */ }
    cwd = isAbsolute(cwd ?? '') ? cwd : byHash.get(name) ?? null;
    if (!cwd) continue;
    for (const file of list(chats).filter((n) => /^session-.*\.json$/.test(n)).map((n) => join(chats, n))) {
      if (inspected++ >= MAX_FILES) return found;
      await readOne(found, file, fileStamp(file), project, reuse, async () => readGemini(file, project, cwd));
    }
  }
  return found;
}

// ------------------------------------------------------------------------------------------ sources + import

const READERS = { claude, codex, copilot, gemini };
export const FORMATS = { claude: 'Claude Code', codex: 'Codex', copilot: 'Copilot CLI', gemini: 'Gemini CLI' };

// Filename-only discovery for an explicitly selected review. Never parse other sessions to locate saved file hashes.
export function transcriptFiles(sources) {
  const out = [];
  for (const { agent, path: base } of sources) {
    if (!isDir(base)) continue;
    let files = [];
    if (agent === 'codex' && isDir(join(base, 'sessions'))) files = codexFiles(join(base, 'sessions'));
    else if (agent === 'copilot') {
      const dir = join(base, 'session-state');
      if (isDir(dir)) for (const name of list(dir).slice(0, MAX_FILES)) {
        if (isDir(join(dir, name))) files.push(join(dir, name, 'events.jsonl'));
      }
    } else if (agent === 'claude' || agent === 'gemini') {
      const parent = join(base, agent === 'claude' ? 'projects' : 'tmp');
      if (isDir(parent)) for (const name of list(parent)) {
        const project = join(parent, name);
        if (!isDir(project)) continue;
        const dir = agent === 'gemini' ? join(project, 'chats') : project;
        if (!isDir(dir)) continue;
        for (const file of list(dir)) {
          if (files.length >= MAX_FILES) break;
          if (agent === 'claude' ? file.endsWith('.jsonl') : /^session-.*\.json$/.test(file)) files.push(join(dir, file));
        }
        if (files.length >= MAX_FILES) break;
      }
    }
    out.push(...files.filter(isFile).map((file) => ({ agent, file })));
  }
  return out;
}

// Where each agent keeps its history unless the user says otherwise: [agent, folder, note].
export function defaultSources(env) {
  const home = env.HOME ?? '';
  return [
    { agent: 'claude', path: env.CLAUDE_CONFIG_DIR || join(home, '.claude'), note: env.CLAUDE_CONFIG_DIR ? 'CLAUDE_CONFIG_DIR' : 'default' },
    { agent: 'codex', path: env.CODEX_HOME || join(home, '.codex'), note: env.CODEX_HOME ? 'CODEX_HOME' : 'default' },
    { agent: 'copilot', path: join(home, '.copilot'), note: 'default' },
    { agent: 'gemini', path: join(home, '.gemini'), note: 'default' },
  ];
}

// Other places the same histories turn up (XDG location, Flatpak or Snap apps, Windows folders seen from WSL). Only folders that exist are suggested.
export function suggestedSources(env) {
  const home = env.HOME ?? '', out = [];
  const apps = list(join(home, '.var', 'app')).map((a) => join(home, '.var', 'app', a));
  const wsl = list('/mnt/c/Users').map((u) => join('/mnt/c/Users', u));
  const places = [[join(home, '.config', 'claude'), 'claude', 'XDG config folder'], ...apps.flatMap((a) => [[join(a, '.claude'), 'claude', 'Flatpak app'], [join(a, '.codex'), 'codex', 'Flatpak app'], [join(a, '.gemini'), 'gemini', 'Flatpak app']]),
    ...wsl.flatMap((u) => [[join(u, '.claude'), 'claude', 'Windows folder'], [join(u, '.codex'), 'codex', 'Windows folder'], [join(u, '.gemini'), 'gemini', 'Windows folder']])];
  for (const [path, agent, note] of places) if (isDir(path)) out.push({ agent, path, note });
  return out;
}

// How many history files a source holds (bounded); null when the folder does not exist. Used by the settings page only.
export function probeSource({ agent, path }) {
  if (!isDir(path)) return null;
  let n = 0;
  const walk = (dir, depth, match) => {
    for (const name of list(dir)) {
      if (n >= MAX_FILES) return;
      const p = join(dir, name);
      if (depth > 0 && isDir(p)) walk(p, depth - 1, match);
      else if (match(name) && isFile(p)) n++;
    }
  };
  if (agent === 'claude') for (const d of list(join(path, 'projects'))) walk(join(path, 'projects', d), 0, (f) => f.endsWith('.jsonl'));
  else if (agent === 'codex') walk(join(path, 'sessions'), 3, (f) => /^rollout-.*\.jsonl$/.test(f));
  else if (agent === 'copilot') { for (const d of list(join(path, 'session-state'))) if (n < MAX_FILES && isFile(join(path, 'session-state', d, 'workspace.yaml'))) n++; }
  else if (agent === 'gemini') for (const d of list(join(path, 'tmp'))) walk(join(path, 'tmp', d, 'chats'), 0, (f) => /^session-.*\.json$/.test(f));
  return n;
}

// `sources`: [{ agent, path }] chosen by the user; default is each agent's usual folder. `known`: project folders to
// recognise hashed Gemini folders by. The same session found through two sources is returned once.
export async function findSessions({ env, root, agents = Object.keys(READERS), allProjects = false, reuse, sources, known = [] }) {
  const project = allProjects ? null : realRoot(root);
  const list_ = (sources ?? defaultSources(env)).filter((s) => agents.includes(s.agent) && READERS[s.agent]);
  const all = new Map();
  for (const source of list_) {
    for (const s of await READERS[source.agent](source.path, project, reuse, known)) {
      const id = s.reused ? s.reused.id : `${s.agent}:${s.native}`;
      if (!all.has(id) || (s.ended ?? '') > (all.get(id).ended ?? '')) all.set(id, s);
    }
  }
  return [...all.values()].sort((a, b) => a.started.localeCompare(b.started));
}

// Insert new sessions; refresh usage and the end time of known ones. Hook-recorded fields (title, branch,
// transcript, links) are never overwritten. -> [{ ...session, id, state: 'new' | 'updated' | 'unchanged' }]
export function importSessions(db, root, sessions, { dryRun = false } = {}) {
  const project = realRoot(root);
  if (db === null) return sessions.flatMap((s) => (sessionId(s.agent, s.native) ? [{ ...s, id: sessionId(s.agent, s.native), state: 'new' }] : []));
  const get = db.prepare('SELECT ended, model, tokens_in, tokens_out, cost_usd FROM sessions WHERE id = ?');
  const insert = db.prepare(`INSERT INTO sessions (id, agent, project, title, started, ended, branch, resume, transcript, model, tokens_in, tokens_out, cost_usd, source)
    VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'import')`);
  const update = db.prepare(`UPDATE sessions SET
      ended = CASE WHEN ended IS NULL OR ended < ? THEN ? ELSE ended END,
      branch = COALESCE(branch, ?), transcript = COALESCE(transcript, ?),
      model = COALESCE(?, model), tokens_in = COALESCE(?, tokens_in), tokens_out = COALESCE(?, tokens_out), cost_usd = COALESCE(?, cost_usd)
    WHERE id = ?`);
  const results = [];
  for (const s of sessions) {
    const id = sessionId(s.agent, s.native);
    if (id === null) continue;
    const row = get.get(id);
    let state = 'new';
    if (row) {
      const same = row.model === (s.model ?? row.model) && row.tokens_in === (s.tokensIn ?? row.tokens_in)
        && row.tokens_out === (s.tokensOut ?? row.tokens_out) && row.cost_usd === (s.costUsd ?? row.cost_usd)
        && row.ended !== null && row.ended >= s.ended;
      state = same ? 'unchanged' : 'updated';
    }
    if (!dryRun && state === 'new') {
      insert.run(id, s.agent, project, s.started, s.ended, s.branch, resumeCommand(s.agent, s.native), s.transcript, s.model, s.tokensIn, s.tokensOut, s.costUsd);
    } else if (!dryRun && state === 'updated') {
      update.run(s.ended, s.ended, s.branch, s.transcript, s.model, s.tokensIn, s.tokensOut, s.costUsd, id);
    }
    results.push({ ...s, id, state });
  }
  return results;
}
