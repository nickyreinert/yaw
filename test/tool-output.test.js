import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectAnalysis, readAnalysis, readTurns } from '../core/lib/session-analysis.js';
import { sessionsData } from '../core/web/dashboard.js';
import { toolOutputRows, toolOutputTable } from '../core/web/assets/tool-output.js';
import { KIT_ROOT, tmp, writeTree } from './helpers/fixtures.js';
import { longLineFile, peakDuring } from './helpers/long-line.js';

// T-048: tool-result sizes by tool and by the command's first word. Real tool-result text comes from the T-047 fixtures.
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/claude/${name}.json`, import.meta.url), 'utf8'));
const bash = fixture('PostToolUse-Bash'), grep = fixture('PostToolUse-Grep'), read = fixture('PostToolUse-Read');
const time = '2026-10-24T08:00:00Z';
const use = (...calls) => ({ type: 'assistant', timestamp: time, message: { id: `m${calls[0].id}`, content: calls.map((c) => ({ type: 'tool_use', ...c })) } });
const result = (id, content, extra = {}) => ({ type: 'user', timestamp: time, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, ...extra }] } });
const bytes = Buffer.byteLength;

function transcript(root) {
  const readText = `     1\t${read.tool_response.file.content}`;
  return [
    { type: 'user', timestamp: time, sessionId: 'claude-tools', cwd: root, message: { role: 'user', content: 'Check the repo' } },
    use({ id: 'a', name: 'Bash', input: { command: 'SECRET_TOKEN=hunter2 /usr/bin/git commit -m "private message"' } }),
    result('a', bash.tool_response.stdout),
    use({ id: 'b', name: 'Bash', input: { command: 'git status' } }),
    result('b', [{ type: 'text', text: bash.tool_response.stdout }]),
    use({ id: 'c', name: 'Read', input: { file_path: '/secret/place.txt' } }),
    result('c', readText),
    use({ id: 'd', name: 'Grep', input: { pattern: 'foo' } }),
    result('d', grep.tool_response.content),
    use({ id: 'e', name: 'Bash', input: { command: 'exit 3' } }),
    result('e', 'Exit code 3\nboom', { is_error: true }),
    { type: 'assistant', timestamp: '2026-10-24T08:00:09Z', message: { id: 'z', content: [{ type: 'text', text: 'Done.' }] } },
  ];
}

test('a scan stores tool-result sizes by tool and first word, never tool output or command text', async () => {
  const home = tmp('yaw-tools-home-'), root = tmp();
  const env = { HOME: home, CLAUDE_CONFIG_DIR: join(home, '.claude'), CODEX_HOME: join(home, '.codex') };
  writeTree(env.CLAUDE_CONFIG_DIR, { 'projects/demo/session.jsonl': transcript(root).map(JSON.stringify).join('\n') });
  await collectAnalysis({ root, env, all: true });
  const row = readAnalysis(env).rows[0];
  const out = bytes(bash.tool_response.stdout);
  assert.deepEqual(row.toolOutput.tools.Bash, { calls: 3, bytes: 2 * out + bytes('Exit code 3\nboom'), max: bytes('Exit code 3\nboom') });
  assert.deepEqual(row.toolOutput.tools.Grep, { calls: 1, bytes: bytes(grep.tool_response.content), max: bytes(grep.tool_response.content) });
  assert.equal(row.toolOutput.tools.Read.calls, 1);
  assert.deepEqual(row.toolOutput.commands.git, { calls: 2, bytes: 2 * out, max: out });
  assert.deepEqual(row.toolOutput.commands.exit, { calls: 1, bytes: bytes('Exit code 3\nboom'), max: bytes('Exit code 3\nboom') });
  const stored = readFileSync(join(home, '.yaw/session-analysis.json'), 'utf8');
  for (const secret of ['hello', 'line two', 'foo here', 'boom', 'hunter2', 'private message', 'SECRET_TOKEN', '/secret/place', '/usr/bin']) {
    assert.ok(!stored.includes(secret), `stored scan must not contain ${secret}`);
  }
  const data = await sessionsData({ root, kitRoot: KIT_ROOT, env });
  assert.deepEqual(data.rows[0].toolOutput, row.toolOutput);
});

test('the tool-output scan skips an oversized line without buffering it (T-016)', () => {
  const dir = tmp();
  const file = longLineFile(dir,
    use({ id: 'big', name: 'Bash', input: { command: 'git log' } }, { id: 'small', name: 'Bash', input: { command: 'npm test' } }),
    result('big', 'PAD'), result('small', 'ok'));
  const { grewMiB, result: read } = peakDuring(join(KIT_ROOT, 'core/lib/session-analysis.js'), "mod.readTurns(file, 'claude')", file);
  assert.equal(read.limited, true);
  assert.deepEqual(read.tools.commands, { npm: { calls: 1, bytes: 2, max: 2 } });
  assert.ok(grewMiB < 48, `peak RSS grew ${grewMiB.toFixed(1)} MiB while skipping a 64 MiB line`);
});

test('other agents report no tool-output sizes', async () => {
  const file = join(tmp(), 'events.jsonl');
  writeTree(join(file, '..'), { 'events.jsonl': JSON.stringify({ type: 'user.message', timestamp: time, data: { content: 'hello' } }) });
  assert.equal((await readTurns(file, 'copilot')).tools, undefined);
});

test('Analytics tool-output table lists tools and commands with share and estimated tokens', () => {
  const rows = [
    { toolOutput: { tools: { Bash: { calls: 3, bytes: 3000, max: 2000 }, Read: { calls: 1, bytes: 1000, max: 1000 } }, commands: { git: { calls: 2, bytes: 2500, max: 2000 } } } },
    { toolOutput: { tools: { Bash: { calls: 1, bytes: 1000, max: 1000 } }, commands: { git: { calls: 1, bytes: 1000, max: 1000 } } } },
    { toolOutput: null },
  ];
  const list = toolOutputRows(rows);
  assert.deepEqual(list.map((r) => [r.kind, r.name, r.calls, r.bytes, r.max, r.sessions]), [
    ['Tool', 'Bash', 4, 4000, 2000, 2], ['Command', 'git', 3, 3500, 2000, 2], ['Tool', 'Read', 1, 1000, 1000, 1]]);
  assert.equal(list[0].share, 0.8); assert.equal(list[1].share, 0.7);
  const seen = {};
  const node = toolOutputTable(rows, {
    table: (id, cols, data, options) => { Object.assign(seen, { id, cols, data, options }); return 'table'; },
    num: (key, label, value, show) => ({ key, label, value, show, num: true }),
    str: (key, label, value) => ({ key, label, value }),
    short: (n) => String(n),
  });
  assert.equal(node, 'table'); assert.equal(seen.id, 'tooloutput');
  assert.deepEqual(seen.cols.map((c) => c.label), ['Kind', 'Name', 'Results', 'Sessions', 'Bytes', 'Largest', 'Share of tool output', 'Est. tokens']);
  assert.equal(seen.cols.find((c) => c.key === 'tokens').value(seen.data[0]), 1000);
  assert.match(seen.options.note, /sizes only/i);
  assert.deepEqual(toolOutputRows([{ toolOutput: null }]), []);
});
