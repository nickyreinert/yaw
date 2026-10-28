import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overviewMetricItems, summarizeOverview } from '../core/web/assets/overview-metrics.js';
const values = (summary) => Object.fromEntries(overviewMetricItems({ summary, projects: 1, openTasks: 0 }).map(([key, value]) => [key, value]));
test('shared overview distinguishes unknown measurements from reported zero and counts all agents', () => {
  const unknown = summarizeOverview([{ agent: 'codex', tokensIn: null, tokensOut: null, cost: null, minutes: null }]);
  const missing = values(unknown);
  assert.equal(missing.Tokens, '—'); assert.equal(missing['Reported cost'], '—'); assert.equal(missing.Elapsed, '—');
  assert.equal(missing.Sessions, '1'); assert.equal(missing['Open tasks'], '0');
  const reported = summarizeOverview([{ agent: 'codex', tokensIn: 0, tokensOut: 0, cost: 0, minutes: 0 }, { agent: 'claude' }]);
  const known = values(reported);
  assert.equal(known.Tokens, '0'); assert.equal(known['Reported cost'], '$0.00'); assert.equal(known.Elapsed, '0m');
  assert.equal(known.Agents, '2'); assert.equal(reported.costSessions, 1);
});
test('workspace summaries and global rows produce identical cards for identical data', () => {
  const rowSummary = summarizeOverview([{ agent: 'codex', tokensIn: 1000, tokensOut: 200, cost: 1.25, minutes: 90 }]);
  const workspace = { sessions: 1, agents: 1, tokens: 1200, usageSessions: 1, costUsd: 1.25, costSessions: 1, minutes: 90, timedSessions: 1 };
  assert.deepEqual(values(workspace), values(rowSummary));
  assert.equal(values(workspace).Elapsed, '1h 30m');
  assert.equal(values(null).Sessions, '—');
});
