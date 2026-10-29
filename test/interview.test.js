// CLI interview engine (Y-3.3), facts and rule-based profile suggestion (Y-3.6).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asksIn, batchesOf, parseReply, runInterview, whenMatches } from '../core/interview/engine.js';
import { deriveFacts, matchFacts } from '../core/interview/facts.js';
import { profileFor as browserProfileFor } from '../core/web/assets/setup-cards.js';
import { stackProfile } from '../core/interview/suggest.js';
import { collectQuestions, listProfiles, loadBaseQuestions } from '../core/render/kit.js';
import { KIT_ROOT, scripted } from './helpers/fixtures.js';

const q = (over) => ({ id: 'idea.team', mode: 'Q', type: 'choice', label: 'Solo or team?', choices: ['solo', 'team'], default: 'solo', ...over });

test('interview/base.yaml validates, ids are unique, and Quick asks only Q questions', () => {
  const all = collectQuestions(KIT_ROOT, ['core']);
  assert.ok(all.length >= 5);
  assert.deepEqual(loadBaseQuestions(KIT_ROOT), all);
  assert.ok(all.filter((x) => asksIn(x, 'quick')).every((x) => x.mode === 'Q'));
  assert.ok(all.some((x) => x.mode === 'F'));
  assert.ok(all.some((x) => x.id === 'user.agents') && all.some((x) => x.id === 'arch.language'));
});

test('parseReply: Enter takes the default, ? and skip are commands, errors explain', () => {
  assert.deepEqual(parseReply(q(), ''), { value: 'solo' });
  assert.deepEqual(parseReply(q(), '?'), { help: true });
  assert.deepEqual(parseReply(q(), ' SKIP '), { skip: true });
  assert.deepEqual(parseReply(q(), 'team'), { value: 'team' });
  assert.deepEqual(parseReply(q(), '2'), { value: 'team' });
  assert.match(parseReply(q(), 'both').error, /"both" is not one of: solo, team/);
  assert.match(parseReply(q({ type: 'number' }), 'x').error, /number/);
  assert.deepEqual(parseReply(q({ type: 'number' }), '3'), { value: 3 });
  assert.deepEqual(parseReply(q({ type: 'boolean' }), 'Y'), { value: true });
  assert.deepEqual(parseReply(q({ type: 'text', default: 'de' }), 'en'), { value: 'en' });
});

test('parseReply: multi-select takes names or numbers; later-phase choices cannot be picked', () => {
  const multi = q({
    type: 'multi',
    choices: [{ value: 'claude' }, { value: 'codex' }, { value: 'gemini', label: 'Gemini', phase: 3 }],
    default: ['claude'],
  });
  assert.deepEqual(parseReply(multi, 'claude, 2'), { value: ['claude', 'codex'] });
  assert.deepEqual(parseReply(multi, 'codex,codex'), { value: ['codex'] });
  assert.match(parseReply(multi, 'gemini').error, /"Gemini" is not available yet/);
  assert.match(parseReply(multi, '3').error, /not available yet/);
  assert.deepEqual(parseReply(multi, ''), { value: ['claude'] });
});

test('batches: one section per batch, at most 6 questions', () => {
  const mk = (id) => q({ id });
  const batches = batchesOf([...'abcdefgh'].map((c) => mk(`user.${c}`)).concat([mk('idea.a'), mk('user.z')]));
  assert.deepEqual(batches.map((b) => [b.section, b.questions.length]), [['user', 6], ['user', 2], ['idea', 1], ['user', 1]]);
});

test('modes: Q everywhere, S in standard and full, F in full only; when() reads earlier answers', () => {
  assert.deepEqual(['quick', 'standard', 'full'].map((m) => asksIn('Q', m)), [true, true, true]);
  assert.deepEqual(['quick', 'standard', 'full'].map((m) => asksIn('S', m)), [false, true, true]);
  assert.deepEqual(['quick', 'standard', 'full'].map((m) => asksIn('F', m)), [false, false, true]);
  assert.equal(whenMatches({ 'idea.team': 'team' }, { 'idea.team': 'team' }), true);
  assert.equal(whenMatches({ 'idea.team': ['team', 'external-reviewers'] }, { 'idea.team': 'solo' }), false);
  assert.equal(whenMatches(undefined, {}), true);
});

test('runInterview: Enter, skip, ?, wrong replies; skipped and unasked questions are listed as default', async () => {
  const questions = [
    q({ id: 'user.agents', type: 'multi', choices: ['claude', 'codex'], default: ['claude'], help: 'agents' }),
    q({ id: 'idea.team' }),
    q({ id: 'idea.size', type: 'number', default: 1 }),
    q({ id: 'team.approvals', type: 'number', default: 1, when: { 'idea.team': 'team' } }),
    q({ id: 'quality.deep', mode: 'F', default: 'x', type: 'text', when: { 'idea.team': 'solo' } }),
  ];
  const prompter = scripted(['?', 'codex', 'wat', 'team', 'skip', '']);
  const r = await runInterview({ questions, mode: 'pro', prompter, kitRoot: KIT_ROOT });
  assert.deepEqual(r.answers, { 'user.agents': ['codex'], 'idea.team': 'team', 'idea.size': 1, 'team.approvals': 1 });
  // "skip" and the question this mode does not ask are defaults; Enter on team.approvals is an answer
  assert.deepEqual(r.defaulted, ['idea.size']);
  const shown = prompter.shown.join('');
  assert.match(shown, /AGENTS.md: shared project rules/, '? shows interview/help/agents.md');
  assert.match(shown, /"wat" is not one of: solo, team/);
  assert.match(shown, /About you \(1\/4\)/);
});

test('runInterview: a question whose when() does not hold is not asked and not answered', async () => {
  const questions = [q({ id: 'idea.team' }), q({ id: 'team.approvals', type: 'number', default: 1, when: { 'idea.team': 'team' } })];
  const r = await runInterview({ questions, mode: 'pro', prompter: scripted(['']), kitRoot: KIT_ROOT });
  assert.deepEqual(r.answers, { 'idea.team': 'solo' });
  assert.deepEqual(r.defaulted, []);
});

test('runInterview: input that ends is an error, not a silent exit', async () => {
  const prompter = { ...scripted(), async ask() { throw new Error('input ended before all questions were answered'); } };
  await assert.rejects(runInterview({ questions: [q()], mode: 'pro', prompter, kitRoot: KIT_ROOT }), /input ended/);
});

test('runInterview: saved answers are reviewable defaults without mutating the question definitions', async () => {
  const questions = [
    q({ id: 'idea.team' }),
    q({ id: 'idea.text', type: 'text', default: 'Original default' }),
    q({ id: 'team.approvals', type: 'number', default: 1, when: { 'idea.team': 'team' } }),
  ];
  const defaults = { 'idea.team': 'team', 'idea.text': 'Saved idea', 'team.approvals': 2 };
  const r = await runInterview({ questions, mode: 'pro', defaults, prompter: scripted(['', 'New idea', '']) });
  assert.deepEqual(r.answers, { 'idea.team': 'team', 'idea.text': 'New idea', 'team.approvals': 2 });
  assert.equal(questions[0].default, 'solo');
  assert.equal(defaults['idea.text'], 'Saved idea');
  await assert.rejects(runInterview({ questions, mode: 'pro', defaults: { 'idea.team': 'invalid' }, prompter: scripted() }), /Invalid saved answer for idea.team/);
});

test('facts come only from answers that exist; auto leaves a fact unknown', () => {
  assert.deepEqual(deriveFacts({ 'arch.language': 'javascript', 'arch.runs-on': 'local' }), { language: 'javascript', runsOn: 'local', hosted: false });
  assert.deepEqual(deriveFacts({ 'arch.language': 'auto', 'arch.runs-on': 'auto' }), {});
  assert.deepEqual(deriveFacts({ 'arch.runs-on': 'edge', 'idea.audience': 'public', 'idea.team': 'team' }), { runsOn: 'edge', hosted: true, public: true, team: true, usesGitHub: true });
  assert.deepEqual(matchFacts({ language: ['python'], runsOn: ['local'], hasUI: [false] }, { language: 'python', runsOn: 'edge' }), { matched: 1, mismatched: 1 });
});

test('stack: language x runs-on picks exactly one profile, tailored or basic; uncovered pairs describe kit coverage', () => {
  const profiles = listProfiles(KIT_ROOT);
  const pick = (language, runsOn) => stackProfile(profiles, { 'arch.language': language, 'arch.runs-on': runsOn }).profile;
  assert.equal(pick('javascript', 'local'), 'node-cli');
  assert.equal(pick('javascript', 'static'), 'node-basic');
  assert.equal(pick('python', 'local'), 'python-cli');
  assert.equal(pick('python', 'app-store'), 'python-basic');
  assert.equal(pick('html', 'static'), 'static-site');
  assert.equal(pick('kotlin', 'app-store'), 'android-kotlin');
  assert.equal(pick('kotlin', 'self-hosted'), 'kotlin-basic');
  for (const language of ['swift', 'go', 'rust', 'java']) assert.equal(pick(language, 'local'), `${language}-basic`);
  for (const host of ['local', 'self-hosted', 'serverless', 'edge', 'static']) {
    assert.equal(pick('html', host), 'static-site', host);
    assert.ok(profiles.find((p) => p.name === 'static-site').stack.notes[host], host);
  }
  assert.equal(pick('html', 'wordpress'), null);
  assert.match(stackProfile(profiles, { 'arch.language': 'html', 'arch.runs-on': 'wordpress' }).reason, /no YAW profile for html on wordpress; choose/);
  assert.equal(stackProfile(profiles, {}).profile, null);
});


test('stack catalogue has unique pairs and browser selection agrees with CLI for every choice', () => {
  const profiles = listProfiles(KIT_ROOT);
  const questions = loadBaseQuestions(KIT_ROOT);
  const choices = (id) => questions.find((q) => q.id === id).choices.map((c) => c.value ?? c);
  for (const language of choices('arch.language')) for (const host of choices('arch.runs-on')) {
    const matches = profiles.filter((p) => p.stack.language.includes(language) && p.stack.runsOn.includes(host));
    assert.ok(matches.length <= 1, `${language} on ${host} has overlapping profiles`);
    const cli = stackProfile(profiles, { 'arch.language': language, 'arch.runs-on': host }).profile;
    assert.equal(browserProfileFor(profiles, language, host)?.name ?? null, cli, `${language} on ${host}`);
  }
});

test('CLI controls sit immediately above every input, including help and validation retries', async () => {
  const prompter = scripted(['?', 'invalid', 'w']);
  const ask = prompter.ask;
  prompter.ask = async (prompt, keys) => {
    assert.equal(prompter.shown.at(-1), '      (? help, skip, w switch to browser)\n');
    assert.equal(prompt, '      [solo] > ');
    return ask(prompt, keys);
  };
  const result = await runInterview({
    questions: [q({ hint: 'First detail\nSecond detail', status: 'First status\nSecond status', help: 'stack' })],
    mode: 'pro', known: { 'user.expertise': 'layperson' }, prompter, kitRoot: KIT_ROOT, allowWeb: true,
  });
  assert.equal(result.web, true);
  const shown = prompter.shown.join('');
  for (const line of ['First detail', 'Second detail', 'First status', 'Second status', '- Language and runtime']) {
    assert.ok(shown.includes(`      ${line}`), line);
  }
  assert.doesNotMatch(shown, /Continue in the browser|Tailored stack/);
  const terminal = scripted(['']);
  await runInterview({ questions: [q()], mode: 'pro', prompter: terminal });
  assert.equal(terminal.shown.at(-1), '      (? help, skip)\n');
});
