// Manual portable data exchange. Native histories and local paths never enter the vault.
import { constants, openSync, closeSync, fstatSync, readFileSync, writeFileSync, renameSync, mkdirSync, lstatSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { join, resolve, dirname, parse as parsePath, isAbsolute, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { spawnSync } from 'node:child_process';
import { userDir, userDataDir, readUserData, writeUserData, secretFindings } from './user-store.js';
import { parse, stringify } from './yaml.js';
import { schemas } from '../render/kit.js';

const hash = (v) => createHash('sha256').update(v).digest('hex');
const canonical = (v) => JSON.stringify(v, (_, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x);
const equal = (a, b) => canonical(a ?? null) === canonical(b ?? null);
const NUMBERS = ['tokens_in', 'tokens_out', 'cost_usd', 'prompts', 'answers', 'promptChars', 'answerChars'];
// Per-session figures that place a session on a chart (never summed in the totals) and its two plain labels.
const EXTRA = ['started', 'minutes', 'medianAnswerChars', 'p95AnswerChars', 'medianResponseMs', 'p95ResponseMs'];
const LABELS = ['agent', 'model'];
const LABEL_RE = /^[\p{L}\p{N} _.:\/@+()-]{1,80}$/u;
const SCOPES = ['settings', 'presets', 'statistics'];
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
export function configureSync({ env, target, github, name, scopes = SCOPES }) {
  if (Boolean(target) === Boolean(github)) throw new Error('Choose a folder or a GitHub repository');
  if (!Array.isArray(scopes) || !scopes.length || scopes.some((s) => !SCOPES.includes(s))) throw new Error('Scopes: settings,presets,statistics');
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
  if (key !== 'settings/profile' && !/^presets\/[a-z0-9][a-z0-9-]*$/.test(key)) throw new Error('Unknown portable record');
  if (value === null) return null;
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
function localRecords(env, scopes, kitRoot) {
  const out = {};
  if (scopes.includes('settings')) {
    const text = read(join(userDir(env), 'user-profile.yaml'));
    out['settings/profile'] = text === null ? null : portable('settings/profile', parse(text), kitRoot);
    if (out['settings/profile'] && !Object.keys(out['settings/profile'].answers).length) out['settings/profile'] = null;
  }
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
export function mergeRecords(local, remote, base, resolution) {
  const records = {}, conflicts = [];
  for (const key of new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(base)])) {
    const l = local[key] ?? null, r = remote[key] ?? null, b = base[key] ?? null;
    if (equal(l, r) || equal(r, b)) records[key] = l;
    else if (equal(l, b)) records[key] = r;
    else if (resolution === 'local' || resolution === 'remote') records[key] = resolution === 'local' ? l : r;
    else conflicts.push(key);
  }
  return { records, conflicts };
}
function validateVault(v, kitRoot) {
  if (!v || v.version !== 1 || !v.records || !v.devices || Array.isArray(v.records) || Array.isArray(v.devices) || Object.keys(v).some((k) => !['version', 'records', 'devices'].includes(k))) throw new Error('Unsupported sync vault');
  for (const [k, value] of Object.entries(v.records)) v.records[k] = portable(k, value, kitRoot);
  for (const [id, d] of Object.entries(v.devices)) {
    if (!/^[a-f0-9-]{36}$/.test(id) || !d || !Array.isArray(d.rows) || d.rows.length > 100000 || Object.keys(d).some((k) => !['name', 'updated', 'rows'].includes(k)) || !Number.isFinite(Date.parse(d.updated))) throw new Error('Invalid device statistics');
    label(d.name);
    for (const r of d.rows) {
      // Rows written by older versions have no EXTRA or label fields; they still count in the totals.
      if (!/^[a-f0-9]{64}$/.test(r.key) || Object.keys(r).some((k) => k !== 'key' && ![...NUMBERS, ...EXTRA, ...LABELS].includes(k)) ||
        [...NUMBERS, ...EXTRA].some((k) => r[k] !== undefined && r[k] !== null && !finite(r[k])) ||
        LABELS.some((k) => r[k] !== undefined && r[k] !== null && !(typeof r[k] === 'string' && LABEL_RE.test(r[k])))) throw new Error('Invalid numeric summary');
    }
  }
  return v;
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
  const state = readUserData(env, 'sync-state.json'), me = readUserData(env, 'sync-device.json')?.id;
  const rows = new Map();
  for (const [id, d] of Object.entries(state?.devices ?? {}).sort()) {
    if (id === me) continue;
    for (const row of d.rows ?? []) {
      const old = rows.get(row.key);
      if (!old || (row.prompts ?? 0) + (row.answers ?? 0) > (old.prompts ?? 0) + (old.answers ?? 0)) rows.set(row.key, { ...row, device: d.name });
    }
  }
  return [...rows.values()];
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
export function runSync({ env, kitRoot, resolution, name, execute = command }) {
  if (resolution !== undefined && !['local', 'remote'].includes(resolution)) throw new Error('Resolution must be local or remote');
  const cfg = readUserData(env, 'sync-config.json');
  if (!cfg) throw new Error('Configure sync first');
  const d = device(env, name);
  const home = safe(userDataDir(env));
  const lock = join(home, 'sync.lock');
  try { mkdirSync(lock, { mode: 0o700 }); } catch { throw new Error('Sync is already running (or sync.lock needs manual recovery)'); }
  let remoteLock;
  try {
    let dir = cfg.target;
    if (cfg.github) {
      if (execute('gh', ['repo', 'view', cfg.github, '--json', 'isPrivate', '--jq', '.isPrivate'], home, env) !== 'true') throw new Error('Sync requires a private GitHub repository');
      dir = safe(join(home, 'sync-github'));
      if (!read(join(dir, '.git', 'HEAD'))) execute('git', ['-c', 'core.hooksPath=/dev/null', 'clone', '--', `https://github.com/${cfg.github}.git`, dir], home, env);
      else execute('git', ['-c', 'core.hooksPath=/dev/null', 'pull', '--ff-only'], dir, env);
    }
    if (!lstatSync(safe(dir)).isDirectory()) throw new Error('Sync folder is unavailable');
    remoteLock = join(dir, '.yaw-sync.lock');
    try { mkdirSync(remoteLock, { mode: 0o700 }); } catch { remoteLock = null; throw new Error('Destination is busy; retry later'); }
    const file = join(dir, 'yaw-sync.json');
    const vault = validateVault(json(file, { version: 1, records: {}, devices: {} }), kitRoot);
    const state = readUserData(env, 'sync-state.json') ?? { base: {} };
    const local = localRecords(env, cfg.scopes, kitRoot);
    const enabled = (key) => cfg.scopes.includes(key.startsWith('presets/') ? 'presets' : 'settings');
    const subset = (obj) => Object.fromEntries(Object.entries(obj).filter(([k]) => enabled(k)));
    const merged = mergeRecords(local, subset(vault.records), subset(state.base ?? {}), resolution);
    if (merged.conflicts.length) {
      writeUserData(env, 'sync-state.json', { ...state, conflicts: merged.conflicts });
      return { ...syncStatus({ env }), message: 'Conflicts need a choice; no portable records were changed.' };
    }
    Object.assign(vault.records, merged.records);
    if (cfg.scopes.includes('statistics')) vault.devices[d.id] = { name: d.name, updated: new Date().toISOString(), rows: statistics(env) };
    if (!equal(local, localRecords(env, cfg.scopes, kitRoot))) throw new Error('Local settings changed during sync; retry');
    // Publish before applying incoming changes. Failed publication leaves local files and the merge base intact.
    validateVault(vault, kitRoot);
    write(file, `${JSON.stringify(vault)}\n`);
    if (cfg.github) {
      execute('git', ['add', '--', 'yaw-sync.json'], dir, env);
      if (execute('git', ['diff', '--cached', '--name-only', '--', 'yaw-sync.json'], dir, env)) execute('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'user.name=YAW Sync', '-c', 'user.email=yaw@localhost', 'commit', '--only', '-m', 'Sync portable YAW data', '--', 'yaw-sync.json'], dir, env);
      execute('git', ['-c', 'core.hooksPath=/dev/null', 'push'], dir, env);
    }
    if (!equal(local, localRecords(env, cfg.scopes, kitRoot))) throw new Error('Local settings changed during sync; retry');
    for (const [key, value] of Object.entries(merged.records)) {
      const path = join(userDir(env), key === 'settings/profile' ? 'user-profile.yaml' : `${key}.yaml`);
      if (value === null) {
        const previous = read(path);
        const paths = Object.fromEntries(Object.entries(previous ? parse(previous)?.answers ?? {} : {}).filter(([k]) => /(path|folder|directory|endpoint|host|url|root)$/i.test(k)));
        if (key === 'settings/profile' && Object.keys(paths).length) write(path, stringify({ answers: paths }));
        else { safe(path); try { unlinkSync(path); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
      }
      else {
        const doc = structuredClone(value);
        // Keep local path answers while applying the portable portion.
        const previous = read(path);
        for (const [k, v] of Object.entries(previous ? parse(previous)?.answers ?? {} : {})) if (/(path|folder|directory|endpoint|host|url|root)$/i.test(k)) doc.answers[k] = v;
        write(path, stringify(doc));
      }
    }
    writeUserData(env, 'sync-state.json', { base: { ...(state.base ?? {}), ...merged.records }, devices: cfg.scopes.includes('statistics') ? vault.devices : {}, lastSync: new Date().toISOString(), conflicts: [] });
    return { ...syncStatus({ env }), message: 'Sync complete.' };
  } finally {
    if (remoteLock) rmdirSync(remoteLock);
    rmdirSync(lock);
  }
}
