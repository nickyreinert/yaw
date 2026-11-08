// T-027: personal settings live only in ~/.yaw/user-profile.yaml; team settings stay in the repository.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { addModule, initProject, readAnswers, updateProject } from '../core/render/project.js';
import { collectQuestions, loadModule } from '../core/render/kit.js';
import { resolveCompact } from '../modules/compact/lib/settings.js';
import { deriveFacts } from '../core/interview/facts.js';
import { stringify } from '../core/lib/yaml.js';
import { KIT_ROOT, read, tmp } from './helpers/fixtures.js';

const MODULES = ['core', 'communication'];
const profileFile = (env) => join(env.HOME, '.yaw/user-profile.yaml');

function doc(extra = {}, scopes) {
  return {
    mode: 'quick',
    answers: { 'user.agents': ['claude', 'codex'], 'user.language': 'fr', 'user.length': 'brief', 'user.expertise': 'expert', 'idea.text': 'A tiny tool.', 'idea.team': 'solo', ...extra },
    ...(scopes ? { scopes } : {}),
    proposal: { status: 'confirmed', summary: 'test', profiles: ['node-cli'], modules: MODULES },
  };
}

async function project(d = doc()) {
  const root = tmp('yaw-split-');
  const env = { HOME: tmp('yaw-home-') };
  await initProject({ root, kitRoot: KIT_ROOT, answers: { text: stringify(d), doc: d }, modules: MODULES, env });
  return { root, env };
}

test('personal answers go to ~/.yaw/user-profile.yaml, never into .yaw/answers.yaml', async () => {
  const { root, env } = await project();
  const committed = read(root, '.yaw/answers.yaml');
  assert.doesNotMatch(committed, /user\./);
  assert.match(committed, /idea\.text/);
  const profile = readFileSync(profileFile(env), 'utf8');
  assert.match(profile, /user\.language: fr/);
  assert.match(profile, /user\.agents/);
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

test('a setting switched to team is committed and rendered; one switched to personal leaves the repository', async () => {
  const scopes = { 'user.length': 'team', 'user.explain': 'team', 'user.expertise': 'team', 'user.language': 'team', 'tasks.use-github': 'personal' };
  const { root, env } = await project(doc({ 'tasks.use-github': false }, scopes));
  const committed = readAnswers(root).answers;
  assert.equal(committed['user.length'], 'brief');
  assert.equal(committed['user.language'], 'fr');
  assert.equal(Object.hasOwn(committed, 'tasks.use-github'), false);
  assert.equal(Object.hasOwn(committed, 'user.agents'), false);
  assert.match(readFileSync(profileFile(env), 'utf8'), /tasks\.use-github: false/);
  assert.match(read(root, 'AGENTS.md'), /Chat in "fr"/);
  assert.match(read(root, 'AGENTS.md'), /Prefer bullet points/);
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
  assert.doesNotMatch(read(root, '.yaw/answers.yaml'), /user\./);
  const profile = readFileSync(profileFile(env), 'utf8');
  assert.match(profile, /user\.autonomy: act-and-report/);
  assert.match(profile, /user\.length: brief/);
});

test('yaw add writes a personal module answer to the profile only', async () => {
  const { root, env } = await project();
  await addModule({ root, kitRoot: KIT_ROOT, module: 'comfort', newAnswers: { 'user.comfort': ['hygiene'] }, env });
  assert.doesNotMatch(read(root, '.yaw/answers.yaml'), /user\./);
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
  const shared = model.normalize({ mode: 'quick', answers, scopes: { 'user.language': 'team' } });
  assert.deepEqual(shared.doc.scopes, { 'user.language': 'team' });
  const input = { mode: 'quick', answers };
  const preview = model.filePreview(input, '.yaw/answers.yaml').content;
  assert.doesNotMatch(preview, /user\./, 'personal answers are not shown as committed');
  assert.match(model.filePreview({ ...input, scopes: { 'user.language': 'team' } }, '.yaw/answers.yaml').content, /user\.language: fr/);
});
