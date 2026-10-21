// Setup depth Quick / Full (Y-5.10, ADR-0032): selection, relevance, dependency closure, the 80-line AGENTS.md budget.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveFacts } from '../core/interview/facts.js';
import { main } from '../core/cli/main.js';
import { parseDocument } from '../core/lib/yaml.js';
import { AGENTS_MAX_LINES } from '../core/render/compose.js';
import { initProject, readAnswers, renderInit, selectModules } from '../core/render/project.js';
import { KIT_ROOT, capture, makeKit, scripted, tmp, writeAnswers } from './helpers/fixtures.js';

const fixture = (name) => JSON.parse(readFileSync(join(KIT_ROOT, 'test/fixtures/setup-depth', name), 'utf8'));
const NO_PROJECT = tmp('yaw-none-');

function answersFor(profile, { mode, team = false, github } = {}) {
  const doc = parseDocument(readFileSync(join(KIT_ROOT, 'examples', profile, 'answers.yaml'), 'utf8')).value;
  doc.mode = mode;
  if (team) doc.answers['idea.team'] = 'team';
  if (github !== undefined) doc.answers['tasks.use-github'] = github;
  return doc;
}

function render(profile, options) {
  const doc = answersFor(profile, options);
  const modules = selectModules({ mode: options.mode, facts: deriveFacts(doc.answers) });
  return { modules, desired: renderInit({ root: NO_PROJECT, answersDoc: doc, modules }).desired };
}

const lines = (desired) => desired.get('AGENTS.md').content.toString('utf8').replace(/\n$/, '').split('\n').length;

test('Quick produces exactly its baseline modules and files', () => {
  const { modules, desired } = render('node-cli', { mode: 'quick' });
  const expected = fixture('quick-node-cli.json');
  assert.deepEqual(modules, expected.modules);
  assert.deepEqual([...desired.keys()].sort(), expected.files);
});

test('Full: github and ci follow the GitHub answer; git-hooks, decisions, sessions, comfort are always on', () => {
  const on = render('node-cli', { mode: 'full' }).modules;
  assert.deepEqual(on, ['core', 'ci', 'comfort', 'communication', 'decisions', 'devenv', 'git-hooks', 'github', 'security', 'sessions', 'standards', 'tasks']);
  const off = render('node-cli', { mode: 'full', github: false }).modules;
  assert.deepEqual(off, on.filter((m) => m !== 'github' && m !== 'ci'));
});

test('Full: a team project always has github and ci, whatever the GitHub answer says', () => {
  for (const github of [undefined, false]) {
    const modules = render('node-cli', { mode: 'full', team: true, github }).modules;
    for (const m of ['team', 'github', 'ci', 'tasks', 'git-hooks']) assert.ok(modules.includes(m), `${m} with github=${github}`);
  }
});

test('Full without GitHub keeps tasks local, whatever tasks.mode says', async () => {
  const { tasksMode } = await import('../core/lib/tasks.js');
  assert.equal(tasksMode({ 'idea.team': 'solo', 'tasks.mode': 'both', 'tasks.use-github': false }), 'local');
  assert.equal(tasksMode({ 'idea.team': 'solo', 'tasks.mode': 'both' }), 'both');
});

test('standard is an alias of full: same modules, same files, same bytes', () => {
  for (const options of [{}, { team: true }]) {
    const full = render('node-cli', { mode: 'full', ...options });
    const standard = render('node-cli', { mode: 'standard', ...options });
    assert.deepEqual(standard.modules, full.modules);
    assert.deepEqual([...standard.desired.keys()], [...full.desired.keys()]);
    // the only difference is the mode the AGENTS.md header records
    const text = (d, path) => d.get(path).content.toString('utf8').replace('(standard setup)', '(full setup)');
    for (const path of full.desired.keys()) assert.equal(text(standard.desired, path), text(full.desired, path), path);
  }
});

test('standard output is byte for byte what it was before Y-5.10 (AGENTS.md excluded: it was trimmed)', () => {
  const before = fixture('standard-team-node-cli.json');
  const { modules, desired } = render('node-cli', { mode: 'standard', team: true });
  assert.deepEqual(modules, before.modules);
  const hashes = Object.fromEntries([...desired].filter(([p]) => p !== 'AGENTS.md').sort().map(([p, v]) => [p, createHash('sha256').update(v.content).digest('hex')]));
  assert.deepEqual(hashes, before.files);
});

test(`AGENTS.md has at most ${AGENTS_MAX_LINES} lines for Full in every profile, solo and team`, () => {
  for (const profile of ['node-cli', 'python-cli']) {
    for (const team of [false, true]) {
      const { desired } = render(profile, { mode: 'full', team });
      assert.ok(lines(desired) <= AGENTS_MAX_LINES, `${profile} ${team ? 'team' : 'solo'}: ${lines(desired)} lines`);
    }
  }
});

test('a dependency violation in proposal.modules is an error that names the missing module', async () => {
  const stdout = capture();
  const stderr = capture();
  const answers = writeAnswers(tmp('yaw-ans-'), 'mode: quick\nanswers:\n  user.agents: [claude]\nproposal:\n  status: confirmed\n  summary: s\n  profiles: [node-cli]\n  modules: [core, ci]\n');
  const cwd = tmp('yaw-proj-');
  const code = await main(['init', '--answers', answers, '--yes', '--skip-verify'], { cwd, kitRoot: KIT_ROOT, stdout, stderr, prompter: { ...scripted(), interactive: false } });
  assert.equal(code, 1);
  assert.match(stderr.text(), /ci depends on github, which is not in the selected modules/);
});

test('a mode default that breaks a dependency is an error that names the missing module', () => {
  const kitRoot = makeKit(tmp('yaw-kit-'), { modules: { core: {}, child: { depends: ['core', 'parent'] } } });
  assert.throws(() => selectModules({ kitRoot, mode: 'full', facts: {} }), /child depends on parent, which is not in the selected modules/);
});

test('yaw add keeps the answers of earlier modules and takes the old answer as the default', async () => {
  const question = { id: 'quality.level', mode: 'Q', type: 'choice', label: 'Level?', choices: ['low', 'high'], default: 'low' };
  const kitRoot = makeKit(tmp('yaw-kit-'), { modules: { core: { templates: { 'AGENTS.md.tmpl': '# A\n' } }, extra: { depends: ['core'], questions: [question] } } });
  const root = tmp('yaw-proj-');
  const yaw = async (args) => main(args, { cwd: root, kitRoot, stdout: capture(), stderr: capture(), prompter: { ...scripted(), interactive: false } });
  const answers = writeAnswers(tmp('yaw-ans-'), 'mode: quick\nanswers:\n  user.agents: [claude]\n  quality.level: high\nproposal:\n  status: confirmed\n  summary: s\n  profiles: [node-cli]\n  modules: [core]\n');
  await initProject({ root, kitRoot, answersFile: answers });
  assert.equal(await yaw(['add', 'extra', '--yes']), 0);
  const doc = readAnswers(root);
  assert.equal(doc.mode, 'quick');
  assert.equal(doc.answers['quality.level'], 'high');
  assert.deepEqual(doc.answers['user.agents'], ['claude']);
});
