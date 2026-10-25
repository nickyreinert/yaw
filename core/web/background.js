import { fork } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, constants, fchmodSync, fstatSync, ftruncateSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { userDir } from '../lib/user-store.js';

// `root === null` is the shared dashboard server for YAW projects; a folder root is a per-folder dashboard server.
const stateName = (root) => root === null ? 'dashboard.json' : `${createHash('sha256').update(realpathSync(root)).digest('hex')}.json`;

export function stateFile(root, env, create = false) {
  const dir = join(userDir(env), 'web');
  if (create) mkdirSync(dir, { recursive: true, mode: 0o700 });
  let st;
  try { st = lstatSync(dir); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (!st) return join(dir, stateName(root));
  if (!st.isDirectory() || st.isSymbolicLink() || (st.mode & 0o077)) {
    throw new Error('The YAW web state directory must be a private directory (0700), not a symlink');
  }
  return join(dir, stateName(root));
}

function openState(file, flags) {
  const fd = openSync(file, flags | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  const st = fstatSync(fd);
  if (!st.isFile() || (st.mode & 0o077) || (process.getuid && st.uid !== process.getuid())) {
    closeSync(fd);
    throw new Error('The YAW web state must be a private regular file (0600)');
  }
  return fd;
}

function writePrivate(file, text) {
  const fd = openState(file, constants.O_WRONLY | constants.O_CREAT);
  try {
    fchmodSync(fd, 0o600);
    ftruncateSync(fd, 0);
    writeFileSync(fd, text);
  } finally {
    closeSync(fd);
  }
}

export function writeState(file, state) {
  writePrivate(file, JSON.stringify(state));
}

export function writeBackgroundLauncher({ root, env, url }) {
  if (!/^http:\/\/127\.0\.0\.1:\d+\/\?t=[a-f0-9]{64}$/.test(url)) throw new Error('Invalid background web login link');
  const file = `${stateFile(root, env)}.html`;
  writePrivate(file, `<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="refresh" content="0;url=${url}"><title>YAW web</title>\n`);
  return file;
}

function readState(file) {
  let fd;
  try {
    fd = openState(file, constants.O_RDONLY);
    const state = JSON.parse(readFileSync(fd, 'utf8'));
    if (!Number.isInteger(state.port) || state.port < 1 || state.port > 65535 ||
        !/^[a-f0-9]{64}$/.test(state.controlToken)) throw new Error('Invalid YAW web state; the server may still be starting. Retry yaw web.');
    return state;
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    if (e instanceof SyntaxError) throw new Error('YAW web state is incomplete; the server may still be starting. Retry yaw web.');
    throw e;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

// A failed connection can be stale state; never signal a PID from a state file.
export async function backgroundRequest({ root, env, action = 'open', body }) {
  const file = stateFile(root, env);
  const state = readState(file);
  if (!state) return null;
  let response;
  try {
    response = await fetch(`http://127.0.0.1:${state.port}/api/web/${action}`, {
      method: 'POST', headers: { 'x-yaw-control': state.controlToken, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(5000), redirect: 'error',
    });
  } catch (e) {
    if (e.cause?.code === 'ECONNREFUSED') {
      unlinkSync(file);
      return { stale: true };
    }
    throw new Error(`Could not contact the background web server (${e.cause?.code ?? e.name}); it was not stopped or replaced`);
  }
  if (!response.ok) throw new Error(`Background web server refused ${action} (${response.status}); it was not stopped or replaced`);
  const result = await response.json();
  if (action === 'open' && !new RegExp(`^http://127\\.0\\.0\\.1:${state.port}/\\?t=[a-f0-9]{64}$`).test(result.url)) {
    throw new Error('Background web server returned an invalid login link');
  }
  return result;
}

export async function startBackground({ io, shared = false }) {
  const file = stateFile(shared ? null : io.cwd, io.env, true);
  const fd = openState(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL);
  closeSync(fd);
  const controlToken = randomBytes(32).toString('hex');
  const log = openState(`${file}.log`, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND);
  const child = fork(new URL('./background-worker.js', import.meta.url), [], {
    cwd: io.cwd, env: io.env, detached: true, stdio: ['ignore', 'ignore', log, 'ipc'],
    execArgv: [],
  });
  closeSync(log);
  try {
    const ready = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Background web server did not become ready within 15 seconds')), 15000);
      const cleanup = () => clearTimeout(timer);
      child.once('error', (e) => { cleanup(); reject(e); });
      child.once('exit', (code) => { cleanup(); reject(new Error(`Background web server exited before readiness (${code})`)); });
      child.once('message', (message) => {
        cleanup();
        if (message.error) reject(new Error(message.error));
        else resolve(message);
      });
      child.send({ root: io.cwd, kitRoot: io.kitRoot, file, controlToken });
    });
    child.disconnect();
    child.unref();
    return ready;
  } catch (e) {
    if (child.connected) child.disconnect();
    // The child closes itself if the parent disconnects before readiness.
    try { unlinkSync(file); } catch (cleanup) { if (cleanup.code !== 'ENOENT') throw cleanup; }
    throw e;
  }
}
