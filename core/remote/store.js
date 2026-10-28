// Execution metadata is deliberately separate from analytics and portable data (ADR-0018).
import { createHash, randomUUID } from 'node:crypto';
import { constants, openSync, closeSync, writeFileSync, unlinkSync, readFileSync, lstatSync, mkdirSync, fstatSync } from 'node:fs';
import { join, resolve, parse, sep } from 'node:path';
import { readUserData, writeUserData, userDataDir } from '../lib/user-store.js';

export const digest = (value) => createHash('sha256').update(String(value)).digest('hex');
export class RemoteError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function requireValue(condition, message, status = 400) {
  if (!condition) throw new RemoteError(message, status);
}
export function safeDirectory(path, create = false) {
  path = resolve(path);
  let part = parse(path).root;
  for (const name of path.slice(part.length).split(sep).filter(Boolean)) {
    part = join(part, name);
    if (create) { try { mkdirSync(part, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; } }
    const st = lstatSync(part);
    requireValue(st.isDirectory() && !st.isSymbolicLink(), 'Remote storage requires real directories');
  }
  return path;
}
export function remoteStore(env) {
  safeDirectory(userDataDir(env), true);
  const file = join(userDataDir(env), 'remote.lock');
  let fd;
  try { fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const old = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let stale = false, stat;
    try {
      stat = fstatSync(old);
      requireValue(stat.isFile() && stat.size < 32, 'Remote service lock is invalid');
      const text = readFileSync(old, 'utf8');
      requireValue(/^[1-9][0-9]*\n$/.test(text), 'Remote service lock is invalid');
      try { process.kill(Number(text.trim()), 0); } catch (err) { stale = err.code === 'ESRCH'; }
    } finally { closeSync(old); }
    if (!stale) throw new RemoteError('Remote service lock exists. Stop the other service; inspect remote.lock if its PID was reused.', 409);
    const current = lstatSync(file);
    requireValue(current.ino === stat.ino && current.dev === stat.dev, 'Remote lock changed; retry startup', 409);
    unlinkSync(file);
    fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  }
  writeFileSync(fd, `${process.pid}\n`); closeSync(fd);
  let state;
  try {
    state = readUserData(env, 'remote-state.json') ?? { version: 1, projects: [], sessions: [], receipts: {}, devices: [], telegram: null, offset: 0 };
    requireValue(state.version === 1, 'Unsupported remote metadata version');
    for (const session of state.sessions) {
      if (!['completed', 'failed', 'stopped'].includes(session.state)) session.state = 'unknown';
    }
    for (const receipt of Object.values(state.receipts)) if (['received', 'dispatched'].includes(receipt.status)) receipt.status = 'unknown';
    writeUserData(env, 'remote-state.json', state);
  } catch (e) { unlinkSync(file); throw e; }
  let closed = false;
  return {
    state,
    save() { requireValue(!closed, 'Remote store is closed', 503); writeUserData(env, 'remote-state.json', state); },
    close() { if (!closed) { closed = true; unlinkSync(file); } },
  };
}
export const identifier = () => randomUUID();
