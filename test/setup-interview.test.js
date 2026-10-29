// Quick setup establishes project facts while reusing optional personal settings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { main } from '../core/cli/main.js';
import { isPreference } from '../core/interview/policy.js';
import { runInterview } from '../core/interview/engine.js';
import { collectQuestions, hasModule } from '../core/render/kit.js';
import { readAnswers } from '../core/render/project.js';
import { saveSetup } from '../core/lib/user-store.js';
import { createFormModel } from '../core/web/form-model.js';
import { createFormApi, DRAFT } from '../core/web/init.js';
import { effectiveAnswers, visibleQuestions } from '../core/web/assets/ui-state.js';
import { KIT_ROOT, capture, scripted, tmp } from './helpers/fixtures.js';
import { kickoffPrompt } from '../core/lib/kickoff.js';
import { foundationContext } from '../core/lib/foundations.js';

const BASE = { 'idea.text': 'Rename photos safely for a local photographer.', 'arch.language': 'python', 'arch.runs-on': 'local' };
const PERSONAL = { 'user.agents': ['codex'], 'user.expertise': 'expert', 'user.language': 'en', 'user.autonomy': 'act-and-report', 'user.length': 'brief', 'user.register': 'technical' };
const fixture = () => ({ root: tmp('yaw-quick-'), kitRoot: KIT_ROOT, env: { HOME: tmp('yaw-quick-home-'), PATH: [dirname(process.execPath), '/usr/bin', '/bin'].join(':') } });
function save(f, answers = PERSONAL) {
  saveSetup({ ...f, answers, mode: 'quick', projectRoot: f.root, kit: '0.1.0', preset: false, profile: true });
  return join(f.env.HOME, '.yaw/user-profile.yaml');
}

test('project architecture constraints reach terminal, browser, kickoff and agent context independently of personal settings', async () => {
  const f = fixture();
  save(f);
  const chosen = { ...BASE, 'arch.runs-on': 'self-hosted', 'arch.hosting-control': 'on-premises', 'arch.libraries': 'open-source', 'arch.services': 'none', 'arch.cost': 'capped', 'arch.cost-limit': 'EUR 20 per month; no overage' };
  const result = await cli(f, prompts(chosen, 'pro'));
  assert.equal(result.code, 0, result.err);
  const answers = readAnswers(f.root).answers;
  for (const [key, value] of Object.entries(chosen)) assert.equal(answers[key], value);
  const browser = createFormModel({ ...f, root: tmp() }).normalize({ mode: 'pro', answers: chosen });
  assert.deepEqual(browser.doc.answers, answers);
  const prompt = kickoffPrompt({ answers });
  assert.match(prompt, /Hosting control: on-premises/);
  assert.match(prompt, /Library policy: open-source/);
  assert.match(prompt, /External application services: none/);
  assert.match(prompt, /Cost policy: capped/);
  assert.match(prompt, /Budget cap: EUR 20 per month; no overage/);
  assert.equal(foundationContext({ root: f.root }).constraints['arch.services'], 'none');
  assert.equal(foundationContext({ root: f.root }).constraints['arch.cost-limit'], chosen['arch.cost-limit']);
});

test('unknown project constraints remain explicit and mockups include layout before visual polish', () => {
  const model = createFormModel(fixture());
  const normalized = model.normalize({ mode: 'quick', answers: BASE });
  for (const id of ['arch.libraries', 'arch.services']) assert.equal(normalized.doc.answers[id], 'undecided');
  for (const id of ['arch.hosting-control', 'arch.cost']) assert.equal(Object.hasOwn(normalized.doc.answers, id), false);
  assert.equal(Object.hasOwn(normalized.doc.answers, 'arch.cost-limit'), false);
  const prompt = kickoffPrompt({ answers: BASE });
  assert.doesNotMatch(prompt, /Cost policy:/);
  assert.match(prompt, /wireframe, screen mockup or clickable prototype/);
  assert.match(prompt, /Mockups cover layout as well as colours/);
  assert.match(prompt, /Review structure and the main flow before polishing colour/);
  assert.match(prompt, /never infer a subscription, credit-card, purchase or provisioning approval/);
});

test('no preference invites recommendations and explicit Pro answers survive a switch to Quick', () => {
  const model = createFormModel(fixture());
  const ids = ['arch.hosting-control', 'arch.libraries', 'arch.services', 'arch.cost'];
  const answers = { ...BASE, 'arch.runs-on': 'self-hosted', 'arch.framework': 'Keep Django', ...Object.fromEntries(ids.map((id) => [id, 'no-preference'])) };
  for (const mode of ['pro', 'basic', 'quick']) {
    const normalized = model.normalize({ mode, answers });
    for (const id of ids) assert.equal(normalized.doc.answers[id], 'no-preference');
    assert.equal(normalized.doc.answers['arch.framework'], 'Keep Django');
    const prompt = kickoffPrompt({ answers: normalized.doc.answers });
    assert.match(prompt, /Hosting control: no preference \(recommend a suitable option with rationale\)/);
    assert.match(prompt, /Neither authorizes a purchase or provisioning/);
    const visible = visibleQuestions(model.bootstrap().questions, answers, mode, normalized.modules).map((q) => q.id);
    assert.equal(visible.includes('arch.hosting-control'), mode === 'pro');
    assert.ok(!visible.includes('arch.cost-limit'));
  }
});
function prompts(answers = BASE, mode = 'quick') {
  const p = scripted(), questions = collectQuestions(KIT_ROOT, readdirSync(join(KIT_ROOT, 'modules')).filter((name) => hasModule(KIT_ROOT, name)));
  p.ask = async (prompt) => {
    p.asked.push(prompt);
    assert.ok(p.asked.length < 80, 'interview must make progress');
    if (/Setup depth/.test(prompt)) return mode;
    if (/^Modules \(comma-separated/.test(prompt)) return 'none';
    if (/Write these files/.test(prompt)) return 'y';
    if (/Save |guidance to kick off/.test(prompt)) return 'n';
    const screen = [...p.shown].reverse().find((text) => /^  \d+\/\d+ /.test(text));
    const q = questions.find((q) => screen?.split('\n')[0].endsWith(q.label));
    assert.ok(q, `unexpected prompt: ${prompt}`);
    const value = answers[q.id];
    return value === undefined ? '' : Array.isArray(value) ? value.join(',') : String(value);
  };
  return p;
}
async function cli(f, prompter, args = ['init', '--skip-verify']) {
  const stdout = capture(), stderr = capture();
  const code = await main(args, { ...f, cwd: f.root, stdout, stderr, prompter });
  return { code, out: stdout.text(), err: stderr.text() };
}

test('Quick CLI and browser reuse the same saved personal values without asking or saving them', async () => {
  const f = fixture(), file = save(f), before = readFileSync(file, 'utf8');
  const p = prompts(), r = await cli(f, p);
  assert.equal(r.code, 0, r.err);
  const doc = readAnswers(f.root);
  for (const [id, value] of Object.entries(PERSONAL).filter(([id]) => !['user.length', 'user.register'].includes(id))) assert.deepEqual(doc.answers[id], value);
  const shown = p.shown.join('');
  for (const label of ['Your experience with software', 'Language for chat', 'How often should the agent ask', 'How long should answers be']) assert.ok(!shown.includes(label));
  assert.match(shown, /What language do you want to use/);
  assert.match(shown, /Where will it run/);
  assert.match(r.out, /user\.language +en +\(saved personal setting\)/);
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.ok(!existsSync(join(f.env.HOME, '.yaw/history.jsonl')));
  const web = createFormModel({ ...f, root: tmp('yaw-quick-web-') });
  const input = { mode: 'quick', answers: BASE };
  const preview = web.preview(input), boot = web.bootstrap();
  assert.deepEqual(web.normalize(input).doc, doc);
  assert.deepEqual(effectiveAnswers(boot.questions.filter((q) => preview.modules.includes(q.owner) || isPreference(q)), BASE, 'quick'), doc.answers);
  assert.equal(preview.sources['user.language'], 'saved personal setting');
  assert.ok(!visibleQuestions(boot.questions, BASE, 'quick', preview.modules).some((q) => q.id === 'user.language'));
});

test('partial profiles use documented defaults; explicit project overrides win', () => {
  const f = fixture(); save(f, { 'user.language': 'en' });
  const model = createFormModel(f);
  const preview = model.preview({ mode: 'quick', answers: { ...BASE, 'user.language': 'de' } });
  assert.equal(preview.answers['user.language'], 'de');
  assert.equal(preview.sources['user.language'], 'answered');
  assert.equal(preview.answers['user.expertise'], 'intermediate');
  assert.equal(preview.sources['user.expertise'], 'documented default');
});

test('saved layperson expertise keeps Full F-question behavior in sync with the CLI', async () => {
  const f = fixture(); save(f, { 'user.expertise': 'layperson' });
  const model = createFormModel(f);
  const given = { ...BASE, 'idea.team': 'team', 'tasks.use-github': true, 'team.session-context': false };
  const result = model.normalize({ mode: 'full', answers: given });
  const questions = result.answerQuestions;
  let current;
  const cli = await runInterview({ questions, mode: 'full', kitRoot: KIT_ROOT, prompter: {
    show(text) { current = questions.find((q) => text.split('\n')[0].endsWith(q.label)) ?? current; },
    ask: async () => Object.hasOwn(given, current.id) ? String(given[current.id]) : '',
  } });
  assert.equal(result.doc.answers['team.session-context'], false);
  assert.deepEqual(result.doc.answers, cli.answers);
});

test('editing keeps project preferences when global defaults change', async () => {
  const f = fixture(); save(f, { 'user.language': 'en' });
  assert.equal((await cli(f, prompts())).code, 0);
  const before = readFileSync(join(f.root, '.yaw/answers.yaml'), 'utf8');
  save(f, { 'user.language': 'de' });
  const model = createFormModel({ ...f, edit: true, sections: ['user'] });
  const preview = model.preview(model.initial);
  assert.equal(preview.answers['user.language'], 'en');
  assert.equal(preview.sources['user.language'], 'saved project setting');
  assert.equal(readFileSync(join(f.root, '.yaw/answers.yaml'), 'utf8'), before);
});

test('invalid saved preferences are ignored safely in both lanes and never overwritten', async () => {
  const f = fixture(), file = save(f);
  writeFileSync(file, 'answers: { user.expertise: invalid }\n');
  const before = readFileSync(file, 'utf8');
  const web = createFormModel(f);
  assert.match(web.bootstrap().personalWarning, /unreadable or invalid/);
  assert.equal(web.preview({ mode: 'quick', answers: BASE }).answers['user.expertise'], 'intermediate');
  const r = await cli(f, prompts());
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /unreadable or invalid/);
  assert.equal(readFileSync(file, 'utf8'), before);
});

test('empty, skipped and uncertain essential answers need a real selection in the CLI', async () => {
  const questions = collectQuestions(KIT_ROOT, []).filter((q) => q.required);
  const p = scripted(['', 'skip', "don't know", BASE['idea.text'], '', 'skip', "don't know", 'python', '', 'local']);
  const result = await runInterview({ questions, mode: 'quick', kitRoot: KIT_ROOT, prompter: p });
  assert.deepEqual(result.answers, BASE);
  assert.match(p.shown.join(''), /Choose a project answer/);
  assert.deepEqual(result.defaulted, []);
});

test('browser incomplete setup is a draft; Apply cannot invent purpose or stack', async () => {
  const f = fixture(), model = createFormModel(f);
  const preview = model.preview({ mode: 'quick', answers: {} });
  assert.deepEqual(preview.unresolved, ['idea.text', 'arch.language', 'arch.runs-on']);
  assert.equal(preview.profile, null);
  assert.deepEqual(preview.files, []);
  assert.throws(() => model.normalize({ mode: 'quick', answers: {} }), /Essential project answers/);
  const api = createFormApi({ ...f, skipVerify: true, verify: async () => true, stderr: capture() });
  await api.action('draft', { mode: 'quick', answers: { 'idea.text': BASE['idea.text'] } });
  assert.ok(existsSync(join(f.root, DRAFT)));
  assert.ok(!existsSync(join(f.root, '.yaw/manifest.json')));
  assert.throws(() => api.prepareApply({ mode: 'quick', answers: {} }), /Essential project answers/);
  const resume = model.prefill('draft');
  assert.equal(resume.answers['arch.language'], '');
  assert.deepEqual(resume.proposed, ['idea.text', 'arch.language', 'arch.runs-on']);
  await api.close();
});

test('loaded presets and planning recommendations require confirmation before Apply', () => {
  const f = fixture();
  const saved = saveSetup({ ...f, answers: BASE, mode: 'quick', projectRoot: f.root, kit: '0.1.0', preset: true, profile: false });
  const model = createFormModel(f), input = model.prefill('preset', saved.preset);
  assert.deepEqual(input.proposed, ['idea.text', 'arch.language', 'arch.runs-on']);
  assert.throws(() => model.normalize(input), /need confirmation/);
  const preview = model.preview(input);
  assert.equal(preview.sources['arch.language'], 'proposed — needs confirmation');
  assert.equal(model.normalize({ ...input, proposed: [] }).profile, 'python-cli');
  assert.throws(() => model.normalize({ ...input, proposed: ['user.language'] }), /Invalid proposed/);
});

test('noninteractive --yes cannot fill missing facts or accept an unconfirmed proposal', async () => {
  for (const contents of [
    'mode: quick\nanswers: { user.agents: [codex], arch.language: python, arch.runs-on: local }\n',
    'mode: quick\nanswers: { user.agents: [codex] }\nproposal: { status: proposed, summary: A tool, profiles: [python-cli], modules: [core] }\n',
  ]) {
    const f = fixture(), file = join(tmp('yaw-quick-answers-'), 'answers.yaml'); writeFileSync(file, contents);
    const r = await cli(f, { interactive: false }, ['init', '--answers', file, '--yes', '--skip-verify']);
    assert.equal(r.code, 1);
    assert.match(r.err, /Essential project answers|still proposed/);
    assert.deepEqual(readdirSync(f.root), []);
  }
});

test('init no longer offers a separate personal onboarding menu', async () => {
  const f = fixture(), p = prompts();
  const r = await cli(f, p);
  assert.equal(r.code, 0, r.err);
  assert.doesNotMatch(p.shown.join(''), /u\) Review|Review and save personal settings/);
  assert.match(r.out, /No personal defaults set/);
  assert.equal(existsSync(join(f.env.HOME, '.yaw/user-profile.yaml')), false);
});

test('runtime context hides irrelevant hosting/cost answers and preserves valid Kotlin dependency choices', () => {
  const model = createFormModel(fixture());
  for (const language of ['kotlin', 'swift', 'javascript']) {
    const input = { ...BASE, 'arch.language': language, 'arch.runs-on': 'app-store', 'arch.hosting-control': 'managed',
      'arch.libraries': 'open-source', 'arch.services': 'none', 'arch.cost': 'capped', 'arch.cost-limit': 'USD 50/month' };
    const normalized = model.normalize({ mode: 'pro', answers: input });
    for (const id of ['arch.hosting-control', 'arch.cost', 'arch.cost-limit']) assert.equal(Object.hasOwn(normalized.doc.answers, id), false, `${language}: ${id}`);
    assert.equal(normalized.doc.answers['arch.libraries'], 'open-source');
    const visible = visibleQuestions(model.bootstrap().questions, input, 'pro', normalized.modules).map((q) => q.id);
    assert.ok(visible.includes('arch.libraries'));
    assert.ok(!visible.includes('arch.hosting-control') && !visible.includes('arch.cost'));
    const prompt = kickoffPrompt({ answers: input });
    assert.doesNotMatch(prompt, /Hosting control: managed|Cost policy: capped|Budget cap: USD 50/);
    const paid = model.normalize({ mode: 'pro', answers: { ...input, 'arch.libraries': 'commercial-allowed' } });
    assert.equal(paid.doc.answers['arch.cost'], 'capped'); assert.equal(paid.doc.answers['arch.cost-limit'], input['arch.cost-limit']);
    assert.equal(Object.hasOwn(paid.doc.answers, 'arch.hosting-control'), false);
  }
});
