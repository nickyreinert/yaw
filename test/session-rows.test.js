import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ROWS, sessionRows } from '../core/web/session-rows.js';

const rows = [
  { id: 'codex:one', agent: 'codex', project: '/a', model: 'alpha', language: 'python', started: '2026-10-23T10:00:00Z', ended: '2026-10-23T11:00:00Z', tokens_in: 500, tokens_out: 100, cost_usd: null, source: 'local',
    metrics: { prompts: 2, answers: 3, promptChars: 40, answerChars: 900, medianAnswerChars: 250, p95AnswerChars: 500, medianResponseMs: 2349, p95ResponseMs: 8000, responseSamples: 2, limited: false },
    evaluation: { classified: 2, skipped: 0, counts: { outcome: { unknown: 5, fulfilled: 1 } }, evaluated: '2026-10-24T00:00:00Z' } },
  { id: 'claude:two', agent: 'claude', project: '/b', model: 'beta', started: '2026-10-22T09:00:00Z', ended: '2026-10-22T09:30:00Z', tokens_in: 300, tokens_out: 50, cost_usd: 0, source: 'import' },
  { id: 'codex:three', agent: 'codex', project: '/b', model: null, started: '2026-10-24T08:00:00Z', ended: null, tokens_in: null, tokens_out: null, cost_usd: null },
  { id: 'claude:broken', agent: 'claude', project: '/a', started: 'not a date' },
];

test('session rows: newest first, unknown values stay null, no undated rows', () => {
  const out = sessionRows(rows);
  assert.deepEqual(out.rows.map((r) => r.id), ['codex:three', 'codex:one', 'claude:two']);
  assert.equal(out.total, 4); assert.equal(out.undated, 1); assert.equal(out.limited, false);
  const [three, one, two] = out.rows;
  assert.equal(three.model, 'Unknown'); assert.equal(three.minutes, null); assert.equal(three.tokensIn, null); assert.equal(three.prompts, null); assert.equal(three.source, 'hook');
  assert.equal(three.language, 'Unknown'); assert.equal(one.language, 'python');
  assert.equal(three.deviceId, 'local'); assert.equal(three.deviceName, 'This device');
  assert.equal(one.minutes, 60); assert.equal(one.cost, null); assert.equal(one.started, Date.parse('2026-10-23T10:00:00Z'));
  assert.equal(one.medianResp, 2.3); assert.equal(one.answerChars, 900); assert.equal(one.outcome, 'fulfilled', 'a confident label wins over unknown');
  assert.equal(two.cost, 0, 'a reported zero is known'); assert.equal(two.source, 'import'); assert.equal(two.evaluation, null);
});

test('session rows: bounded list', () => {
  const many = Array.from({ length: MAX_ROWS + 5 }, (_, n) => ({ ...rows[1], id: `claude:${n}` }));
  const out = sessionRows(many);
  assert.equal(out.rows.length, MAX_ROWS); assert.equal(out.limited, true); assert.equal(out.total, MAX_ROWS + 5);
});
