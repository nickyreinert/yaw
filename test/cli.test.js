// CLI entry (Y-2.4) and minimal init (Y-2.10), run as a real process.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMMANDS, HELP_GROUPS } from '../core/cli/main.js';
import { initProject } from '../core/render/project.js';
import { KIT_ROOT, makeKit, readTree, run, tmp, writeAnswers, cleanEnv } from './helpers/fixtures.js';
import { saveRemoteSettings } from '../core/lib/remote-settings.js';

const YAW = join(KIT_ROOT, 'bin', 'yaw');
const yaw = (args, options = {}) => run(process.execPath, [YAW, ...args], options);
const VERSION = JSON.parse(readFileSync(join(KIT_ROOT, 'package.json'), 'utf8')).version;

test('--version prints the kit version', () => {
  const r = yaw(['--version']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, `yaw ${VERSION}\n`);
});

test('help lists every phase-1 command; no arguments prints help too', () => {
  for (const args of [['help'], ['--help'], []]) {
    const r = yaw(args);
    assert.equal(r.status, 0);
    for (const c of COMMANDS.filter((c) => !c.optional)) assert.match(r.stdout, new RegExp(`^  ${c.name} `, 'm'), c.name);
  }
  assert.match(yaw(['help', 'update']).stdout, /usage: yaw update \[--yes\] \[--strategy keep\|take\|merge\] \[--restore <path>\] \[--forget <path>\]/);
});

test('the implemented command list includes remote control (ADR-0069)', () => {
  assert.deepEqual(COMMANDS.map((c) => c.name), [
    'remote',
    'init', 'defaults', 'web', 'apply', 'update', 'edit', 'remove', 'status', 'doctor', 'self-update', 'self-uninstall', 'help',
    'add', 'hook', 'sync', 'agents', 'task', 'kickoff', 'gh', 'decisions', 'knowledge', 'map', 'review', 'sessions', 'session-start', 'hygiene', 'notify', 'statusline', 'presets',
  ]);
});

test('help groups every command exactly once without placeholders', () => {
  const names = HELP_GROUPS.flatMap((group) => group.names);
  const built = COMMANDS.map((c) => c.name);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual([...names].sort(), built.sort());
  const output = yaw([]).stdout;
  for (const group of HELP_GROUPS) {
    assert.ok(output.includes(`${group.title}:\n`));
    for (const name of group.names.filter((name) => name !== 'remote')) assert.equal(output.match(new RegExp(`^  ${name} `, 'gm')).length, 1);
  }
  assert.doesNotMatch(output, /placeholder|not implemented|coming later in phase 1|\(step [35]\)/i);
});

test('Remote Control is absent from help and refuses direct commands until enabled in global settings', () => {
  const home = tmp('yaw-disabled-remote-'), env = cleanEnv(home);
  for (const args of [[], ['help'], ['--help']]) assert.doesNotMatch(yaw(args, { env }).stdout, /^  remote /m);
  for (const args of [['remote', 'serve'], ['remote', 'status'], ['remote', 'sync'], ['remote', '--help'], ['help', 'remote']]) {
    const result = yaw(args, { env }); assert.equal(result.status, 1); assert.match(result.stderr, /Global → Settings → Features/);
  }
  assert.deepEqual(readTree(home), {});
  saveRemoteSettings(env, { enabled: true, port: 4320 });
  assert.match(yaw([], { env }).stdout, /^  remote /m);
  assert.equal(yaw(['remote', 'status'], { env }).status, 0);
  assert.match(yaw(['help', 'remote'], { env }).stdout, /usage: yaw remote/);
});

test('deferred commands are absent from help and use ordinary unknown-command errors', () => {
  for (const name of ['config', 'session']) {
    for (const args of [[], ['--help'], ['-h'], ['help']]) {
      assert.doesNotMatch(yaw(args).stdout, new RegExp(`^  ${name} `, 'm'));
    }
    for (const args of [[name], [name, '--help'], ['help', name]]) {
      const r = yaw(args);
      assert.equal(r.status, 1);
      assert.equal(r.stdout, '');
      assert.match(r.stderr, new RegExp(`unknown command "${name}"`));
      assert.doesNotMatch(r.stderr, /placeholder|not implemented/i);
    }
  }
});

test('unknown command exits 1 with usage on stderr', () => {
  const r = yaw(['frobnicate']);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /unknown command "frobnicate"/);
  assert.match(r.stderr, /^usage: yaw <command> \[options\]$/m);
});

test('unknown option and invalid strategy exit 1', () => {
  const opt = yaw(['update', '--frob']);
  assert.equal(opt.status, 1);
  assert.match(opt.stderr, /usage: yaw update/);
  assert.equal(yaw(['update', '--strategy', 'yolo'], { cwd: tmp() }).status, 1);
});

test('init without a terminal needs --answers; --answers without a terminal needs --yes', () => {
  const dir = tmp();
  const r = yaw(['init'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no terminal for the interview: run yaw init --answers <file> --yes/);
  const noYes = yaw(['init', '--answers', writeAnswers(tmp('yaw-ans-')), '--skip-verify'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(noYes.status, 1);
  assert.match(noYes.stderr, /confirmation needed: run again with --yes/);
  assert.deepEqual(readTree(dir), {});
});

test('init --answers --yes renders core and the profile; a second init is refused', () => {
  const dir = tmp('yaw-proj-');
  const answers = writeAnswers(tmp('yaw-ans-'));
  const r = yaw(['init', '--answers', answers, '--yes', '--skip-verify'], { cwd: dir });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /added: AGENTS\.md/);
  assert.match(r.stdout, /verification skipped/);
  assert.deepEqual(Object.keys(readTree(dir)).filter((p) => !p.startsWith('.yaw/base/')), [
    '.gitignore', '.yaw/answers.yaml', '.yaw/manifest.json', 'AGENTS.md', 'CLAUDE.md', 'README.md', 'just/node-cli.just', 'justfile', 'package.json', 'src/index.js', 'test/index.test.js',
  ]);
  assert.equal(readTree(dir)['.yaw/answers.yaml'], readFileSync(answers, 'utf8'));
  const again = yaw(['init', '--answers', answers, '--yes', '--skip-verify'], { cwd: dir });
  assert.equal(again.status, 1);
  assert.match(again.stderr, /already exists; use yaw update/);
});

test('init rejects invalid answers with file and line', () => {
  const dir = tmp('yaw-proj-');
  const bad = writeAnswers(tmp('yaw-ans-'), 'mode: quick\nanswers:\n  user.agents: [claude]\n  user.api-token: x\n');
  const r = yaw(['init', '--answers', bad, '--yes', '--skip-verify'], { cwd: dir });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /answers\.yaml:4: /);
  assert.deepEqual(readTree(dir), {});
});

test('update without a terminal behaves like --yes and says so', () => {
  const dir = tmp('yaw-proj-');
  yaw(['init', '--answers', writeAnswers(tmp('yaw-ans-')), '--yes', '--skip-verify'], { cwd: dir });
  const r = yaw(['update'], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /no terminal: edited files are kept \(same as --yes\)/);
  assert.match(r.stdout, /nothing to do/);
});

test('status prints the module and file table', () => {
  const dir = tmp('yaw-proj-');
  yaw(['init', '--answers', writeAnswers(tmp('yaw-ans-')), '--yes', '--skip-verify'], { cwd: dir });
  const r = yaw(['status'], { cwd: dir });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`kit: project pinned to ${VERSION.replace(/\./g, '\\.')}, installed`));
  assert.match(r.stdout, /^ {2}core +10 files$/m);
  assert.match(r.stdout, /^ {2}AGENTS\.md +core +unedited$/m);
  assert.match(r.stdout, /^ {2}\.yaw\/answers\.yaml +core +owned$/m);
  assert.match(r.stdout, /^ {2}README\.md +core +owned$/m);
  assert.equal(yaw(['status'], { cwd: tmp() }).status, 1);
});

test('init leaves nothing behind when a template fails to render', async () => {
  const kitRoot = makeKit(tmp('yaw-kit-'), { modules: { core: { templates: { 'a.md.tmpl': '<%= answers.nope.x %>\n' } } } });
  const dir = tmp('yaw-proj-');
  await assert.rejects(initProject({ root: dir, kitRoot, answersFile: writeAnswers(tmp('yaw-ans-')) }), /a\.md\.tmpl:1: missing value "answers\.nope\.x"/);
  assert.deepEqual(readTree(dir), {});
});
