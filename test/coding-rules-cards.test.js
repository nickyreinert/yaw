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
