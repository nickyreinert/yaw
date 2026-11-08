import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../core/cli/main.js';
import { collectQuestions, hasModule } from '../core/render/kit.js';
import { readAnswers } from '../core/render/project.js';
import { PERSONAL_PREFERENCES } from '../core/interview/policy.js';
import { loadPreferences, saveSetup, seedPersonalPreferences } from '../core/lib/user-store.js';
import { createFormModel } from '../core/web/form-model.js';
import { createFormApi } from '../core/web/init.js';
import { isInline } from '../core/web/assets/setup-cards.js';
import { visibleQuestions } from '../core/web/assets/ui-state.js';
import { createStyle } from '../core/cli/style.js';
import { KIT_ROOT, capture, cleanEnv, scripted, tmp } from './helpers/fixtures.js';

const BASE = { 'idea.text': 'A local note organizer.', 'arch.language': 'typescript', 'arch.runs-on': 'local' };
const PERSONAL = { 'user.expertise': 'layperson', 'user.language': 'en', 'user.autonomy': 'ask-often', 'user.length': 'brief', 'user.explain': 'one-line' };
const fixture = () => ({ root: tmp(), kitRoot: KIT_ROOT, env: cleanEnv(tmp()) });
const profile = (f) => join(f.env.HOME, '.yaw/user-profile.yaml');
function prompts({ mode = 'basic', answers = PERSONAL, apply = true, offer = true, save = true } = {}) {
  const p = scripted(), questions = collectQuestions(KIT_ROOT, readdirSync(join(KIT_ROOT, 'modules')).filter((name) => hasModule(KIT_ROOT, name)));
  p.ask = async (prompt) => {
    p.asked.push(prompt);
    assert.ok(p.asked.length < 100);
    if (/Would you like to enter personal defaults/.test(prompt)) return offer ? 'y' : 'n';
    if (/Setup depth/.test(prompt)) return mode;
    if (/^\s*Modules /.test(prompt)) return 'none';
    if (/Write these files/.test(prompt)) return apply ? 'y' : 'n';
    if (/Save these personal defaults/.test(prompt)) return save ? 'y' : 'n';
    if (/Save |Kick off the project documents|create one now/.test(prompt)) return 'n';
    const screen = [...p.shown].map((s) => s.replace(/\x1b\[[0-9;]*m/g, '')).reverse().find((s) => /^  \d+\/\d+ /.test(s));
    const q = questions.find((q) => screen?.split('\n')[0].endsWith(q.label));
    assert.ok(q, `unexpected prompt ${prompt}`);
    return Object.hasOwn({ ...BASE, ...answers }, q.id) ? String(({ ...BASE, ...answers })[q.id]) : '';
  };
  return p;
}
async function cli(f, args, p) {
  const stdout = capture(), stderr = capture();
  const code = await main(args, { ...f, cwd: f.root, stdout, stderr, prompter: p });
  assert.equal(code, 0, stderr.text());
  return { out: stdout.text(), err: stderr.text() };
}

test('install onboarding asks first, can be declined, and saves only reviewed personal defaults', async () => {
  const declined = fixture(), p = prompts({ offer: false });
  await cli(declined, ['defaults', '--offer'], p);
  assert.match(p.asked[0], /Would you like to enter personal defaults now/);
  assert.equal(p.asked.length, 1); assert.equal(existsSync(profile(declined)), false);
  const f = fixture();
  await cli(f, ['defaults', '--offer'], prompts());
  assert.deepEqual(loadPreferences(f).answers, PERSONAL);
  assert.equal(existsSync(join(f.root, '.yaw')), false);
  assert.equal(existsSync(join(f.env.HOME, '.yaw/history.jsonl')), false);
  const again = prompts(); await cli(f, ['defaults', '--offer'], again);
  assert.equal(again.asked.length, 0, 'install reruns do not prompt when personal defaults exist');
});

// T-027 (ADR-0134, amends ADR-0079): personal answers are saved only to ~/.yaw/user-profile.yaml and never committed;
// the profile is read over the project answers, and the last saved personal answers apply to every project.
test('Quick uses factory or saved preferences without personal prompts; they stay out of the repository', async () => {
  for (const saved of [false, true]) {
    const f = fixture();
    if (saved) saveSetup({ ...f, answers: PERSONAL, mode: 'pro', projectRoot: f.root, kit: '', preset: false, profile: true });
    const p = prompts({ mode: 'quick' });
    const result = await cli(f, ['init', '--skip-verify'], p);
    assert.doesNotMatch(p.shown.join(''), /Your experience with software|How long should answers|Review and save personal/);
    assert.equal(Object.keys(readAnswers(f.root).answers).some((id) => id.startsWith('user.')), false);
    const answers = readAnswers(f.root, { env: f.env }).answers;
    assert.equal(answers['user.expertise'], saved ? 'layperson' : 'intermediate');
    assert.equal(answers['user.length'], saved ? 'brief' : 'balanced');
    const instructions = readFileSync(join(f.root, 'AGENTS.md'), 'utf8');
    assert.doesNotMatch(instructions, /Prefer bullet points, key points and direct answers|Give balanced answers/, 'the answer style is personal');
    if (saved) assert.deepEqual(preferences(f), PERSONAL, 'the saved preferences are reused, not changed');
    else assert.match(result.out, /No personal defaults set/);
  }
});

const preferences = (f) => Object.fromEntries(PERSONAL_PREFERENCES.map((id) => [id, loadPreferences(f).answers[id]]));

test('Basic and Pro save the personal answers to the profile; a later project changes them for every project', async () => {
  for (const mode of ['basic', 'pro']) {
    const first = fixture();
    await cli(first, ['init', '--skip-verify'], prompts({ mode }));
    assert.deepEqual(preferences(first), PERSONAL);
    assert.equal(Object.keys(readAnswers(first.root).answers).some((id) => id.startsWith('user.')), false);
    const next = { ...first, root: tmp() };
    await cli(next, ['init', '--skip-verify'], prompts({ mode, answers: { ...PERSONAL, 'user.length': 'extensive', 'user.expertise': 'expert' } }));
    assert.equal(readAnswers(next.root, { env: next.env }).answers['user.length'], 'extensive');
    assert.equal(readAnswers(first.root, { env: first.env }).answers['user.length'], 'extensive', 'one personal file for all projects');
  }
});

test('Basic browser questions and Apply match terminal defaults without enabling communication tooling', async () => {
  const f = fixture(), model = createFormModel(f), boot = model.bootstrap();
  assert.match(boot.personalDefaultsNotice, /No personal defaults/);
  const visible = visibleQuestions(boot.questions, BASE, 'basic', ['core']);
  for (const id of PERSONAL_PREFERENCES) {
    const question = visible.find((q) => q.id === id);
    assert.ok(question, id);
    assert.equal(isInline(question), false, 'personal questions appear in About you even when communication tooling is off');
  }
  const api = createFormApi({ ...f, skipVerify: true });
  try {
    const prepared = api.prepareApply({ mode: 'basic', answers: { ...BASE, ...PERSONAL, 'tasks.use-github': false } });
    assert.deepEqual(prepared.modules, ['core']);
    await api.apply(prepared, () => {});
    assert.deepEqual(preferences(f), PERSONAL);
    const another = { ...f, root: tmp() }, api2 = createFormApi({ ...another, skipVerify: true });
    try { await api2.apply(api2.prepareApply({ mode: 'basic', answers: { ...BASE, ...PERSONAL, 'user.length': 'extensive' } }), () => {}); }
    finally { api2.close(); }
    assert.equal(Object.hasOwn(readAnswers(another.root).answers, 'user.length'), false);
    assert.equal(readAnswers(another.root, { env: another.env }).answers['user.length'], 'extensive');
  } finally { api.close(); }
});

test('notice respects terminal colour and missing defaults never add another menu item', async () => {
  const f = fixture(), p = prompts({ mode: 'quick' }); p.style = createStyle(true);
  const result = await cli(f, ['init', '--skip-verify'], p);
  assert.match(result.out, /\x1b\[33mNo personal defaults set/);
  assert.doesNotMatch(p.shown.join(''), /u\)/);
});

test('cancelled setups write no personal settings; invalid profiles survive', async () => {
  const f = fixture(), p = prompts({ apply: false });
  const code = await main(['init', '--skip-verify'], { ...f, cwd: f.root, stdout: capture(), stderr: capture(), prompter: p });
  assert.equal(code, 1); assert.equal(existsSync(profile(f)), false);
  saveSetup({ ...f, answers: { 'user.agents': ['claude'] }, mode: 'quick', projectRoot: f.root, kit: '', preset: false, profile: true });
  seedPersonalPreferences({ ...f, mode: 'basic', answers: PERSONAL, reviewed: PERSONAL_PREFERENCES });
  assert.equal(loadPreferences(f).answers['user.length'], 'brief', 'legacy agent-only profiles can acquire personal defaults');
  writeFileSync(profile(f), 'answers: { user.expertise: invalid }\n');
  const before = readFileSync(profile(f), 'utf8');
  assert.equal(seedPersonalPreferences({ ...f, mode: 'basic', answers: PERSONAL, reviewed: PERSONAL_PREFERENCES }).saved, false);
  assert.equal(readFileSync(profile(f), 'utf8'), before);
  // T-027: an apply does not repair an invalid profile either; it warns and keeps the personal answers out of the repository.
  const api = createFormApi({ ...f, root: tmp(), skipVerify: true });
  const log = [];
  try { await api.apply(api.prepareApply({ mode: 'basic', answers: { ...BASE, ...PERSONAL } }), (e) => log.push(e)); } finally { api.close(); }
  assert.match(log.map((e) => e.text ?? '').join(''), /Personal settings were not saved/);
  assert.equal(readFileSync(profile(f), 'utf8'), before);
});
