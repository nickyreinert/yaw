// Recall store (T-055, kickoff/16-compact-output.md §4 L6, ADR-0133): the raw output of a cut tool result, kept in
// ~/.yaw/recall/<hash>.gz so `yaw recall <hash>` can show it. Optional (the `recall` lever), off by default, and
// the first place YAW stores tool-output content. Same private rules as the hook logs (core/hooks/common.js):
// directory 0700, files 0600, owned by us, never through a symbolic link. At most 200 entries, 30 days and 10 MB
// per entry. Never read by data sync, which lists the files it takes by name.

import { chmodSync, closeSync, constants, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { yawHome } from '../../../core/hooks/common.js';
import { UsageError } from '../../../core/cli/commands.js';

export const MAX_ENTRIES = 200;
export const MAX_AGE_MS = 30 * 24 * 3600 * 1000;
export const MAX_BYTES = 10 * 1024 * 1024;

const HASH = /^[a-f0-9]{16}$/;
const ENTRY = /^[a-f0-9]{16}\.gz$/;
const ours = (st) => !process.getuid || st.uid === process.getuid();

// The recall directory as a private real directory of ours; null when it does not exist and `create` is false.
function privateDir(env, create) {
  const dir = join(yawHome(env), 'recall');
  if (create) mkdirSync(dir, { recursive: true, mode: 0o700 });
  let st;
  try { st = lstatSync(dir); } catch (e) {
    if (e.code === 'ENOENT' && !create) return null;
    throw e;
  }
  if (st.isSymbolicLink() || !st.isDirectory() || !ours(st)) throw new Error(`${dir} must be a directory of yours, not a symbolic link`);
  if (st.mode & 0o077) chmodSync(dir, 0o700);
  return dir;
}

// Drop expired entries and the oldest beyond the limit. Only files named like entries are touched; a link
// with an entry's name is removed (unlink never follows it).
function prune(dir, now) {
  const live = [];
  for (const name of readdirSync(dir).filter((n) => ENTRY.test(n))) {
    const path = join(dir, name);
    try {
      const st = lstatSync(path);
      if (!st.isFile() || now - st.mtimeMs > MAX_AGE_MS) unlinkSync(path);
      else live.push({ path, name, mtime: st.mtimeMs });
    } catch { /* gone already */ }
  }
  live.sort((a, b) => a.mtime - b.mtime || (a.name < b.name ? -1 : 1));
  for (const { path } of live.slice(0, Math.max(0, live.length - MAX_ENTRIES))) {
    try { unlinkSync(path); } catch { /* gone already */ }
  }
}

// -> the 16-digit hash of `raw`, or null when it could not be stored (over 10 MB, a linked or foreign
// directory, any I/O error). Never throws: a failed store falls back to the re-run hint.
export function storeRecall(env, raw, now = Date.now()) {
  try {
    const data = Buffer.from(raw);
    if (data.length > MAX_BYTES) return null;
    const hash = createHash('sha256').update(data).digest('hex').slice(0, 16);
    const dir = privateDir(env, true);
    // A temporary file we create exclusively, renamed over the name: a link planted at the name is replaced,
    // never written through.
    const temp = join(dir, `.tmp-${process.pid}-${randomBytes(6).toString('hex')}`);
    const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      fchmodSync(fd, 0o600);
      writeFileSync(fd, gzipSync(data));
    } catch (e) {
      try { unlinkSync(temp); } catch { /* nothing left to remove */ }
      throw e;
    } finally {
      closeSync(fd);
    }
    renameSync(temp, join(dir, `${hash}.gz`));
    prune(dir, now);
    return hash;
  } catch {
    return null;
  }
}

// -> the raw output as a Buffer. Throws a readable error for a malformed hash, a missing, expired, linked,
// foreign or oversized entry.
export function readRecall(env, hash, now = Date.now()) {
  if (!HASH.test(hash)) throw new Error('not a recall hash (16 hex digits, as printed after "yaw recall")');
  const missing = () => new Error(`no recall entry ${hash} (entries are kept ${MAX_AGE_MS / 86400000} days, at most ${MAX_ENTRIES}; the recall lever must be on to store them)`);
  const dir = privateDir(env, false);
  if (!dir) throw missing();
  let fd;
  try {
    fd = openSync(join(dir, `${hash}.gz`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (e) {
    if (e.code === 'ENOENT') throw missing();
    if (e.code === 'ELOOP') throw new Error(`recall entry ${hash} is a symbolic link; not followed`);
    throw e;
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || !ours(st)) throw new Error(`recall entry ${hash} is not a regular file of yours`);
    if (now - st.mtimeMs > MAX_AGE_MS) throw missing();
    if (st.size > MAX_BYTES) throw new Error(`recall entry ${hash} is larger than ${MAX_BYTES} bytes`);
    return gunzipSync(readFileSync(fd), { maxOutputLength: MAX_BYTES });
  } finally {
    closeSync(fd);
  }
}

// `yaw recall <hash>`: print the stored raw output.
export function recall({ positionals, io }) {
  if (positionals.length !== 1) throw new UsageError('give the hash printed after "full output: yaw recall"');
  io.stdout.write(readRecall(io.env ?? process.env, positionals[0]));
  return 0;
}
