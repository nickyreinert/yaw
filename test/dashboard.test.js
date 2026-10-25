// yaw web (#172): the read-only dashboard data and its server.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dashboardData, startDashboard } from '../core/web/dashboard.js';
import { realRoot, registryFile, withRegistry } from '../modules/sessions/lib/registry.js';
import { main } from '../core/cli/main.js';
import { makeProject } from './helpers/hooks.js';
import { KIT_ROOT, capture, tmp } from './helpers/fixtures.js';

const home = () => {
  const dir = join(tmp('yaw-home-'), '.yaw');
  mkdirSync(dir, { mode: 0o700 });
  return { HOME: join(dir, '..'), YAW_HOME: dir };
};

const TASKS = '# Tasks\n\n## Active\n\n### T-001 Build the parser — in progress (40 %)\n\n## Backlog\n\n- T-002 Write docs — later\n';

test('dashboard data: project facts, tasks, and session stats for this project and all projects', async () => {
  const root = await makeProject({ modules: ['core', 'security'] });
  writeFileSync(join(root, 'TASKS.md'), TASKS);
  const env = home();
  const project = realRoot(root);
  withRegistry(env, (db) => {
    const add = db.prepare('INSERT INTO sessions (id, agent, project, title, started, ended, branch) VALUES (?, ?, ?, ?, ?, ?, ?)');
    add.run('claude:a1', 'claude', project, 'Parser \u001b[31mwork', '2026-10-20T10:00:00.000Z', '2026-10-20T11:30:00.000Z', 'feat/T-001-parser');
    add.run('codex:b2', 'codex', project, 'Docs', '2026-10-21T09:00:00.000Z', '2026-10-21T09:20:00.000Z', 'main');
    add.run('claude:c3', 'claude', '/elsewhere', 'Other', '2026-10-22T09:00:00.000Z', null, 'main');
    db.prepare("INSERT INTO session_links (session_id, kind, ref) VALUES ('claude:a1', 'commit', 'abc1234'), ('claude:a1', 'task', 'T-001')").run();
    db.prepare("UPDATE sessions SET model = 'opus', tokens_in = 1000, tokens_out = 200, cost_usd = 1.5 WHERE id = 'claude:a1'").run();
  });
  const data = await dashboardData({ root, kitRoot: KIT_ROOT, env, now: new Date('2026-10-23T00:00:00Z') });
  assert.equal(data.project.profiles[0], 'node-cli');
  assert.deepEqual(data.project.modules, ['core', 'security']);
  assert.deepEqual(data.tasks.active, [{ id: 'T-001', issue: undefined, title: 'Build the parser', status: 'in progress', progress: 40 }]);
  assert.equal(data.tasks.backlog[0].note, 'later');
  assert.deepEqual(data.decisions, { available: false });
  const mine = data.sessions.project;
  assert.equal(mine.sessions, 2);
  assert.equal(mine.minutes, 110);
  assert.deepEqual(mine.byAgent, { claude: { sessions: 1, minutes: 90, tokens: 1200 }, codex: { sessions: 1, minutes: 20 } });
  assert.equal(mine.tokens, 1200);
  assert.equal(mine.costUsd, 1.5);
  assert.equal(mine.recent[1].model, 'opus');
  assert.equal(mine.recent[0].id, 'codex:b2');
  assert.equal(mine.recent[1].commits, 1);
  assert.equal(mine.recent[1].tasks, 1);
  assert.doesNotMatch(mine.recent[1].title, /\u001b/, 'terminal controls are removed');
  assert.equal(data.sessions.all.sessions, 3);
  assert.equal(data.sessions.all.projects.length, 2);
  assert.deepEqual(data.sessions.all.last30Days, { '2026-10-20': 1, '2026-10-21': 1, '2026-10-22': 1 });
});

test('dashboard data: a missing registry is reported and never created; a broken TASKS.md does not hide the rest', async () => {
  const root = await makeProject({ modules: ['core'] });
  writeFileSync(join(root, 'TASKS.md'), 'not a ledger\n');
  const env = home();
  const data = await dashboardData({ root, kitRoot: KIT_ROOT, env });
  assert.deepEqual(data.sessions, { available: false });
  assert.equal(existsSync(registryFile(env)), false);
  assert.match(data.tasks.error, /# Tasks/);
  assert.equal(data.project.name.length > 0, true);
});

test('dashboard server: same authenticated handshake as the form without serving setup-form assets', async () => {
  const root = await makeProject({ modules: ['core'] });
  const s = await startDashboard({ root, kitRoot: KIT_ROOT, env: home(), signals: false });
  try {
    const base = `http://127.0.0.1:${s.port}`;
    assert.equal((await fetch(`${base}/api/dashboard`)).status, 403);
    const cookie = (await fetch(s.url, { redirect: 'manual' })).headers.get('set-cookie').split(';')[0];
    const page = await fetch(`${base}/`, { headers: { cookie } });
    assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
    assert.match(await page.text(), /<title>YAW dashboard<\/title>/);
    assert.equal((await fetch(`${base}/dashboard.js`, { headers: { cookie } })).status, 200);
    assert.equal((await fetch(`${base}/app.js`, { headers: { cookie } })).status, 404, 'the setup form is not served');
    const api = await fetch(`${base}/api/dashboard`, { headers: { cookie } });
    assert.equal(api.status, 200);
    assert.deepEqual((await api.json()).sessions, { available: false });
    const post = await fetch(`${base}/api/apply`, { method: 'POST', headers: { cookie, origin: base, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(post.status, 403);
  } finally {
    await s.close();
  }
});

test('yaw web: the dashboard opens without a setup prompt in an uninitialized project folder', async () => {
  const root = await makeProject({ modules: ['core'] });
  const env = home();
  const run = async (cwd, prompter) => {
    const stdout = capture();
    let url;
    const running = main(['web'], { cwd, env, kitRoot: KIT_ROOT, stdout, stderr: capture(), prompter, openBrowser: async (u) => { url = u; return true; } });
    for (let i = 0; i < 50 && !url; i++) await new Promise((r) => setTimeout(r, 20));
    const cookie = (await fetch(url, { redirect: 'manual' })).headers.get('set-cookie').split(';')[0];
    const title = (await (await fetch(new URL('/', url), { headers: { cookie } })).text()).match(/<title>(.*)<\/title>/)[1];
    process.emit('SIGINT');
    assert.equal(await running, 0);
    return { title, out: stdout.text() };
  };
  const dash = await run(root);
  assert.equal(dash.title, 'YAW dashboard');
  assert.match(dash.out, /YAW dashboard \(local only\)\. Switch projects/);
  const parent = tmp('yaw-projects-');
  mkdirSync(join(parent, 'project-one', '.git'), { recursive: true });
  mkdirSync(join(parent, 'project-two', '.git'), { recursive: true });
  const asked = [];
  const prompter = { interactive: true, ask: async (question) => { asked.push(question); return 'n'; } };
  const web = await run(parent, prompter);
  assert.equal(web.title, 'YAW dashboard');
  assert.match(web.out, /opening the dashboard without changing files/);
  assert.deepEqual(asked, [], 'yaw web does not ask to initialize a folder of projects');
  const help = capture();
  await main(['help'], { cwd: root, env, kitRoot: KIT_ROOT, stdout: help, stderr: capture() });
  assert.match(help.text(), /^ {2}web {2,}open the local dashboard/m);
});
