import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lstatSync, readFileSync, renameSync, writeFileSync, symlinkSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { classifierSettings, classifyMessages, collectAnalysis, LABELS, localEndpoint, probeClassifier, messageMetrics, messageOf, readAnalysis, readTurns, scanSummary, userOutcome } from '../core/lib/session-analysis.js';
import { createWorkspaceApi } from '../core/web/workspace-api.js';
import { dashboardData, sessionsData, startDashboard } from '../core/web/dashboard.js';
import { main } from '../core/cli/main.js';
import { notificationSettings, saveNotifications, deliverNotifications } from '../modules/comfort/lib/settings.js';
import { buildPayload } from '../modules/comfort/lib/notify.js';
import { readPersonal, resolveFeatures } from '../modules/comfort/lib/config.js';
import { readUserData, writeUserData } from '../core/lib/user-store.js';
import { realRoot } from '../modules/sessions/lib/registry.js';
import { saveSources } from '../core/lib/session-sources.js';
import { KIT_ROOT, capture, tmp, writeTree } from './helpers/fixtures.js';
import { makeProject } from './helpers/hooks.js';
import { longLineFile, peakDuring } from './helpers/long-line.js';

const environment = () => { const home = tmp('yaw-analysis-home-'); return { HOME: home, CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude') }; };
const messages = [
  { role: 'user', text: 'Fix the parser', time: '2026-10-24T08:00:00Z' },
  { role: 'assistant', text: 'Parser fixed.', time: '2026-10-24T08:00:02Z' },
  { role: 'user', text: 'Thanks, works', time: '2026-10-24T08:01:00Z' },
];
const responseFor = () => ({
  answers: Object.fromEntries(Object.entries(LABELS).map(([key, labels]) => [key, { choice: labels[0], probabilities: Object.fromEntries(labels.map((l, i) => [l, i ? 0 : 1])) }])),
  usage: { truncated: false }, routing: { model: 'multilingual' },
});
function fixture(env, root, id = 'test') {
  const file = `sessions/2026/10/24/rollout-${id}.jsonl`;
  writeTree(env.CODEX_HOME, { [file]: [
    { type: 'session_meta', timestamp: messages[0].time, payload: { id, cwd: root } },
    ...messages.map((m) => ({ type: 'response_item', timestamp: m.time, payload: { type: 'message', role: m.role, content: [{ type: m.role === 'user' ? 'input_text' : 'output_text', text: m.text }] } })),
  ].map(JSON.stringify).join('\n') });
  return join(env.CODEX_HOME, file);
}

test('saved scans are explicit, private, bounded to the chosen workspace, and contain no message text', async () => {
  const env = environment(), root = tmp(), other = tmp();
  fixture(env, root); fixture(env, other, 'other');
  assert.deepEqual((await dashboardData({ root, kitRoot: KIT_ROOT, env })).sessions, { available: false });
  assert.equal(readAnalysis(env).collected, null);
  await collectAnalysis({ root, env });
  let saved = readAnalysis(env);
  assert.equal(saved.rows.length, 1); assert.equal(saved.rows[0].metrics.answers, 1);
  assert.equal(saved.rows[0].metrics.medianResponseMs, 2000);
  assert.doesNotMatch(JSON.stringify(saved), /Fix the parser|Parser fixed|Thanks, works|rollout-/);
  assert.equal(lstatSync(join(env.HOME, '.yaw/session-analysis.json')).mode & 0o777, 0o600);
  await collectAnalysis({ root, env, all: true });
  saved = readAnalysis(env); assert.equal(saved.rows.length, 2);
  const d = await dashboardData({ root, kitRoot: KIT_ROOT, env });
  assert.equal(d.sessions.project.sessions, 1); assert.equal(d.sessions.all.sessions, 2);
  const all = await sessionsData({ root, kitRoot: KIT_ROOT, env });
  assert.equal(all.available, true); assert.equal(all.rows.length, 2); assert.equal(all.current, realRoot(root));
  assert.ok(all.rows.every((r) => r.answers === 1 && r.medianResp === 2));
  assert.doesNotMatch(JSON.stringify(all), /Fix the parser|Parser fixed|Thanks, works|rollout-/);
});

test('session browser exposes each configured project programming language', async () => {
  const root = await makeProject({ modules: ['core'] }), env = environment();
  const answers = join(root, '.yaw/answers.yaml');
  writeFileSync(answers, readFileSync(answers, 'utf8').replace('  idea.text:', '  arch.language: python\n  idea.text:'));
  writeTree(root, { 'src/main.js': '', 'package.json': '{}' });
  fixture(env, root);
  await collectAnalysis({ root, env });
  const data = await sessionsData({ root, kitRoot: KIT_ROOT, env });
  assert.equal(data.rows[0].language, 'python');
  writeFileSync(answers, readFileSync(answers, 'utf8').replace('arch.language: python', 'arch.language: auto'));
  assert.equal((await sessionsData({ root, kitRoot: KIT_ROOT, env })).rows[0].language, 'javascript');
});

test('session browser detects language for projects without a configured language', async () => {
  const root = tmp(), env = environment();
  writeTree(root, { 'src/main.go': '', 'go.mod': '' });
  fixture(env, root);
  await collectAnalysis({ root, env });
  const data = await sessionsData({ root, kitRoot: KIT_ROOT, env });
  assert.equal(data.rows[0].language, 'go');
});

test('rescans reuse unchanged transcripts and reread changed ones', async () => {
  const env = environment(), root = tmp(), file = fixture(env, root);
  utimesSync(file, 1800000000, 1800000000);
  let result = await collectAnalysis({ root, env });
  assert.deepEqual([result.sessions, result.reused, result.skipped], [1, 0, 0]);
  const text = readFileSync(file, 'utf8');
  writeFileSync(file, text.replace('Parser fixed.', 'Parser FIXED.')); utimesSync(file, 1800000000, 1800000000);
  result = await collectAnalysis({ root, env });
  assert.equal(result.reused, 1);
  assert.equal(readAnalysis(env).rows[0].metrics.answerChars, 'Parser fixed.'.length);
  writeFileSync(file, text.replace('Parser fixed.', 'Parser fixed now.'));
  result = await collectAnalysis({ root, env });
  assert.equal(result.reused, 0);
  assert.equal(readAnalysis(env).rows[0].metrics.answerChars, 'Parser fixed now.'.length);
  assert.match(scanSummary({ sessions: 3, reused: 2, skipped: 1, limited: 1 }), /2 unchanged.*1 partial.*1 unreadable/);
});

test('long transcripts are read in full; rows from the older capped reader are read again', async () => {
  const env = environment(), root = tmp(), id = 'long';
  const file = `sessions/2026/10/24/rollout-${id}.jsonl`;
  const lines = [{ type: 'session_meta', timestamp: messages[0].time, payload: { id, cwd: root } }];
  for (let n = 0; n < 1500; n++) for (const role of ['user', 'assistant']) {
    lines.push({ type: 'response_item', timestamp: messages[0].time, payload: { type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text: `${role} ${n}` }] } });
  }
  writeTree(env.CODEX_HOME, { [file]: lines.map(JSON.stringify).join('\n') });
  let result = await collectAnalysis({ root, env });
  let row = readAnalysis(env).rows[0];
  assert.equal(row.metrics.prompts, 1500); assert.equal(row.metrics.answers, 1500); assert.equal(row.metrics.limited, false); assert.equal(result.limited, 0);
  assert.equal((await collectAnalysis({ root, env })).reused, 1);
  const data = readAnalysis(env); delete data.rows[0].reader; data.rows[0].metrics.limited = true; writeUserData(env, 'session-analysis.json', data);
  result = await collectAnalysis({ root, env });
  assert.equal(result.reused, 0); row = readAnalysis(env).rows[0];
  assert.equal(row.metrics.limited, false); assert.equal(row.reader, 3);
});

test('message extraction ignores tools and non-text blocks; Unicode lengths and response timing are measured', () => {
  assert.equal(messageOf('codex', { type: 'event_msg', payload: { type: 'token_count' } }), null);
  assert.equal(messageOf('claude', { type: 'assistant', message: { content: [{ type: 'tool_use', input: 'private tool' }, { type: 'text', text: 'Hi' }] } }).text, 'Hi');
  assert.equal(messageOf('copilot', { type: 'assistant.message', data: { content: 'Hello' } }).text, 'Hello');
  const m = messageMetrics([...messages, { role: 'assistant', text: '😀', time: '2026-10-24T08:01:04Z' }]);
  assert.equal(m.answers, 2); assert.equal(m.answerChars, 14); assert.equal(m.p95ResponseMs, 4000);
});

test('transcript reader refuses symlinks and records malformed-line coverage', async () => {
  const dir = tmp(), file = join(dir, 'events.jsonl');
  writeFileSync(file, '{broken\n' + JSON.stringify({ type: 'user.message', timestamp: messages[0].time, data: { content: 'hello' } }));
  const data = await readTurns(file, 'copilot'); assert.equal(data.limited, true); assert.equal(data.messages.length, 1);
  symlinkSync(file, join(dir, 'link.jsonl'));
  await assert.rejects(readTurns(join(dir, 'link.jsonl'), 'copilot'), /ELOOP|symbolic/);
});

test('transcript reader skips an oversized line without buffering it (T-016)', () => {
  const line = (text) => ({ type: 'user', timestamp: messages[0].time, message: { role: 'user', content: text } });
  const file = longLineFile(tmp(), line('before'), line('PAD'), line('after'));
  const { grewMiB, result } = peakDuring(join(KIT_ROOT, 'core/lib/session-analysis.js'), "mod.readTurns(file, 'claude')", file);
  assert.deepEqual(result.messages.map((m) => m.text), ['before', 'after']); assert.equal(result.limited, true);
  assert.ok(grewMiB < 48, `peak RSS grew ${grewMiB.toFixed(1)} MiB while skipping a 64 MiB line`);
});

test('Laya classification uses verified local protocol and strict probabilities, rejects truncation and hosted URLs', async () => {
  let called = 0;
  const fetchFn = async (url, options) => {
    called++; assert.equal(url, 'http://127.0.0.1:8000/v1/systemone');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'multilingual'); assert.equal(body.max_len, 8192);
    assert.deepEqual(Object.keys(body.questions), Object.keys(LABELS));
    return Response.json(responseFor());
  };
  const result = await classifyMessages(messages, { fetchFn });
  assert.equal(called, 1); assert.equal(result.classified, 1); assert.equal(result.counts.outcome.fulfilled, 1);
  assert.doesNotMatch(JSON.stringify(result), /Fix the parser/);
  const preview = await classifyMessages(messages, { fetchFn: async (url, options) => {
    assert.match(JSON.parse(options.body).questions.outcome.instructions, /focus on explicit requirements/i);
    return Response.json(responseFor());
  }, prompt: 'Focus on explicit requirements.', includeTurns: true, maxTurns: 1 });
  assert.equal(preview.turns.length, 1); assert.equal(preview.turns[0].prompt, 'Fix the parser');
  assert.equal(preview.turns[0].answer, 'Parser fixed.');
  assert.deepEqual(preview.turns[0].predictions.outcome, { choice: 'fulfilled', confidence: 1, prediction: 'fulfilled' });
  assert.equal(preview.truncated, true);
  assert.throws(() => localEndpoint('https://remote.example'), /hosted endpoints/);
  assert.throws(() => localEndpoint('http://localhost:8000'), /hosted endpoints/);
  for (const bad of [
    { ...responseFor(), usage: { truncated: true } },
    { answers: {} },
    { ...responseFor(), answers: { ...responseFor().answers, outcome: { choice: 'fulfilled', probabilities: { fulfilled: 0.2 } } } },
  ]) await assert.rejects(classifyMessages(messages, { fetchFn: async () => Response.json(bad) }), /invalid|untruncated/);
  const large = await classifyMessages([{ ...messages[0], text: 'x'.repeat(6000) }, messages[1]], { fetchFn: () => { throw new Error('must not call'); } });
  assert.equal(large.skipped, 1); assert.equal(large.classified, 0);
});

test('classifier settings are validated, applied to requests and probed with a made-up turn only', async () => {
  assert.deepEqual(classifierSettings(), { endpoint: 'http://127.0.0.1:8000', threshold: 0.65, maxTurnBytes: 5000, maxLen: 8192, timeoutSeconds: 120, prompt: 'Classify the coding assistant response using only the supplied conversation.' });
  assert.throws(() => classifierSettings({ endpoint: 'http://example.com:8000' }), /hosted endpoints/);
  assert.throws(() => classifierSettings({ threshold: 0.2 }), /threshold/);
  assert.throws(() => classifierSettings({ maxTurnBytes: 9000, maxLen: 4096 }), /truncated/);
  assert.throws(() => classifierSettings({ timeoutSeconds: 1.5 }), /whole number/);
  assert.throws(() => classifierSettings({ prompt: '' }), /Classification prompt/);
  assert.throws(() => classifierSettings({ prompt: 'x'.repeat(4001) }), /Classification prompt/);
  const seen = [];
  const unsure = { ...responseFor(), answers: Object.fromEntries(Object.entries(LABELS).map(([key, labels]) => [key, { choice: labels[0], probabilities: Object.fromEntries(labels.map((l, i) => [l, i === 0 ? 0.9 : i === 1 ? 0.1 : 0])) }])) };
  const fetchFn = async (url, options) => { seen.push([url, JSON.parse(options.body)]); return Response.json(unsure); };
  const result = await classifyMessages(messages, { endpoint: 'http://127.0.0.1:9100', threshold: 0.99, maxLen: 6000, fetchFn });
  assert.equal(seen[0][0], 'http://127.0.0.1:9100/v1/systemone'); assert.equal(seen[0][1].max_len, 6000);
  assert.equal(result.threshold, 0.99); assert.equal(result.counts.outcome.unknown, 1);
  const smaller = await classifyMessages([{ ...messages[0], text: 'x'.repeat(1200) }, messages[1]], { maxTurnBytes: 1000, fetchFn: () => { throw new Error('must not call'); } });
  assert.equal(smaller.skipped, 1);
  seen.length = 0;
  const probe = await probeClassifier({}, fetchFn);
  assert.match(probe.message, /Laya answered at http:\/\/127\.0\.0\.1:8000/);
  assert.doesNotMatch(seen[0][1].state, /Fix the parser/);
  await assert.rejects(probeClassifier({}, async () => Response.json({ answers: {} })), (e) => !/no classification result was saved/.test(e.message));
});

test('outcome classification defines evidence for each label and uses the next user message as feedback', async () => {
  await classifyMessages(messages, { fetchFn: async (_url, options) => {
    const { state, questions } = JSON.parse(options.body);
    assert.deepEqual(JSON.parse(state), { prompt: 'Fix the parser', answer: 'Parser fixed.', nextPrompt: 'Thanks, works' });
    const { instructions, criteria } = questions.outcome;
    assert.match(instructions, /user reaction in nextPrompt/);
    assert.match(instructions, /Classify this request, not the entire session/);
    assert.match(instructions, /not verified code or test results/);
    assert.match(criteria.fulfilled, /confirms success/);
    assert.match(criteria.partially, /specific requirement remains/);
    assert.match(criteria.not_fulfilled, /reports failure/);
    assert.match(criteria.abandoned, /explicitly cancels/);
    assert.match(criteria.unknown, /bare thanks/);
    assert.deepEqual(Object.keys(criteria), LABELS.outcome);
    return Response.json(responseFor());
  } });
});

test('preceding context is supplied only when the full current turn still fits the byte budget', async () => {
  const dialogue = [
    { role: 'user', text: 'Fix the parser' }, { role: 'assistant', text: 'Which input fails?' },
    { role: 'user', text: 'Empty arrays' }, { role: 'assistant', text: 'Fixed empty arrays.' },
    { role: 'user', text: 'That works' },
  ];
  const states = [];
  const fetchFn = async (_url, options) => { states.push(JSON.parse(JSON.parse(options.body).state)); return Response.json(responseFor()); };
  await classifyMessages(dialogue, { fetchFn });
  assert.deepEqual(states[1], { previousPrompt: 'Fix the parser', previousAnswer: 'Which input fails?', prompt: 'Empty arrays', answer: 'Fixed empty arrays.', nextPrompt: 'That works' });
  states.length = 0;
  const large = [{ role: 'user', text: '😀'.repeat(300) }, ...dialogue.slice(1)];
  const result = await classifyMessages(large, { fetchFn, maxTurnBytes: 1000 });
  assert.equal(result.skipped, 2); // Oversized first turn and final user message without an answer.
  assert.equal(result.classified, 1);
  assert.deepEqual(states, [{ prompt: 'Empty arrays', answer: 'Fixed empty arrays.', nextPrompt: 'That works' }]);
});

test('UNKNOWN reasons distinguish model abstention from threshold rejection without lowering the threshold', async () => {
  const cases = [
    { choice: 'unknown', probabilities: { fulfilled: 0.1, partially: 0.1, not_fulfilled: 0, abandoned: 0, unknown: 0.8 }, reason: 'model' },
    { choice: 'unknown', probabilities: { fulfilled: 0.3, partially: 0.3, not_fulfilled: 0, abandoned: 0, unknown: 0.4 }, reason: 'model' },
    { choice: 'fulfilled', probabilities: { fulfilled: 0.6, partially: 0, not_fulfilled: 0, abandoned: 0, unknown: 0.4 }, reason: 'lowConfidence' },
    { choice: 'not_fulfilled', probabilities: { fulfilled: 0, partially: 0, not_fulfilled: 0.65, abandoned: 0, unknown: 0.35 }, reason: null },
  ];
  for (const { reason, ...outcome } of cases) {
    const response = responseFor(); response.answers.outcome = outcome;
    const result = await classifyMessages(messages, { includeTurns: true, fetchFn: async () => Response.json(response) });
    assert.equal(result.threshold, 0.65);
    assert.deepEqual(result.outcomeUnknown, { model: Number(reason === 'model'), lowConfidence: Number(reason === 'lowConfidence'), noVerdict: 0 });
    assert.equal(result.counts.outcome[reason ? 'unknown' : outcome.choice], 1);
    assert.equal(result.turns[0].predictions.outcome.unknownReason ?? null, reason);
    assert.doesNotMatch(JSON.stringify({ ...result, turns: undefined }), /Fix the parser|Parser fixed/);
  }
});

test('saved UNKNOWN diagnostics reach Learn as metadata without conversation text', async () => {
  const env = environment(), root = tmp(); fixture(env, root);
  const response = responseFor();
  response.answers.outcome = { choice: 'fulfilled', probabilities: { fulfilled: 0.6, partially: 0, not_fulfilled: 0, abandoned: 0, unknown: 0.4 } };
  await collectAnalysis({ root, env, classify: true, fetchFn: async () => Response.json(response) });
  const saved = readAnalysis(env), data = await sessionsData({ root, kitRoot: KIT_ROOT, env });
  assert.deepEqual(saved.rows[0].evaluation.outcomeUnknown, { model: 0, lowConfidence: 1, noVerdict: 0 });
  assert.deepEqual(data.rows[0].evaluation.outcomeUnknown, saved.rows[0].evaluation.outcomeUnknown);
  assert.doesNotMatch(JSON.stringify([saved, data]), /Fix the parser|Parser fixed|Thanks, works/);
});

test('whole-message user verdicts resolve clear feedback without matching quotes, qualifications or new requests', () => {
  for (const text of ['That works.', 'Thanks, that works!', 'Looks good', 'Fixed now.', 'Das funktioniert jetzt, danke.', 'Problem solved.']) assert.equal(userOutcome(text), 'fulfilled', text);
  for (const text of ['It is still broken.', 'Still broken!', 'It doesn’t work.', 'That is not what I asked for.', 'Das funktioniert nicht.']) assert.equal(userOutcome(text), 'not_fulfilled', text);
  for (const text of ['Stop, forget this task.', 'Please cancel this task.', 'Vergiss diese Aufgabe.']) assert.equal(userOutcome(text), 'abandoned', text);
  for (const text of ['', 'Thanks.', 'Thank you!', 'Danke.']) assert.equal(userOutcome(text), 'unknown', text);
  for (const text of ['That works?', 'That works, but saving fails.', 'Looks good, now add sorting.', 'Say "that works".', 'The documentation says: that works.', '```that works```', '> That works.', 'Not fixed now.', 'That works in staging only.', 'Thanks, that does not look good.']) assert.equal(userOutcome(text), null, text);
});

test('user verdict rules override uncertain or contrary model outcomes transparently, without affecting other dimensions', async () => {
  const response = responseFor();
  response.answers.outcome = { choice: 'unknown', probabilities: { fulfilled: 0.2, partially: 0.1, not_fulfilled: 0.1, abandoned: 0.1, unknown: 0.5 } };
  for (const [feedback, expected] of [['That works.', 'fulfilled'], ['It is still broken.', 'not_fulfilled'], ['Stop, forget this task.', 'abandoned'], ['Thanks.', 'unknown'], ['', 'unknown']]) {
    const dialogue = [messages[0], messages[1], ...(feedback ? [{ role: 'user', text: feedback }] : [])];
    const result = await classifyMessages(dialogue, { includeTurns: true, fetchFn: async () => Response.json(response) });
    const prediction = result.turns[0].predictions.outcome;
    assert.equal(prediction.choice, 'unknown'); assert.equal(prediction.confidence, 0.5);
    assert.equal(prediction.prediction, expected); assert.equal(prediction.source, 'userFeedback');
    assert.equal(result.outcomeFeedback, 1);
    assert.equal(result.outcomeUnknown.noVerdict, Number(expected === 'unknown'));
    assert.equal(result.counts.sentiment.positive, 1);
  }
  const result = await classifyMessages([messages[0], messages[1]], { includeTurns: true, fetchFn: async () => Response.json(responseFor()) });
  assert.equal(result.turns[0].predictions.outcome.choice, 'fulfilled');
  assert.equal(result.turns[0].predictions.outcome.prediction, 'unknown', 'an assistant claim without a user reaction cannot establish acceptance');
});

test('Laya sample preview uses selected saved sessions and does not persist transcripts or predictions', async () => {
  const env = environment(), root = tmp(); fixture(env, root);
  await collectAnalysis({ root, env });
  const api = createWorkspaceApi({
    root, kitRoot: KIT_ROOT, env,
    fetchFn: async (_url, options) => {
      assert.match(JSON.parse(options.body).questions.outcome.instructions, /Look for explicit completion/);
      return Response.json(responseFor());
    },
  });
  const samples = api.get['/api/classifier-samples'](), before = readFileSync(join(env.HOME, '.yaw/session-analysis.json'), 'utf8');
  assert.equal(samples.length, 1);
  await assert.rejects(api.action('classifier-preview', { ids: [samples[0].id], classifier: {} }), /Confirm sending/);
  const preview = await api.action('classifier-preview', { ids: [samples[0].id], classifier: { prompt: 'Look for explicit completion.' }, confirm: true });
  assert.equal(preview.sessions.length, 1);
  assert.equal(preview.sessions[0].turns.length, 1);
  assert.equal(preview.sessions[0].turns[0].prompt, 'Fix the parser');
  assert.match(preview.message, /were not saved/);
  assert.equal(readFileSync(join(env.HOME, '.yaw/session-analysis.json'), 'utf8'), before);
  await assert.rejects(api.action('classifier-preview', { ids: ['not-a-saved-session'], classifier: {}, confirm: true }), /no longer in the saved scan/);
});

test('classifier job pauses between turns, resumes, and reports progress', async () => {
  const root = await makeProject({ modules: ['core'] }), env = environment(), file = fixture(env, root);
  writeFileSync(file, `${readFileSync(file, 'utf8')}\n${JSON.stringify({
    type: 'response_item', timestamp: '2026-10-24T08:01:02Z',
    payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Second task complete.' }] },
  })}`);
  await collectAnalysis({ root, env });
  let announceFirst, finishFirst;
  const firstStarted = new Promise((resolve) => { announceFirst = resolve; });
  const firstResponse = new Promise((resolve) => { finishFirst = resolve; });
  let calls = 0;
  const api = createWorkspaceApi({
    root, kitRoot: KIT_ROOT, env,
    fetchFn: async () => {
      calls++;
      if (calls === 1) { announceFirst(); return firstResponse; }
      return Response.json(responseFor());
    },
  });
  const run = api.action('evaluate', { confirm: true, all: false });
  await firstStarted;
  assert.equal((await api.action('classifier-pause', {})).status, 'pausing');
  finishFirst(Response.json(responseFor()));
  for (let i = 0; i < 100 && api.get['/api/classification-job']()?.status !== 'paused'; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(api.get['/api/classification-job']().status, 'paused');
  assert.equal(calls, 1, 'the next Laya request waits while paused');
  await api.action('classifier-resume', {});
  const result = await run;
  assert.equal(result.classified, true);
  assert.equal(calls, 2);
  assert.equal(api.get['/api/classification-job']().status, 'completed');
  assert.equal(readAnalysis(env).rows[0].evaluation.classified, 2);
});

test('stopping an active classifier aborts Laya and saves no unfinished results', async () => {
  const root = tmp(), env = environment(); fixture(env, root);
  await collectAnalysis({ root, env });
  const before = readFileSync(join(env.HOME, '.yaw/session-analysis.json'), 'utf8');
  let announceStarted;
  const started = new Promise((resolve) => { announceStarted = resolve; });
  const api = createWorkspaceApi({
    root, kitRoot: KIT_ROOT, env,
    fetchFn: (_url, { signal }) => new Promise((resolve, reject) => {
      announceStarted();
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
  });
  const run = api.action('evaluate', { confirm: true, all: false });
  await started;
  await api.action('classifier-stop', {});
  await assert.rejects(run, /Classification stopped/);
  assert.equal(api.get['/api/classification-job']().status, 'stopped');
  assert.equal(readFileSync(join(env.HOME, '.yaw/session-analysis.json'), 'utf8'), before);
});

test('failed local classification leaves saved results unchanged; CLI scan and analytics work without sessions module', async () => {
  const root = tmp(), env = environment(); fixture(env, root);
  await collectAnalysis({ root, env });
  const before = readFileSync(join(env.HOME, '.yaw/session-analysis.json'), 'utf8');
  await assert.rejects(collectAnalysis({ root, env, classify: true, fetchFn: async () => { throw new Error('secret must not echo'); } }), /not reachable/);
  assert.equal(readFileSync(join(env.HOME, '.yaw/session-analysis.json'), 'utf8'), before);
  const io = { cwd: root, env, kitRoot: KIT_ROOT, stdout: capture(), stderr: capture() };
  assert.equal(await main(['sessions', 'scan'], io), 0, io.stderr.text());
  assert.equal(await main(['sessions', 'analytics'], io), 0);
  assert.doesNotMatch(io.stdout.text(), /Parser fixed/);
});

test('dashboard scan and preference actions require session plus CSRF; GET never scans', async (t) => {
  const root = await makeProject({ modules: ['core'] }), env = environment(); fixture(env, root);
  const server = await startDashboard({ root, env, kitRoot: KIT_ROOT, signals: false }); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.port}`, cookie = (await fetch(server.url, { redirect: 'manual' })).headers.get('set-cookie').split(';')[0];
  const html = await (await fetch(base, { headers: { cookie } })).text();
  const csrf = html.match(/name="yaw-csrf" content="([a-f0-9]+)"/)[1];
  assert.match(html, /id="classifier-job"/);
  const post = (action, input, withCsrf = true) => fetch(`${base}/api/${action}`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json', ...(withCsrf ? { 'x-yaw-token': csrf } : {}) }, body: JSON.stringify(input),
  });
  await fetch(`${base}/api/dashboard?history=local&refresh-history=1`, { headers: { cookie } });
  assert.equal(readAnalysis(env).collected, null);
  assert.equal((await post('collect', {}, false)).status, 403);
  assert.equal((await post('evaluate', {})).status, 400);
  assert.equal((await post('collect', { all: false })).status, 200);
  assert.equal(readAnalysis(env).rows.length, 1);
  assert.equal((await post('preferences', { autoRefresh: true })).status, 200);
  assert.equal((await post('preferences', { autoRefresh: 'yes' })).status, 400);
  assert.equal((await post('classifier-save', { classifier: { endpoint: 'http://127.0.0.1:8123', threshold: 0.8, prompt: 'Prioritize explicit acceptance criteria.' } })).status, 200);
  assert.equal((await post('classifier-save', { classifier: { endpoint: 'https://remote.example' } })).status, 400);
  assert.equal((await post('classifier-save', { classifier: {} }, false)).status, 403);
  assert.equal((await fetch(`${base}/api/classification-job`, { headers: { cookie } })).status, 200);
  assert.equal((await post('classifier-pause', {})).status, 200);
  const prefs = await (await fetch(`${base}/api/preferences`, { headers: { cookie } })).json();
  assert.equal(prefs.autoRefresh, true);
  assert.equal(prefs.classifier.endpoint, 'http://127.0.0.1:8123'); assert.equal(prefs.classifier.threshold, 0.8); assert.equal(prefs.classifier.maxLen, 8192);
  assert.equal(prefs.classifier.prompt, 'Prioritize explicit acceptance criteria.');
  // Nothing listens on port 9 on loopback, so the probe reports the failure instead of a 500.
  const probe = await post('classifier-test', { classifier: { endpoint: 'http://127.0.0.1:9' } });
  assert.equal(probe.status, 502); assert.match((await probe.json()).error, /not reachable/);
  assert.doesNotMatch(html, /sidebar-footer/);
});

test('global task snapshots are explicit and retain separate workspace identities', async () => {
  const root = tmp(), other = tmp(), env = environment();
  fixture(env, root); fixture(env, other, 'other');
  writeTree(root, { 'TASKS.md': '# Tasks\n\n## Active\n\n### T-001 First — in progress\n\n## Backlog\n' });
  writeTree(other, { 'TASKS.md': '# Tasks\n\n## Active\n\n### T-001 Other — in progress\n\n## Backlog\n' });
  const api = createWorkspaceApi({ root, env, kitRoot: KIT_ROOT });
  await api.action('collect', { all: true });
  const data = await dashboardData({ root, env, kitRoot: KIT_ROOT });
  assert.equal(data.globalTasks.length, 2); assert.equal(data.tasks.active[0].title, 'First');
  assert.ok(data.globalTasks.some((t) => t.active[0]?.title === 'Other'));
  const visited = [];
  await collectAnalysis({ root, env, tasksFor: (project) => { visited.push(project); return {}; } });
  assert.deepEqual(visited, [realRoot(root)]);
  assert.equal(data.project.canonicalRoot, realRoot(root));
});

test('Telegram settings store only environment names and never return credentials', async () => {
  const root = await makeProject({ modules: ['core', 'comfort'] }), env = environment();
  env.TEST_BOT = '123:' + 'x'.repeat(30); env.TEST_CHAT = '-123';
  const input = { enabled: true, minutes: 3, terminal: 'off', telegram: { enabled: true, tokenEnv: 'TEST_BOT', chatIdEnv: 'TEST_CHAT' } };
  saveNotifications({ root, env, input });
  assert.equal(notificationSettings({ root, env }).telegramReady, true);
  assert.equal(resolveFeatures({ root, personal: readPersonal(env).config }).features.includes('notifications'), true);
  assert.doesNotMatch(JSON.stringify(notificationSettings({ root, env })), /123:|-123/);
  assert.doesNotMatch(readFileSync(join(env.HOME, '.yaw/notification-settings.json'), 'utf8'), /123:|-123/);
  let called = 0;
  const sent = await deliverNotifications({
    payload: buildPayload({ project: root, status: 'done' }), config: readPersonal(env).config.notify, env,
    fetchFn: async (url, options) => { called++; assert.ok(url.startsWith('https://api.telegram.org/bot')); assert.equal(JSON.parse(options.body).chat_id, '-123'); return Response.json({ ok: true }); },
  });
  assert.equal(called, 1); assert.deepEqual(sent, ['telegram']);
  await assert.rejects(deliverNotifications({ payload: buildPayload({ project: root, status: 'done' }), config: input, env: {} }), /credentials/);
  assert.throws(() => saveNotifications({ root, env, input: { ...input, telegram: { ...input.telegram, tokenEnv: env.TEST_BOT } } }), /never Telegram credentials/);
  await assert.rejects(deliverNotifications({
    payload: buildPayload({ project: root, status: 'done' }), config: readPersonal(env).config.notify, env,
    fetchFn: async () => { throw new Error(env.TEST_BOT); },
  }), (error) => error.message === 'telegram notification could not be delivered');
  const answersFile = join(root, '.yaw/answers.yaml');
  writeFileSync(answersFile, readFileSync(answersFile, 'utf8').replace('answers:\n', 'answers:\n  user.comfort: []\n'));
  assert.deepEqual(resolveFeatures({ root, personal: readPersonal(env).config }).features, ['notifications']);
});

test('private JSON state honors YAW_HOME, replaces atomically and rejects linked targets', () => {
  const env = { ...environment(), YAW_HOME: tmp('yaw-state-override-') };
  writeUserData(env, 'test-state.json', { version: 1 });
  writeUserData(env, 'test-state.json', { version: 2 });
  assert.deepEqual(readUserData(env, 'test-state.json'), { version: 2 });
  const outside = join(tmp(), 'outside.json'); writeFileSync(outside, '{"untouched":true}');
  symlinkSync(outside, join(env.YAW_HOME, 'linked-state.json'));
  assert.throws(() => writeUserData(env, 'linked-state.json', {}), /regular file/);
  assert.equal(readFileSync(outside, 'utf8'), '{"untouched":true}');
});

test('rescans keep saved rows and classifications when a history file or folder is unavailable, and report them', async () => {
  const env = environment(), root = tmp(), file = fixture(env, root);
  await collectAnalysis({ root, env });
  const saved = readAnalysis(env);
  saved.rows[0].evaluation = { classified: 1, skipped: 0, counts: { outcome: { fulfilled: 1 } } };
  writeUserData(env, 'session-analysis.json', saved);
  renameSync(file, join(tmp(), 'moved.jsonl'));
  let result = await collectAnalysis({ root, env });
  assert.deepEqual(readAnalysis(env).rows, saved.rows);
  assert.deepEqual([result.sessions, result.missing], [0, 1]);
  assert.match(scanSummary(result), /1 saved session\(s\) not found.*kept/);
  renameSync(env.CODEX_HOME, join(tmp(), 'moved-home'));
  result = await collectAnalysis({ root, env, all: true });
  assert.deepEqual(readAnalysis(env).rows, saved.rows);
  assert.equal(result.missing, 1);
});

test('rescans keep saved rows when their history source is disabled', async () => {
  const env = environment(), root = tmp();
  fixture(env, root);
  await collectAnalysis({ root, env });
  const before = readAnalysis(env).rows;
  saveSources(env, [{ agent: 'codex', path: env.CODEX_HOME, enabled: false }]);
  const result = await collectAnalysis({ root, env });
  assert.deepEqual(readAnalysis(env).rows, before);
  assert.equal(result.missing, 1);
  assert.doesNotMatch(scanSummary({ sessions: 1, missing: 0 }), /not found/);
});
