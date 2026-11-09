// Helpers shared by the hook entry points (dispatch.js and the lean compress.js): the YAW home, stdin, the
// private logs and muted handler output. Imports only node builtins, so the lean entry stays lean.

import { chmodSync, closeSync, constants, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync, renameSync, writeSync } from 'node:fs';
import { join } from 'node:path';

const LOG_MAX_BYTES = 5 * 1024 * 1024;

export function yawHome(env) {
  return env.YAW_HOME || join(env.HOME || '', '.yaw');
}

export function readStdin(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(Buffer.from(c)));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

// Open a log for appending as a private regular file: never follows a symlink, never blocks on a FIFO, and
// makes a file of ours that an older version created 0644 private.
function openLog(path) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || (process.getuid && st.uid !== process.getuid())) throw new Error('hook log is not a regular file of ours');
    if (st.mode & 0o077) fchmodSync(fd, 0o600);
    return { fd, size: st.size };
  } catch (e) {
    closeSync(fd);
    throw e;
  }
}

// Append one line to ~/.yaw/logs/<file> (private: directory 0700, file 0600, no symlinks); rotate to <file>.1
// above 5 MB, which keeps its mode. Never throws.
export function appendLog(env, file, line) {
  try {
    const dir = join(yawHome(env), 'logs');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const st = lstatSync(dir);
    if (!st.isDirectory() || (process.getuid && st.uid !== process.getuid())) return;
    if (st.mode & 0o077) chmodSync(dir, 0o700);
    const path = join(dir, file);
    let log = openLog(path);
    if (log.size > LOG_MAX_BYTES) {
      renameSync(path, `${path}.1`);
      closeSync(log.fd);
      log = openLog(path);
    }
    try { writeSync(log.fd, `${line}\n`); } finally { closeSync(log.fd); }
  } catch { /* logging must not affect the session */ }
}

// Errors YAW raises itself; their messages hold no payload content.
export class HookError extends Error {}

// Error log, never payload content (B rule 6): YAW's own messages in full; for anything else (a handler,
// JSON.parse, which quotes the input) only the error's name and code.
export function logError(env, where, error) {
  const text = error instanceof HookError ? error.message : `${error?.name ?? 'Error'}${error?.code ? ` ${error.code}` : ''} (message not logged)`;
  appendLog(env, 'hook-errors.log', `${new Date().toISOString()} ${where}: ${text}`);
}

// While handlers run, their own writes to stdout/stderr/console are swallowed: on UserPromptSubmit and
// SessionStart plain stdout would reach the model, and stray text breaks the JSON answer (ADR-0007).
export async function muted(fn) {
  const saved = { out: process.stdout.write, err: process.stderr.write, console: { ...console } };
  const none = () => true;
  process.stdout.write = none;
  process.stderr.write = none;
  for (const k of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir', 'table']) console[k] = () => {};
  try {
    return await fn();
  } finally {
    process.stdout.write = saved.out;
    process.stderr.write = saved.err;
    Object.assign(console, saved.console);
  }
}
