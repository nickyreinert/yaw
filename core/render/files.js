// Project file access for the render engine: hashing (ADR-0003), path guard, atomic writes.
// Every write and delete goes through here, so no kit command can touch a path outside the project.

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';

export const MANIFEST = '.yaw/manifest.json';
export const BASE_DIR = '.yaw/base';

export class PathError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PathError';
  }
}

// sha256 over the content with CRLF normalised to LF (ADR-0003). Byte-preserving for non-UTF-8 input.
export function hashContent(content) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
  const normalised = Buffer.from(buf.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
  return `sha256:${createHash('sha256').update(normalised).digest('hex')}`;
}

// Validate a project-relative path. Rejects absolute paths, "..", backslashes, NUL, ".git" and
// (unless kitOwned) the kit's own bookkeeping paths.
export function checkRelPath(rel, { kitOwned = false } = {}) {
  if (typeof rel !== 'string' || rel === '') throw new PathError('empty path');
  if (rel.includes('\0')) throw new PathError(`invalid path "${rel}": NUL byte`);
  if (rel.includes('\\')) throw new PathError(`invalid path "${rel}": backslash`);
  if (isAbsolute(rel) || rel.startsWith('/')) throw new PathError(`path "${rel}" is absolute`);
  const parts = rel.split('/');
  if (parts.some((p) => p === '..')) throw new PathError(`path "${rel}" escapes the project`);
  if (parts.some((p) => p === '' || p === '.')) throw new PathError(`invalid path "${rel}"`);
  if (parts[0] === '.git') throw new PathError(`path "${rel}" is inside .git`);
  if (!kitOwned && (rel === MANIFEST || rel === BASE_DIR || rel.startsWith(`${BASE_DIR}/`))) {
    throw new PathError(`path "${rel}" is reserved for the kit`);
  }
  return rel;
}

// Resolve rel inside root. The deepest existing ancestor must resolve (through symlinks) inside root.
export function resolveInside(root, rel, options) {
  checkRelPath(rel, options);
  const realRoot = realpathSync(root);
  const target = join(realRoot, ...rel.split('/'));
  let probe = dirname(target);
  while (!existsSync(probe)) probe = dirname(probe);
  assertInside(realRoot, realpathSync(probe), rel);
  if (existsSync(target) || isSymlink(target)) {
    const st = lstatSync(target);
    if (st.isSymbolicLink()) {
      let real;
      try {
        real = realpathSync(target);
      } catch {
        throw new PathError(`path "${rel}" is a dangling symlink`);
      }
      assertInside(realRoot, real, rel);
    }
  }
  return target;
}

function isSymlink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function assertInside(realRoot, real, rel) {
  const r = relative(realRoot, real);
  if (r === '') return;
  if (r === '..' || r.startsWith(`..${sep}`) || isAbsolute(r)) throw new PathError(`path "${rel}" escapes the project`);
}

export function readProjectFile(root, rel, options) {
  const p = resolveInside(root, rel, options);
  try {
    return readFileSync(p);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

// Write via a temp file in the same directory + rename, so readers never see a half-written file.
export function writeAtomic(root, rel, content, options) {
  const target = resolveInside(root, rel, options);
  mkdirSync(dirname(target), { recursive: true });
  resolveInside(root, rel, options); // re-check after creating directories
  const tmp = join(dirname(target), `.${basename(target)}.yaw-${process.pid}-${randomBytes(4).toString('hex')}`);
  try {
    writeFileSync(tmp, content, { flag: 'wx' });
    renameSync(tmp, target);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* already gone */ }
    throw e;
  }
}

// Delete a file and every directory left empty by it, up to (not including) the project root.
export function removeFile(root, rel, options) {
  const target = resolveInside(root, rel, options);
  try {
    unlinkSync(target);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  pruneEmptyDirs(root, dirname(rel));
}

export function pruneEmptyDirs(root, relDir) {
  const realRoot = realpathSync(root);
  let dir = relDir;
  while (dir && dir !== '.') {
    const abs = join(realRoot, ...dir.split('/'));
    try {
      if (readdirSync(abs).length > 0) return;
      rmdirSync(abs);
    } catch (e) {
      if (e.code !== 'ENOENT') return;
    }
    dir = dirname(dir);
  }
}

export function basePath(rel) {
  return `${BASE_DIR}/${rel}`;
}
