import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readTurns } from '../core/lib/session-analysis.js';
import {
  TAXONOMY, admissionRule, answerTail, assistantState, buildExchanges, classifyExchanges, isShouting, labelExchange,
  questionsFor, reactionRules, repeatsRequest, rollup, scaleValue, userState,
} from '../core/lib/session-classification.js';
import { KIT_ROOT } from './helpers/fixtures.js';

const laya = (name) => JSON.parse(readFileSync(join(KIT_ROOT, 'test/fixtures/laya', `${name}.json`), 'utf8'));
const settings = { maxTurnBytes: 5000 };

test('the Claude reader keeps tool calls, tool errors, denials and interrupts with the reply (recorded line shapes)', async () => {
  const { messages } = await readTurns(join(KIT_ROOT, 'test/fixtures/claude/transcript-events.jsonl'), 'claude');
  assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);
  assert.deepEqual(messages[1].events, { tools: ['Edit', 'Bash'], toolErrors: 1, toolDenied: 1, interrupted: true });
  const [first, second] = buildExchanges(messages, { agent: 'claude' });
  assert.deepEqual([first.i, second.i, second.reaction], [1, 2, null]);
  assert.equal(first.reaction, 'I SAID ONLY rename x!!! Revert the refactor, again.');
  assert.equal(first.responseMs, 4000);
  assert.match(first.fp, /^[0-9a-f]{64}$/);
  assert.equal(admissionRule(first), 'admits_error');
  assert.equal(admissionRule(second), null);
  const labelled = labelExchange(first);
  assert.deepEqual(labelled.signals, { interrupted: true, toolDenied: true, toolErrors: 1, responseMs: 4000 });
  assert.deepEqual(labelled.user.tags.find((t) => t.key === 'stops_or_reverts'), { key: 'stops_or_reverts', source: 'signal' });
  assert.deepEqual(labelled.assistant.admission, { label: 'admits_error', source: 'rule' });
  assert.deepEqual(labelExchange(second).user, { verdict: { label: 'none', source: 'signal' }, tags: [] });
});

test('admission without a following file change is an apology without fix; other agents get no admission rule', () => {
  const messages = [{ role: 'user', text: 'Fix it' }, { role: 'assistant', text: "You're right, I missed the header." }, { role: 'user', text: 'ok' }];
  assert.equal(admissionRule(buildExchanges(messages, { agent: 'claude' })[0]), 'apology_without_fix');
  assert.equal(admissionRule(buildExchanges(messages, { agent: 'codex' })[0]), null);
  for (const text of ['Mein Fehler, ich korrigiere das.', 'I made a mistake in the loop.', 'My bad.']) {
    assert.equal(admissionRule(buildExchanges([messages[0], { role: 'assistant', text }], { agent: 'claude' })[0]), 'apology_without_fix', text);
  }
  for (const text of ['Done. `my mistake` is a string in the test.', 'You are right to ask.', 'Renamed x.']) {
    assert.equal(admissionRule(buildExchanges([messages[0], { role: 'assistant', text }], { agent: 'claude' })[0]), null, text);
  }
});

test('reaction rules fire on explicit English and German wording only', () => {
  const rules = (reaction, prompt = 'Rename x to count') => reactionRules(reaction, prompt);
  for (const text of ['Revert the refactor.', 'Please undo that.', 'roll it back', 'Mach das rückgängig.', 'Setz das zurück!', 'That is not what I asked, please continue.', 'Das wollte ich nicht.', 'Wrong file, please revert.', 'Undo!']) {
    assert.equal(rules(text).verdict, 'corrected', text);
  }
  assert.equal(rules('Revert the refactor.').tags.stops_or_reverts, true);
  assert.equal(rules('That works.').verdict, 'accepted');
  assert.equal(rules('Danke.').verdict, 'unknown');
  for (const text of ['Implement undo for the editor.', 'Implement undo.', 'Undo for the editor is missing.', 'Add a rollback script.', 'Now add tests.', 'Reset the password form']) {
    const r = rules(text);
    assert.equal(r.verdict, null, text);
    assert.equal(r.tags.stops_or_reverts, false, text);
  }
  for (const text of ['I SAID ONLY rename x!!!', 'STOP CHANGING THE TESTS', 'why?!!', 'what the fuck', 'So ein Scheiß.']) assert.equal(rules(text).tags.profanity_or_shouting, true, text);
  for (const text of ['Use the API JSON output.', 'Check `assert(!!x)` and ```\nNO NO NO\n```', 'Hi!']) assert.equal(rules(text).tags.profanity_or_shouting, false, text);
  for (const text of ['I already said: only rename.', 'As I told you, keep the API.', 'Wie gesagt, nur umbenennen.', 'Ich hab doch gesagt, nur x.']) assert.equal(rules(text).tags.cites_ignored_instruction, true, text);
  assert.equal(rules('Said tests pass, nice.').tags.cites_ignored_instruction, false);
  assert.equal(repeatsRequest('Rename x to count in utils.js please', 'Rename x to count in utils.js'), true);
  assert.equal(repeatsRequest('Now rename y to total in report.js', 'Rename x to count in utils.js'), false);
  assert.equal(repeatsRequest('Rename x', 'Rename x'), false, 'too few words');
});

test('scales use the five level probabilities: score, adjacent mass, not applicable and low confidence', () => {
  assert.deepEqual(scaleValue({ probabilities: { 1: 0, 2: 0, 3: 0.1, 4: 0.6, 5: 0.3 } }, 0.65), { score: 4.2, mass: 0.9, level: 4, source: 'model' });
  assert.deepEqual(scaleValue({ probabilities: { 1: 0.05, 2: 0.05, 3: 0.05, 4: 0.05, 5: 0.1, not_applicable: 0.7 } }, 0.65), { unknown: 'notApplicable', source: 'model' });
  assert.deepEqual(scaleValue({ probabilities: { 1: 0.4, 2: 0.05, 3: 0.1, 4: 0.05, 5: 0.4 } }, 0.65), { unknown: 'lowConfidence', mass: 0.45, source: 'model' });
});

test('request states are JSON objects, the reaction comes first and the answer is a named byte-bounded tail', () => {
  const [ex] = buildExchanges([{ role: 'user', text: 'Explain' }, { role: 'assistant', text: `${'é'.repeat(1000)}end` }, { role: 'user', text: 'Thanks' }]);
  const state = userState(ex, settings);
  assert.deepEqual(Object.keys(state), ['reaction', 'prompt', 'answerTail']);
  assert.ok(Buffer.byteLength(state.answerTail) <= 1500 && state.answerTail.endsWith('end') && !state.answerTail.includes('�'));
  assert.equal(answerTail('short'), 'short');
  const prev = { prompt: 'First', answer: 'One' };
  assert.deepEqual(Object.keys(assistantState(ex, prev, settings)), ['previousPrompt', 'previousAnswer', 'prompt', 'answer']);
  assert.deepEqual(Object.keys(assistantState(ex, { prompt: 'x'.repeat(3000), answer: '' }, settings)), ['prompt', 'answer']);
  assert.equal(assistantState(ex, null, { maxTurnBytes: 1000 }), null, 'never truncated');
  assert.equal(userState({ ...ex, reaction: null }, settings), null);
  const questions = questionsFor('user', 'Guide.');
  assert.equal(questions.sarcasm.type, 'noul');
  assert.deepEqual(Object.keys(questions.frustration.criteria), ['1', '2', '3', '4', '5']);
  assert.match(questions.verdict.instructions, /^Guide\. /);
});

// The three section 12 cases where zero-shot Laya was wrong (test/fixtures/laya/README.md, finding 5).
async function classifyWith(messages, responses) {
  const calls = [];
  const fetchFn = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body);
    return Response.json(('reaction' in body.state ? responses.user : responses.assistant).response);
  };
  return { result: await classifyExchanges(messages, { agent: 'claude', fetchFn }), calls };
}

test('section 12 regression: a shouted revert is labelled by rules, not by the low model estimate', async () => {
  const { result, calls } = await classifyWith([
    { role: 'user', text: 'Rename x to count in utils.js.' }, { role: 'assistant', text: 'Done: I renamed x to count and also refactored the whole module.' },
    { role: 'user', text: 'I SAID ONLY rename x!!! Revert the refactor, again.' },
  ], { assistant: laya('assistant-call'), user: laya('user-call') });
  assert.equal(typeof calls[0].state, 'object');
  const { user } = result.exchanges[0];
  assert.deepEqual(user.verdict, { label: 'corrected', source: 'rule' });
  assert.deepEqual(user.frustration, { score: 4, level: 4, source: 'rule' });
  assert.deepEqual(user.tags.filter((t) => t.source === 'rule').map((t) => t.key).sort(), ['cites_ignored_instruction', 'profanity_or_shouting', 'stops_or_reverts']);
  assert.equal(user.complaint.source, 'model');
});

test('section 12 regression: "not what I asked, revert" after a long reply is corrected, not a new topic', async () => {
  const state = JSON.parse(laya('user-call-long').request.state);
  const { result } = await classifyWith([
    { role: 'user', text: state.prompt }, { role: 'assistant', text: state.answerTail }, { role: 'user', text: state.reaction },
  ], { assistant: laya('assistant-call'), user: laya('user-call-long') });
  const { user } = result.exchanges[0];
  assert.deepEqual(user.verdict, { label: 'corrected', source: 'rule' });
  assert.deepEqual(user.tags.find((t) => t.key === 'stops_or_reverts'), { key: 'stops_or_reverts', source: 'rule' });
  assert.equal(user.frustration.level >= 3, true);
});

test('section 12 regression: adherence has no rule and stays a model estimate', async () => {
  const { result, calls } = await classifyWith([
    { role: 'user', text: 'Now rename exportCsv to toCsv everywhere.' }, { role: 'assistant', text: 'Renamed exportCsv to toCsv in report.js and its two callers; tests pass.' },
  ], { assistant: laya('assistant-call'), user: laya('user-call') });
  assert.equal(calls.length, 1, 'no reaction, no user call');
  const { assistant, user } = result.exchanges[0];
  assert.equal(assistant.adherence.source, 'model');
  assert.deepEqual(assistant.admission, { label: 'unknown', p: 0.51, source: 'model' });
  assert.deepEqual(user.verdict, { label: 'none', source: 'signal' });
});

test('invalid or truncated Laya answers fail the run without partial results', async () => {
  const messages = [{ role: 'user', text: 'a' }, { role: 'assistant', text: 'b' }, { role: 'user', text: 'c' }];
  const broken = structuredClone(laya('user-call').response);
  delete broken.answers.sarcasm;
  const truncated = structuredClone(laya('assistant-call').response);
  truncated.usage.truncated = true;
  await assert.rejects(classifyWith(messages, { assistant: laya('assistant-call'), user: { response: broken } }), /invalid label probabilities/);
  await assert.rejects(classifyWith(messages, { assistant: { response: truncated }, user: laya('user-call') }), /untruncated/);
  assert.deepEqual(Object.keys(TAXONOMY), ['assistant', 'user']);
});

test('rollup: final verdict, success, escalation and apology loop (section 7)', () => {
  const ex = (i, verdict, frustration, admission) => ({ i, assistant: admission ? { admission: { label: admission, source: 'rule' } } : {},
    user: { verdict: { label: verdict, source: 'rule' }, ...(frustration ? { frustration: { score: frustration, level: Math.round(frustration), source: 'model' } } : {}), tags: [{ key: 'repeats_request', source: 'rule' }] } });
  const r = rollup([ex(1, 'corrected', 2, 'admits_error'), ex(2, 'corrected', 3.2, 'apology_without_fix'), ex(3, 'new_topic', 4.4, 'none'), ex(4, 'accepted', null), ex(5, 'none', null)]);
  assert.equal(r.finalVerdict, 'accepted');
  assert.equal(r.success, 3);
  assert.equal(r.acceptance, 0.33);
  assert.equal(r.frustrationPeak, 4.4);
  assert.equal(r.escalation, true);
  assert.equal(r.apologyLoop, true);
  assert.equal(r.counts.user.verdict.corrected, 2);
  assert.equal(r.counts.user.tags.repeats_request, 5);
  assert.equal(r.unknown.verdict.noReaction, 1);
  assert.equal(rollup([]).finalVerdict, null);
});

test('classifyExchanges stores schema 2 with a roll-up and no message text', async () => {
  const { result } = await classifyWith([
    { role: 'user', text: 'Rename x to count in utils.js.' }, { role: 'assistant', text: 'Done: I renamed x to count.' },
    { role: 'user', text: 'Thanks, perfect.' },
  ], { assistant: laya('assistant-call'), user: laya('user-call') });
  assert.equal(result.schema, 2);
  assert.match(result.taxonomy, /^[a-f0-9]{64}$/);
  assert.equal(result.calibration, null);
  assert.ok(result.session && result.exchanges.length);
});
