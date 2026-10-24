import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profileSessions } from '../core/web/session-profile.js';

const now = new Date('2026-10-24T12:00:00Z');
const rows = [
  { id: 'codex:one', agent: 'codex', project: '/a', model: 'alpha', started: '2026-10-23T10:00:00Z', ended: '2026-10-23T11:00:00Z', tokens_in: 500, tokens_out: 100, cost_usd: null },
  { id: 'claude:two', agent: 'claude', project: '/b', model: 'beta', started: '2026-10-22T09:00:00Z', ended: '2026-10-22T09:30:00Z', tokens_in: 300, tokens_out: 50, cost_usd: 0, source: 'import' },
  { id: 'codex:three', agent: 'codex', project: '/b', model: null, started: '2026-10-01T08:00:00Z', ended: null, tokens_in: null, tokens_out: null, cost_usd: null },
  { id: 'claude:old', agent: 'claude', project: '/a', model: 'alpha', started: '2025-01-01T08:00:00Z', ended: '2025-01-01T09:00:00Z', tokens_in: 900, tokens_out: 200, cost_usd: 1.25 },
];

test('profiling: aggregates and coverage use the same project, agent, model and date selection', () => {
  const all = profileSessions(rows, new URLSearchParams({ days: '30' }), now);
  assert.equal(all.summary.sessions, 3);
  assert.equal(all.summary.minutes, 90);
  assert.equal(all.summary.tokensIn, 800);
  assert.equal(all.summary.tokensOut, 150);
  assert.equal(all.summary.usageKnown, 2);
  assert.equal(all.summary.costKnown, 1, 'a reported zero is known, missing cost is unknown');
  assert.equal(all.summary.durationKnown, 2);
  assert.equal(all.recent.find((r) => r.id === 'codex:three').tokensIn, null);
  assert.equal(all.recent.find((r) => r.id === 'codex:three').minutes, null);
  assert.deepEqual(all.options.model, ['Unknown', 'alpha', 'beta']);
  const selected = profileSessions(rows, new URLSearchParams({ project: '/b', agent: 'claude', model: 'beta', days: '7' }), now);
  assert.equal(selected.summary.sessions, 1);
  assert.equal(selected.summary.costUsd, 0);
  assert.deepEqual(selected.projects.map((r) => r.name), ['/b']);
  assert.deepEqual(selected.models.map((r) => r.name), ['beta']);
  assert.deepEqual(selected.activity, [{ day: '2026-10-22', sessions: 1 }]);
  assert.equal(selected.recent[0].source, 'Imported');
  assert.equal(profileSessions(rows, new URLSearchParams({ days: 'all' }), now).summary.sessions, 4);
});

test('profiling: unknown model, empty selections, invalid dates and bounded recent rows', () => {
  const unknown = profileSessions(rows, new URLSearchParams({ model: 'Unknown' }), now);
  assert.equal(unknown.summary.sessions, 1);
  assert.equal(unknown.summary.usageKnown, 0);
  assert.equal(profileSessions(rows, new URLSearchParams({ project: 'absent' }), now).recent.length, 0);
  assert.throws(() => profileSessions(rows, new URLSearchParams({ days: 'garbage' }), now), /Choose/);
  const large = Array.from({ length: 150 }, (_, n) => ({ ...rows[0], id: `codex:${n}` }));
  const result = profileSessions(large, new URLSearchParams({ days: 'all' }), now);
  assert.equal(result.summary.sessions, 150);
  assert.equal(result.recent.length, 50, 'only the display list is truncated, not aggregates');
  assert.equal(result.models[0].sessions, 150);
});


test('profiling: all history by default; sorting happens before pagination and reaches every session', () => {
  assert.equal(profileSessions(rows, new URLSearchParams(), now).summary.sessions, 4);
  const large = Array.from({ length: 151 }, (_, n) => ({ ...rows[0], id: `codex:${String(n).padStart(3, '0')}`, project: n < 80 ? '/z' : '/a', agent: n % 2 ? 'codex' : 'claude' }));
  const first = profileSessions(large, new URLSearchParams({ sort: 'project', direction: 'asc' }), now);
  assert.ok(first.recent.every((r) => r.project === '/a'));
  assert.equal(first.pagination.pages, 4);
  const ids = new Set();
  for (let page = 1; page <= 4; page++) {
    const result = profileSessions(large, new URLSearchParams({ sort: 'agent', direction: 'asc', page: String(page) }), now);
    result.recent.forEach((r) => ids.add(r.id));
    assert.equal(result.summary.sessions, 151);
  }
  assert.equal(ids.size, 151);
  assert.equal(profileSessions(rows, new URLSearchParams({ sort: 'cost', direction: 'desc' }), now).recent.at(-1).costUsd, null);
  assert.throws(() => profileSessions(rows, new URLSearchParams({ sort: '__proto__' }), now), /Invalid session sort/);
});
