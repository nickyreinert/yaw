// CLI entry (Y-2.4) and minimal init (Y-2.10), run as a real process.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMMANDS } from '../core/cli/main.js';
import { initProject } from '../core/render/project.js';
import { KIT_ROOT, makeKit, readTree, run, tmp, writeAnswers } from './helpers/fixtures.js';

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
    for (const c of COMMANDS) assert.match(r.stdout, new RegExp(`^  ${c.name} `, 'm'), c.name);
  }
  assert.match(yaw(['help', 'update']).stdout, /usage: yaw update \[--yes\] \[--strategy keep\|take\|merge\] \[--restore <path>\] \[--forget <path>\]/);
});

test('the phase-1 command list is fixed (ADR-0019)', () => {
  assert.deepEqual(COMMANDS.map((c) => c.name), [
    'init', 'update', 'remove', 'status', 'doctor', 'self-update', 'self-uninstall', 'help',
    'apply', 'add', 'hook', 'sync', 'agents', 'task', 'config', 'gh', 'decisions', 'sessions', 'session', 'session-start', 'hygiene', 'notify', 'presets',
  ]);
});

test('unknown command exits 1 with usage on stderr', () => {
  const r = yaw(['frobnicate']);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /unknown command "frobnicate"/);
  assert.match(r.stderr, /^usage: yaw <command> \[options\]$/m);
});

test('unknown option and planned commands exit 1', () => {
  const opt = yaw(['update', '--frob']);
  assert.equal(opt.status, 1);
  assert.match(opt.stderr, /usage: yaw update/);
  const planned = yaw(['config']);
  assert.equal(planned.status, 1);
  assert.match(planned.stderr, /comes with step 5/);
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
    '.gitignore', '.yaw/answers.yaml', '.yaw/manifest.json', 'AGENTS.md', 'CLAUDE.md', 'just/node-cli.just', 'justfile', 'package.json', 'src/index.js', 'test/index.test.js',
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
  assert.match(r.stdout, /^ {2}core +9 files$/m);
  assert.match(r.stdout, /^ {2}AGENTS\.md +core +unedited$/m);
  assert.match(r.stdout, /^ {2}\.yaw\/answers\.yaml +core +owned$/m);
  assert.equal(yaw(['status'], { cwd: tmp() }).status, 1);
});

test('init leaves nothing behind when a template fails to render', async () => {
  const kitRoot = makeKit(tmp('yaw-kit-'), { modules: { core: { templates: { 'a.md.tmpl': '<%= answers.nope.x %>\n' } } } });
  const dir = tmp('yaw-proj-');
  await assert.rejects(initProject({ root: dir, kitRoot, answersFile: writeAnswers(tmp('yaw-ans-')) }), /a\.md\.tmpl:1: missing value "answers\.nope\.x"/);
  assert.deepEqual(readTree(dir), {});
});
