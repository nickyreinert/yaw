// Hook logs (T-010): ~/.yaw/logs is private (0700), log files are private regular files (0600), symlinks and
// special files are never followed or written, and rotation keeps both protections.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fixture, hook, makeProject } from './helpers/hooks.js';
import { tmp } from './helpers/fixtures.js';

const skip = process.platform === 'win32' && 'POSIX modes';
const mode = (path) => statSync(path).mode & 0o777;
const run = async (root, home) => hook({ root, agent: 'claude', event: 'PreToolUse', payload: fixture('claude', 'PreToolUse'), env: { HOME: home } });

async function setup() {
  const root = await makeProject();
  const home = tmp('yaw-home-');
  return { root, home, logs: join(home, '.yaw', 'logs') };
}

test('hook logs are created private: directory 0700, file 0600', { skip }, async () => {
  const { root, home, logs } = await setup();
  const old = process.umask(0o022);
  try { assert.equal((await run(root, home)).code, 0); } finally { process.umask(old); }
  assert.equal(mode(logs), 0o700);
  assert.equal(mode(join(logs, 'hooks.jsonl')), 0o600);
});

test('existing loose log directory and file are made private', { skip }, async () => {
  const { root, home, logs } = await setup();
  mkdirSync(logs, { recursive: true, mode: 0o755 });
  chmodSync(logs, 0o755);
  writeFileSync(join(logs, 'hooks.jsonl'), '', { mode: 0o644 });
  chmodSync(join(logs, 'hooks.jsonl'), 0o644);
  await run(root, home);
  assert.equal(mode(logs), 0o700);
  assert.equal(mode(join(logs, 'hooks.jsonl')), 0o600);
  assert.match(readFileSync(join(logs, 'hooks.jsonl'), 'utf8'), /"agent":"claude"/);
});

test('a symlinked log file is not followed', { skip }, async () => {
  const { root, home, logs } = await setup();
  mkdirSync(logs, { recursive: true, mode: 0o700 });
  const target = join(tmp('yaw-victim-'), 'victim.txt');
  writeFileSync(target, 'keep\n', { mode: 0o644 });
  symlinkSync(target, join(logs, 'hooks.jsonl'));
  assert.equal((await run(root, home)).code, 0);
  assert.equal(readFileSync(target, 'utf8'), 'keep\n');
  assert.equal(mode(target), 0o644);
});

test('a symlinked log directory is not followed', { skip }, async () => {
  const { root, home, logs } = await setup();
  const target = tmp('yaw-victim-');
  mkdirSync(join(home, '.yaw'), { recursive: true });
  symlinkSync(target, logs);
  assert.equal((await run(root, home)).code, 0);
  assert.equal(existsSync(join(target, 'hooks.jsonl')), false);
});

test('a non-regular log target (FIFO) is rejected without blocking', { skip }, async () => {
  const { root, home, logs } = await setup();
  mkdirSync(logs, { recursive: true, mode: 0o700 });
  const fifo = join(logs, 'hooks.jsonl');
  assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
  assert.equal((await run(root, home)).code, 0);
  assert.ok(statSync(fifo).isFIFO());
});

test('rotation keeps the rotated and the new log private', { skip }, async () => {
  const { root, home, logs } = await setup();
  mkdirSync(logs, { recursive: true, mode: 0o700 });
  const file = join(logs, 'hooks.jsonl');
  writeFileSync(file, '', { mode: 0o644 });
  chmodSync(file, 0o644);
  truncateSync(file, 5 * 1024 * 1024 + 1);
  await run(root, home);
  assert.equal(statSync(`${file}.1`).size, 5 * 1024 * 1024 + 1);
  assert.equal(mode(`${file}.1`), 0o600);
  assert.equal(mode(file), 0o600);
  assert.ok(statSync(file).size < 1024);
});
