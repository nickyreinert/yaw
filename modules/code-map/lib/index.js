// code-map index (Y-5.11, ADR-0033): which files the map covers, and the rebuildable per-worktree cache.
//
// listFiles   the working tree (tracked + untracked, not ignored), after the exclusions and the link checks
// refresh     stat + SHA-256 per file, reusing the cache when the stat tuple is unchanged
// cache       ~/.yaw/cache/code-map/<key>.json, outside the project; temp file + rename, no lock
//
// Nothing here opens a file that an exclusion or a symlink check rejected.

import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { parse } from '../../../core/lib/yaml.js';

export const MAX_HASH_BYTES = 8 * 1024 * 1024;
export const SCHEMA = 1;

// Environment problems (not in a git work tree, a symlinked map file): exit code 2.
export class MapEnvError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MapEnvError';
  }
}

// ---------------------------------------------------------------- globs

// `**` any depth, `*` within a segment, `?` one character. A pattern without wildcards also matches everything under it.
export function globToRegExp(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}${/[*?]/.test(pattern) ? '' : '(?:/.*)?'}$`);
}

const globCache = new Map();
export function matches(pattern, path) {
  let re = globCache.get(pattern);
  if (!re) {
    re = globToRegExp(pattern.replace(/\/+$/, ''));
    globCache.set(pattern, re);
  }
  return re.test(path);
}

// ---------------------------------------------------------------- exclusions

// Directories excluded at any depth / only at the top level (generated outputs, dependencies, kit bookkeeping).
const ANY_DEPTH = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv']);
const TOP_LEVEL = new Set(['.yaw', 'vendor', 'dist', 'build', 'coverage']);

// The secretFiles / secretAllow patterns of the security module, read from the kit even when it is not installed.
export function loadSecretRules(kitRoot) {
  try {
    const doc = parse(readFileSync(join(kitRoot, 'modules', 'security', 'guards.yaml'), 'utf8'));
    const compile = (list) => (list ?? []).map((r) => new RegExp(r.pattern));
    return { files: compile(doc.secretFiles), allow: compile(doc.secretAllow) };
  } catch {
    return { files: [], allow: [] };
  }
}

export function isSecretName(rules, path) {
  const name = path.split('/').pop();
  if (rules.allow.some((re) => re.test(name))) return false;
  return rules.files.some((re) => re.test(name));
}

// Pure checks on the path text, before any file system access.
export function excludedByName(path, { secrets, exclude = [] }) {
  // control characters, backticks and backslashes would break the generated Markdown (and are never source files)
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f`\\]/.test(path)) return true;
  const parts = path.split('/');
  if (parts.slice(0, -1).some((p) => ANY_DEPTH.has(p)) || ANY_DEPTH.has(parts[0])) return true;
  if (parts.length > 1 && TOP_LEVEL.has(parts[0])) return true;
  if (secrets && isSecretName(secrets, path)) return true;
  return exclude.some((g) => matches(g, path));
}

// ---------------------------------------------------------------- git

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
  return r.error || r.status !== 0 ? null : r.stdout;
}

// { top, gitDir, head, branch } for a directory inside a git work tree, else null.
export function gitInfo(root) {
  const out = git(root, ['rev-parse', '--is-inside-work-tree', '--show-toplevel', '--git-dir']);
  if (!out) return null;
  const [inside, top, gitDir] = out.toString('utf8').split('\n');
  if (inside !== 'true') return null;
  const head = git(root, ['rev-parse', 'HEAD'])?.toString('utf8').trim() ?? null;
  const branch = git(root, ['symbolic-ref', '--short', '-q', 'HEAD'])?.toString('utf8').trim() ?? null;
  return { top: realpathSync(top), gitDir: realpathSync(resolve(root, gitDir)), head, branch };
}

function walk(realRoot, dir = '') {
  const out = [];
  let entries;
  try {
    entries = readdirSync(join(realRoot, dir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (ANY_DEPTH.has(e.name) || (!dir && TOP_LEVEL.has(e.name))) continue;
      out.push(...walk(realRoot, rel));
    } else out.push(rel);
  }
  return out;
}

// ---------------------------------------------------------------- enumeration

// Sorted project-relative paths of the regular files the map covers, plus the number of excluded candidates.
// A git work tree lists tracked and untracked non-ignored files; outside one (only the init starter) the tree is walked.
export function listFiles(root, { kitRoot, exclude = [], useGit = true } = {}) {
  const realRoot = realpathSync(root);
  const secrets = loadSecretRules(kitRoot);
  let candidates;
  const out = useGit ? git(realRoot, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']) : null;
  if (out) candidates = out.toString('utf8').split('\0').filter(Boolean);
  else candidates = walk(realRoot);
  const dirOk = new Map([['', true]]);
  const parentOk = (dir) => {
    if (dirOk.has(dir)) return dirOk.get(dir);
    const cut = dir.lastIndexOf('/');
    let ok = parentOk(cut === -1 ? '' : dir.slice(0, cut));
    if (ok) {
      try {
        ok = lstatSync(join(realRoot, dir)).isDirectory(); // lstat: a symlinked directory is not a directory
      } catch {
        ok = false;
      }
    }
    dirOk.set(dir, ok);
    return ok;
  };
  const files = [];
  let excluded = 0;
  for (const path of [...new Set(candidates)].sort(compare)) {
    if (excludedByName(path, { secrets, exclude })) {
      excluded++;
      continue;
    }
    const cut = path.lastIndexOf('/');
    let ok = parentOk(cut === -1 ? '' : path.slice(0, cut));
    if (ok) {
      try {
        ok = lstatSync(join(realRoot, path)).isFile(); // gone (deleted), a symlink, a submodule or a directory: not listed
      } catch {
        ok = false;
      }
    }
    if (ok) files.push(path);
    else excluded++;
  }
  return { files, excluded };
}

export function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------------------------------------------------------------- hashing and the index

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

// SHA-256 of a regular file, opened with O_NOFOLLOW; null for files over 8 MiB or when it is not a regular file.
// `open` is a seam for tests (spy on what gets opened).
export function hashFile(realRoot, path, { open = openSync } = {}) {
  const fd = open(join(realRoot, path), constants.O_RDONLY | NOFOLLOW);
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > MAX_HASH_BYTES) return null;
    const hash = createHash('sha256');
    const buf = Buffer.allocUnsafe(64 * 1024);
    for (;;) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      hash.update(buf.subarray(0, n));
    }
    return hash.digest('hex');
  } finally {
    closeSync(fd);
  }
}

const tuple = (e) => `${e.size}:${e.mode}:${e.mtimeNs}:${e.ctimeNs}:${e.ino}`;

// The index for `files`: path -> { size, mode, mtimeNs, ctimeNs, ino, sha256 }. A file whose stat tuple matches the
// cache keeps its hash unless it was modified at or after the cache write (racily clean).
export function refresh(root, files, { cache = null, open } = {}) {
  const realRoot = realpathSync(root);
  const written = cache?.written ? BigInt(cache.written) * 1_000_000n : 0n;
  const index = {};
  for (const path of files) {
    let st;
    try {
      st = lstatSync(join(realRoot, path), { bigint: true });
    } catch {
      continue; // gone since the listing
    }
    if (!st.isFile()) continue;
    const entry = { size: Number(st.size), mode: Number(st.mode), mtimeNs: String(st.mtimeNs), ctimeNs: String(st.ctimeNs), ino: String(st.ino), sha256: null };
    const old = cache?.files?.[path];
    if (old && tuple(old) === tuple(entry) && BigInt(entry.mtimeNs) < written && BigInt(entry.ctimeNs) < written) {
      entry.sha256 = old.sha256;
    } else {
      try {
        entry.sha256 = hashFile(realRoot, path, { open });
      } catch {
        continue; // unreadable or replaced by a link: not indexed
      }
    }
    index[path] = entry;
  }
  return index;
}

// What changed between two indexes. A deleted path whose hash shows up at an added path is a rename (a hint).
export function diffIndex(before, after) {
  const added = Object.keys(after).filter((p) => !before[p]).sort(compare);
  const deleted = Object.keys(before).filter((p) => !after[p]).sort(compare);
  const edited = Object.keys(after).filter((p) => before[p] && (before[p].sha256 !== after[p].sha256 || before[p].size !== after[p].size)).sort(compare);
  const renamed = [];
  const free = new Set(added);
  for (const from of deleted) {
    const sha = before[from].sha256;
    if (!sha) continue;
    const to = [...free].find((p) => after[p].sha256 === sha);
    if (to) {
      renamed.push({ from, to });
      free.delete(to);
    }
  }
  const gone = new Set(renamed.map((r) => r.from));
  const arrived = new Set(renamed.map((r) => r.to));
  return { added: added.filter((p) => !arrived.has(p)), deleted: deleted.filter((p) => !gone.has(p)), edited, renamed };
}

// ---------------------------------------------------------------- cache

// ~/.yaw (or an absolute YAW_HOME); null when neither is an absolute path (the index then lives in memory only).
export function yawHome(env) {
  const home = env.YAW_HOME || (env.HOME ? join(env.HOME, '.yaw') : '');
  return home && isAbsolute(home) ? home : null;
}

export function cacheKey(info) {
  return createHash('sha256').update(`${info.top}\0${info.gitDir}`).digest('hex').slice(0, 16);
}

export function cacheFile(env, info) {
  const home = yawHome(env);
  return home ? join(home, 'cache', 'code-map', `${cacheKey(info)}.json`) : null;
}

// The cache of this worktree, or null (missing, unreadable, another schema or another tree).
export function readCache(file, info) {
  if (!file) return null;
  try {
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    if (doc.schema !== SCHEMA || doc.root !== info.top || doc.gitDir !== info.gitDir || typeof doc.files !== 'object') return null;
    return doc;
  } catch {
    return null;
  }
}

// Temp file in the same directory + rename; two writers each leave a complete snapshot, the last rename wins.
export function writeCache(file, info, index, { kit = '', now = Date.now() } = {}) {
  if (!file) return false;
  const doc = { schema: SCHEMA, kit, root: info.top, gitDir: info.gitDir, head: info.head, branch: info.branch, written: now, files: index };
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(tmp, `${JSON.stringify(doc)}\n`, { flag: 'wx', mode: 0o600 });
    renameSync(tmp, file);
    return true;
  } catch {
    try { unlinkSync(tmp); } catch { /* not created */ }
    return false;
  }
}

export function removeCache(env, info) {
  const file = cacheFile(env, info);
  if (!file) return false;
  try {
    unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

// docs/code-map.md must be a regular file inside the project: no symlink in any component.
// -> { state: 'ok' | 'missing', text }; throws MapEnvError otherwise.
export function readMapFile(root, rel) {
  const realRoot = realpathSync(root);
  const parts = rel.split('/');
  let cur = realRoot;
  for (let i = 0; i < parts.length; i++) {
    cur = join(cur, parts[i]);
    let st;
    try {
      st = lstatSync(cur);
    } catch (e) {
      if (e.code === 'ENOENT') return { state: 'missing', text: null };
      throw e;
    }
    if (st.isSymbolicLink()) throw new MapEnvError(`${rel} is behind a symbolic link (${parts.slice(0, i + 1).join('/')}); the code map must be a regular file inside the project`);
    if (i < parts.length - 1 && !st.isDirectory()) throw new MapEnvError(`${parts.slice(0, i + 1).join('/')} is not a directory`);
    if (i === parts.length - 1 && !st.isFile()) throw new MapEnvError(`${rel} is not a regular file`);
  }
  const fd = openSync(cur, constants.O_RDONLY | NOFOLLOW);
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw new MapEnvError(`${rel} is not a regular file`);
    return { state: 'ok', text: readFileSync(fd, 'utf8') };
  } finally {
    closeSync(fd);
  }
}
