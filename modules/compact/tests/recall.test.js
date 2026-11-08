// compact L6 (T-055, kickoff/16-compact-output.md §4 L6): the optional recall store ~/.yaw/recall/<hash>.gz.
// Private directory 0700 and files 0600, no symlinks, at most 200 entries / 30 days / 10 MB per entry, never
// synced, read back with `yaw recall <hash>`, off by default (the cut output then ends with the re-run hint).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { main } from '../../../core/cli/main.js';
import { portableSnapshot } from '../../../core/lib/data-sync.js';
import { loadModule } from '../../../core/render/kit.js';
import { KIT_ROOT, capture, cleanEnv, tmp } from '../../../test/helpers/fixtures.js';
import { MAX_AGE_MS, MAX_BYTES, MAX_ENTRIES, readRecall, storeRecall } from '../lib/recall.js';
import { writePersonal } from '../lib/settings.js';

const recallDir = (env) => join(env.HOME, '.yaw', 'recall');
const entries = (env) => readdirSync(recallDir(env)).filter((n) => n.endsWith('.gz'));
const mode = (path) => lstatSync(path).mode & 0o777;

async function yaw(args, { env, cwd = tmp('yaw-recall-cwd-') }) {
  const stdout = capture();
  const stderr = capture();
  const code = await main(args, { cwd, kitRoot: KIT_ROOT, stdout, stderr, env });
  return { code, out: stdout.text(), err: stderr.text() };
}

// A failing step printing 300 numbered lines: more than the head and tail, so the output is cut.
const failing = (env) => yaw(['run', '--compact', '--step', 'test', '--', process.execPath, '-e',
  'for (let i = 0; i < 300; i++) console.log("line " + i); process.exitCode = 1'], { env });

test('store: gzip file 0600 in a 0700 directory; the same text gives the same hash; round trip', () => {
  const env = cleanEnv(tmp('yaw-home-'));
  const hash = storeRecall(env, 'raw \x1b[31moutput\x1b[0m\n');
  assert.match(hash, /^[a-f0-9]{16}$/);
  assert.equal(storeRecall(env, 'raw \x1b[31moutput\x1b[0m\n'), hash);
  assert.deepEqual(entries(env), [`${hash}.gz`]);
  assert.equal(mode(recallDir(env)), 0o700);
  assert.equal(mode(join(recallDir(env), `${hash}.gz`)), 0o600);
  assert.equal(readRecall(env, hash).toString('utf8'), 'raw \x1b[31moutput\x1b[0m\n');
});

test('a loose directory or file of ours is made private again', () => {
  const env = cleanEnv(tmp('yaw-home-'));
  const hash = storeRecall(env, 'one');
  const file = join(recallDir(env), `${hash}.gz`);
  chmodSync(recallDir(env), 0o755);
  chmodSync(file, 0o644);
  assert.equal(storeRecall(env, 'one'), hash);
  assert.equal(mode(recallDir(env)), 0o700);
  assert.equal(mode(file), 0o600);
});

test('symlinks are never followed: a linked directory', () => {
  const env = cleanEnv(tmp('yaw-home-'));
  const outside = tmp('yaw-outside-');
  mkdirSync(join(env.HOME, '.yaw'), { recursive: true });
  symlinkSync(outside, recallDir(env));
  assert.equal(storeRecall(env, 'data'), null);
  assert.deepEqual(readdirSync(outside), []);
  assert.throws(() => readRecall(env, 'a'.repeat(16)), /symbolic link/);
});

test('symlinks are never followed: a linked entry is not read, and a link at the target name is replaced, not written through', () => {
  const env = cleanEnv(tmp('yaw-home-'));
  const outside = tmp('yaw-outside-');
  const hash = storeRecall(env, 'data');
  const file = join(recallDir(env), `${hash}.gz`);
  writeFileSync(join(outside, 'real.gz'), gzipSync('stolen'));
  rmSync(file);
  symlinkSync(join(outside, 'real.gz'), file);
  assert.throws(() => readRecall(env, hash));
  const secret = join(outside, 'secret');
  writeFileSync(secret, 'do not touch');
  rmSync(file);
  symlinkSync(secret, file);
  assert.equal(storeRecall(env, 'data'), hash);
  assert.equal(readFileSync(secret, 'utf8'), 'do not touch');
  assert.equal(lstatSync(file).isSymbolicLink(), false);
  assert.equal(readRecall(env, hash).toString(), 'data');
});

test('limits: at most 200 entries (oldest go first), 30 days, 10 MB per entry', () => {
  assert.equal(MAX_ENTRIES, 200);
  assert.equal(MAX_AGE_MS, 30 * 24 * 3600 * 1000);
  assert.equal(MAX_BYTES, 10 * 1024 * 1024);
  const env = cleanEnv(tmp('yaw-home-'));
  const first = storeRecall(env, 'entry 0');
  const t0 = Date.now() / 1000 - 3600;
  utimesSync(join(recallDir(env), `${first}.gz`), t0, t0);
  const kept = [];
  for (let i = 1; i < MAX_ENTRIES; i++) kept.push(storeRecall(env, `entry ${i}`));
  assert.equal(entries(env).length, MAX_ENTRIES);
  const newest = storeRecall(env, 'one more');
  assert.equal(entries(env).length, MAX_ENTRIES);
  assert.ok(!entries(env).includes(`${first}.gz`), 'the oldest entry is pruned');
  assert.ok(entries(env).includes(`${newest}.gz`));

  const old = storeRecall(env, 'old entry');
  const past = (Date.now() - MAX_AGE_MS - 60_000) / 1000;
  utimesSync(join(recallDir(env), `${old}.gz`), past, past);
  storeRecall(env, 'trigger prune');
  assert.ok(!entries(env).includes(`${old}.gz`), 'entries older than 30 days are pruned');
  assert.throws(() => readRecall(env, old), /no recall entry/);

  const before = entries(env).length;
  assert.equal(storeRecall(env, 'x'.repeat(MAX_BYTES + 1)), null);
  assert.equal(entries(env).length, before);
  const exact = storeRecall(env, 'y'.repeat(MAX_BYTES));
  assert.equal(readRecall(env, exact).length, MAX_BYTES);
});

test('read: only 16 hex digits are a hash; an entry that inflates past 10 MB is refused', () => {
  const env = cleanEnv(tmp('yaw-home-'));
  storeRecall(env, 'x');
  for (const bad of ['../x', 'zz', 'ABCDEF0123456789', 'a'.repeat(15), '']) assert.throws(() => readRecall(env, bad), /not a recall hash/);
  const bomb = 'b'.repeat(16);
  writeFileSync(join(recallDir(env), `${bomb}.gz`), gzipSync(Buffer.alloc(MAX_BYTES + 1024)), { mode: 0o600 });
  assert.throws(() => readRecall(env, bomb));
});

test('yaw recall <hash> prints the stored raw output; unknown and malformed hashes fail', async () => {
  const env = cleanEnv(tmp('yaw-home-'));
  const hash = storeRecall(env, 'raw line 1\nraw line 2\n');
  const ok = await yaw(['recall', hash], { env });
  assert.equal(ok.code, 0, ok.err);
  assert.equal(ok.out, 'raw line 1\nraw line 2\n');
  const missing = await yaw(['recall', 'f'.repeat(16)], { env });
  assert.equal(missing.code, 1);
  assert.match(missing.err, /no recall entry/);
  const bad = await yaw(['recall', '../../etc/passwd'], { env });
  assert.equal(bad.code, 1);
  assert.match(bad.err, /not a recall hash/);
  assert.equal((await yaw(['recall'], { env })).code, 1);
});

test('off by default: nothing is stored and the cut output ends with the YAW_VERBOSE=1 hint', async () => {
  const env = cleanEnv(tmp('yaw-home-'), { YAW_COMPACT: '1' });
  const r = await failing(env);
  assert.equal(r.code, 1);
  const lines = r.out.trimEnd().split('\n');
  assert.equal(lines.at(-1), 're-run with YAW_VERBOSE=1 for the full output');
  assert.equal(existsSync(recallDir(env)), false);
});

test('lever on: the raw output is stored and the cut output ends with the recall line', async () => {
  const env = cleanEnv(tmp('yaw-home-'));
  const root = tmp('yaw-recall-proj-');
  writePersonal(env, root, ['recipes', 'recall']);
  const r = await yaw(['run', '--compact', '--step', 'test', '--', process.execPath, '-e',
    'for (let i = 0; i < 300; i++) console.log("line " + i); process.exitCode = 1'], { env, cwd: root });
  assert.equal(r.code, 1);
  const last = r.out.trimEnd().split('\n').at(-1);
  const hash = /^full output: yaw recall ([a-f0-9]{16})$/.exec(last)?.[1];
  assert.ok(hash, last);
  assert.doesNotMatch(r.out, /YAW_VERBOSE/);
  const back = await yaw(['recall', hash], { env });
  assert.equal(back.out, Array.from({ length: 300 }, (_, i) => `line ${i}\n`).join(''));
  assert.equal(mode(join(recallDir(env), `${hash}.gz`)), 0o600);
});

test('lever on, output not cut: nothing is stored', async () => {
  const env = cleanEnv(tmp('yaw-home-'));
  const root = tmp('yaw-recall-proj-');
  writePersonal(env, root, ['recipes', 'recall']);
  const r = await yaw(['run', '--compact', '--step', 'test', '--', process.execPath, '-e', 'console.log("short"); process.exitCode = 1'], { env, cwd: root });
  assert.equal(r.out, 'short\n');
  assert.equal(existsSync(recallDir(env)), false);
});

test('YAW_COMPACT=1 alone never turns the recall store on', async () => {
  const env = cleanEnv(tmp('yaw-home-'), { YAW_COMPACT: '1' });
  await failing(env);
  assert.equal(existsSync(recallDir(env)), false);
});

test('the module offers recall as its own off-by-default lever', () => {
  const levers = loadModule(KIT_ROOT, 'compact').questions.find((q) => q.id === 'compact.levers');
  assert.ok(levers.choices.some((c) => c.value === 'recall'));
  assert.equal(levers.default.includes('recall'), false);
});

test('never synced: a stored entry appears in no portable snapshot', () => {
  const env = cleanEnv(tmp('yaw-home-'));
  const hash = storeRecall(env, 'sync-canary-output');
  const snap = portableSnapshot({ env, kitRoot: KIT_ROOT, scopes: ['settings', 'presets', 'statistics', 'tasks', 'knowledge'], name: 'test' });
  const text = JSON.stringify(snap);
  assert.doesNotMatch(text, /sync-canary-output|recall/);
  assert.equal(text.includes(hash), false);
});
