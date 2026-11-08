import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync, symlinkSync, realpathSync, renameSync, chmodSync, existsSync } from 'node:fs';
import { tmp as makeTmp } from './helpers/fixtures.js';
import { join, resolve } from 'node:path';
import { configureSync, runSync, syncStatus, syncedSessions } from '../core/lib/data-sync.js';
import { writeUserData } from '../core/lib/user-store.js';
import { main } from '../core/cli/main.js';
import { createWorkspaceApi } from '../core/web/workspace-api.js';
import { startFormServer } from '../core/web/form-server.js';
import { sessionsData } from '../core/web/dashboard.js';

const kitRoot = resolve('.');
const settled = async (api) => {
  for (let i = 0; i < 200; i++) {
    const job = api.get['/api/sync-job']();
    if (job && !['running', 'cancelling'].includes(job.status)) return job;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('sync job did not finish');
};
function pair(scopes) {
  const root = realpathSync(makeTmp('yaw-sync-'));
  const target = join(root, 'NAS'); mkdirSync(target);
  const a = { HOME: join(root, 'laptop') }, b = { HOME: join(root, 'pc') };
  configureSync({ env: a, target, name: 'Laptop', scopes });
  configureSync({ env: b, target, name: 'PC', scopes });
  const run = (env, extra = {}) => runSync({ env, kitRoot, ...extra });
  const preset = (env, language) => {
    mkdirSync(join(env.HOME, '.yaw/presets'), { recursive: true });
    writeFileSync(join(env.HOME, '.yaw/presets/work.yaml'), `name: work\nsource: /private/local/work\nanswers:\n  user.language: ${language}\n`);
  };
  return { target, a, b, run, preset };
}
test('two-way presets: repeat runs, deletion tombstones, and different device homes', () => {
  const { a, b, run, preset } = pair();
  preset(a, 'en'); run(a); run(b);
  assert.match(readFileSync(join(b.HOME, '.yaw/presets/work.yaml'), 'utf8'), /user.language: en/);
  preset(b, 'de'); run(b); run(a);
  assert.match(readFileSync(join(a.HOME, '.yaw/presets/work.yaml'), 'utf8'), /user.language: de/);
  unlinkSync(join(b.HOME, '.yaw/presets/work.yaml')); run(b); run(a); run(b);
  assert.equal(readFileSync(join(a.HOME, '.yaw/sync-state.json'), 'utf8').includes('conflicts'), true);
  assert.throws(() => readFileSync(join(a.HOME, '.yaw/presets/work.yaml')), /ENOENT/);
});
test('concurrent preset edits stop without overwriting either side; explicit resolution converges', () => {
  const { target, a, b, run, preset } = pair();
  preset(a, 'en'); run(a); run(b);
  preset(a, 'de'); preset(b, 'fr'); run(a);
  const before = readFileSync(join(target, 'yaw-sync.json'), 'utf8');
  assert.deepEqual(run(b).conflicts, ['presets/work']);
  assert.equal(readFileSync(join(target, 'yaw-sync.json'), 'utf8'), before);
  assert.match(readFileSync(join(b.HOME, '.yaw/presets/work.yaml'), 'utf8'), /fr/);
  assert.equal(run(b, { resolution: 'remote' }).conflicts.length, 0);
  assert.match(readFileSync(join(b.HOME, '.yaw/presets/work.yaml'), 'utf8'), /de/);
});
test('statistics merge by stable session identity; repeat sync and imported snapshots do not inflate totals', () => {
  const { target, a, b, run } = pair(['statistics']);
  const row = (id, n) => ({ id, project: '/private/project', title: 'Do not export', transcript: '/private/history', tokens_in: n, metrics: { prompts: n, answers: n } });
  writeUserData(a, 'session-analysis.json', { rows: [row('claude:one', 2)] });
  writeUserData(b, 'session-analysis.json', { rows: [row('claude:one', 3), row('codex:two', 4)] });
  run(a); run(b); const result = run(a); run(a);
  assert.equal(result.totals.sessions, 2); assert.equal(result.totals.tokens_in, 7);
  assert.equal(syncStatus({ env: a }).totals.sessions, 2);
  assert.deepEqual(result.devices.map((d) => d.name).sort(), ['Laptop', 'PC']);
  const laptop = result.devices.find((d) => d.name === 'Laptop');
  assert.equal(syncStatus({ env: a, selected: laptop.id }).totals.sessions, 1);
  const exported = readFileSync(join(target, 'yaw-sync.json'), 'utf8');
  for (const text of ['/private/', 'Do not export', 'claude:one', 'transcript']) assert.equal(exported.includes(text), false);
});
test('settings retain local paths while portable defaults converge', () => {
  const { a, b, run } = pair(['settings']);
  for (const [env, path] of [[a, '/Laptop/knowledge'], [b, '/PC/knowledge']]) writeFileSync(join(env.HOME, '.yaw/user-profile.yaml'), `answers:\n  user.language: en\n  user.knowledge-path: ${path}\n`);
  run(a); run(b);
  assert.match(readFileSync(join(b.HOME, '.yaw/user-profile.yaml'), 'utf8'), /\/PC\/knowledge/);
});
test('unselected scopes do not publish presets or settings', () => {
  const { target, a, run, preset } = pair(['statistics']); preset(a, 'en'); run(a);
  assert.deepEqual(JSON.parse(readFileSync(join(target, 'yaw-sync.json'))).records, {});
});
test('symlinks, malicious keys, malformed versions and a busy destination are refused', () => {
  const { target, a, run } = pair();
  const outside = join(a.HOME, 'unrelated.txt'); writeFileSync(outside, 'untouched');
  symlinkSync(outside, join(target, 'yaw-sync.json'));
  assert.throws(() => run(a), /symbolic/); assert.equal(readFileSync(outside, 'utf8'), 'untouched');
  unlinkSync(join(target, 'yaw-sync.json'));
  writeFileSync(join(target, 'yaw-sync.json'), JSON.stringify({ version: 1, records: { '../../outside': null }, devices: {} }));
  assert.throws(() => run(a), /Unknown portable/);
  writeFileSync(join(target, 'yaw-sync.json'), '{"version":99}'); assert.throws(() => run(a), /Unsupported/);
  unlinkSync(join(target, 'yaw-sync.json')); mkdirSync(join(target, '.yaw-sync.lock'));
  assert.throws(() => run(a), /busy/);
});
test('CLI and authenticated workspace API share configuration, sync and device statistics', async () => {
  const { target, a } = pair();
  let out = ''; const io = { env: a, cwd: kitRoot, kitRoot, stdout: { write: (s) => { out += s; } }, stderr: { write: (s) => { out += s; } }, prompter: { close() {} } };
  assert.equal(await main(['sync', 'run'], io), 0); assert.equal(JSON.parse(out).message, 'Sync complete.');
  const api = createWorkspaceApi({ root: kitRoot, kitRoot, env: a });
  await api.action('sync-setup', { target, name: 'Renamed', scopes: ['statistics'] });
  assert.equal((await api.action('sync-run', {})).status, 'running');
  assert.equal((await settled(api)).result.device.name, 'Renamed');
  assert.equal(api.get['/api/global/sync']().configured, true);
  await assert.rejects(api.action('sync-setup', { target, scopes: [] }), /Scopes/);
});

test('GitHub requires a private repository and publishes only the vault; failed push preserves local records', () => {
  const root = realpathSync(makeTmp('yaw-sync-git-')), env = { HOME: root };
  configureSync({ env, github: 'owner/yaw-data', name: 'PC', scopes: ['settings'] });
  const calls = [];
  const execute = (bin, args) => {
    calls.push([bin, args]);
    if (bin === 'gh') return 'true';
    if (args.includes('clone')) {
      const dir = args.at(-1); mkdirSync(join(dir, '.git'), { recursive: true }); writeFileSync(join(dir, '.git/HEAD'), 'ref: refs/heads/main');
      writeFileSync(join(dir, 'yaw-sync.json'), JSON.stringify({ version: 1, records: { 'settings/profile': { answers: { 'user.language': 'de' } } }, devices: {} }));
    }
    if (args.includes('diff')) return 'yaw-sync.json';
    if (args.includes('push')) throw new Error('offline');
    return '';
  };
  assert.throws(() => runSync({ env, kitRoot, execute }), /offline/);
  assert.throws(() => readFileSync(join(root, '.yaw/user-profile.yaml')), /ENOENT/);
  assert.equal(syncStatus({ env }).lastSync, null);
  assert.ok(calls.find(([, args]) => args.includes('commit') && args.includes('--only') && args.at(-1) === 'yaw-sync.json'));
  assert.throws(() => runSync({ env, kitRoot, execute: () => 'false' }), /private/);
});

test('unavailable folder preserves local records and merge base', () => {
  const { target, a, run, preset } = pair(); preset(a, 'en'); run(a);
  const before = readFileSync(join(a.HOME, '.yaw/sync-state.json'), 'utf8');
  renameSync(target, `${target}-offline`);
  assert.throws(() => run(a), /ENOENT/);
  assert.equal(readFileSync(join(a.HOME, '.yaw/sync-state.json'), 'utf8'), before);
  assert.match(readFileSync(join(a.HOME, '.yaw/presets/work.yaml'), 'utf8'), /en/);
});

test('sync HTTP actions require authentication and CSRF; reads never configure or synchronize', async () => {
  const { a } = pair(['statistics']);
  const api = createWorkspaceApi({ root: kitRoot, kitRoot, env: a });
  const server = await startFormServer({ api, get: api.get, signals: false });
  try {
    const base = `http://127.0.0.1:${server.port}`;
    assert.equal((await fetch(`${base}/api/global/sync`)).status, 403);
    const login = await fetch(server.url, { redirect: 'manual' });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(`${base}/api/global/sync`, { headers: { cookie } })).status, 200);
    assert.equal(syncStatus({ env: a }).lastSync, null);
    const headers = { cookie, origin: base, 'content-type': 'application/json' };
    assert.equal((await fetch(`${base}/api/sync-run`, { method: 'POST', headers, body: '{}' })).status, 403);
    const csrf = cookie.slice(cookie.indexOf('=') + 1);
    assert.equal((await fetch(`${base}/api/sync-run`, { method: 'POST', headers: { ...headers, 'x-yaw-token': csrf }, body: '{}' })).status, 200);
    await settled(api);
    assert.ok(syncStatus({ env: a }).lastSync);
  } finally { await server.close(); }
});
test('--sync shortcut: a new machine joins the sync folder and gets the presets before the interview', async () => {
  const { target, a, run, preset } = pair();
  preset(a, 'en'); run(a);
  const fresh = { HOME: join(realpathSync(makeTmp('yaw-fresh-')), 'new') };
  mkdirSync(fresh.HOME, { recursive: true });
  const { syncShortcut } = await import('../core/cli/sync.js');
  let out = '';
  syncShortcut({ spec: target, io: { env: fresh, kitRoot, cwd: process.cwd(), stdout: { write: (t) => { out += t; } } } });
  assert.match(out, /Synced portable settings and presets with/);
  assert.match(readFileSync(join(fresh.HOME, '.yaw/presets/work.yaml'), 'utf8'), /user.language: en/);
  assert.throws(() => syncShortcut({ spec: join(target, 'missing'), io: { env: { HOME: join(fresh.HOME, 'x') }, kitRoot, cwd: process.cwd(), stdout: { write() {} } } }), /--sync .*does not exist/);
});

test('sessions of another device reach the Sessions data with start time, agent and device, never path or title', async () => {
  const { target, a, b, run } = pair(['statistics']);
  const row = (id, agent, started) => ({ id, project: '/private/project', title: 'Do not export', agent, model: 'opus', started, ended: '2026-10-01T10:30:00Z', tokens_in: 5, metrics: { prompts: 2, answers: 3 } });
  writeUserData(b, 'session-analysis.json', { rows: [row('claude:one', 'claude', '2026-10-01T10:00:00Z'), row('codex:two', 'codex', '2026-10-02T10:00:00Z')] });
  writeUserData(a, 'session-analysis.json', { rows: [row('codex:two', 'codex', '2026-10-02T10:00:00Z')], collected: '2026-10-03T00:00:00Z' });
  run(b); run(a);
  assert.equal(syncedSessions(a).length, 2);
  const exported = readFileSync(join(target, 'yaw-sync.json'), 'utf8');
  for (const text of ['/private/', 'Do not export', 'claude:one']) assert.equal(exported.includes(text), false);
  const data = await sessionsData({ root: a.HOME, kitRoot, env: a });
  // codex:two exists on both devices: counted once, as the local copy
  assert.equal(data.rows.length, 2);
  const synced = data.rows.filter((r) => r.source === 'synced');
  assert.equal(synced.length, 1);
  assert.deepEqual([synced[0].agent, synced[0].project, synced[0].minutes, synced[0].model], ['claude', 'synced · PC', 30, 'opus']);
  assert.match(synced[0].deviceId, /^[a-f0-9-]{36}$/);
  assert.equal(synced[0].deviceId, syncedSessions(a)[0].deviceId);
  assert.equal(synced[0].deviceName, 'PC');
  assert.equal(data.rows.find((r) => r.source !== 'synced').deviceId, 'local');
  assert.equal(data.history.synced, 1);
});
test('a vault written by an older version (rows without start time) is still accepted', () => {
  const { target, a, run } = pair(['statistics']);
  run(a);
  const file = join(target, 'yaw-sync.json'), vault = JSON.parse(readFileSync(file, 'utf8'));
  vault.devices['11111111-1111-1111-1111-111111111111'] = { name: 'Mac', updated: new Date().toISOString(), rows: [{ key: 'a'.repeat(64), tokens_in: null, prompts: 1, answers: 2 }] };
  writeFileSync(file, JSON.stringify(vault));
  assert.equal(run(a).totals.sessions, 1);
});

test('global knowledge syncs both ways, with deletions; secrets, links and other files stay local', () => {
  const { target, a, b, run } = pair(['knowledge']);
  const dir = (env) => join(env.HOME, '.yaw/knowledge'); mkdirSync(join(dir(a), 'team'), { recursive: true });
  writeFileSync(join(dir(a), 'team/style.md'), '# Style\nShort sentences.\n');
  writeFileSync(join(dir(a), 'notes.txt'), 'not markdown');
  writeFileSync(join(dir(a), 'leak.md'), '# Leak\nAKIAIOSFODNN7EXAMPLE and -----BEGIN RSA PRIVATE KEY-----\n');
  symlinkSync(join(dir(a), 'notes.txt'), join(dir(a), 'link.md'));
  run(a); run(b);
  assert.equal(readFileSync(join(dir(b), 'team/style.md'), 'utf8'), '# Style\nShort sentences.\n');
  for (const name of ['notes.txt', 'leak.md', 'link.md']) assert.throws(() => readFileSync(join(dir(b), name)), /ENOENT/);
  const vault = readFileSync(join(target, 'yaw-sync.json'), 'utf8');
  for (const text of ['AKIA', 'notes.txt', 'link.md']) assert.equal(vault.includes(text), false);
  unlinkSync(join(dir(b), 'team/style.md')); run(b); run(a);
  assert.throws(() => readFileSync(join(dir(a), 'team/style.md')), /ENOENT/);
});

test('a synced knowledge file that grows too large or turns secret-looking stays put instead of becoming a deletion', () => {
  const { target, a, b, run } = pair(['knowledge']);
  const dir = (env) => join(env.HOME, '.yaw/knowledge'); mkdirSync(dir(a), { recursive: true });
  writeFileSync(join(dir(a), 'big.md'), '# Big\nsmall for now\n');
  writeFileSync(join(dir(a), 'notes.md'), '# Notes\nplain\n');
  run(a); run(b);
  const large = `# Big\n${'x'.repeat(130 * 1024)}\n`, leaked = '# Notes\nAKIAIOSFODNN7EXAMPLE\n';
  writeFileSync(join(dir(a), 'big.md'), large); writeFileSync(join(dir(a), 'notes.md'), leaked);
  assert.deepEqual(run(a).excluded, ['knowledge/big.md', 'knowledge/notes.md']);
  assert.equal(readFileSync(join(dir(a), 'big.md'), 'utf8'), large);
  assert.equal(readFileSync(join(dir(a), 'notes.md'), 'utf8'), leaked);
  const vault = JSON.parse(readFileSync(join(target, 'yaw-sync.json'), 'utf8'));
  assert.equal(vault.records['knowledge/big.md'].text, '# Big\nsmall for now\n');
  assert.equal(vault.records['knowledge/notes.md'].text, '# Notes\nplain\n');
  run(b);
  assert.equal(readFileSync(join(dir(b), 'big.md'), 'utf8'), '# Big\nsmall for now\n');
  assert.equal(readFileSync(join(dir(b), 'notes.md'), 'utf8'), '# Notes\nplain\n');
  // An edit from another device does not overwrite the excluded local file; once portable again, the edits conflict.
  writeFileSync(join(dir(b), 'big.md'), '# Big\nedited on PC\n'); run(b); run(a);
  assert.equal(readFileSync(join(dir(a), 'big.md'), 'utf8'), large);
  writeFileSync(join(dir(a), 'big.md'), '# Big\ntrimmed\n');
  assert.deepEqual(run(a).conflicts, ['knowledge/big.md']);
});

test('task snapshots sync as folder name plus items, appear on the other device only when the scope is on', async () => {
  const { target, a, b, run } = pair(['tasks']);
  const snapshot = { project: '/private/work/Shop', available: true, active: [{ id: 'T-001', issue: 4, title: 'Build cart', status: 'IN PROGRESS', progress: 40 }], backlog: [{ id: 'T-002', issue: null, title: 'Pay', note: 'later' }] };
  writeUserData(b, 'session-analysis.json', { rows: [], tasks: [snapshot, { project: '/x/empty', available: false }] });
  run(b); run(a);
  assert.equal(readFileSync(join(target, 'yaw-sync.json'), 'utf8').includes('/private'), false);
  const data = await sessionsData({ root: a.HOME, kitRoot, env: a });
  const t = data.tasks.find((x) => x.project === 'synced · PC · Shop');
  assert.equal(t.active[0].title, 'Build cart'); assert.equal(t.backlog[0].note, 'later');
  assert.equal(data.tasks.length, 1);
  // scope off: nothing is shown
  configureSync({ env: a, target, scopes: ['presets'] });
  assert.equal((await sessionsData({ root: a.HOME, kitRoot, env: a })).tasks.length, 0);
});

test('tasks and knowledge are opt-in', () => {
  const root = realpathSync(makeTmp('yaw-sync-')), target = join(root, 'NAS'); mkdirSync(target);
  assert.deepEqual(configureSync({ env: { HOME: root }, target }).config.scopes, ['settings', 'presets', 'statistics']);
  assert.throws(() => configureSync({ env: { HOME: join(root, 'x') }, target, scopes: ['nope'] }), /Scopes/);
});

test('Git sync runs as a cancellable job and the event loop keeps serving while a subprocess waits', async () => {
  const root = realpathSync(makeTmp('yaw-sync-job-')), bin = join(root, 'bin'), env = { HOME: join(root, 'home'), PATH: `${bin}:${process.env.PATH}` };
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), `#!/bin/sh\necho $$ > "${join(root, 'gh.pid')}"\nsleep 30\necho true\n`);
  chmodSync(join(bin, 'gh'), 0o755);
  configureSync({ env, github: 'owner/yaw-data', name: 'PC', scopes: ['settings'] });
  const api = createWorkspaceApi({ root: kitRoot, kitRoot, env });
  let ticks = 0; const timer = setInterval(() => { ticks++; }, 10);
  try {
    const started = Date.now();
    assert.equal((await api.action('sync-run', {})).status, 'running');
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(Date.now() - started < 2000 && ticks >= 10, `event loop was blocked (${ticks} ticks)`);
    assert.equal(api.get['/api/global/sync']().configured, true);
    assert.match(api.get['/api/sync-job']().step, /gh/);
    await assert.rejects(api.action('sync-run', {}), /already running/);
    assert.equal((await api.action('sync-cancel', {})).status, 'cancelling');
    const job = await settled(api);
    assert.equal(job.status, 'cancelled');
    assert.equal(syncStatus({ env }).lastSync, null);
    assert.equal(existsSync(join(env.HOME, '.yaw/sync.lock')), false);
    assert.throws(() => process.kill(Number(readFileSync(join(root, 'gh.pid'), 'utf8')), 0), /ESRCH/);
  } finally { clearInterval(timer); api.close(); }
});
