// Knowledge editing (ADR-0053): the shared store, `yaw knowledge`, and the dashboard actions with project switching.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { contentHash, removeKnowledge, saveKnowledge } from '../core/lib/knowledge-store.js';
import { startDashboard } from '../core/web/dashboard.js';
import { main } from '../core/cli/main.js';
import { makeProject } from './helpers/hooks.js';
import { KIT_ROOT, capture, tmp } from './helpers/fixtures.js';

const home = () => {
  const dir = join(tmp('yaw-kstore-home-'), '.yaw');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return { HOME: join(dir, '..'), YAW_HOME: dir };
};
const put = (path, text) => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, text); };
const fakeToken = () => `ghp_${'a1B2'.repeat(9)}`;

test('knowledge store: creates global and project records, edits with a hash check, deletes only when confirmed', async () => {
  const root = await makeProject({ modules: ['core'] }), env = home(), ctx = { root, kitRoot: KIT_ROOT, env };
  const user = await saveKnowledge({ ...ctx, input: { source: 'user-knowledge', title: 'Prefer uv', type: 'rule', tags: ['python'], body: 'Use uv.' } });
  assert.equal(user.key, 'user-knowledge:personal/prefer-uv.md');
  const userFile = join(env.YAW_HOME, 'knowledge', 'personal', 'prefer-uv.md');
  assert.match(readFileSync(userFile, 'utf8'), /type: rule[\s\S]*# Prefer uv[\s\S]*Use uv\./);
  assert.equal(statSync(userFile).mode & 0o777, 0o600);
  const project = await saveKnowledge({ ...ctx, input: { source: 'project-knowledge', title: 'API notes', body: 'Paginate.' } });
  assert.ok(existsSync(join(root, 'docs', 'knowledge', 'api-notes.md')));
  assert.equal((await saveKnowledge({ ...ctx, input: { source: 'project-knowledge', title: 'API notes', body: 'again' } })).key, 'project-knowledge:api-notes-2.md', 'never overwrites');
  await assert.rejects(saveKnowledge({ ...ctx, input: { source: 'project-knowledge', title: 'X', namespace: 'n', body: 'b' } }), /global knowledge only/);
  await assert.rejects(saveKnowledge({ ...ctx, input: { source: 'decisions', title: 'X', body: 'b' } }), /yaw decisions record/);

  const before = readFileSync(userFile, 'utf8');
  await assert.rejects(saveKnowledge({ ...ctx, input: { key: user.key, expected: 'stale', content: `${before}\nMore.` } }), (e) => e.status === 409);
  const saved = await saveKnowledge({ ...ctx, input: { key: user.key, expected: contentHash(before), content: `${before}\nMore.` } });
  assert.match(saved.message, /Saved ~\/\.yaw\/knowledge\/personal\/prefer-uv\.md/);
  assert.match(readFileSync(userFile, 'utf8'), /More\.$/);

  const current = contentHash(readFileSync(join(root, 'docs', 'knowledge', 'api-notes.md'), 'utf8'));
  await assert.rejects(removeKnowledge({ ...ctx, input: { key: project.key, expected: current } }), /Confirm/);
  await removeKnowledge({ ...ctx, input: { key: project.key, expected: current, confirm: true } });
  assert.equal(existsSync(join(root, 'docs', 'knowledge', 'api-notes.md')), false);
});

test('knowledge store: refuses secrets, secret file names, links, and paths outside the sources', async () => {
  const root = await makeProject({ modules: ['core'] }), env = home(), ctx = { root, kitRoot: KIT_ROOT, env };
  await assert.rejects(saveKnowledge({ ...ctx, input: { source: 'user-knowledge', title: 'Leak', body: `token ${fakeToken()}` } }), /secret/);
  assert.equal(existsSync(join(env.YAW_HOME, 'knowledge', 'personal', 'leak.md')), false);
  for (const key of ['project-knowledge:../escape.md', 'project-knowledge:/etc/passwd.md', 'project-knowledge:notes.txt', 'nope:a.md']) {
    await assert.rejects(saveKnowledge({ ...ctx, input: { key, expected: 'x', content: 'x' } }), Error, key);
  }
  const outside = tmp('yaw-kstore-outside-');
  writeFileSync(join(outside, 'target.md'), '# Outside\n');
  mkdirSync(join(root, 'docs', 'knowledge'), { recursive: true });
  symlinkSync(join(outside, 'target.md'), join(root, 'docs', 'knowledge', 'link.md'));
  const hash = contentHash('# Outside\n');
  await assert.rejects(saveKnowledge({ ...ctx, input: { key: 'project-knowledge:link.md', expected: hash, content: '# Changed\n' } }), /symbolic link/);
  await assert.rejects(removeKnowledge({ ...ctx, input: { key: 'project-knowledge:link.md', expected: hash, confirm: true } }), /symbolic link/);
  assert.equal(readFileSync(join(outside, 'target.md'), 'utf8'), '# Outside\n');
});

test('knowledge store: editing an ADR rebuilds the decision index', async () => {
  const root = await makeProject({ modules: ['core', 'decisions'] }), env = home(), ctx = { root, kitRoot: KIT_ROOT, env };
  const adr = '# ADR-0001: Use SQLite\n\n- **Status:** Accepted\n- **Date:** 2026-01-01\n- **Category:** Storage / Database\n\n## Context\n\nLocal data.\n\n## Decision\n\nUse SQLite.\n\n## Consequences\n\nOne file.\n';
  put(join(root, '.decisions', 'ADR-0001.md'), adr);
  const result = await saveKnowledge({ ...ctx, input: { key: 'decisions:ADR-0001.md', expected: contentHash(adr), content: adr.replace('Use SQLite.\n', 'Use SQLite with WAL.\n') } });
  assert.match(result.message, /Decision index rebuilt/);
  assert.match(readFileSync(join(root, '.decisions', 'ADR-0001.md'), 'utf8'), /WAL/);
});

test('yaw knowledge: list, show, add, edit from a file, and remove with --yes', async () => {
  const root = await makeProject({ modules: ['core'] }), env = home();
  const run = async (...args) => {
    const stdout = capture(), stderr = capture();
    const code = await main(['knowledge', ...args], { cwd: root, env, kitRoot: KIT_ROOT, stdout, stderr, prompter: { interactive: false } });
    return { code, out: stdout.text(), err: stderr.text() };
  };
  assert.equal((await run('add', 'Prefer uv', '--global', '--type', 'rule', '--tag', 'python', '--body', 'Use uv.')).code, 0);
  assert.equal((await run('add', 'API notes', '--body', 'Paginate.')).code, 0);
  const leak = await run('add', 'Leak', '--global', '--body', fakeToken());
  assert.notEqual(leak.code, 0); assert.match(leak.err, /secret/);
  const list = await run('list');
  assert.match(list.out, /Prefer uv/); assert.match(list.out, /API notes/);
  assert.doesNotMatch((await run('list', '--project')).out, /Prefer uv/);
  assert.match((await run('show', 'prefer-uv')).out, /Use uv\./);
  const file = join(tmp('yaw-kstore-edit-'), 'new.md');
  writeFileSync(file, '# API notes\n\nPaginate with cursors.\n');
  assert.equal((await run('edit', 'api-notes', '--file', file)).code, 0);
  assert.match(readFileSync(join(root, 'docs', 'knowledge', 'api-notes.md'), 'utf8'), /cursors/);
  const refused = await run('remove', 'api-notes');
  assert.notEqual(refused.code, 0);
  assert.ok(existsSync(join(root, 'docs', 'knowledge', 'api-notes.md')), 'not deleted without confirmation');
  assert.equal((await run('remove', 'api-notes', '--yes')).code, 0);
  assert.equal(existsSync(join(root, 'docs', 'knowledge', 'api-notes.md')), false);
});

test('dashboard: knowledge actions need the CSRF token and run against the selected project; unknown projects are refused', async () => {
  const a = await makeProject({ modules: ['core'] }), b = await makeProject({ modules: ['core'] }), env = home();
  const plain = tmp('yaw-kstore-plain-');
  const s = await startDashboard({ root: a, kitRoot: KIT_ROOT, env, signals: false });
  try {
    const base = `http://127.0.0.1:${s.port}`;
    const cookie = (await fetch(s.url, { redirect: 'manual' })).headers.get('set-cookie').split(';')[0];
    const csrf = (await (await fetch(`${base}/`, { headers: { cookie } })).text()).match(/name="yaw-csrf" content="([a-f0-9]+)"/)[1];
    const post = (name, input, token = csrf) => fetch(`${base}/api/${name}`, {
      method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json', ...(token ? { 'x-yaw-token': token } : {}) }, body: JSON.stringify(input),
    });
    const record = { source: 'project-knowledge', title: 'B only', body: 'For project B.' };
    assert.equal((await post('knowledge-save', { record }, null)).status, 403);
    assert.equal((await post('project-add', { path: plain })).status, 400, 'folders without a YAW setup are refused');
    assert.equal((await post('knowledge-save', { record, workspace: b })).status, 404, 'unknown projects are refused');
    const added = await post('project-add', { path: b });
    assert.equal(added.status, 200);
    const workspace = (await added.json()).root;
    const listed = await (await fetch(`${base}/api/projects`, { headers: { cookie } })).json();
    assert.deepEqual(listed.projects.map((p) => p.root).sort(), [workspace, listed.current].sort());
    assert.equal((await post('knowledge-save', { record, workspace })).status, 200);
    assert.ok(existsSync(join(b, 'docs', 'knowledge', 'b-only.md')));
    assert.equal(existsSync(join(a, 'docs', 'knowledge', 'b-only.md')), false);
    const knowledge = await (await fetch(`${base}/api/knowledge?${new URLSearchParams({ workspace, scope: 'project' })}`, { headers: { cookie } })).json();
    assert.deepEqual(knowledge.entries.map((r) => r.title), ['B only']);
    assert.equal((await fetch(`${base}/api/dashboard?workspace=${encodeURIComponent(plain)}`, { headers: { cookie } })).status, 404);
  } finally {
    await s.close();
  }
});
