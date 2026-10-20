// CLI interview engine (Y-3.3), facts and rule-based profile suggestion (Y-3.6).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asksIn, batchesOf, parseReply, runInterview, whenMatches } from '../core/interview/engine.js';
import { deriveFacts, matchFacts } from '../core/interview/facts.js';
import { suggestProfiles } from '../core/interview/suggest.js';
import { collectQuestions, listProfiles, loadBaseQuestions } from '../core/render/kit.js';
import { KIT_ROOT, scripted } from './helpers/fixtures.js';

const q = (over) => ({ id: 'idea.team', mode: 'Q', type: 'choice', label: 'Solo or team?', choices: ['solo', 'team'], default: 'solo', ...over });

test('interview/base.yaml validates, ids are unique, and Quick asks only Q questions', () => {
  const all = collectQuestions(KIT_ROOT, ['core']);
  assert.ok(all.length >= 5);
  assert.deepEqual(loadBaseQuestions(KIT_ROOT), all);
  assert.ok(all.every((x) => x.mode === 'Q'));
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
    q({ id: 'quality.deep', mode: 'F', default: 'x', type: 'text' }),
  ];
  const prompter = scripted(['?', 'codex', 'wat', 'team', 'skip', '']);
  const r = await runInterview({ questions, mode: 'quick', prompter, kitRoot: KIT_ROOT });
  assert.deepEqual(r.answers, { 'user.agents': ['codex'], 'idea.team': 'team', 'idea.size': 1, 'team.approvals': 1, 'quality.deep': 'x' });
  // "skip" and the question this mode does not ask are defaults; Enter on team.approvals is an answer
  assert.deepEqual(r.defaulted, ['idea.size', 'quality.deep']);
  const shown = prompter.shown.join('');
  assert.match(shown, /Every selected agent gets the files it reads/, '? shows interview/help/agents.md');
  assert.match(shown, /"wat" is not one of: solo, team/);
  assert.match(shown, /About you \(1\/3\)/);
});

test('runInterview: a question whose when() does not hold is not asked and not answered', async () => {
  const questions = [q({ id: 'idea.team' }), q({ id: 'team.approvals', type: 'number', default: 1, when: { 'idea.team': 'team' } })];
  const r = await runInterview({ questions, mode: 'quick', prompter: scripted(['']), kitRoot: KIT_ROOT });
  assert.deepEqual(r.answers, { 'idea.team': 'solo' });
  assert.deepEqual(r.defaulted, []);
});

test('runInterview: input that ends is an error, not a silent exit', async () => {
  const prompter = { ...scripted(), async ask() { throw new Error('input ended before all questions were answered'); } };
  await assert.rejects(runInterview({ questions: [q()], mode: 'quick', prompter, kitRoot: KIT_ROOT }), /input ended/);
});

test('facts come only from answers that exist; auto leaves a fact unknown', () => {
  assert.deepEqual(deriveFacts({ 'arch.language': 'javascript', 'arch.runs-on': 'local' }), { language: 'javascript', runsOn: 'local', hosted: false });
  assert.deepEqual(deriveFacts({ 'arch.language': 'auto', 'arch.runs-on': 'auto' }), {});
  assert.deepEqual(deriveFacts({ 'arch.runs-on': 'edge', 'idea.audience': 'public', 'idea.team': 'team' }), { runsOn: 'edge', hosted: true, public: true, team: true });
  assert.deepEqual(matchFacts({ language: ['python'], runsOn: ['local'], hasUI: [false] }, { language: 'python', runsOn: 'edge' }), { matched: 1, mismatched: 1 });
});

test('suggestion: the unique best match; ties, contradictions and unknown facts give none', () => {
  const profiles = listProfiles(KIT_ROOT);
  assert.deepEqual(profiles.map((p) => p.name), ['node-cli', 'python-cli']);
  const pick = (answers) => suggestProfiles(profiles, deriveFacts(answers)).suggestion;
  assert.equal(pick({ 'arch.language': 'javascript', 'arch.runs-on': 'local' }), 'node-cli');
  assert.equal(pick({ 'arch.language': 'typescript', 'arch.runs-on': 'auto' }), 'node-cli');
  assert.equal(pick({ 'arch.language': 'python', 'arch.runs-on': 'local' }), 'python-cli');
  assert.equal(pick({ 'arch.language': 'auto', 'arch.runs-on': 'local' }), null, 'both match one fact: a tie');
  assert.equal(pick({ 'arch.language': 'python', 'arch.runs-on': 'edge' }), null, 'every profile is contradicted');
  assert.equal(pick({}), null);
});

test('suggestion is deterministic: input order does not matter, ties are listed by name', () => {
  const profiles = listProfiles(KIT_ROOT);
  const facts = { runsOn: 'local' };
  const a = suggestProfiles(profiles, facts);
  const b = suggestProfiles([...profiles].reverse(), facts);
  assert.deepEqual(a, b);
  assert.deepEqual(a.candidates.map((c) => c.name), ['node-cli', 'python-cli']);
  assert.equal(a.suggestion, null);
  assert.deepEqual(suggestProfiles(profiles, { language: 'python', runsOn: 'local' }), suggestProfiles([...profiles].reverse(), { language: 'python', runsOn: 'local' }));
});
