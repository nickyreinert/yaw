// T-031: Coding Practices is no longer a section. User-facing errors, diagnostic logs and internal documentation
// are derived from language, destination and enabled modules, and old project answers stay readable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadBaseQuestions } from '../core/render/kit.js';
import { asksAtDepth } from '../core/interview/depth.js';
import { codingPractices } from '../core/lib/coding-practices.js';
import { initProject } from '../core/render/project.js';
import { KIT_ROOT, readTree, tmp, writeAnswers } from './helpers/fixtures.js';

const REMOVED = ['quality.error-detail', 'quality.log-output', 'quality.documentation'];

test('user-facing errors, diagnostic logs and internal documentation are not interview options', () => {
  const questions = loadBaseQuestions(KIT_ROOT);
  for (const id of REMOVED) {
    const q = questions.find((item) => item.id === id);
    for (const mode of ['quick', 'basic', 'pro']) assert.ok(!q || !asksAtDepth(q, mode), `${id} is asked in ${mode}`);
  }
});

test('the generated rules follow language and destination', () => {
  const text = (answers, context) => codingPractices(answers, context).join('\n');
  const page = text({ 'arch.language': 'html', 'arch.runs-on': 'static' });
  assert.match(page, /No logging infrastructure/);
  assert.doesNotMatch(page, /structured (console|log)/i);
  const server = text({ 'arch.language': 'typescript', 'arch.runs-on': 'self-hosted' });
  assert.match(server, /structured/i);
  assert.doesNotMatch(server, /No logging infrastructure/);
  assert.match(text({ 'arch.language': 'python', 'arch.runs-on': 'local' }), /structured/i);
});

test('the documentation rule defers to the Code Map when that module is on', () => {
  const answers = { 'arch.language': 'python', 'arch.runs-on': 'local' };
  assert.match(codingPractices(answers, { modules: ['core', 'code-map'] }).join('\n'), /docs\/code-map\.md/);
  assert.doesNotMatch(codingPractices(answers, { modules: ['core'] }).join('\n'), /code-map/);
});

test('old answers are ignored and a plain HTML page gets no logging rule in docs/engineering.md', async () => {
  const root = tmp('yaw-practices-');
  const answers = `mode: quick\nanswers:\n  user.agents: [claude]\n  idea.text: A landing page.\n  arch.language: html\n  arch.runs-on: static\n  quality.log-output: file\n  quality.error-detail: detailed\nproposal:\n  status: confirmed\n  summary: test\n  profiles: [static-site]\n  modules: [core]\n`;
  await initProject({ root, kitRoot: KIT_ROOT, answersFile: writeAnswers(tmp('yaw-practices-ans-'), answers), modules: ['core'] });
  const doc = readTree(root)['docs/engineering.md'];
  assert.match(doc, /No logging infrastructure/);
  assert.doesNotMatch(doc, /structured log files|clear error context/i);
});
