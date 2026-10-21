// Session registry (Y-5.7, ADR-0029): the sessions / session_links tables of ~/.yaw/yaw.db (BD3, ADR-0018),
// written by the module's hooks and read by `yaw sessions`. Metadata and paths only: no prompt text, no
// transcript content (doc 12 §4). Every path is checked before it is opened, symlinks are refused, and
// nothing read from the database or from a project file is ever executed or opened.

import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadSqlite, migrate } from '../../../core/lib/db.js';
import { parseTasks } from '../../../core/lib/tasks.js';
import { checkRelPath } from '../../../core/render/files.js';
import { yawHome } from '../../../core/hooks/dispatch.js';

export class RegistryError extends Error {}

export const AGENTS = ['claude', 'codex', 'copilot'];
export const NATIVE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const SESSION_ID = /^(claude|codex|copilot):[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const TASK_REF = /^(T-\d{1,6}|#\d{1,9})$/;
const TRAILER_KEY = 'Agent-Session';
const ACTIVE_WINDOW_MS = 4 * 60 * 60 * 1000; // a session counts as "current" for 4 h after its last hook
const MAX_TITLE = 120;
const MAX_FILES = 50;
const MAX_COMMITS = 100;
const MAX_LEDGER_BYTES = 1024 * 1024;
const GIT_TIMEOUT_MS = 5000;

// Control characters (terminal escapes) never reach the screen or a stored title.
export const clean = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim();
const clip = (s, n) => ([...s].length > n ? `${[...s].slice(0, n - 1).join('')}…` : s);

// ------------------------------------------------------------------------------------------ file access

// Read a project file only if every component is a real directory / regular file (no symlink anywhere).
// -> text, or null when it is missing, unsafe, or too large. Never throws.
export function readRegular(root, rel) {
  try {
    checkRelPath(rel);
    let cur = root;
    const parts = rel.split('/');
    for (let i = 0; i < parts.length; i += 1) {
      cur = join(cur, parts[i]);
      const st = lstatSync(cur);
      if (st.isSymbolicLink()) return null;
      if (i < parts.length - 1 ? !st.isDirectory() : !st.isFile() || st.size > MAX_LEDGER_BYTES) return null;
    }
    return readFileSync(cur, 'utf8');
  } catch {
    return null;
  }
}

export function realRoot(root) {
  try {
    return realpathSync(root);
  } catch {
    return root;
  }
}

// ~/.yaw/yaw.db (or $YAW_HOME): the file itself must be a regular file, not a link somebody planted.
export function registryFile(env) {
  return join(yawHome(env), 'yaw.db');
}

// 0700 for the registry directory: when it was just created, or when it is a real directory (not a link) named
// .yaw that we own. Never follows a link, never touches a directory the user pointed YAW_HOME at (YAW_HOME=$HOME),
// never throws.
export function tightenHome(home, existed, uid = process.getuid?.()) {
  try {
    const st = lstatSync(home);
    if (st.isSymbolicLink() || !st.isDirectory() || st.uid !== uid) return false;
    if (existed && basename(home) !== '.yaw') return false;
    chmodSync(home, 0o700);
    return true;
  } catch {
    return false;
  }
}

export function openRegistry(env) {
  const home = yawHome(env);
  if (!home) throw new RegistryError('no home directory for ~/.yaw/yaw.db (set HOME or YAW_HOME)');
  const existed = existsSync(home);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  tightenHome(home, existed);
  const file = registryFile(env);
  try {
    const st = lstatSync(file);
    if (st.isSymbolicLink() || !st.isFile()) throw new RegistryError(`${file} must be a regular file, not a link`);
  } catch (e) {
    if (e instanceof RegistryError) throw e;
    if (e.code !== 'ENOENT') throw new RegistryError(`${file} cannot be checked (${e.code})`);
  }
  const { DatabaseSync } = loadSqlite();
  const db = new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout = 3000'); // several sessions (hooks) write the same file
  db.exec('PRAGMA foreign_keys = ON');
  migrate(db);
  return db;
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
  return { claude: `claude --resume ${nativeId}`, codex: `codex resume ${nativeId}`, copilot: `copilot --resume ${nativeId}` }[agent];
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
