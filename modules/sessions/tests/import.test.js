// `yaw sessions import` (#174): past sessions of a project from the agents' local history, metadata only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../../../core/cli/main.js';
import { KIT_ROOT, capture, cleanEnv, tmp } from '../../../test/helpers/fixtures.js';
import { boundedLines, claudeFolder, findSessions, inProject, workspaceFields } from '../lib/import.js';
import { realRoot, registryFile, withRegistry } from '../lib/registry.js';
import { longLineFile, peakDuring } from '../../../test/helpers/long-line.js';

const SECRET = 'PROMPT-CANARY-7f3a';
const jsonl = (rows) => `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;
const put = (file, text) => {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, text);
};

function history(home, project) {
  const other = '/somewhere/else';
  const cdir = join(home, '.claude', 'projects', claudeFolder(project));
  put(join(cdir, 'aaaa1111-0000-4000-8000-000000000001.jsonl'), jsonl([
    { type: 'user', sessionId: 'aaaa1111-0000-4000-8000-000000000001', cwd: project, gitBranch: 'feat/T-001-x', timestamp: '2026-10-20T09:00:00.000Z', message: { role: 'user', content: SECRET } },
    { type: 'assistant', sessionId: 'aaaa1111-0000-4000-8000-000000000001', cwd: project, timestamp: '2026-10-20T09:01:00.000Z', message: { id: 'm1', model: 'claude-opus', content: [{ type: 'text', text: SECRET }], usage: { input_tokens: 100, cache_read_input_tokens: 900, output_tokens: 50 } } },
    { type: 'assistant', sessionId: 'aaaa1111-0000-4000-8000-000000000001', cwd: project, timestamp: '2026-10-20T09:01:01.000Z', message: { id: 'm1', model: 'claude-opus', content: [], usage: { input_tokens: 100, cache_read_input_tokens: 900, output_tokens: 50 } } },
    { type: 'assistant', sessionId: 'aaaa1111-0000-4000-8000-000000000001', cwd: join(project, 'sub'), timestamp: '2026-10-20T10:30:00.000Z', message: { id: 'm2', model: 'claude-haiku', usage: { input_tokens: 10, output_tokens: 5 } } },
    { type: 'ai-title', aiTitle: SECRET, sessionId: 'aaaa1111-0000-4000-8000-000000000001' },
    { type: 'cost-state', sessionId: 'aaaa1111-0000-4000-8000-000000000001', totalCostUSD: 1.23456 },
    'not json',
  ]).replace('"not json"', '{broken'));
  // same folder name, another real path (the encoding is lossy): ignored
  put(join(cdir, 'aaaa1111-0000-4000-8000-000000000002.jsonl'), jsonl([
    { type: 'user', sessionId: 'aaaa1111-0000-4000-8000-000000000002', cwd: other, timestamp: '2026-10-20T09:00:00.000Z' },
  ]));
  put(join(home, '.codex', 'sessions', '2026', '10', '21', 'rollout-2026-10-21T08-00-00-bbbb.jsonl'), jsonl([
    { type: 'session_meta', timestamp: '2026-10-21T08:00:00.000Z', payload: { id: 'bbbb2222-0000-4000-8000-000000000001', cwd: project, timestamp: '2026-10-21T08:00:00.000Z', git: { branch: 'main' }, base_instructions: { text: SECRET } } },
    { type: 'turn_context', timestamp: '2026-10-21T08:00:01.000Z', payload: { model: 'gpt-x', cwd: project } },
    { type: 'event_msg', timestamp: '2026-10-21T08:00:02.000Z', payload: { type: 'user_message', message: SECRET } },
    { type: 'event_msg', timestamp: '2026-10-21T08:20:00.000Z', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 5000, output_tokens: 300 } } } },
  ]));
  put(join(home, '.codex', 'sessions', '2026', '10', '21', 'rollout-2026-10-21T09-00-00-cccc.jsonl'), jsonl([
    { type: 'session_meta', timestamp: '2026-10-21T09:00:00.000Z', payload: { id: 'cccc', cwd: other } },
  ]));
  const sdir = join(home, '.copilot', 'session-state', 'dddd4444-0000-4000-8000-000000000001');
  put(join(sdir, 'workspace.yaml'), `id: dddd4444-0000-4000-8000-000000000001\ncwd: ${project}\nbranch: dev\nname: ${SECRET}\ncreated_at: 2026-10-22T07:00:00.000Z\nupdated_at: 2026-10-22T07:45:00.000Z\n`);
  put(join(sdir, 'events.jsonl'), jsonl([
    { type: 'session.start', timestamp: '2026-10-22T07:00:00.000Z', data: { sessionId: 'dddd4444-0000-4000-8000-000000000001', selectedModel: 'auto', context: { cwd: project, branch: 'dev' } } },
    { type: 'user.message', timestamp: '2026-10-22T07:01:00.000Z', data: { content: SECRET } },
    { type: 'session.usage_record', timestamp: '2026-10-22T07:02:00.000Z', data: { usage: { model: 'sonnet', inputTokens: 700, cacheReadTokens: 300, outputTokens: 40 } } },
    { type: 'session.usage_record', timestamp: '2026-10-22T07:40:00.000Z', data: { usage: { model: 'sonnet', inputTokens: 1000, outputTokens: 60 } } },
  ]));
  put(join(home, '.copilot', 'session-state', 'eeee', 'workspace.yaml'), `id: eeee\ncwd: ${other}\ncreated_at: 2026-10-22T07:00:00.000Z\n`);
}

async function yaw(args, { cwd, env }) {
  const stdout = capture();
  const stderr = capture();
  const code = await main(args, { stdout, stderr, cwd, env, kitRoot: KIT_ROOT, prompter: { interactive: false, ask: async () => '', close() {} } });
  return { code, out: stdout.text(), err: stderr.text() };
}

test('helpers: folder encoding, project match, workspace fields without name or summary', () => {
  assert.equal(claudeFolder('/Users/a/dev/_YAW.x'), '-Users-a-dev--YAW-x');
  assert.ok(inProject('/p/app', '/p/app'));
  assert.ok(inProject('/p/app/sub', '/p/app'));
  assert.ok(!inProject('/p/app2', '/p/app'));
  assert.ok(!inProject('relative', '/p/app'));
  assert.deepEqual(workspaceFields('id: x\ncwd: "/a b"\nname: secret\nsummary: s\n'), { id: 'x', cwd: '/a b' });
});

test('yaw sessions import: works without a YAW setup; dry run first; metadata only; idempotent', async () => {
  const home = tmp('yaw-home-');
  const project = realRoot(tmp('yaw-legacy-'));
  history(home, project);
  const env = cleanEnv(home, { PATH: process.env.PATH });

  const dry = await yaw(['sessions', 'import', '--dry-run'], { cwd: project, env });
  assert.equal(dry.code, 0, dry.err);
  assert.match(dry.out, /3 session\(s\) of .* found; 3 new, 0 updated, 0 unchanged; nothing was written \(--dry-run\)/);
  assert.equal(existsSync(registryFile(env)), false, 'a dry run never creates the registry');

  const r = await yaw(['sessions', 'import'], { cwd: project, env });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^added {2}claude:aaaa1111-0000-4000-8000-000000000001 {2}2026-10-20 09:00 {2}claude-opus {2}in 1k out 0k {2}\$1\.23 {2}\[feat\/T-001-x\]$/m);
  assert.match(r.out, /3 new, 0 updated, 0 unchanged\n$/);
  const rows = withRegistry(env, (db) => db.prepare('SELECT id, agent, project, title, started, ended, branch, resume, model, tokens_in, tokens_out, cost_usd, source FROM sessions ORDER BY started').all().map((x) => ({ ...x })));
  assert.deepEqual(rows, [
    { id: 'claude:aaaa1111-0000-4000-8000-000000000001', agent: 'claude', project, title: null, started: '2026-10-20T09:00:00.000Z', ended: '2026-10-20T10:30:00.000Z', branch: 'feat/T-001-x', resume: 'claude --resume aaaa1111-0000-4000-8000-000000000001', model: 'claude-opus', tokens_in: 1010, tokens_out: 55, cost_usd: 1.2346, source: 'import' },
    { id: 'codex:bbbb2222-0000-4000-8000-000000000001', agent: 'codex', project, title: null, started: '2026-10-21T08:00:00.000Z', ended: '2026-10-21T08:20:00.000Z', branch: 'main', resume: 'codex resume bbbb2222-0000-4000-8000-000000000001', model: 'gpt-x', tokens_in: 5000, tokens_out: 300, cost_usd: null, source: 'import' },
    { id: 'copilot:dddd4444-0000-4000-8000-000000000001', agent: 'copilot', project, title: null, started: '2026-10-22T07:00:00.000Z', ended: '2026-10-22T07:45:00.000Z', branch: 'dev', resume: 'copilot --resume dddd4444-0000-4000-8000-000000000001', model: 'sonnet', tokens_in: 2000, tokens_out: 100, cost_usd: null, source: 'import' },
  ]);
  assert.doesNotMatch(r.out, new RegExp(SECRET));
  assert.ok(!readFileSync(registryFile(env)).includes(SECRET), 'no prompt, title or name text reaches the registry');

  const again = await yaw(['sessions', 'import'], { cwd: project, env });
  assert.match(again.out, /^sessions import: 3 session\(s\) of .* found; 0 new, 0 updated, 3 unchanged\n$/);

  // a hook-recorded title survives; new usage is filled in
  withRegistry(env, (db) => db.prepare("UPDATE sessions SET title = 'T-001 Parser', tokens_out = NULL WHERE id LIKE 'codex:%'").run());
  const update = await yaw(['sessions', 'import', '--agent', 'codex'], { cwd: project, env });
  assert.match(update.out, /^updated {2}codex:bbbb2222/m);
  assert.match(update.out, /1 session\(s\) of .* found; 0 new, 1 updated, 0 unchanged/);
  const codex = withRegistry(env, (db) => db.prepare("SELECT title, tokens_out FROM sessions WHERE id LIKE 'codex:%'").get());
  assert.deepEqual({ ...codex }, { title: 'T-001 Parser', tokens_out: 300 });

  const bad = await yaw(['sessions', 'import', '--agent', 'cursor'], { cwd: project, env });
  assert.equal(bad.code, 1);
  assert.match(bad.err, /--agent must be one of claude, codex, copilot/);
  const nothing = await yaw(['sessions', 'import', '--dry-run'], { cwd: realRoot(tmp('yaw-empty-')), env });
  assert.match(nothing.out, /0 session\(s\) of .* found[\s\S]*Looked in ~\/\.claude\/projects/);
});

test('yaw sessions: other verbs still need a YAW setup with the sessions module', async () => {
  const env = cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH });
  const r = await yaw(['sessions', 'list'], { cwd: tmp('yaw-legacy-'), env });
  assert.equal(r.code, 1);
  assert.match(r.err, /run yaw init first/);
});


test('global history discovery spans all agents and projects without importing or retaining content', async () => {
  const home = tmp('yaw-global-history-'), project = realRoot(tmp('yaw-global-project-'));
  const env = { HOME: home, CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude') };
  history(home, project);
  const sessions = await findSessions({ env, allProjects: true });
  assert.equal(sessions.length, 6);
  assert.deepEqual([...new Set(sessions.map((s) => s.agent))].sort(), ['claude', 'codex', 'copilot']);
  assert.deepEqual([...new Set(sessions.map((s) => s.cwd))].sort(), ['/somewhere/else', project].sort());
  assert.ok(!JSON.stringify(sessions).includes(SECRET));
  assert.equal(existsSync(registryFile(env)), false);
  assert.ok(inProject('/absolute/project', null));
  assert.ok(!inProject('relative', null));
});

test('history import skips an oversized line without buffering it (T-016)', () => {
  const native = 'aaaa1111-0000-4000-8000-000000000001';
  const line = (time, content) => ({ type: 'user', sessionId: native, cwd: '/p', timestamp: time, message: { role: 'user', content } });
  const file = longLineFile(tmp(), line('2026-10-20T09:00:00.000Z', 'a'), line('2026-10-20T09:30:00.000Z', 'PAD'), line('2026-10-20T10:00:00.000Z', 'b'));
  const { grewMiB, result } = peakDuring(join(KIT_ROOT, 'modules/sessions/lib/import.js'), 'mod.readClaude(file, null)', file);
  assert.equal(result.native, native); assert.equal(result.started, '2026-10-20T09:00:00.000Z'); assert.equal(result.ended, '2026-10-20T10:00:00.000Z');
  assert.ok(grewMiB < 48, `peak RSS grew ${grewMiB.toFixed(1)} MiB while skipping a 64 MiB line`);
});

test('bounded lines: CRLF, characters split across chunks, a last line without newline, an over-limit line', async () => {
  const bytes = Buffer.from('a\r\nü€\n0123456789\n\nend');
  const chunks = [bytes.subarray(0, 4), bytes.subarray(4, 6), bytes.subarray(6, 12), bytes.subarray(12)];
  const out = [];
  for await (const line of boundedLines(chunks, 8)) out.push(line);
  assert.deepEqual(out, ['a', 'ü€', null, '', 'end']);
});
