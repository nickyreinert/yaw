// Manual portable data exchange. Native histories and local paths never enter the vault.
import { constants, openSync, closeSync, fstatSync, readFileSync, writeFileSync, renameSync, mkdirSync, lstatSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { join, resolve, dirname, parse as parsePath, isAbsolute, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { userDir, userDataDir, readUserData, writeUserData, secretFindings } from './user-store.js';
import { parse, stringify } from './yaml.js';
import { schemas } from '../render/kit.js';
import { loadRules, secretValueRule } from '../../modules/security/lib/guards.js';
import { remoteSettings } from './remote-settings.js';
import { setupDefaults } from './setup-defaults.js';

const hash = (v) => createHash('sha256').update(v).digest('hex');
const canonical = (v) => JSON.stringify(v, (_, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x);
const equal = (a, b) => canonical(a ?? null) === canonical(b ?? null);
const NUMBERS = ['tokens_in', 'tokens_out', 'cost_usd', 'prompts', 'answers', 'promptChars', 'answerChars'];
// Per-session figures that place a session on a chart (never summed in the totals) and its two plain labels.
const EXTRA = ['started', 'minutes', 'medianAnswerChars', 'p95AnswerChars', 'medianResponseMs', 'p95ResponseMs'];
const LABELS = ['agent', 'model'];
const LABEL_RE = /^[\p{L}\p{N} _.:\/@+()-]{1,80}$/u;
const SCOPES = ['settings', 'presets', 'statistics', 'tasks', 'knowledge'];
// A global knowledge record is a Markdown file below ~/.yaw/knowledge, at most five levels deep.
const PART = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
const KNOWLEDGE_KEY = (key) => typeof key === 'string' && key.startsWith('knowledge/') && key.length <= 310 && /\.md$/i.test(key) && key.split('/').length <= 6 && key.split('/').every((p) => PART.test(p));
const MAX_RECORD = 128 * 1024, MAX_TASK_PROJECTS = 500, MAX_TASK_ITEMS = 500;
const scopeOf = (key) => key.startsWith('presets/') ? 'presets' : key.startsWith('knowledge/') ? 'knowledge' : 'settings';
export const sessionKey = (id) => hash(String(id));
const finite = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

// Check every component before opening, including parent directories. Missing leaves are allowed.
function safe(path) {
  path = resolve(path);
  let current = parsePath(path).root;
  for (const part of path.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    try { if (lstatSync(current).isSymbolicLink()) throw new Error('Sync refuses symbolic links'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return path;
}
function read(path) {
  safe(path);
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > 16 * 1024 * 1024) throw new Error('Sync requires regular files smaller than 16 MiB');
    return readFileSync(fd, 'utf8');
  } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  finally { if (fd !== undefined) closeSync(fd); }
}
function write(path, text) {
  if (Buffer.byteLength(text) > 16 * 1024 * 1024) throw new Error('Sync data exceeds the 16 MiB exchange limit');
  safe(path); mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); safe(path);
  const temp = `${path}.${randomUUID()}.tmp`;
  try { writeFileSync(temp, text, { flag: 'wx', mode: 0o600 }); renameSync(temp, path); }
  finally { try { unlinkSync(temp); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
}
const json = (path, fallback) => { const text = read(path); return text === null ? fallback : JSON.parse(text); };
function label(value) {
  if (typeof value !== 'string' || !/^[\p{L}\p{N} _.-]{1,64}$/u.test(value)) throw new Error('Device name needs 1–64 letters, digits, spaces, dots, underscores or hyphens');
  return value;
}
function device(env, name) {
  const old = readUserData(env, 'sync-device.json');
  const d = old ?? { id: randomUUID(), name: label(hostname().replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 64) || 'Device') };
  if (name !== undefined) d.name = label(name);
  if (!old || name !== undefined) writeUserData(env, 'sync-device.json', d);
  return d;
}
// Tasks and knowledge hold your own text, so they are opt-in.
export function configureSync({ env, target, github, name, scopes = ['settings', 'presets', 'statistics'] }) {
  if (scopes.some((s) => readUserData(env, 'hub-sync.json')?.scopes?.includes(s))) throw new Error('These datasets have migrated to the hub; use yaw remote sync');
  if (Boolean(target) === Boolean(github)) throw new Error('Choose a folder or a GitHub repository');
  if (!Array.isArray(scopes) || !scopes.length || scopes.some((s) => !SCOPES.includes(s))) throw new Error(`Scopes: ${SCOPES.join(',')}`);
  if (github && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(github)) throw new Error('GitHub repository must be owner/repository');
  if (target && (typeof target !== 'string' || !isAbsolute(target) || !lstatSync(safe(target)).isDirectory())) throw new Error('Choose an existing absolute folder (mount your NAS first)');
  device(env, name);
  const next = { version: 1, target: target ? resolve(target) : null, github: github ?? null, scopes: [...new Set(scopes)] };
  const old = readUserData(env, 'sync-config.json');
  if (old && (old.target !== next.target || old.github !== next.github)) throw new Error('Changing sync destinations is not supported; use the existing destination');
  writeUserData(env, 'sync-config.json', next);
  return syncStatus({ env });
}

function portable(key, value, kitRoot) {
  if (key !== 'settings/profile' && key !== 'settings/setup-defaults' && !/^presets\/[a-z0-9][a-z0-9-]*$/.test(key) && !KNOWLEDGE_KEY(key)) throw new Error('Unknown portable record');
  if (value === null) return null;
  if (key === 'settings/setup-defaults') {
    const checked = setupDefaults({ kitRoot }, value);
    return { version: 1, modules: checked.modules, answers: checked.answers };
  }
  if (key.startsWith('knowledge/')) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((k) => k !== 'text') || typeof value.text !== 'string' || !value.text.trim() ||
      value.text.includes('\0') || Buffer.byteLength(value.text) > MAX_RECORD) throw new Error('Invalid knowledge record');
    if (secretValueRule(loadRules({ kitRoot }), value.text)) throw new Error('Sync refused secret-looking data');
    return { text: value.text };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid portable record');
  const preset = key.startsWith('presets/');
  if (key !== 'settings/profile' && !/^presets\/[a-z0-9][a-z0-9-]*$/.test(key)) throw new Error('Unknown portable record');
  const doc = structuredClone(value);
  if (preset) { doc.source = 'synced'; if (doc.name !== key.slice(8)) throw new Error('Preset name mismatch'); }
  // Machine-dependent answers stay on their originating device, including inside presets.
  for (const k of Object.keys(doc.answers ?? {})) if (/(path|folder|directory|endpoint|host|url|root)$/i.test(k)) delete doc.answers[k];
  if (schemas().validate(preset ? 'preset.schema.json' : 'user-profile.schema.json', doc).length) throw new Error('Invalid synced settings or preset');
  if (secretFindings({ answers: doc.answers, kitRoot }).length || secretFindings({ answers: { 'user.description': doc.description ?? '' }, kitRoot }).length) throw new Error('Sync refused secret-looking data');
  return doc;
}
// ~/.yaw/knowledge/**/*.md as portable records. Links, secret-looking names and text, and oversized files stay local.
// Markdown files that exist but cannot be synced are added to `excluded`, so the merge leaves them alone rather than reading them as deletions.
function localKnowledge(env, kitRoot, excluded) {
  const out = {}, rules = loadRules({ kitRoot }), root = safe(join(userDir(env), 'knowledge'));
  const walk = (rel, depth) => {
    let names = [];
    try { names = readdirSync(join(root, rel)).sort(); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
    for (const name of names) {
      if (!PART.test(name)) continue;
      const child = rel ? `${rel}/${name}` : name, path = join(root, child), key = /\.md$/i.test(name) ? `knowledge/${child}` : null;
      let st; try { st = lstatSync(path); } catch { if (key) excluded.add(key); continue; }
      if (st.isSymbolicLink()) { if (key) excluded.add(key); continue; }
      if (st.isDirectory()) { if (depth < 4) walk(child, depth + 1); continue; }
      if (!key) continue;
      if (!st.isFile() || st.size > MAX_RECORD || Object.keys(out).length >= 1000) { excluded.add(key); continue; }
      let text; try { text = read(path); } catch { excluded.add(key); continue; }
      if (text === null) continue;
      if (!text.trim() || text.includes('\0') || secretValueRule(rules, text)) { excluded.add(key); continue; }
      out[key] = { text };
    }
  };
  walk('', 0);
  return out;
}
function localRecords(env, scopes, kitRoot, excluded = new Set()) {
  const out = {};
  if (scopes.includes('settings')) {
    const text = read(join(userDir(env), 'user-profile.yaml'));
    out['settings/profile'] = text === null ? null : portable('settings/profile', parse(text), kitRoot);
    if (out['settings/profile'] && !Object.keys(out['settings/profile'].answers).length) out['settings/profile'] = null;
  }
  if (scopes.includes('knowledge')) Object.assign(out, localKnowledge(env, kitRoot, excluded));
  if (scopes.includes('presets')) {
    const dir = safe(join(userDir(env), 'presets'));
    let names = [];
    try { names = readdirSync(dir); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    for (const n of names.filter((n) => /^[a-z0-9][a-z0-9-]*\.yaml$/.test(n))) {
      const key = `presets/${n.slice(0, -5)}`;
      out[key] = portable(key, parse(read(join(dir, n))), kitRoot);
    }
  }
  return out;
}
// Per-session numerical summaries, keyed without workspace paths. Counts are never added to old snapshots.
function statistics(env) {
  return (readUserData(env, 'session-analysis.json')?.rows ?? []).filter((r) => typeof r.id === 'string' && r.id.length > 0).map((r) => {
    const row = { key: sessionKey(r.id) };
    for (const k of NUMBERS) {
      const v = r[k] ?? r.metrics?.[k];
      row[k] = finite(v) ? v : null;
    }
    // Start time, length and response figures let another device chart this session; no title, project or path.
    const started = Date.parse(r.started), ended = Date.parse(r.ended);
    const extra = { started, minutes: Number.isFinite(ended) && ended >= started ? Math.round((ended - started) / 60000) : null,
      medianAnswerChars: r.metrics?.medianAnswerChars, p95AnswerChars: r.metrics?.p95AnswerChars, medianResponseMs: r.metrics?.medianResponseMs, p95ResponseMs: r.metrics?.p95ResponseMs };
    for (const k of EXTRA) row[k] = finite(extra[k]) ? extra[k] : null;
    for (const k of LABELS) row[k] = typeof r[k] === 'string' && LABEL_RE.test(r[k]) ? r[k] : null;
    return row;
  });
}
// Excluded keys exist locally but cannot be synced: they are neither published, applied nor reported as conflicts.
export function mergeRecords(local, remote, base, resolution, excluded = []) {
  const records = {}, conflicts = [];
  for (const key of new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(base)])) {
    if (excluded.includes(key)) continue;
    const l = local[key] ?? null, r = remote[key] ?? null, b = base[key] ?? null;
    if (equal(l, r) || equal(r, b)) records[key] = l;
    else if (equal(l, b)) records[key] = r;
    else if (resolution === 'local' || resolution === 'remote') records[key] = resolution === 'local' ? l : r;
    else conflicts.push(key);
  }
  return { records, conflicts };
}
export function validateVault(v, kitRoot) {
  if (!v || v.version !== 1 || !v.records || !v.devices || Array.isArray(v.records) || Array.isArray(v.devices) || Object.keys(v).some((k) => !['version', 'records', 'devices'].includes(k))) throw new Error('Unsupported sync vault');
  for (const [k, value] of Object.entries(v.records)) v.records[k] = portable(k, value, kitRoot);
  for (const [id, d] of Object.entries(v.devices)) {
    if (!/^[a-f0-9-]{36}$/.test(id) || !d || !Array.isArray(d.rows) || d.rows.length > 100000 || Object.keys(d).some((k) => !['name', 'updated', 'rows', 'tasks'].includes(k)) || !Number.isFinite(Date.parse(d.updated))) throw new Error('Invalid device statistics');
    label(d.name);
    if (d.tasks !== undefined) validTasks(d.tasks, kitRoot);
    for (const r of d.rows) {
      // Rows written by older versions have no EXTRA or label fields; they still count in the totals.
      if (!/^[a-f0-9]{64}$/.test(r.key) || Object.keys(r).some((k) => k !== 'key' && ![...NUMBERS, ...EXTRA, ...LABELS].includes(k)) ||
        [...NUMBERS, ...EXTRA].some((k) => r[k] !== undefined && r[k] !== null && !finite(r[k])) ||
        LABELS.some((k) => r[k] !== undefined && r[k] !== null && !(typeof r[k] === 'string' && LABEL_RE.test(r[k])))) throw new Error('Invalid numeric summary');
    }
  }
  return v;
}
// Task snapshots: the project's folder name (never its path) with the ledger's active and backlog items.
const text = (v, max = 300) => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max) : null;
function cleanTasks(list, kitRoot) {
  const rules = loadRules({ kitRoot }), out = [];
  for (const t of Array.isArray(list) ? list : []) {
    if (!t?.available || typeof t.project !== 'string' || out.length >= MAX_TASK_PROJECTS) continue;
    const name = t.project.split('/').filter(Boolean).pop()?.replace(/[^\p{L}\p{N} _.-]/gu, '-').slice(0, 64);
    if (!name) continue;
    const item = (i, extra) => ({ id: text(i?.id, 40), issue: typeof i?.issue === 'number' || typeof i?.issue === 'string' ? (typeof i.issue === 'number' ? i.issue : text(i.issue, 40)) : null, title: text(i?.title), [extra]: extra === 'progress' ? (Number.isFinite(i?.progress) && i.progress >= 0 && i.progress <= 100 ? i.progress : null) : text(i?.note), ...(extra === 'progress' ? { status: text(i?.status, 80) } : {}) });
    const active = (t.active ?? []).slice(0, MAX_TASK_ITEMS).map((i) => item(i, 'progress')), backlog = (t.backlog ?? []).slice(0, MAX_TASK_ITEMS).map((i) => item(i, 'note'));
    if (secretValueRule(rules, JSON.stringify([active, backlog]))) continue;
    out.push({ name, active, backlog });
  }
  return out;
}
const TASK_KEYS = { active: ['id', 'issue', 'title', 'progress', 'status'], backlog: ['id', 'issue', 'title', 'note'] };
function validTasks(list, kitRoot) {
  if (!Array.isArray(list) || list.length > MAX_TASK_PROJECTS) throw new Error('Invalid task snapshots');
  const rules = loadRules({ kitRoot });
  for (const t of list) {
    if (!t || typeof t !== 'object' || Object.keys(t).some((k) => !['name', 'active', 'backlog'].includes(k))) throw new Error('Invalid task snapshots');
    label(t.name);
    for (const kind of ['active', 'backlog']) {
      if (!Array.isArray(t[kind]) || t[kind].length > MAX_TASK_ITEMS) throw new Error('Invalid task snapshots');
      for (const i of t[kind]) if (!i || typeof i !== 'object' || Object.keys(i).some((k) => !TASK_KEYS[kind].includes(k)) || Object.values(i).some((v) => v !== null && typeof v !== 'string' && typeof v !== 'number')) throw new Error('Invalid task snapshots');
    }
    if (secretValueRule(rules, JSON.stringify(t))) throw new Error('Sync refused secret-looking data');
  }
}
function totals(devices, selected) {
  const rows = new Map();
  // A duplicated session uses the most complete observation, never the sum of overlapping snapshots.
  for (const [id, d] of Object.entries(devices).sort()) {
    if (selected && id !== selected) continue;
    for (const row of d.rows) {
      const old = rows.get(row.key);
      if (!old || (row.prompts ?? 0) + (row.answers ?? 0) > (old.prompts ?? 0) + (old.answers ?? 0)) rows.set(row.key, row);
    }
  }
  return { sessions: rows.size, ...Object.fromEntries(NUMBERS.map((k) => [k, [...rows.values()].some((r) => r[k] !== null) ? [...rows.values()].reduce((s, r) => s + (r[k] ?? 0), 0) : null])) };
}
// Sessions other devices contributed, for the Sessions pages: the most complete copy of each, none of this device's own.
export function syncedSessions(env) {
  const hub = remoteSettings(env).enabled ? readUserData(env, 'hub-sync.json') : null;
  if (![...(readUserData(env, 'sync-config.json')?.scopes ?? []), ...(hub?.scopes ?? [])].includes('statistics')) return [];
  const state = hub?.scopes.includes('statistics') ? readUserData(env, 'hub-sync-state.json') : readUserData(env, 'sync-state.json');
  const me = hub?.scopes.includes('statistics') ? state?.deviceId : readUserData(env, 'sync-device.json')?.id;
  const rows = new Map();
  for (const [id, d] of Object.entries(state?.devices ?? {}).sort()) {
    if (id === me) continue;
    for (const row of d.rows ?? []) {
      const old = rows.get(row.key);
      if (!old || (row.prompts ?? 0) + (row.answers ?? 0) > (old.prompts ?? 0) + (old.answers ?? 0)) rows.set(row.key, { ...row, deviceId: id, device: d.name });
    }
  }
  return [...rows.values()];
}
// Task snapshots of other devices' projects: [{ device, name, active, backlog }]
export function syncedTasks(env) {
  const hub = remoteSettings(env).enabled ? readUserData(env, 'hub-sync.json') : null;
  if (![...(readUserData(env, 'sync-config.json')?.scopes ?? []), ...(hub?.scopes ?? [])].includes('tasks')) return [];
  const state = hub?.scopes.includes('tasks') ? readUserData(env, 'hub-sync-state.json') : readUserData(env, 'sync-state.json');
  const me = hub?.scopes.includes('tasks') ? state?.deviceId : readUserData(env, 'sync-device.json')?.id;
  return Object.entries(state?.devices ?? {}).sort().filter(([id]) => id !== me).flatMap(([, d]) => (d.tasks ?? []).map((t) => ({ device: d.name, ...t })));
}
export function syncStatus({ env, selected } = {}) {
  const cfg = readUserData(env, 'sync-config.json');
  const state = readUserData(env, 'sync-state.json') ?? {};
  const d = readUserData(env, 'sync-device.json');
  const devices = state.devices ?? {};
  return { configured: Boolean(cfg), config: cfg, device: d, lastSync: state.lastSync ?? null, conflicts: state.conflicts ?? [],
    totals: totals(devices, selected), devices: Object.entries(devices).map(([id, v]) => ({ id, name: v.name, local: id === d?.id, updated: v.updated, ...totals(devices, id) })) };
}
function command(bin, args, cwd, env) {
  const result = spawnSync(bin, args, { cwd, env: { ...env, GIT_TERMINAL_PROMPT: '0' }, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${bin} sync operation failed; check authentication, connectivity and repository permissions`);
  return result.stdout.trim();
}
// Cancellable counterpart of command() for the web job: the whole process group is stopped so Git helpers do not outlive an abort.
function commandAsync(bin, args, cwd, env, signal) {
  return new Promise((resolve, reject) => {
    const fail = () => new Error(`${bin} sync operation failed; check authentication, connectivity and repository permissions`);
    let child, out = '', done = false;
    const stop = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* already gone */ } } };
    const finish = (fn, value) => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort); fn(value); };
    const onAbort = () => { stop(); finish(reject, new Error('Sync cancelled')); };
    if (signal?.aborted) return reject(new Error('Sync cancelled'));
    try { child = spawn(bin, args, { cwd, env: { ...env, GIT_TERMINAL_PROMPT: '0' }, detached: true, stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch { return reject(fail()); }
    const timer = setTimeout(() => { stop(); finish(reject, fail()); }, 60000);
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { out += chunk; if (out.length > 1024 * 1024) { stop(); finish(reject, fail()); } });
    child.on('error', () => finish(reject, fail()));
    child.on('close', (code) => code === 0 ? finish(resolve, out.trim()) : finish(reject, fail()));
  });
}
const describe = (bin, args) => { const rest = [...args]; while (rest[0] === '-c') rest.splice(0, 2); return `${bin} ${rest[0]}`; };
// Each external command is yielded as [bin, args, cwd, env]; the caller runs it (synchronously for the CLI, asynchronously for the web job) and sends back its output.
function* syncSteps({ env, kitRoot, resolution, name }) {
  if (resolution !== undefined && !['local', 'remote'].includes(resolution)) throw new Error('Resolution must be local or remote');
  const cfg = readUserData(env, 'sync-config.json');
  if (!cfg) throw new Error('Configure sync first');
  cfg.scopes = cfg.scopes.filter((s) => !readUserData(env, 'hub-sync.json')?.scopes?.includes(s));
  if (!cfg.scopes.length) throw new Error('These datasets have migrated to the hub; use yaw remote sync');
  const d = device(env, name);
  const home = safe(userDataDir(env));
  const lock = join(home, 'sync.lock');
  try { mkdirSync(lock, { mode: 0o700 }); } catch { throw new Error('Sync is already running (or sync.lock needs manual recovery)'); }
  let remoteLock;
  try {
    let dir = cfg.target;
    if (cfg.github) {
      if ((yield ['gh', ['repo', 'view', cfg.github, '--json', 'isPrivate', '--jq', '.isPrivate'], home, env]) !== 'true') throw new Error('Sync requires a private GitHub repository');
      dir = safe(join(home, 'sync-github'));
      if (!read(join(dir, '.git', 'HEAD'))) yield ['git', ['-c', 'core.hooksPath=/dev/null', 'clone', '--', `https://github.com/${cfg.github}.git`, dir], home, env];
      else yield ['git', ['-c', 'core.hooksPath=/dev/null', 'pull', '--ff-only'], dir, env];
    }
    if (!lstatSync(safe(dir)).isDirectory()) throw new Error('Sync folder is unavailable');
    remoteLock = join(dir, '.yaw-sync.lock');
    try { mkdirSync(remoteLock, { mode: 0o700 }); } catch { remoteLock = null; throw new Error('Destination is busy; retry later'); }
    const file = join(dir, 'yaw-sync.json');
    const vault = validateVault(json(file, { version: 1, records: {}, devices: {} }), kitRoot);
    const state = readUserData(env, 'sync-state.json') ?? { base: {} };
    const excluded = new Set(), local = localRecords(env, cfg.scopes, kitRoot, excluded);
    const enabled = (key) => cfg.scopes.includes(scopeOf(key));
    const subset = (obj) => Object.fromEntries(Object.entries(obj).filter(([k]) => enabled(k)));
    const merged = mergeRecords(local, subset(vault.records), subset(state.base ?? {}), resolution, [...excluded]);
    if (merged.conflicts.length) {
      writeUserData(env, 'sync-state.json', { ...state, conflicts: merged.conflicts });
      return { ...syncStatus({ env }), message: 'Conflicts need a choice; no portable records were changed.' };
    }
    Object.assign(vault.records, merged.records);
    const stats = cfg.scopes.includes('statistics'), tasks = cfg.scopes.includes('tasks');
    if (stats || tasks) vault.devices[d.id] = { name: d.name, updated: new Date().toISOString(), rows: stats ? statistics(env) : [], ...(tasks ? { tasks: cleanTasks(readUserData(env, 'session-analysis.json')?.tasks, kitRoot) } : {}) };
    else delete vault.devices[d.id];
    if (!equal(local, localRecords(env, cfg.scopes, kitRoot))) throw new Error('Local settings changed during sync; retry');
    // Publish before applying incoming changes. Failed publication leaves local files and the merge base intact.
    validateVault(vault, kitRoot);
    write(file, `${JSON.stringify(vault)}\n`);
    if (cfg.github) {
      yield ['git', ['add', '--', 'yaw-sync.json'], dir, env];
      if (yield ['git', ['diff', '--cached', '--name-only', '--', 'yaw-sync.json'], dir, env]) yield ['git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=YAW Sync', '-c', 'user.email=yaw@localhost', 'commit', '--only', '-m', 'Sync portable YAW data', '--', 'yaw-sync.json'], dir, env];
      yield ['git', ['-c', 'core.hooksPath=/dev/null', 'push'], dir, env];
    }
    if (!equal(local, localRecords(env, cfg.scopes, kitRoot))) throw new Error('Local settings changed during sync; retry');
    applyPortableRecords({ env, records: merged.records });
    writeUserData(env, 'sync-state.json', { base: { ...(state.base ?? {}), ...merged.records }, devices: stats || tasks ? vault.devices : {}, lastSync: new Date().toISOString(), conflicts: [] });
    return { ...syncStatus({ env }), excluded: [...excluded], message: 'Sync complete.' };
  } finally {
    if (remoteLock) rmdirSync(remoteLock);
    rmdirSync(lock);
  }
}
export function runSync({ env, kitRoot, resolution, name, execute = command }) {
  const steps = syncSteps({ env, kitRoot, resolution, name });
  let step = steps.next();
  while (!step.done) {
    let output;
    try { output = execute(...step.value); } catch (e) { step = steps.throw(e); continue; }
    step = steps.next(output);
  }
  return step.value;
}
export async function runSyncAsync({ env, kitRoot, resolution, name, execute = commandAsync, signal, onStep }) {
  const steps = syncSteps({ env, kitRoot, resolution, name });
  let step = steps.next();
  while (!step.done) {
    let output;
    try {
      if (signal?.aborted) throw new Error('Sync cancelled');
      onStep?.(describe(step.value[0], step.value[1]));
      output = await execute(...step.value, signal);
    } catch (e) { step = steps.throw(e); continue; }
    step = steps.next(output);
  }
  return step.value;
}

export function portableSnapshot({ env, kitRoot, scopes, name, serverMode = false }) {
  const excluded = new Set(), records = localRecords(env, scopes, kitRoot, excluded);
  if (serverMode && scopes.includes('settings')) records['settings/setup-defaults'] = portable('settings/setup-defaults', readUserData(env, 'setup-defaults.json'), kitRoot);
  return { records, excluded: [...excluded], device: { name: device(env, name).name, updated: new Date().toISOString(),
    rows: scopes.includes('statistics') ? statistics(env) : [], ...(scopes.includes('tasks') ? { tasks: cleanTasks(readUserData(env, 'session-analysis.json')?.tasks, kitRoot) } : {}) } };
}
export const portableScope = scopeOf;
export function applyPortableRecords({ env, records }) {
    for (const [key, value] of Object.entries(records)) {
      if (key === 'settings/setup-defaults') {
        if (value !== null) writeUserData(env, 'setup-defaults.json', value);
        else { const file = join(userDataDir(env), 'setup-defaults.json'); safe(file); try { unlinkSync(file); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
        continue;
      }
      const path = join(userDir(env), key === 'settings/profile' ? 'user-profile.yaml' : key.startsWith('knowledge/') ? join(...key.split('/')) : `${key}.yaml`);
      if (value === null) {
        const previous = key.startsWith('knowledge/') ? null : read(path);
        const paths = Object.fromEntries(Object.entries(previous ? parse(previous)?.answers ?? {} : {}).filter(([k]) => /(path|folder|directory|endpoint|host|url|root)$/i.test(k)));
        if (key === 'settings/profile' && Object.keys(paths).length) write(path, stringify({ answers: paths }));
        else { safe(path); try { unlinkSync(path); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
      }
      else if (key.startsWith('knowledge/')) write(path, value.text);
      else {
        const doc = structuredClone(value);
        // Keep local path answers while applying the portable portion.
        const previous = read(path);
        for (const [k, v] of Object.entries(previous ? parse(previous)?.answers ?? {} : {})) if (/(path|folder|directory|endpoint|host|url|root)$/i.test(k)) doc.answers[k] = v;
        write(path, stringify(doc));
      }
    }
}
