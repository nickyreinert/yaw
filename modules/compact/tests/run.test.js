// compact L1 (T-050, kickoff/16-compact-output.md §4 L1): `yaw run --compact -- <cmd>` and the wrapped
// node-cli recipes. Exit 0: one line; exit 0 with warnings: count and the first 10; exit not 0: cleaned and
// capped output with the exit code kept; YAW_VERBOSE=1: raw output; rawBytes/outBytes per step in run.jsonl.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../../../core/cli/main.js';
import { compactJust, loadProfile } from '../../../core/render/kit.js';
import { initProject } from '../../../core/render/project.js';
import { KIT_ROOT, capture, cleanEnv, tmp, writeAnswers } from '../../../test/helpers/fixtures.js';

const NODE = process.execPath;

async function run(args, { env = cleanEnv(tmp('yaw-home-'), { YAW_COMPACT: '1' }), cwd = tmp('yaw-run-') } = {}) {
  const stdout = capture();
  const stderr = capture();
  const code = await main(['run', ...args], { cwd, kitRoot: KIT_ROOT, stdout, stderr, env });
  return { code, out: stdout.text(), err: stderr.text(), env };
}

// A command that prints `script`'s output and exits with `code`.
const node = (script, code = 0) => ['--', NODE, '-e', `${script}; process.exitCode = ${code}`];
const runLog = (env) => readFileSync(join(env.HOME, '.yaw', 'logs', 'run.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('exit 0 without warnings: one line with the step, the line count and the time; the output is dropped', async () => {
  const r = await run(['--compact', '--step', 'test', ...node('for (let i = 0; i < 400; i++) console.log("pass " + i)')]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^ok test \(400 lines, \d+\.\ds\)\n$/);
});

test('exit 0 with warnings: count line, the first 10 warnings and the rest counted', async () => {
  const script = 'console.log("start"); for (let i = 1; i <= 12; i++) console.error("npm warn deprecated pkg" + i); console.log("done")';
  const r = await run(['--compact', '--step', 'audit', '--warn', '^npm warn ', ...node(script)]);
  assert.equal(r.code, 0, r.err);
  const lines = r.out.trimEnd().split('\n');
  assert.equal(lines[0], 'audit: 12 warnings');
  assert.deepEqual(lines.slice(1, 11), Array.from({ length: 10 }, (_, i) => `npm warn deprecated pkg${i + 1}`));
  assert.equal(lines[11], '… +2 more warnings');
  assert.equal(lines.length, 12);
});

test('exit 0, warning pattern given but no match: still one line', async () => {
  const r = await run(['--compact', '--step', 'lint', '--warn', '^npm warn ', ...node('console.log("fine")')]);
  assert.match(r.out, /^ok lint \(1 lines, \d+\.\ds\)\n$/);
});

test('exit not 0: the code is kept; ANSI, progress frames and repeated lines are cleaned up', async () => {
  const script = [
    'process.stdout.write("\\x1b[31mnot ok 1 - adds\\x1b[0m\\n")',
    'process.stdout.write("progress 10%\\rprogress 50%\\rprogress 100%\\n")',
    'for (let i = 0; i < 5; i++) console.log("same line")',
    'console.log("other")',
  ].join('; ');
  const r = await run(['--compact', '--step', 'test', ...node(script, 3)]);
  assert.equal(r.code, 3);
  assert.doesNotMatch(r.out, /\x1b/);
  assert.match(r.out, /^not ok 1 - adds$/m);
  assert.match(r.out, /^progress 100%$/m);
  assert.doesNotMatch(r.out, /progress 10%/);
  assert.equal(r.out.match(/^same line$/gm).length, 1);
  assert.match(r.out, /^… 4 more identical lines$/m);
  assert.match(r.out, /^other$/m);
  assert.doesNotMatch(r.out, /YAW_VERBOSE/, 'nothing was cut, so no re-run hint');
});

test('exit not 0 with long output: head and tail are kept, the cut ends with the YAW_VERBOSE hint', async () => {
  const r = await run(['--compact', '--step', 'test', ...node('for (let i = 1; i <= 1000; i++) console.log("line " + i)', 1)]);
  assert.equal(r.code, 1);
  assert.match(r.out, /^line 1$/m);
  assert.match(r.out, /^line 1000$/m);
  assert.doesNotMatch(r.out, /^line 500$/m);
  assert.match(r.out, /lines cut/);
  assert.match(r.out.trimEnd().split('\n').at(-1), /YAW_VERBOSE=1/);
  assert.ok(r.out.split('\n').length < 150);
});

test('a missing command fails with 127', async () => {
  const r = await run(['--compact', '--step', 'test', '--', 'yaw-no-such-command']);
  assert.equal(r.code, 127);
  assert.match(r.err, /yaw-no-such-command/);
});

test('YAW_VERBOSE=1 prints the raw output and keeps the exit code', async () => {
  const env = cleanEnv(tmp('yaw-home-'), { YAW_COMPACT: '1', YAW_VERBOSE: '1' });
  const r = await run(['--compact', '--step', 'test', ...node('process.stdout.write("\\x1b[32mraw\\x1b[0m\\n"); console.error("err line")', 2)], { env });
  assert.equal(r.code, 2);
  assert.equal(r.out, '\x1b[32mraw\x1b[0m\n');
  assert.equal(r.err, 'err line\n');
  assert.equal(existsSync(join(env.HOME, '.yaw', 'logs', 'run.jsonl')), false);
});

test('compact off (YAW_COMPACT=0, or no project answer) prints the raw output', async () => {
  for (const extra of [{ YAW_COMPACT: '0' }, {}]) {
    const r = await run(['--compact', '--step', 'test', ...node('console.log("a"); console.log("b")')], { env: cleanEnv(tmp('yaw-home-'), extra) });
    assert.equal(r.code, 0);
    assert.equal(r.out, 'a\nb\n');
  }
});

test('the project answer turns it on; a project with only the hook lever keeps raw recipe output', async () => {
  for (const [levers, compact] of [['[recipes]', true], ['[hook]', false]]) {
    const root = tmp('yaw-compact-run-');
    await initProject({ root, answersFile: writeAnswers(tmp('yaw-ans-'), ANSWERS.replace('LEVERS', levers)), modules: ['core', 'compact'] });
    const r = await run(['--compact', '--step', 'test', ...node('console.log("a"); console.log("b")')], { env: cleanEnv(tmp('yaw-home-')), cwd: root });
    assert.equal(r.code, 0, r.err);
    if (compact) assert.match(r.out, /^ok test \(2 lines, /);
    else assert.equal(r.out, 'a\nb\n');
  }
});

test('rawBytes and outBytes are recorded per step, without output content', async () => {
  const env = cleanEnv(tmp('yaw-home-'), { YAW_COMPACT: '1' });
  const ok = await run(['--compact', '--step', 'test', ...node('for (let i = 0; i < 10; i++) console.log("secret-output-" + i)')], { env });
  const failed = await run(['--compact', '--step', 'lint', ...node('console.log("bad")', 1)], { env });
  const [first, second] = runLog(env);
  assert.equal(first.step, 'test');
  assert.equal(first.method, 'ok');
  assert.equal(first.exitCode, 0);
  assert.equal(first.rawBytes, Buffer.byteLength(Array.from({ length: 10 }, (_, i) => `secret-output-${i}\n`).join('')));
  assert.equal(first.outBytes, Buffer.byteLength(ok.out));
  assert.equal(second.step, 'lint');
  assert.equal(second.method, 'failed');
  assert.equal(second.exitCode, 1);
  assert.equal(second.outBytes, Buffer.byteLength(failed.out));
  assert.doesNotMatch(readFileSync(join(env.HOME, '.yaw', 'logs', 'run.jsonl'), 'utf8'), /secret-output|bad/);
});

const ANSWERS = `mode: standard
answers:
  user.agents: [claude, codex]
  idea.text: A tiny command-line tool.
  idea.team: solo
  tasks.mode: local
  compact.levers: LEVERS
  compact.personal: false
proposal:
  status: confirmed
  summary: test project
  profiles: [node-cli]
  modules: [core, compact]
`;

// The body line of `recipe` in a just file.
function recipeLines(text, recipe) {
  const rows = text.split('\n');
  const start = rows.findIndex((l) => l.startsWith(`${recipe}:`));
  const out = [];
  for (const l of rows.slice(start + 1)) {
    if (!l.startsWith('    ')) break;
    out.push(l.slice(4));
  }
  return out;
}

test('node-cli recipes: the check steps run through the wrapper with the profile warning pattern; others stay', async () => {
  const root = tmp('yaw-compact-just-');
  await initProject({ root, answersFile: writeAnswers(tmp('yaw-ans-'), ANSWERS.replace('LEVERS', '[recipes]')), modules: ['core', 'compact'] });
  const text = readFileSync(join(root, 'just', 'node-cli.just'), 'utf8');
  const source = readFileSync(join(KIT_ROOT, 'profiles', 'node-cli', 'just', 'node-cli.just'), 'utf8');
  for (const verb of ['test', 'lint', 'audit']) {
    for (const line of recipeLines(text, verb)) assert.match(line, new RegExp(`yaw run --compact --step ${verb} `), `${verb}: ${line}`);
  }
  assert.match(recipeLines(text, 'test')[0], /--warn/);
  for (const verb of ['setup', 'dev', 'fmt', 'typecheck', 'build', 'deploy']) assert.deepEqual(recipeLines(text, verb), recipeLines(source, verb), verb);
  assert.ok(loadProfile(KIT_ROOT, 'node-cli').compact.warnings);
});

test('without the compact module the recipes are the profile source', async () => {
  const root = tmp('yaw-compact-just-');
  await initProject({ root, answersFile: writeAnswers(tmp('yaw-ans-'), ANSWERS.replace('LEVERS', '[recipes]').replace('modules: [core, compact]', 'modules: [core]')), modules: ['core'] });
  assert.equal(readFileSync(join(root, 'just', 'node-cli.just'), 'utf8'), readFileSync(join(KIT_ROOT, 'profiles', 'node-cli', 'just', 'node-cli.just'), 'utf8'));
});

// Run a wrapped body line the way just does (sh -cu), with or without a yaw on the PATH.
function shell(line, { withYaw, env: extra = {} }) {
  const home = tmp('yaw-home-');
  const env = { ...cleanEnv(home, { YAW_COMPACT: '1', ...extra }) };
  if (withYaw) {
    const bin = join(home, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'yaw'), `#!/bin/sh\nexec '${NODE}' '${join(KIT_ROOT, 'bin', 'yaw')}' "$@"\n`, { mode: 0o755 });
    env.PATH = `${bin}:${env.PATH}`;
  }
  return spawnSync('sh', ['-cu', line.replace(/^@/, '')], { cwd: tmp('yaw-sh-'), env, encoding: 'utf8' });
}

test('a wrapped line keeps quotes and pipes, the exit code, and falls back to raw output without yaw', () => {
  const just = `test:\n    @node -e 'console.log("it'"'"'s 1"); console.log("two")' | cat && exit 4\n`;
  const [line] = recipeLines(compactJust(just, { warnings: '^npm warn ' }), 'test');
  const wrapped = shell(line, { withYaw: true });
  assert.equal(wrapped.status, 4, wrapped.stderr);
  assert.match(wrapped.stdout, /^it's 1\ntwo\n/);
  const passing = shell(line.replace('exit 4', 'true'), { withYaw: true });
  assert.equal(passing.status, 0, passing.stderr);
  assert.match(passing.stdout, /^ok test \(2 lines, \d+\.\ds\)\n$/);
  const raw = shell(line, { withYaw: false });
  assert.equal(raw.status, 4);
  assert.equal(raw.stdout, "it's 1\ntwo\n");
});
