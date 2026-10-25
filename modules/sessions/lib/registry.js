// Session registry (Y-5.7, ADR-0029): the sessions / session_links tables of ~/.yaw/yaw.db (BD3, ADR-0018),
// written by the module's hooks and read by `yaw sessions`. Metadata and paths only: no prompt text, no
// transcript content (doc 12 §4). Descriptor checks mitigate path swaps; SQLite still opens by pathname
// (see ADR-0029's filesystem boundary). Registry values are never executed.

import { closeSync, constants, existsSync, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadSqlite, migrate } from '../../../core/lib/db.js';
import { parseTasks } from '../../../core/lib/tasks.js';
import { checkRelPath } from '../../../core/render/files.js';
import { yawHome } from '../../../core/hooks/dispatch.js';

export class RegistryError extends Error {}

export const AGENTS = ['claude', 'codex', 'copilot', 'gemini'];
export const NATIVE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const SESSION_ID = /^(claude|codex|copilot|gemini):[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const TASK_REF = /^(T-\d{1,6}|#\d{1,9})$/;
const TRAILER_KEY = 'Agent-Session';
const ACTIVE_WINDOW_MS = 4 * 60 * 60 * 1000; // a session counts as "current" for 4 h after its last hook
const MAX_TITLE = 120;
const MAX_FILES = 50;
const MAX_COMMITS = 100;
const MAX_LEDGER_BYTES = 1024 * 1024;
const GIT_TIMEOUT_MS = 5000;
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino;

// Control characters (terminal escapes) never reach the screen or a stored title.
export const clean = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim();
const clip = (s, n) => ([...s].length > n ? `${[...s].slice(0, n - 1).join('')}…` : s);

// ------------------------------------------------------------------------------------------ file access

// Check relative components, then bind the read to the checked file's device/inode.
// -> text, or null when it is missing, unsafe, or too large. Never throws.
export function readRegular(root, rel, { open = openSync } = {}) {
  let fd;
  try {
    checkRelPath(rel);
    let cur = root;
    let expected;
    const parts = rel.split('/');
    for (let i = 0; i < parts.length; i += 1) {
      cur = join(cur, parts[i]);
      const st = lstatSync(cur);
      if (st.isSymbolicLink()) return null;
      if (i < parts.length - 1 ? !st.isDirectory() : !st.isFile() || st.size > MAX_LEDGER_BYTES) return null;
      expected = st;
    }
    fd = open(cur, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > MAX_LEDGER_BYTES || !sameFile(expected, st)) return null;
    return readFileSync(fd, 'utf8');
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function realRoot(root) {
  try {
    return realpathSync(root);
  } catch {
    return root;
  }
}

// ~/.yaw/yaw.db (or $YAW_HOME).
export function registryFile(env) {
  return join(yawHome(env), 'yaw.db');
}

// 0700 for the registry directory: when it was just created, or when it is a real directory (not a link) named
// .yaw that we own. Never follows a link, never touches a directory the user pointed YAW_HOME at (YAW_HOME=$HOME),
// never throws.
export function tightenHome(home, existed, uid = process.getuid?.(), { open = openSync } = {}) {
  let fd;
  try {
    if (!isAbsolute(home)) return false;
    home = home.replace(/\/+$/, '') || '/'; // a trailing slash would make lstat follow a link
    const st = lstatSync(home);
    if (st.isSymbolicLink() || !st.isDirectory() || st.uid !== uid) return false;
    if (existed && basename(home) !== '.yaw') return false;
    fd = open(home, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const actual = fstatSync(fd);
    if (!actual.isDirectory() || !sameFile(st, actual) || actual.uid !== uid) return false;
    fchmodSync(fd, 0o700);
    return true;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// Mode bits cannot attest ACLs or isolate another process running as the same user.
function trustedAncestry(directory, uid) {
  let cur = realpathSync(directory);
  for (;;) {
    const st = lstatSync(cur);
    const sticky = (st.mode & 0o1000) !== 0;
    if (!st.isDirectory() || ![0, uid].includes(st.uid) || ((st.mode & 0o022) !== 0 && !sticky)) {
      throw new RegistryError(`${cur}: registry ancestry must be owned by you or root and not writable by others (except sticky directories)`);
    }
    const parent = dirname(cur);
    if (cur === parent) return;
    cur = parent;
  }
}

function checkRegistryEntry(file, uid, { missing = false } = {}) {
  try {
    const st = lstatSync(file);
    if (!st.isFile() || st.uid !== uid || st.nlink !== 1 || (st.mode & 0o022) !== 0) {
      throw new RegistryError(`${file} must be an owner-controlled regular file, not a link or shared writable file`);
    }
    return st;
  } catch (e) {
    if (missing && e.code === 'ENOENT') return null;
    if (e instanceof RegistryError) throw e;
    throw new RegistryError(`${file} cannot be checked (${e.code})`);
  }
}

export function openRegistry(env, { open = openSync, database } = {}) {
  const configured = yawHome(env);
  if (!isAbsolute(configured)) throw new RegistryError('HOME or YAW_HOME must be an absolute path for the session registry');
  const home = resolve(configured);
  const uid = process.getuid?.();
  if (uid === undefined) throw new RegistryError('the session registry requires POSIX ownership checks');
  let ancestor = home;
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  trustedAncestry(ancestor, uid);
  const existed = existsSync(home);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  tightenHome(home, existed);
  const homeStat = lstatSync(home);
  if (!homeStat.isDirectory() || homeStat.uid !== uid || (homeStat.mode & 0o077) !== 0) {
    throw new RegistryError(`${home} must be a private directory owned by you; choose a private YAW_HOME (mode 0700)`);
  }
  trustedAncestry(home, uid);
  const file = join(home, 'yaw.db');
  const sidecars = ['-journal', '-wal', '-shm'].map((suffix) => `${file}${suffix}`);
  const checkSidecars = () => {
    for (const sidecar of sidecars) checkRegistryEntry(sidecar, uid, { missing: true });
  };
  let expected = checkRegistryEntry(file, uid, { missing: true });
  let fd;
  let db;
  try {
    const flags = constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK;
    try {
      fd = open(file, flags | (expected ? 0 : constants.O_CREAT | constants.O_EXCL), 0o600);
    } catch (e) {
      if (expected || e.code !== 'EEXIST') throw e;
      // Another hook may have created the registry after our missing-file check.
      expected = checkRegistryEntry(file, uid);
      fd = open(file, flags);
    }
    const actual = fstatSync(fd);
    if (!actual.isFile() || actual.uid !== uid || actual.nlink !== 1 || (expected && !sameFile(expected, actual))) {
      throw new RegistryError(`${file} changed while opening the registry`);
    }
    fchmodSync(fd, 0o600);
    checkSidecars();
    const { DatabaseSync } = loadSqlite();
    db = database ? database(file) : new DatabaseSync(file);
    // Detect persistent replacements before schema writes; this is not an atomic SQLite open.
    if (!sameFile(actual, checkRegistryEntry(file, uid)) || !sameFile(homeStat, lstatSync(home))) {
      throw new RegistryError(`${file} changed while opening SQLite`);
    }
    checkSidecars();
    db.exec('PRAGMA busy_timeout = 3000'); // several sessions (hooks) write the same file
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db);
    return db;
  } catch (e) {
    db?.close();
    if (e instanceof RegistryError) throw e;
    throw new RegistryError(`${file} could not be opened (${e.code ?? e.message})`);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function withRegistry(env, fn) {
  const db = openRegistry(env);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

// ------------------------------------------------------------------------------------------ git (fixed arguments, no shell)

function git(root, args, env) {
  const r = spawnSync('git', args, { cwd: root, env, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });
  return r.status === 0 && !r.error ? r.stdout : null;
}

// "feat/T-012-invite-flow" -> "T-012"; "fix/34-crash" -> "#34"; otherwise null.
export function branchTask(branch) {
  const m = /^[a-z]+\/(T-\d{1,6}|\d{1,9})-/.exec(String(branch ?? ''));
  if (!m) return null;
  return m[1].startsWith('T-') ? m[1] : `#${Number(m[1])}`;
}

// ------------------------------------------------------------------------------------------ what a session works on

// Active tasks of TASKS.md (when the tasks module's ledger exists and parses): [{ ref, title }].
export function activeTasks(root) {
  const text = readRegular(root, 'TASKS.md');
  if (text === null) return [];
  try {
    return parseTasks(text).active
      .map((t) => ({ ref: String(t.id).startsWith('#') || String(t.id).startsWith('T-') ? String(t.id) : `#${t.id}`, title: clean(t.title) }))
      .filter((t) => TASK_REF.test(t.ref))
      .slice(0, 3);
  } catch {
    return [];
  }
}

// Title from the active task (doc 12 §4): "T-012 Invite flow"; the task of the branch wins when it is active.
export function snapshot(root, env) {
  const branch = clean(git(root, ['branch', '--show-current'], env) ?? '') || null;
  const tasks = activeTasks(root);
  const onBranch = branchTask(branch);
  const lead = tasks.find((t) => t.ref === onBranch) ?? tasks[0];
  const refs = [...new Set([...(onBranch ? [onBranch] : []), ...tasks.map((t) => t.ref)])];
  return { branch, refs, title: lead ? clip(`${lead.ref} ${lead.title}`.trim(), MAX_TITLE) : null };
}

export function resumeCommand(agent, nativeId) {
  if (!NATIVE_ID.test(nativeId)) throw new RegistryError('the session id has an unexpected form');
  return { claude: `claude --resume ${nativeId}`, codex: `codex resume ${nativeId}`, copilot: `copilot --resume ${nativeId}`, gemini: `gemini --resume ${nativeId}` }[agent];
}

export const sessionId = (agent, native) => (AGENTS.includes(agent) && typeof native === 'string' && NATIVE_ID.test(native) ? `${agent}:${native}` : null);

// Commits whose message carries `Agent-Session: <id>` (exact match), newest first, and the files they touch.
// Bounded (runs on every Stop): only HEAD's history, only since the session started, at most 100 commits.
// `known` (already linked commit refs) are not diffed again.
export function commitsOf(root, id, env, { since, known = new Set(), maxFiles = MAX_FILES } = {}) {
  const out = git(root, ['log', '--fixed-strings', `--grep=${TRAILER_KEY}: ${id}`, `--max-count=${MAX_COMMITS}`,
    ...(since ? [`--since=${since}`] : []),
    `--format=%H%x1f%(trailers:key=${TRAILER_KEY},valueonly,separator=%x1f)%x1e`], env);
  if (out === null) return { commits: [], files: [] };
  const commits = [];
  for (const rec of out.split('\x1e')) {
    const [hash, ...values] = rec.trim().split('\x1f');
    if (/^[0-9a-f]{40,64}$/.test(hash ?? '') && values.some((v) => v.trim() === id)) commits.push(hash);
  }
  const files = new Set();
  for (const hash of commits) {
    if (files.size >= maxFiles) break;
    if (known.has(hash.slice(0, 12))) continue;
    const names = git(root, ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', '-z', hash], env) ?? '';
    for (const name of names.split('\0')) {
      if (files.size >= maxFiles) break;
      try {
        if (name !== '') files.add(checkRelPath(name));
      } catch { /* a path the kit would not write is not recorded */ }
    }
  }
  return { commits: commits.map((h) => h.slice(0, 12)), files: [...files] };
}

// ------------------------------------------------------------------------------------------ writes

function link(db, id, kind, refs) {
  const add = db.prepare('INSERT OR IGNORE INTO session_links (session_id, kind, ref) VALUES (?, ?, ?)');
  for (const ref of refs) add.run(id, kind, ref);
}

function validTranscript(p) {
  return typeof p === 'string' && p.length > 0 && p.length <= 1024 && p.startsWith('/') && !/[\u0000-\u001f\u007f]/.test(p) ? p : null;
}

// Create or refresh one session. The title is set once (a handoff or custom title is never overwritten).
// end: also stamp `ended` (Stop, SessionEnd, handoff). Returns the session id, or null for an unusable id.
export function recordSession({ db, env, root, agent, native, transcript = null, now, end = false, title }) {
  const id = sessionId(agent, native);
  if (id === null) return null;
  const project = realRoot(root);
  const snap = snapshot(project, env);
  const stamp = (now instanceof Date ? now : new Date(now ?? Date.now())).toISOString();
  db.prepare(`INSERT INTO sessions (id, agent, project, title, started, ended, branch, resume, transcript)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET
      branch = COALESCE(excluded.branch, sessions.branch),
      transcript = COALESCE(sessions.transcript, excluded.transcript),
      title = COALESCE(?, sessions.title, excluded.title),
      ended = CASE WHEN ? THEN excluded.started ELSE sessions.ended END`)
    .run(id, agent, project, snap.title, stamp, end ? stamp : null, snap.branch, resumeCommand(agent, native), validTranscript(transcript),
      title ? clip(clean(title), MAX_TITLE) : null, end ? 1 : 0);
  link(db, id, 'task', snap.refs);
  if (end) {
    const started = db.prepare('SELECT started FROM sessions WHERE id = ?').get(id)?.started;
    const known = new Set(db.prepare("SELECT ref FROM session_links WHERE session_id = ? AND kind = 'commit'").all(id).map((r) => r.ref));
    const haveFiles = db.prepare("SELECT COUNT(*) AS n FROM session_links WHERE session_id = ? AND kind = 'file'").get(id).n;
    const found = commitsOf(project, id, env, { since: started, known, maxFiles: Math.max(0, MAX_FILES - haveFiles) });
    link(db, id, 'commit', found.commits);
    link(db, id, 'file', found.files);
  }
  return id;
}

// ------------------------------------------------------------------------------------------ reads

// The session the current work belongs to: $YAW_SESSION, else the project's most recently active session
// within the last 4 h. null when there is none (a commit then simply carries no trailer).
export function currentSession({ db, root, env, now = new Date() }) {
  const forced = env.YAW_SESSION;
  if (typeof forced === 'string' && forced !== '') return SESSION_ID.test(forced) ? forced : null;
  const row = db.prepare('SELECT id, COALESCE(ended, started) AS last FROM sessions WHERE project = ? ORDER BY last DESC LIMIT 1').get(realRoot(root));
  if (!row) return null;
  if (!SESSION_ID.test(row.id)) throw new RegistryError('this registry row looks damaged; not printing its session id');
  return now.getTime() - Date.parse(row.last) <= ACTIVE_WINDOW_MS ? row.id : null;
}

// "Agent-Session: claude:5f2c…" for `just commit`, or null. Never throws: a commit does not fail over the registry.
export function sessionTrailer({ root, env, now }) {
  try {
    const id = withRegistry(env, (db) => currentSession({ db, root, env, now }));
    return id ? `${TRAILER_KEY}: ${id}` : null;
  } catch {
    return null;
  }
}
