// T-027: personal settings live only in ~/.yaw/user-profile.yaml; team settings stay in the repository.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addModule, initProject, readAnswers, updateProject } from '../core/render/project.js';
import { collectQuestions, loadModule } from '../core/render/kit.js';
import { settingClass, switchable } from '../core/interview/policy.js';
import { resolveCompact } from '../modules/compact/lib/settings.js';
import { deriveFacts } from '../core/interview/facts.js';
import { stringify } from '../core/lib/yaml.js';
import { KIT_ROOT, read, tmp } from './helpers/fixtures.js';

const MODULES = ['core', 'communication'];
const profileFile = (env) => join(env.HOME, '.yaw/user-profile.yaml');
// Every setting is team by default; these preferences are switched to personal.
const PERSONAL = { 'user.language': 'personal', 'user.length': 'personal', 'user.expertise': 'personal', 'user.autonomy': 'personal', 'user.comfort': 'personal' };

function doc(extra = {}, scopes) {
  return {
    mode: 'quick',
    answers: { 'user.agents': ['claude', 'codex'], 'user.language': 'fr', 'user.length': 'brief', 'user.expertise': 'expert', 'idea.text': 'A tiny tool.', 'idea.team': 'solo', ...extra },
    ...(scopes ? { scopes } : {}),
    proposal: { status: 'confirmed', summary: 'test', profiles: ['node-cli'], modules: MODULES },
  };
}

async function project(d = doc({}, PERSONAL)) {
  const root = tmp('yaw-split-');
  const env = { HOME: tmp('yaw-home-') };
  await initProject({ root, kitRoot: KIT_ROOT, answers: { text: stringify(d), doc: d }, modules: MODULES, env });
  return { root, env };
}

test('personal answers go to ~/.yaw/user-profile.yaml, never into .yaw/answers.yaml', async () => {
  const { root, env } = await project();
  const committed = read(root, '.yaw/answers.yaml');
  for (const id of ['user.language', 'user.length', 'user.expertise']) assert.equal(Object.hasOwn(readAnswers(root).answers, id), false, id);
  assert.match(committed, /idea\.text/);
  assert.match(committed, /user\.agents/, 'the agent list generates committed files: team only');
  const profile = readFileSync(profileFile(env), 'utf8');
  assert.match(profile, /user\.language: fr/);
  assert.doesNotMatch(profile, /user\.agents/);
  // Read path: the profile is merged over the project answers.
  assert.equal(readAnswers(root, { env }).answers['user.length'], 'brief');
  assert.equal(readAnswers(root).answers['user.length'], undefined);
});

test('personal style never reaches a committed file in a solo project', async () => {
  const { root } = await project();
  const agents = read(root, 'AGENTS.md');
  assert.doesNotMatch(agents, /Chat in "fr"|Prefer bullet points|user is an expert|## Communication/);
  assert.equal(existsSync(join(root, '.claude/output-styles/yaw.md')), false);
  // The agent files follow the manifest, so a codex user's files are there.
  assert.equal(existsSync(join(root, '.codex')) || /codex/i.test(read(root, '.yaw/manifest.json')), true);
});

test('default is team: without a switch every setting is committed and rendered', async () => {
  const { root, env } = await project(doc({ 'tasks.use-github': false }));
  const committed = readAnswers(root).answers;
  assert.equal(committed['user.length'], 'brief');
  assert.equal(committed['user.language'], 'fr');
  assert.equal(committed['tasks.use-github'], false);
  assert.deepEqual(committed['user.agents'], ['claude', 'codex']);
  assert.equal(existsSync(profileFile(env)), false);
  assert.match(read(root, 'AGENTS.md'), /Chat in "fr"/);
  assert.match(read(root, 'AGENTS.md'), /Prefer bullet points/);
});

test('only communication-like preferences offer personal; security, Unit Tests and other settings are team only', () => {
  const questions = new Map(collectQuestions(KIT_ROOT, ['communication', 'comfort', 'review', 'security', 'tasks', 'compact']).map((q) => [q.id, q]));
  for (const id of ['user.length', 'user.explain', 'user.language', 'user.expertise', 'user.autonomy', 'user.comfort']) {
    assert.equal(switchable(questions.get(id)), true, id);
    assert.equal(settingClass(questions.get(id)), 'team', `${id} defaults to team`);
    assert.equal(settingClass(questions.get(id), { [id]: 'personal' }), 'personal', id);
  }
  for (const id of ['quality.unit-tests', 'quality.review-security', 'compact.levers', 'idea.team', 'arch.language', 'tasks.mode', 'tasks.use-github', 'user.agents']) {
    assert.equal(switchable(questions.get(id)), false, id);
    assert.equal(settingClass(questions.get(id), { [id]: 'personal' }), 'team', id);
  }
  assert.equal(settingClass('user.length'), 'team', 'an unknown or bare id defaults to team');
});

test('setup view: the Personal switch follows switchable(), default team', () => {
  const view = readFileSync(join(KIT_ROOT, 'core/web/assets/interview-view.js'), 'utf8');
  assert.match(view, /if \(switchable\(q\)\) node\.append\(scopeSwitch\(q, id, label\)\)/);
  assert.doesNotMatch(view, /defaultScope/);
});

test('hooks and project rules cannot be switched to personal', async () => {
  const d = doc({}, { 'compact.levers': 'personal' });
  const root = tmp('yaw-split-');
  await assert.rejects(initProject({ root, kitRoot: KIT_ROOT, answers: { text: stringify(d), doc: d }, modules: MODULES, env: { HOME: tmp('yaw-home-') } }), /compact\.levers is a team setting/);
  const locked = collectQuestions(KIT_ROOT, ['compact']).filter((q) => q.scope === 'team').map((q) => q.id);
  for (const id of ['compact.levers', 'idea.team', 'arch.language', 'quality.unit-tests']) assert.ok(locked.includes(id), id);
});

test('an older answers.yaml with user.* keys still reads and is cleaned on the next yaw update', async () => {
  const { root, env } = await project();
  const legacy = read(root, '.yaw/answers.yaml').replace('answers:\n', 'answers:\n  user.autonomy: act-and-report\n  user.length: extensive\n');
  writeFileSync(join(root, '.yaw/answers.yaml'), legacy);
  assert.equal(readAnswers(root).answers['user.autonomy'], 'act-and-report', 'fallback without a profile value');
  assert.equal(readAnswers(root, { env }).answers['user.autonomy'], 'act-and-report');
  assert.equal(readAnswers(root, { env }).answers['user.length'], 'brief', 'the saved profile wins');
  await updateProject({ root, kitRoot: KIT_ROOT, env });
  for (const id of ['user.autonomy', 'user.length']) assert.equal(Object.hasOwn(readAnswers(root).answers, id), false, id);
  const profile = readFileSync(profileFile(env), 'utf8');
  assert.match(profile, /user\.autonomy: act-and-report/);
  assert.match(profile, /user\.length: brief/);
});

test('yaw add writes a personal module answer to the profile only', async () => {
  const { root, env } = await project();
  await addModule({ root, kitRoot: KIT_ROOT, module: 'comfort', newAnswers: { 'user.comfort': ['hygiene'] }, env });
  assert.equal(Object.hasOwn(readAnswers(root).answers, 'user.comfort'), false);
  assert.match(readFileSync(profileFile(env), 'utf8'), /user\.comfort:\n\s+- hygiene/);
});

test('compact levers are a team setting: no personal question, no ~/.yaw/compact.json, YAW_COMPACT still overrides', () => {
  const def = loadModule(KIT_ROOT, 'compact');
  assert.equal(def.questions.some((q) => q.id === 'compact.personal'), false);
  const env = { HOME: tmp('yaw-home-') };
  mkdirSync(join(env.HOME, '.yaw'), { recursive: true });
  writeFileSync(join(env.HOME, '.yaw/compact.json'), JSON.stringify({ version: 1, projects: { '/x': ['hook'] } }));
  assert.deepEqual(resolveCompact({ env, answers: { 'compact.levers': ['recipes'] } }), { levers: ['recipes'], source: 'project' });
  assert.deepEqual(resolveCompact({ env: { ...env, YAW_COMPACT: '0' }, answers: { 'compact.levers': ['recipes'] } }), { levers: [], source: 'env' });
  assert.deepEqual(resolveCompact({ env: { ...env, YAW_COMPACT: '1' }, answers: {} }), { levers: ['recipes', 'hook'], source: 'env' });
});

test('"Who works on this project?" is Solo or Team; a saved external-reviewers reads as team', async () => {
  const team = collectQuestions(KIT_ROOT, []).find((q) => q.id === 'idea.team');
  assert.deepEqual(team.choices.map((c) => c.value ?? c), ['solo', 'team']);
  assert.deepEqual(deriveFacts({ 'idea.team': 'external-reviewers' }).team, true);
  const { root, env } = await project();
  writeFileSync(join(root, '.yaw/answers.yaml'), read(root, '.yaw/answers.yaml').replace('idea.team: solo', 'idea.team: external-reviewers'));
  assert.equal(readAnswers(root).answers['idea.team'], 'team');
  await updateProject({ root, kitRoot: KIT_ROOT, env });
  assert.match(read(root, '.yaw/answers.yaml'), /idea\.team: team/);
});

test('setup form: the Personal switch is validated, saved as scopes and personal answers stay out of the answers preview', async () => {
  const { createFormModel } = await import('../core/web/form-model.js');
  const model = createFormModel({ root: tmp('yaw-split-form-'), kitRoot: KIT_ROOT, env: { HOME: tmp('yaw-home-') } });
  const answers = { 'idea.text': 'A tiny tool.', 'arch.language': 'typescript', 'arch.runs-on': 'local', 'user.language': 'fr' };
  assert.throws(() => model.normalize({ mode: 'quick', answers, scopes: { 'idea.team': 'personal' } }), /Invalid personal or team setting/);
  assert.throws(() => model.normalize({ mode: 'quick', answers, scopes: { 'user.language': 'mine' } }), /Invalid personal or team setting/);
  assert.throws(() => model.normalize({ mode: 'quick', answers, scopes: { 'tasks.use-github': 'personal' } }), /Invalid personal or team setting/);
  const shared = model.normalize({ mode: 'quick', answers, scopes: { 'user.language': 'team' } });
  assert.deepEqual(shared.doc.scopes, { 'user.language': 'team' });
  const input = { mode: 'quick', answers };
  assert.match(model.filePreview(input, '.yaw/answers.yaml').content, /user\.language: fr/, 'default team: committed');
  const preview = model.filePreview({ ...input, scopes: { 'user.language': 'personal' } }, '.yaw/answers.yaml').content;
  assert.doesNotMatch(preview, /user\.language: fr/, 'personal answers are not shown as committed');
});
