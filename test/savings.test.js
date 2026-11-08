import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readSavings } from '../core/lib/savings.js';
import { readTurns } from '../core/lib/session-analysis.js';
import { sessionRows } from '../core/web/session-rows.js';
import { abRows, abTable, savingsRows, savingsTable } from '../core/web/assets/savings.js';
import { tmp, writeTree } from './helpers/fixtures.js';

// T-056: Analytics savings view (rawBytes/outBytes per tool and method, tokens as estimates) and the on/off comparison.
const jsonl = (...recs) => recs.map((r) => JSON.stringify(r)).join('\n');
const ts = '2026-11-01T10:00:00Z';
const hook = (sessionId, name, method, rawBytes, outBytes) => ({ v: 1, agent: 'claude', event: 'PostToolUse', sessionId, tool: { name }, rawBytes, outBytes, method, timing: { ts, hookMs: 1 } });
const fake = { table: (id, cols, data, options) => ({ id, cols, data, options }), num: (key, label, value, show) => ({ key, label, value, show }), str: (key, label, value) => ({ key, label, value }), short: String };

function logs() {
  const home = tmp('yaw-savings-');
  writeTree(join(home, '.yaw', 'logs'), {
    'hooks.jsonl': jsonl(hook('s1', 'Bash', 'cap', 4000, 1000), hook('s1', 'Bash', 'cap', 2000, 1000), hook('s2', 'Grep', 'dedupe', 800, 400),
      { v: 1, agent: 'claude', event: 'PreToolUse', sessionId: 's3', tool: { name: 'Bash' }, timing: { ts, hookMs: 1 } }) + '\nnot json\n',
    'run.jsonl': jsonl({ v: 1, ts, step: 'test', method: 'ok', exitCode: 0, rawBytes: 9000, outBytes: 100, ms: 5 }, { v: 1, ts, step: 'test', method: 'ok', exitCode: 0, rawBytes: 1000, outBytes: 50, ms: 5 }),
  });
  return { HOME: home };
}

test('readSavings sums rawBytes/outBytes per tool and method from stored logs and lists compressed sessions', () => {
  const s = readSavings(logs());
  const find = (source, tool, method) => s.entries.find((e) => e.source === source && e.tool === tool && e.method === method);
  assert.deepEqual(find('hook', 'Bash', 'cap'), { source: 'hook', tool: 'Bash', method: 'cap', calls: 2, rawBytes: 6000, outBytes: 2000 });
  assert.equal(find('hook', 'Grep', 'dedupe').rawBytes, 800);
  assert.deepEqual(find('run', 'test', 'ok'), { source: 'run', tool: 'test', method: 'ok', calls: 2, rawBytes: 10000, outBytes: 150 });
  assert.equal(s.entries.length, 3);
  assert.deepEqual(s.sessions.sort(), ['claude:s1', 'claude:s2']);
  assert.deepEqual(readSavings({ HOME: tmp('yaw-empty-') }), { entries: [], sessions: [] });
});

test('savings table shows rawBytes and outBytes per tool and method with tokens labelled as estimates', () => {
  const list = savingsRows(readSavings(logs()).entries);
  assert.deepEqual(list.map((r) => [r.source, r.tool, r.method, r.rawBytes, r.outBytes]), [['run', 'test', 'ok', 10000, 150], ['hook', 'Bash', 'cap', 6000, 2000], ['hook', 'Grep', 'dedupe', 800, 400]]);
  assert.equal(list[1].savedBytes, 4000); assert.equal(list[1].estTokensSaved, 1000);
  const t = savingsTable(readSavings(logs()).entries, fake);
  assert.deepEqual(t.cols.map((c) => c.label), ['Source', 'Tool or step', 'Method', 'Results', 'rawBytes', 'outBytes', 'Saved', 'Est. tokens saved']);
  assert.match(t.options.note, /estimate/i); assert.match(t.options.note, /bytes \/ 4/);
  assert.deepEqual(savingsRows([]), []);
});

test('A/B comparison uses stored per-session tokensIn and re-run counts, and invents nothing without data', () => {
  const rows = [
    { project: '/p', compressed: true, tokensIn: 100, toolOutput: { tools: {}, commands: {}, verbose: 2 } },
    { project: '/p', compressed: true, tokensIn: 300, toolOutput: { tools: {}, commands: {} } },
    { project: '/p', compressed: false, tokensIn: 1000, toolOutput: null },
    { project: '/p', compressed: false, tokensIn: null, toolOutput: null },
    { project: '/q', compressed: true, tokensIn: null, toolOutput: null },
  ];
  const by = (list, project, on) => list.find((r) => r.project === project && r.on === on);
  const list = abRows(rows);
  assert.deepEqual([by(list, '/p', true).sessions, by(list, '/p', true).meanTokensIn, by(list, '/p', true).reruns, by(list, '/p', true).rerunsPerSession], [2, 200, 2, 1]);
  assert.deepEqual([by(list, '/p', false).sessions, by(list, '/p', false).meanTokensIn, by(list, '/p', false).reruns], [2, 1000, null]);
  assert.equal(by(list, '/q', true).meanTokensIn, null);
  assert.equal(by(list, '/q', false), undefined);
  assert.deepEqual(abRows([]), []);
  const t = abTable(rows, fake);
  assert.match(t.options.note, /same kind of task/i); assert.match(t.options.note, /needs data|no (real )?comparison/i);
  assert.equal(abTable([], fake).options.note.length > 0, true);
});

test('a scan counts YAW_VERBOSE=1 Bash re-runs without storing command text', async () => {
  const root = tmp();
  const file = join(root, 's.jsonl');
  const use = (id, command) => ({ type: 'assistant', message: { id: `m${id}`, content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } });
  const res = (id) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'x' }] } });
  writeTree(root, { 's.jsonl': jsonl(use('a', 'YAW_VERBOSE=1 npm test'), res('a'), use('b', 'npm test'), res('b'), use('c', 'FOO=1 YAW_VERBOSE=1 git log'), res('c'), use('d', 'echo YAW_VERBOSE=1'), res('d')) });
  const t = (await readTurns(file, 'claude')).tools;
  assert.equal(t.verbose, 2);
  assert.doesNotMatch(JSON.stringify(t), /FOO|log/);
  const none = writeTree(root, { 'n.jsonl': jsonl(use('a', 'ls'), res('a')) });
  assert.equal((await readTurns(join(root, 'n.jsonl'), 'claude')).tools.verbose, undefined);
  assert.equal(sessionRows([{ id: 'x', started: ts, toolOutput: { tools: {}, commands: {}, verbose: 1 }, compressed: true }]).rows[0].compressed, true);
});
