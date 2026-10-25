import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, symlinkSync, realpathSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { configureSync, runSync, syncStatus } from '../core/lib/data-sync.js';
import { writeUserData } from '../core/lib/user-store.js';
import { main } from '../core/cli/main.js';
import { createWorkspaceApi } from '../core/web/workspace-api.js';
import { startFormServer } from '../core/web/form-server.js';

const kitRoot = resolve('.');
function pair(scopes) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'yaw-sync-')));
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
  assert.equal((await api.action('sync-run', {})).device.name, 'Renamed');
  assert.equal(api.get['/api/global/sync']().configured, true);
  await assert.rejects(api.action('sync-setup', { target, scopes: [] }), /Scopes/);
});

test('GitHub requires a private repository and publishes only the vault; failed push preserves local records', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'yaw-sync-git-'))), env = { HOME: root };
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
    assert.ok(syncStatus({ env: a }).lastSync);
  } finally { await server.close(); }
});
