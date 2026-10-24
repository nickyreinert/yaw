import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { knowledgeData } from '../core/web/knowledge.js';
import { mergeHistory } from '../core/web/local-history.js';
import { collectAnalysis } from '../core/lib/session-analysis.js';
import { dashboardData, startDashboard } from '../core/web/dashboard.js';
import { registryFile } from '../modules/sessions/lib/registry.js';
import { existsSync } from 'node:fs';
import { makeProject } from './helpers/hooks.js';
import { KIT_ROOT, tmp } from './helpers/fixtures.js';
const put = (path, text) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, text); };
const fixture = () => {
  const root = tmp('yaw-kb-project-'), home = tmp('yaw-kb-home-');
  return { root, kitRoot: KIT_ROOT, env: { HOME: home, YAW_HOME: join(home, '.yaw'), CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude') } };
};

test('knowledge: scope, namespace, type and content search; details resolve only within the selected scope', () => {
  const f = fixture();
  put(join(f.root, '.decisions', 'ADR-0001.md'), '# ADR-0001: Use local storage\n\n- **Status:** Accepted\n\nIndexedDB rationale.');
  put(join(f.env.YAW_HOME, 'knowledge', 'personal', 'RULE-0001.md'), '---\ntype: rule\ntags: [python]\n---\n# Use uv\n\nUse uv for Python packages.');
  const all = knowledgeData(f); assert.equal(all.total, 2); assert.ok(all.entries.every((r) => !Object.hasOwn(r, 'content')));
  const personal = knowledgeData({ ...f, params: new URLSearchParams({ scope: 'user', namespace: 'personal', type: 'rule', q: 'packages' }) });
  assert.equal(personal.total, 1); assert.equal(personal.entries[0].title, 'Use uv');
  const key = personal.entries[0].key;
  const detail = knowledgeData({ ...f, params: new URLSearchParams({ scope: 'user', record: key }) });
  assert.match(detail.record.content, /Python packages/);
  assert.throws(() => knowledgeData({ ...f, params: new URLSearchParams({ scope: 'project', record: key }) }), /unavailable/);
  assert.throws(() => knowledgeData({ ...f, params: new URLSearchParams({ record: '../../other.md' }) }), /unavailable/);
});

test('knowledge: symlinks, oversized files and secret-like content are never returned; viewing creates no stores', () => {
  const f = fixture(), outside = tmp('yaw-kb-outside-');
  const empty = knowledgeData(f); assert.equal(empty.total, 0); assert.equal(existsSync(f.env.YAW_HOME), false);
  put(join(outside, 'private.md'), '# Outside boundary'); symlinkSync(outside, join(f.root, 'docs'));
  put(join(f.root, '.decisions', 'large.md'), 'x'.repeat(128 * 1024 + 1));
  put(join(f.root, '.decisions', 'secret.md'), '# Secret\n' + 'ghp_' + 'a'.repeat(36));
  symlinkSync(join(outside, 'private.md'), join(f.root, '.decisions', 'link.md'));
  const data = knowledgeData(f); assert.equal(data.total, 0); assert.equal(data.excluded, 3);
  assert.ok(data.sources.filter((s) => s.path.startsWith('docs')).every((s) => s.state === 'blocked'));
  assert.doesNotMatch(JSON.stringify(data), /Outside boundary|ghp_/);
});

test('global metadata merges by session ID and preserves hooked title, project, and link identity', () => {
  const old = { id: 'codex:a', project: '/root', title: 'T-001 Parser', ended: '2026-10-24T10:00:00Z', tokens_in: null };
  const local = { id: 'codex:a', project: '/root/sub', title: '', ended: '2026-10-24T09:00:00Z', tokens_in: 1200 };
  const rows = mergeHistory([old], [local]); assert.equal(rows.length, 1); assert.equal(rows[0].title, old.title); assert.equal(rows[0].project, '/root'); assert.equal(rows[0].ended, old.ended); assert.equal(rows[0].tokens_in, 1200);
});

test('global dashboard only shows native history after an explicit scan, without creating a registry', async () => {
  const f = fixture(), path = join(f.env.CODEX_HOME, 'sessions/2026/10/24/rollout-other.jsonl');
  put(path, [
    { type: 'session_meta', timestamp: '2026-10-24T08:00:00Z', payload: { id: 'other', cwd: '/another/project' } },
    { type: 'event_msg', timestamp: '2026-10-24T09:00:00Z', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 1200, output_tokens: 100 } } } },
  ].map(JSON.stringify).join('\n'));
  assert.deepEqual((await dashboardData({ ...f, params: new URLSearchParams({ history: 'local', 'refresh-history': '1' }) })).sessions, { available: false });
  await collectAnalysis({ ...f, all: true });
  const d = await dashboardData(f);
  assert.equal(d.sessions.all.sessions, 1); assert.equal(d.sessions.profiling.recent[0].project, '/another/project'); assert.equal(d.sessions.profiling.summary.tokensIn, 1200);
  assert.equal(existsSync(registryFile(f.env)), false);
  assert.doesNotMatch(JSON.stringify(d), /rollout-other/);
});

test('knowledge API and brand asset require the existing dashboard session', async (t) => {
  const f = fixture(); f.root = await makeProject({ modules: ['core'] });
  put(join(f.root, 'docs/knowledge/note.md'), '# Architecture note\nSafe content.');
  const s = await startDashboard({ ...f, signals: false }); t.after(() => s.close());
  const base = `http://127.0.0.1:${s.port}`;
  assert.equal((await fetch(`${base}/api/knowledge`)).status, 403);
  const cookie = (await fetch(s.url, { redirect: 'manual' })).headers.get('set-cookie').split(';')[0];
  const response = await fetch(`${base}/api/knowledge?scope=project`, { headers: { cookie } });
  assert.equal(response.status, 200); assert.equal((await response.json()).total, 1);
  assert.equal((await fetch(`${base}/yaw-shark.svg`, { headers: { cookie } })).status, 200);
});
