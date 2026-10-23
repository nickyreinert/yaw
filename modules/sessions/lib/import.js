// `yaw sessions import` (#174): read the session history the agents keep on this machine and load the sessions of
// one project into the registry (~/.yaw/yaw.db). Metadata only: ids, times, working folder, branch, model and
// token/cost figures. Prompt, response, tool and file content is parsed line by line and dropped, never stored
// or printed. Idempotent: a session is keyed by '<agent>:<agent session id>', a second import updates it in place.
//
//   Claude Code  ~/.claude/projects/<encoded project path>/<session>.jsonl   ($CLAUDE_CONFIG_DIR)
//   Codex        ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl                ($CODEX_HOME)
//   Copilot CLI  ~/.copilot/session-state/<session>/{workspace.yaml,events.jsonl}

import { createReadStream, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
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
  costUsd: Number.isFinite(cost) && cost > 0 ? Math.round(cost * 10000) / 10000 : null, transcript,
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

async function claude(env, project) {
  const base = env.CLAUDE_CONFIG_DIR || join(env.HOME ?? '', '.claude');
  const dir = join(base, 'projects', claudeFolder(project));
  const found = [];
  for (const name of list(dir).filter((n) => n.endsWith('.jsonl')).slice(0, MAX_FILES)) {
    if (!isFile(join(dir, name))) continue;
    const s = await readClaude(join(dir, name), project);
    if (s) found.push(s);
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

async function codex(env, project) {
  const base = env.CODEX_HOME || join(env.HOME ?? '', '.codex');
  const found = [];
  for (const file of codexFiles(join(base, 'sessions'))) {
    const s = await readCodex(file, project);
    if (s) found.push(s);
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

async function copilot(env, project) {
  const base = join(env.HOME ?? '', '.copilot', 'session-state');
  const found = [];
  for (const name of list(base).slice(0, MAX_FILES)) {
    const dir = join(base, name);
    if (!isDir(dir)) continue;
    const s = await readCopilot(dir, project);
    if (s) found.push(s);
  }
  return found;
}

// ------------------------------------------------------------------------------------------ import

const READERS = { claude, codex, copilot };

export async function findSessions({ env, root, agents = Object.keys(READERS) }) {
  const project = realRoot(root);
  const all = [];
  for (const agent of agents) all.push(...(await READERS[agent](env, project)));
  return all.sort((a, b) => a.started.localeCompare(b.started));
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
