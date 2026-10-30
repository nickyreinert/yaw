// Profile options select a scaffold variant (ADR-0105, T-003).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asksAtDepth } from '../core/interview/depth.js';
import { questionApplies } from '../core/interview/policy.js';
import { collectQuestions, loadProfile, profileOptionValues, renderProfiles } from '../core/render/kit.js';
import { KIT_ROOT, tmp } from './helpers/fixtures.js';

function kit(profileYaml, variants = ['one', 'two']) {
  const root = tmp('yaw-options-');
  cpSync(join(KIT_ROOT, 'interview'), join(root, 'interview'), { recursive: true });
  const dir = join(root, 'profiles', 'demo');
  mkdirSync(join(dir, 'scaffold'), { recursive: true });
  writeFileSync(join(dir, 'profile.yaml'), profileYaml);
  writeFileSync(join(dir, 'scaffold', 'shared.txt'), 'shared\n');
  for (const v of variants) {
    mkdirSync(join(dir, 'variants', v), { recursive: true });
    writeFileSync(join(dir, 'variants', v, `${v}.txt`), `${v}\n`);
  }
  return root;
}

const YAML = `name: demo
title: Demo
summary: Demo profile.
stack:
  language: [typescript]
  runsOn: [app-store]
options:
  framework:
    label: Framework (overrides prefer built-in)
    choices: [one, { value: two, label: Two }]
    default: one
    scaffold: true
`;

test('an option becomes a stack question right after arch.runs-on, asked at every depth for its pair only', () => {
  const root = kit(YAML);
  const questions = collectQuestions(root, []);
  const at = questions.findIndex((q) => q.id === 'arch.demo-framework');
  assert.equal(questions[at - 1].id, 'arch.runs-on');
  const q = questions[at];
  assert.deepEqual(q.choices.map((c) => c.value), ['one', 'two']);
  assert.equal(q.default, 'one');
  assert.match(q.label, /overrides prefer built-in/);
  for (const depth of ['quick', 'basic', 'pro']) assert.equal(asksAtDepth(q, depth), true);
  assert.equal(questionApplies(q, { 'arch.language': 'typescript', 'arch.runs-on': 'app-store' }), true);
  assert.equal(questionApplies(q, { 'arch.language': 'typescript', 'arch.runs-on': 'static' }), false);
});

test('render picks the chosen variant; a missing or unknown answer means the default', () => {
  const root = kit(YAML);
  const files = (answers) => [...renderProfiles({ kitRoot: root, profiles: ['demo'], scaffold: () => false, answers }).files.keys()].sort();
  assert.deepEqual(files({ 'arch.demo-framework': 'two' }), ['shared.txt', 'two.txt']);
  assert.deepEqual(files({}), ['one.txt', 'shared.txt']);
  assert.deepEqual(profileOptionValues(loadProfile(root, 'demo'), { 'arch.demo-framework': 'nope' }), { framework: 'one' });
});

test('loadProfile rejects a default outside the choices, a missing variant folder and two scaffold options', () => {
  assert.throws(() => loadProfile(kit(YAML.replace('default: one', 'default: three')), 'demo'), /not one of its choices/);
  assert.throws(() => loadProfile(kit(YAML, ['one']), 'demo'), /no variants\/two\/ folder/);
  const two = `${YAML}  db:\n    choices: [one, two]\n    default: one\n    scaffold: true\n`;
  assert.throws(() => loadProfile(kit(two), 'demo'), /only one option/);
});

test('a variant file that is also in scaffold/ is an error', () => {
  const root = kit(YAML);
  writeFileSync(join(root, 'profiles', 'demo', 'scaffold', 'one.txt'), 'x\n');
  assert.throws(() => renderProfiles({ kitRoot: root, profiles: ['demo'], scaffold: () => false, answers: {} }), /both scaffold\/ and the variant/);
});

test('the CLI stack confirmation asks an option the interview skipped and keeps a given one', async () => {
  const { confirmStack } = await import('../core/cli/init.js');
  const { listProfiles } = await import('../core/render/kit.js');
  const root = kit(YAML);
  const questions = collectQuestions(root, []);
  const prompter = (replies) => ({ show() {}, ask: async () => replies.shift() });
  const base = { 'arch.language': 'typescript', 'arch.runs-on': 'app-store' };
  const asked = await confirmStack({ prompter: prompter(['2']), profiles: listProfiles(root), questions, answers: base });
  assert.equal(asked.answers['arch.demo-framework'], 'two');
  const kept = await confirmStack({ prompter: prompter([]), profiles: listProfiles(root), questions, answers: { ...base, 'arch.demo-framework': 'one' } });
  assert.equal(kept.answers['arch.demo-framework'], 'one');
});
