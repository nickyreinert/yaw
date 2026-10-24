import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lstatSync, readFileSync, writeFileSync, symlinkSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { classifyMessages, collectAnalysis, LABELS, localEndpoint, messageMetrics, messageOf, readAnalysis, readTurns, scanSummary } from '../core/lib/session-analysis.js';
import { createWorkspaceApi } from '../core/web/workspace-api.js';
import { dashboardData, sessionsData, startDashboard } from '../core/web/dashboard.js';
import { main } from '../core/cli/main.js';
import { notificationSettings, saveNotifications, deliverNotifications } from '../modules/comfort/lib/settings.js';
import { buildPayload } from '../modules/comfort/lib/notify.js';
import { readPersonal, resolveFeatures } from '../modules/comfort/lib/config.js';
import { readUserData, writeUserData } from '../core/lib/user-store.js';
import { realRoot } from '../modules/sessions/lib/registry.js';
import { KIT_ROOT, capture, tmp, writeTree } from './helpers/fixtures.js';
import { makeProject } from './helpers/hooks.js';

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
  assert.equal(row.metrics.limited, false); assert.equal(row.reader, 2);
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
  const post = (action, input, withCsrf = true) => fetch(`${base}/api/${action}`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/json', ...(withCsrf ? { 'x-yaw-token': csrf } : {}) }, body: JSON.stringify(input),
  });
  await fetch(`${base}/api/dashboard?history=local&refresh-history=1`, { headers: { cookie } });
  assert.equal(readAnalysis(env).collected, null);
  assert.equal((await post('collect', {}, false)).status, 403);
  assert.equal((await post('evaluate', {})).status, 400);
  assert.equal((await post('collect', { all: false })).status, 200);
  assert.equal(readAnalysis(env).rows.length, 1);
  assert.equal((await post('preferences', { refreshOnLoad: true, endpoint: 'http://127.0.0.1:8000' })).status, 200);
  const prefs = await (await fetch(`${base}/api/preferences`, { headers: { cookie } })).json();
  assert.equal(prefs.refreshOnLoad, true);
  assert.equal((await post('preferences', { refreshOnLoad: false, endpoint: 'https://remote.example' })).status, 400);
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
