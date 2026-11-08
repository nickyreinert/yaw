// compact (T-049, kickoff/16-compact-output.md §4, §7): definition, interview, scope. `yaw add compact` /
// `yaw remove compact`, a team setting (T-027), precedence YAW_COMPACT > project, the L4 fragment.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../../../core/cli/main.js';
import { selectedByPolicy } from '../../../core/interview/depth.js';
import { loadModule } from '../../../core/render/kit.js';
import { readManifest } from '../../../core/render/manifest.js';
import { initProject, readAnswers } from '../../../core/render/project.js';
import { loadSetupDefaults, saveSetupDefaults } from '../../../core/lib/setup-defaults.js';
import { KIT_ROOT, capture, cleanEnv, readTree, scripted, tmp, writeAnswers } from '../../../test/helpers/fixtures.js';
import { resolveCompact } from '../lib/settings.js';

const ANSWERS = `mode: standard
answers:
  user.agents: [claude, codex]
  idea.text: A tiny command-line tool.
  idea.team: solo
  tasks.mode: local
proposal:
  status: confirmed
  summary: test project
  profiles: [node-cli]
  modules: [core]
`;
const FRAGMENT = /<!-- yaw:compact -->/;

async function project() {
  const root = tmp('yaw-compact-');
  await initProject({ root, answersFile: writeAnswers(tmp('yaw-ans-'), ANSWERS), modules: ['core'] });
  return root;
}

async function yaw(root, args, { env = cleanEnv(tmp('yaw-home-')), prompter = scripted([]) } = {}) {
  const stdout = capture();
  const stderr = capture();
  const code = await main(args, { cwd: root, kitRoot: KIT_ROOT, stdout, stderr, env, prompter });
  return { code, out: stdout.text(), err: stderr.text(), env };
}

test('definition: off at every depth, one levers question, low token cost', () => {
  const def = loadModule(KIT_ROOT, 'compact');
  assert.deepEqual(def.default, { quick: false, standard: false, full: false });
  assert.equal(def.tokenCost, 'low');
  assert.deepEqual(def.depends, ['core']);
  const levers = def.questions.find((q) => q.id === 'compact.levers');
  assert.equal(levers.type, 'multi');
  assert.deepEqual(levers.choices.map((c) => c.value), ['recipes', 'hook']);
  assert.deepEqual(levers.default, ['recipes']);
  assert.equal(levers.scope, 'team', 'a team setting without a personal switch (T-027)');
  assert.equal(def.questions.some((q) => q.id === 'compact.personal'), false);
  assert.equal(def.questions.some((q) => /recall/.test(q.id)), false);
});

test('no recall store: no recall lever, no yaw recall command, no recall module file (T-055 dropped)', async () => {
  const { LEVERS } = await import('../lib/levers.js');
  assert.deepEqual(LEVERS, ['recipes', 'hook']);
  const { COMMANDS } = await import('../../../core/cli/main.js');
  assert.equal(COMMANDS.some((c) => c.name === 'recall'), false);
  assert.equal(existsSync(new URL('../lib/recall.js', import.meta.url)), false);
});

test('add --yes (committed): answers in answers.yaml, the L4 fragment in AGENTS.md, nothing personal', async () => {
  const root = await project();
  const r = await yaw(root, ['add', 'compact', '--yes']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(readAnswers(root).answers['compact.levers'], ['recipes']);
  assert.equal(Object.hasOwn(readAnswers(root).answers, 'compact.personal'), false);
  assert.equal(readManifest(root).modules.compact.enabled, true);
  const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
  assert.match(agents, FRAGMENT);
  assert.match(agents, /YAW_VERBOSE=1/);
  assert.equal(existsSync(join(r.env.HOME, '.yaw', 'compact.json')), false);
});

test('remove: the fragment goes, answers stay, a re-add takes them as defaults', async () => {
  const root = await project();
  const env = cleanEnv(tmp('yaw-home-'));
  await yaw(root, ['add', 'compact', '--yes'], { env });
  const before = readTree(root);
  const r = await yaw(root, ['remove', 'compact', '--yes'], { env });
  assert.equal(r.code, 0, r.err);
  assert.doesNotMatch(readFileSync(join(root, 'AGENTS.md'), 'utf8'), FRAGMENT);
  assert.equal(readManifest(root).modules.compact, undefined);
  assert.ok(!readManifest(root).files.some((f) => f.module === 'compact' || (f.fragments ?? []).some((x) => x.module === 'compact')));
  assert.deepEqual(readAnswers(root).answers['compact.levers'], ['recipes']);
  assert.equal(existsSync(join(env.HOME, '.yaw', 'compact.json')), false);
  await yaw(root, ['add', 'compact', '--yes'], { env });
  assert.deepEqual(readTree(root), before);
});

test('no lever chosen (edited answers): the module is installed but AGENTS.md carries no fragment', async () => {
  const root = tmp('yaw-compact-');
  const text = ANSWERS.replace('  tasks.mode: local\n', '  tasks.mode: local\n  compact.levers: []\n').replace('modules: [core]', 'modules: [core, compact]');
  await initProject({ root, answersFile: writeAnswers(tmp('yaw-ans-'), text), modules: ['core', 'compact'] });
  assert.equal(readManifest(root).modules.compact.enabled, true);
  assert.doesNotMatch(readFileSync(join(root, 'AGENTS.md'), 'utf8'), FRAGMENT);
});

test('the hook lever alone also renders the fragment', async () => {
  const root = await project();
  const r = await yaw(root, ['add', 'compact'], { prompter: scripted(['hook', 'y']) });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(readAnswers(root).answers['compact.levers'], ['hook']);
  assert.match(readFileSync(join(root, 'AGENTS.md'), 'utf8'), FRAGMENT);
});

test('a team setting (T-027): the interview asks only for the levers, they are committed, ~/.yaw/compact.json is not written', async () => {
  const root = await project();
  const env = cleanEnv(tmp('yaw-home-'));
  const r = await yaw(root, ['add', 'compact'], { env, prompter: scripted(['recipes, hook', 'y']) });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(readAnswers(root).answers['compact.levers'], ['recipes', 'hook']);
  assert.match(readFileSync(join(root, 'AGENTS.md'), 'utf8'), FRAGMENT);
  assert.equal(existsSync(join(env.HOME, '.yaw', 'compact.json')), false);
});

test('precedence: YAW_COMPACT, then the project answer', () => {
  const env = cleanEnv(tmp('yaw-home-'));
  const project = { 'compact.levers': ['recipes'] };
  assert.deepEqual(resolveCompact({ env, answers: project }), { levers: ['recipes'], source: 'project' });
  assert.deepEqual(resolveCompact({ env, answers: {} }), { levers: [], source: 'default' });
  assert.deepEqual(resolveCompact({ env, answers: { 'compact.levers': [] } }), { levers: [], source: 'project' });

  // YAW_COMPACT beats the answer; 1 keeps the configured levers, or takes all when none is configured
  const forced = (value, extra) => resolveCompact({ env: { ...env, YAW_COMPACT: value }, ...extra });
  assert.deepEqual(forced('0', { answers: project }), { levers: [], source: 'env' });
  assert.deepEqual(forced('1', { answers: project }), { levers: ['recipes'], source: 'env' });
  assert.deepEqual(forced('1', { answers: {} }), { levers: ['recipes', 'hook'], source: 'env' });
  assert.deepEqual(forced('maybe', { answers: project }), { levers: ['recipes'], source: 'project' });
});

test('Quick reuses saved personal defaults for the module and its answers', () => {
  const env = cleanEnv(tmp('yaw-home-'));
  const ctx = { env, kitRoot: KIT_ROOT };
  assert.equal(loadSetupDefaults(ctx).warning, null);
  assert.ok(loadSetupDefaults(ctx).catalog.some((m) => m.name === 'compact'));
  saveSetupDefaults(ctx, { modules: ['compact'], answers: { 'compact.levers': ['hook'] } });
  const saved = loadSetupDefaults(ctx);
  assert.equal(saved.warning, null);
  assert.deepEqual(saved.modules, ['compact']);
  assert.deepEqual(saved.answers['compact.levers'], ['hook']);
});

test('All: the module is off unless a lever is chosen in the interview', () => {
  const definitions = ['core', 'compact'].map((name) => loadModule(KIT_ROOT, name));
  assert.deepEqual(selectedByPolicy(definitions, { answers: { 'compact.levers': [] } }), ['core']);
  assert.deepEqual(selectedByPolicy(definitions, { answers: { 'compact.levers': ['recipes'] } }), ['core', 'compact']);
});
