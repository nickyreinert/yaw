import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEPTHS, depthOf, depthLabel, RETIRED_ARCHITECTURE } from '../core/interview/depth.js';
import { collectQuestions } from '../core/render/kit.js';
import { runInterview } from '../core/interview/engine.js';
import { asksIn } from '../core/interview/policy.js';
import { createFormModel } from '../core/web/form-model.js';
import { interviewShell } from '../core/web/interview-shell.js';
import { interviewApply, interviewData, interviewPreview } from '../core/web/settings.js';
import { saveSetupDefaults } from '../core/lib/setup-defaults.js';
import { settingsRoute, settingsPresentation, visibleQuestions } from '../core/web/assets/ui-state.js';
import { main } from '../core/cli/main.js';
import { readAnswers } from '../core/render/project.js';
import { KIT_ROOT, tmp, capture, scripted } from './helpers/fixtures.js';
const base = { 'idea.text': 'A project.', 'arch.language': 'typescript', 'arch.runs-on': 'local' };
const f = () => ({ root: tmp(), kitRoot: KIT_ROOT, env: { HOME: tmp(), PATH: process.env.PATH } });

test('Settings URLs keep interview as a feature and preserve deep-link parameters', () => {
  assert.equal(settingsRoute('settings'), 'settings');
  assert.equal(settingsRoute('settings', 'interview'), 'settings?interview');
  assert.equal(settingsRoute('settings', 'project', 'interview&section=stack'), 'settings?section=stack');
  assert.equal(settingsPresentation(undefined), 'settings');
  assert.equal(settingsPresentation('project'), 'settings');
  assert.equal(settingsPresentation(undefined, new URLSearchParams('interview')), 'interview');
  assert.equal(settingsPresentation('interview'), 'interview');
  assert.equal(settingsRoute('global-settings', 'interview'), 'global-settings');
  assert.equal(settingsRoute('settings', 'interview', 'interview&section=stack'), 'settings?interview&section=stack');
  assert.equal(settingsRoute('global-settings', 'files', 'file=presets%2Fdemo.yaml'), 'global-settings/files?file=presets%2Fdemo.yaml');
  assert.equal(settingsRoute('settings', 'kickoff'), 'settings/kickoff');
});

test('Quick asks only project essentials and architecture; Basic adds GitHub/reviews; Pro asks all applicable questions', () => {
  const questions = collectQuestions(KIT_ROOT, ['core', 'tasks', 'review', 'communication', 'team']);
  assert.deepEqual(DEPTHS.map((d) => d.value), ['quick', 'basic', 'pro']);
  assert.deepEqual(DEPTHS.map((d) => d.label), ['Quick', 'Basic', 'All']);
  for (const mode of ['pro', 'all', 'full', 'standard']) assert.equal(depthLabel(mode), 'All');
  const ids = (mode) => questions.filter((q) => asksIn(q, mode)).map((q) => q.id);
  // Generated profile-option questions are asked at every depth (ADR-0105).
  const optionIds = questions.filter((q) => q.profileOption).map((q) => q.id);
  assert.ok(optionIds.includes('arch.node-app-framework') && optionIds.includes('arch.php-serverless-hosting'));
  assert.deepEqual(ids('quick').filter((id) => !optionIds.includes(id)), ['user.agents', 'idea.text', 'tasks.use-github', 'arch.language', 'arch.runs-on']);
  for (const id of optionIds) assert.ok(ids('quick').includes(id), `${id} is asked in Quick`);
  for (const id of ['arch.framework', 'arch.hosting-control', 'arch.libraries', 'arch.services', 'arch.cost', 'arch.cost-limit']) {
    assert.ok(!ids('basic').includes(id), `${id} belongs to Pro`);
    assert.ok(!ids('pro').includes(id), `${id} is retained only for legacy answers`);
  }
  assert.ok(ids('basic').includes('tasks.use-github'));
  assert.ok(ids('basic').includes('quality.review-quality'));
  assert.equal(ids('pro').length, questions.filter((q) => !RETIRED_ARCHITECTURE.has(q.id)).length);
  for (const id of ['arch.library-strategy', 'arch.docker', 'quality.error-detail', 'quality.log-output', 'quality.documentation', 'quality.review-security']) assert.ok(ids('basic').includes(id), id);
  const bootstrap = createFormModel(f()).bootstrap();
  const proVisible = visibleQuestions(bootstrap.questions, {}, 'pro', ['core']);
  assert.ok(proVisible.some((q) => q.id === 'user.comfort'));
  assert.equal(depthOf('full'), 'pro'); assert.equal(depthOf('standard'), 'pro'); assert.equal(depthOf('all'), 'pro');
});

test('optional tools default off and explicit saved tool defaults drive both rendering and interview values', () => {
  const fixture = f();
  const initial = createFormModel(fixture).normalize({ mode: 'quick', answers: base });
  assert.deepEqual(initial.modules, ['core']);
  assert.equal(initial.doc.answers['tasks.use-github'], false);
  saveSetupDefaults(fixture, { modules: ['tasks', 'review'], answers: { 'tasks.use-github': false, 'quality.review-quality': 'request' } });
  const saved = createFormModel(fixture).normalize({ mode: 'quick', answers: base });
  assert.ok(saved.modules.includes('tasks')); assert.ok(saved.modules.includes('review'));
  assert.equal(saved.doc.answers['quality.review-quality'], 'request');
});

test('Basic choices select review/GitHub modules and Pro does not suppress questions for laypeople', async () => {
  const fixture = f();
  const chosen = createFormModel(fixture).normalize({ mode: 'basic', answers: { ...base, 'tasks.use-github': true, 'quality.review-logic': 'push' } });
  assert.ok(chosen.modules.includes('github')); assert.ok(chosen.modules.includes('review'));
  const q = { id: 'team.extra', mode: 'F', label: 'Extra?', type: 'boolean', default: false };
  let asked = 0;
  const result = await runInterview({ questions: [q], mode: 'pro', known: { 'user.expertise': 'layperson' }, prompter: { show() {}, async ask() { asked++; return 'y'; } } });
  assert.equal(asked, 1); assert.equal(result.answers[q.id], true);
});

test('init and Settings use the same canonical wizard and controller; Settings preserves optimistic concurrency', async () => {
  const shell = interviewShell();
  assert.match(shell, /class="wizard-layout"/); assert.match(shell, /id="setup-depth"/); assert.match(shell, /id="apply-dialog"/);
  for (const file of ['app.js', 'settings-view.js']) assert.match(readFileSync(join(KIT_ROOT, 'core/web/assets', file), 'utf8'), /mountInterview/);
  assert.doesNotMatch(readFileSync(join(KIT_ROOT, 'core/web/assets/settings-view.js'), 'utf8'), /function renderInterview\(/);
  const fixture = f();
  const data = interviewData(fixture), input = { mode: 'basic', answers: base, expected: data.hash };
  const preview = interviewPreview({ ...fixture, input });
  assert.ok(preview.files.length); assert.ok(preview.questions || preview.answers);
  const result = await interviewApply({ ...fixture, input });
  assert.ok(result.events.some((e) => e.type === 'done' && e.ok));
  await assert.rejects(interviewApply({ ...fixture, input }), (e) => e.status === 409);
});

test('Quick terminal and browser both reuse a saved review trigger without a redundant module selection', async () => {
  const fixture = f();
  saveSetupDefaults(fixture, { modules: [], answers: { 'quality.review-quality': 'request' } });
  const browser = createFormModel(fixture).normalize({ mode: 'quick', answers: base });
  const p = scripted(), questions = collectQuestions(KIT_ROOT, ['core', 'review']);
  p.ask = async (prompt) => {
    if (/Setup depth/.test(prompt)) return 'quick';
    if (/Write these files/.test(prompt)) return 'y';
    if (/Save |Kick off the project documents/.test(prompt)) return 'n';
    const screen = [...p.shown].reverse().find((s) => /^  \d+\/\d+ /.test(s));
    const q = questions.find((q) => screen?.split('\n')[0].endsWith(q.label));
    return q && Object.hasOwn(base, q.id) ? String(base[q.id]) : '';
  };
  const stderr = capture();
  const code = await main(['init', '--skip-verify'], { ...fixture, cwd: fixture.root, stdout: capture(), stderr, prompter: p });
  assert.equal(code, 0, stderr.text());
  assert.deepEqual(readAnswers(fixture.root), browser.doc);
});
