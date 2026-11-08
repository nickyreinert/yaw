// T-030: the Coding Style cards do not repeat each other. Unit Tests says it is part of `just check`;
// Local settings & secrets has no Docker of its own (Docker is the Architecture switch plus the stack scaffold).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadBaseQuestions, loadModule, profileDevenv } from '../core/render/kit.js';
import { initProject } from '../core/render/project.js';
import { KIT_ROOT, readTree, tmp, writeAnswers } from './helpers/fixtures.js';

test('Unit Tests says it is part of just check and names no other setting', () => {
  const q = loadBaseQuestions(KIT_ROOT).find((item) => item.id === 'quality.unit-tests');
  assert.equal(q.label, 'Unit Tests');
  assert.match(q.hint, /part of `just check`/i);
  assert.match(q.hint, /non-empty/);
  assert.doesNotMatch(q.hint, /Quality reviews|standards|testing rules/i);
});

test('Local settings & secrets has no Docker text, outputs or templates', () => {
  const module = loadModule(KIT_ROOT, 'devenv');
  const shown = JSON.stringify([module.title, module.description, module.short, module.what, module.adds, module.example, module.outputs]);
  assert.doesNotMatch(shown, /docker|compose|devcontainer/i);
  for (const file of ['Dockerfile.tmpl', 'compose.yaml.tmpl', '.devcontainer']) assert.equal(existsSync(join(KIT_ROOT, 'modules/devenv/templates', file)), false, file);
  assert.deepEqual(Object.keys(profileDevenv(KIT_ROOT, ['node-cli'])), ['env']);
});

test('the Docker rule still comes from the Docker switch, not from Local settings', async () => {
  const root = tmp('yaw-cards-');
  const answers = `mode: quick\nanswers:\n  user.agents: [claude]\n  idea.text: A small tool.\n  arch.language: typescript\n  arch.runs-on: local\n  arch.docker: true\nproposal:\n  status: confirmed\n  summary: test\n  profiles: [node-cli]\n  modules: [core, devenv]\n`;
  await initProject({ root, kitRoot: KIT_ROOT, answersFile: writeAnswers(tmp('yaw-cards-ans-'), answers), modules: ['core', 'devenv'] });
  const tree = readTree(root);
  assert.match(tree['docs/engineering.md'], /Docker is required/);
  for (const file of ['Dockerfile', 'compose.yaml', '.devcontainer/devcontainer.json']) assert.equal(Object.hasOwn(tree, file), false, file);
  assert.match(tree['.env.example'], /Copy to \.env/);
});

test('the Coding standards card is gone; the Safety guard still resolves without it', async () => {
  const { hasModule, loadModule: load } = await import('../core/render/kit.js');
  const { CARD_ORDER } = await import('../core/interview/module-groups.js');
  const { checkDependencies } = await import('../core/render/project.js');
  assert.equal(hasModule(KIT_ROOT, 'standards'), false);
  assert.equal(CARD_ORDER.basics.includes('standards'), false);
  assert.equal(existsSync(join(KIT_ROOT, 'modules/standards')), false);
  assert.ok(!(load(KIT_ROOT, 'security').depends ?? []).includes('standards'));
  assert.doesNotThrow(() => checkDependencies({ kitRoot: KIT_ROOT, modules: ['core', 'security'] }));
});

test('the unique standards rules and the stack rules reach docs/engineering.md, always on', async () => {
  const root = tmp('yaw-cards-merge-');
  const answers = `mode: quick\nanswers:\n  user.agents: [claude]\n  idea.text: A small tool.\n  arch.language: typescript\n  arch.runs-on: local\nproposal:\n  status: confirmed\n  summary: test\n  profiles: [node-cli]\n  modules: [core]\n`;
  await initProject({ root, kitRoot: KIT_ROOT, answersFile: writeAnswers(tmp('yaw-cards-ans-'), answers), modules: ['core'] });
  const tree = readTree(root);
  const doc = tree['docs/engineering.md'];
  assert.match(doc, /small, focused units/i);
  assert.match(doc, /N\+1/);
  assert.match(doc, /Conventional Commits/);
  assert.match(doc, /small pull requests/i);
  assert.match(doc, /Stack rules/);
  assert.match(doc, /node:test/);
  assert.equal(Object.hasOwn(tree, 'docs/standards.md'), false);
  assert.doesNotMatch(tree['AGENTS.md'], /docs\/standards\.md/);
});
