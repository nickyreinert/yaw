// Setup depth Quick / Full (Y-5.10, ADR-0032): selection, relevance, dependency closure, the 80-line AGENTS.md budget.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveFacts } from '../core/interview/facts.js';
import { main } from '../core/cli/main.js';
import { parseDocument, stringify } from '../core/lib/yaml.js';
import { AGENTS_MAX_LINES } from '../core/render/compose.js';
import { initProject, readAnswers, renderInit, selectModules } from '../core/render/project.js';
import { KIT_ROOT, capture, cleanEnv, makeKit, read, run, scripted, tmp, writeAnswers } from './helpers/fixtures.js';

const fixture = (name) => JSON.parse(readFileSync(join(KIT_ROOT, 'test/fixtures/setup-depth', name), 'utf8'));
const NO_PROJECT = tmp('yaw-none-');

function answersFor(profile, { mode, team = false, github, tasks } = {}) {
  const doc = parseDocument(readFileSync(join(KIT_ROOT, 'examples', profile, 'answers.yaml'), 'utf8')).value;
  doc.mode = mode;
  if (team) doc.answers['idea.team'] = 'team';
  if (github !== undefined) doc.answers['tasks.use-github'] = github;
  if (tasks !== undefined) doc.answers['tasks.mode'] = tasks;
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

test('Full: github and ci follow the GitHub answer; git-hooks, decisions, sessions, comfort, code-map, review are always on', () => {
  const on = render('node-cli', { mode: 'full' }).modules;
  assert.deepEqual(on, ['core', 'ci', 'code-map', 'comfort', 'communication', 'decisions', 'devenv', 'git-hooks', 'github', 'review', 'security', 'sessions', 'standards', 'tasks']);
  const off = render('node-cli', { mode: 'full', github: false }).modules;
  assert.deepEqual(off, on.filter((m) => m !== 'github' && m !== 'ci'));
});

test('Full: team projects default to GitHub but can use local Git instead', () => {
  for (const github of [undefined, true]) {
    const modules = render('node-cli', { mode: 'full', team: true, github }).modules;
    for (const m of ['team', 'github', 'ci', 'tasks', 'git-hooks']) assert.ok(modules.includes(m), `${m} with github=${github}`);
  }
  const { modules, desired } = render('node-cli', { mode: 'full', team: true, github: false });
  for (const m of ['github', 'ci', 'team']) assert.ok(!modules.includes(m));
  for (const path of desired.keys()) assert.ok(!path.startsWith('.github/'), path);
  assert.doesNotMatch(desired.get('TASKS.md').content.toString(), /Read-only/);
  assert.doesNotMatch(desired.get('AGENTS.md').content.toString(), /Chat in "|Ask before risky|just pr|gh-protect/);
});

test('external reviewers use the same team facts and GitHub opt-out as teams', () => {
  assert.deepEqual(deriveFacts({ 'idea.team': 'external-reviewers' }), { team: true, usesGitHub: true });
  assert.deepEqual(deriveFacts({ 'idea.team': 'external-reviewers', 'tasks.use-github': false }), { team: true, usesGitHub: false });
});

test('a team setup without GitHub preserves and can push to a local bare remote', async () => {
  const root = tmp('yaw-local-team-');
  const remote = tmp('yaw-local-remote-');
  const env = cleanEnv(tmp('yaw-home-'));
  const git = (cwd, ...args) => {
    const r = run('git', args, { cwd, env });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git(remote, 'init', '--bare', '--quiet', '-b', 'main');
  git(root, 'init', '--quiet', '-b', 'main');
  git(root, 'remote', 'add', 'origin', remote);
  const doc = answersFor('node-cli', { mode: 'full', team: true, github: false });
  const modules = selectModules({ mode: doc.mode, facts: deriveFacts(doc.answers) });
  await initProject({ root, answers: { doc, text: stringify(doc) }, modules });
  assert.equal(git(root, 'remote', 'get-url', 'origin'), remote);
  git(root, 'add', 'AGENTS.md', 'TASKS.md');
  git(root, 'commit', '--quiet', '-m', 'initial local team setup');
  git(root, 'push', '--quiet', '-u', 'origin', 'main');
  assert.equal(git(remote, 'rev-parse', 'main'), git(root, 'rev-parse', 'HEAD'));
});

test('Quick and Full register exactly the expected hook modules and skills for every agent', () => {
  for (const agent of ['claude', 'codex', 'copilot']) {
    for (const mode of ['quick', 'full']) {
      const doc = answersFor('node-cli', { mode });
      doc.answers['user.agents'] = [agent];
      const modules = selectModules({ mode, facts: deriveFacts(doc.answers) });
      const { desired } = renderInit({ root: NO_PROJECT, answersDoc: doc, modules });
      const path = agent === 'codex' ? '.codex/hooks.json' : '.claude/settings.json';
      const actual = [...new Set([...(desired.get(path)?.content.toString().matchAll(/--module ([a-z-]+)/g) ?? [])].map((m) => m[1]))].sort();
      const expected = mode === 'quick' ? [] : agent === 'copilot' ? ['security', 'sessions', 'tasks'] : ['comfort', 'decisions', 'review', 'security', 'sessions', 'tasks'];
      assert.deepEqual(actual, expected, `${agent}/${mode}`);
      const skills = [...desired.keys()].filter((p) => p.endsWith('/SKILL.md'));
      const names = ['epic-plan', 'handoff', 'issue-create', 'issue-triage', 'review'];
      const directories = agent === 'claude' ? ['.agents', '.claude'] : ['.agents'];
      const expectedSkills = mode === 'quick' ? [] : names;
      assert.deepEqual(skills.sort(), directories.flatMap((dir) => expectedSkills.map((name) => `${dir}/skills/${name}/SKILL.md`)).sort(), `${agent}/${mode} skills`);
    }
  }
});

test('expanding a real Quick project preserves its mode, answers and edited instructions', async () => {
  const root = tmp('yaw-expand-');
  const doc = answersFor('node-cli', { mode: 'quick' });
  const modules = selectModules({ mode: doc.mode, facts: deriveFacts(doc.answers) });
  await initProject({ root, answers: { doc, text: stringify(doc) }, modules });
  const edited = `${read(root, 'AGENTS.md')}\nMy own rule: preserve this text.\n`;
  writeFileSync(join(root, 'AGENTS.md'), edited);
  const stderr = capture();
  const env = cleanEnv(tmp('yaw-home-'));
  const code = await main(['add', 'git-hooks', '--yes'], { cwd: root, kitRoot: KIT_ROOT, env, stdout: capture(), stderr, prompter: { ...scripted(), interactive: false } });
  assert.equal(code, 0, stderr.text());
  assert.equal(readAnswers(root).mode, 'quick');
  // T-027: yaw add moves the personal answers to ~/.yaw/user-profile.yaml; read over it they are unchanged.
  assert.equal(Object.keys(readAnswers(root).answers).some((id) => id.startsWith('user.')), false);
  assert.deepEqual(readAnswers(root, { env }).answers, doc.answers);
  assert.deepEqual(readAnswers(root).proposal.modules, [...modules, 'git-hooks']);
  assert.equal(read(root, 'AGENTS.md'), edited);
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

test('standard output is byte for byte the recorded fixture (AGENTS.md excluded: it was trimmed; regenerated for code-map in Y-5.11, ADR-0033)', () => {
  const before = fixture('standard-team-node-cli.json');
  const { modules, desired } = render('node-cli', { mode: 'standard', team: true });
  assert.deepEqual(modules, before.modules);
  const hashes = Object.fromEntries([...desired].filter(([p]) => p !== 'AGENTS.md').sort().map(([p, v]) => [p, createHash('sha256').update(v.content).digest('hex')]));
  assert.deepEqual(hashes, before.files);
});

test(`AGENTS.md has at most ${AGENTS_MAX_LINES} lines for Full in every profile, solo and team, every task mode`, () => {
  for (const profile of ['node-cli', 'python-cli']) {
    for (const team of [false, true]) {
      for (const tasks of ['local', 'github', 'both']) {
        const { desired } = render(profile, { mode: 'full', team, tasks });
        assert.ok(lines(desired) <= AGENTS_MAX_LINES, `${profile} ${team ? 'team' : 'solo'} tasks=${tasks}: ${lines(desired)} lines`);
      }
    }
  }
});

test('a dependency violation in proposal.modules is an error that names the missing module', async () => {
  const stdout = capture();
  const stderr = capture();
  const answers = writeAnswers(tmp('yaw-ans-'), 'mode: quick\nanswers:\n  user.agents: [claude]\nproposal:\n  status: confirmed\n  summary: s\n  profiles: [node-cli]\n  modules: [core, ci]\n');
  const cwd = tmp('yaw-proj-');
  const code = await main(['init', '--answers', answers, '--yes', '--skip-verify'], { cwd, env: { HOME: tmp('yaw-home-') }, kitRoot: KIT_ROOT, stdout, stderr, prompter: { ...scripted(), interactive: false } });
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
  const env = { HOME: tmp('yaw-home-') };
  const yaw = async (args) => main(args, { cwd: root, env, kitRoot, stdout: capture(), stderr: capture(), prompter: { ...scripted(), interactive: false } });
  const answers = writeAnswers(tmp('yaw-ans-'), 'mode: quick\nanswers:\n  user.agents: [claude]\n  quality.level: high\nproposal:\n  status: confirmed\n  summary: s\n  profiles: [node-cli]\n  modules: [core]\n');
  await initProject({ root, kitRoot, answersFile: answers });
  assert.equal(await yaw(['add', 'extra', '--yes']), 0);
  const doc = readAnswers(root, { env, kitRoot });
  assert.equal(doc.mode, 'quick');
  assert.equal(doc.answers['quality.level'], 'high');
  assert.deepEqual(doc.answers['user.agents'], ['claude'], 'kept, in ~/.yaw/user-profile.yaml (T-027)');
});
