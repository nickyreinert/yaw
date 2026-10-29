import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync, existsSync, readFileSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { tmp, KIT_ROOT, cleanEnv } from './helpers/fixtures.js';
import { remoteSettings, saveRemoteSettings } from '../core/lib/remote-settings.js';
import { readUserData, writeUserData, writeUserProfile, saveSetup } from '../core/lib/user-store.js';
import { startHostServer } from '../core/remote/host.js';
import { lanOrigin, lanFetch, privateAddress } from '../core/remote/lan.js';
import { digest } from '../core/remote/store.js';
import { NativeAgents } from '../core/remote/native-agent.js';
import { HostTelegram } from '../core/remote/host-telegram.js';
import { connectClient } from '../core/remote/server-client.js';
import { hostInit } from '../core/cli/host-init.js';
import { saveSetupDefaults } from '../core/lib/setup-defaults.js';
import { capture, writeAnswers } from './helpers/fixtures.js';
import { stringify } from '../core/lib/yaml.js';
import { syncedSessions } from '../core/lib/data-sync.js';
import { backgroundControl, startServerBackground } from '../core/remote/background.js';
import { hostRequest } from '../core/remote/server-client.js';

function fixtureSpawn() {
  const children = [], plans = [];
  const spawnFn = (command, args, options) => {
    const child = new EventEmitter(); Object.assign(child, { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill() { queueMicrotask(() => child.emit('close', 0)); } });
    children.push(child); plans.push({ command, args, options }); return child;
  };
  return { children, plans, spawnFn };
}
async function setup(options = {}) {
  const home = realpathSync(tmp('yaw-host-home-')), base = realpathSync(tmp('yaw-host-work-')), env = { ...cleanEnv(home), PATH: process.env.PATH };
  const settings = { enabled: true, role: 'host', port: 4318, bindAddress: '127.0.0.1', workspaceRoot: join(base, 'workspaces') };
  saveRemoteSettings(env, settings, { root: base, confirmWorkspace: true });
  const spawned = fixtureSpawn();
  const service = await startHostServer({ env, kitRoot: KIT_ROOT, port: 0, signals: false, spawnFn: spawned.spawnFn, verify: async () => true, ...options });
  const runtime = readUserData(env, 'server-runtime.json');
  const request = async (path, input, headers = {}) => {
    const r = await fetch(service.address + path, { method: input === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${runtime.token}`, ...(input === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, ...(input === undefined ? {} : { body: JSON.stringify(input) }), redirect: 'manual' });
    return { status: r.status, body: await r.json() };
  };
  return { env, base, settings, service, spawned, request, async close() { await service.close(); } };
}
const input = { mode: 'quick', answers: { 'user.agents': ['claude'], 'idea.text': 'A local project for testing hosted setup.', 'idea.team': 'solo', 'arch.language': 'javascript', 'arch.runs-on': 'local', 'tasks.use-github': false }, modules: ['core'], gitInit: false };

test('host selection requires exact workspace confirmation; LAN transport refuses public targets', async () => {
  const env = cleanEnv(realpathSync(tmp())), root = realpathSync(tmp());
  const settings = { enabled: true, port: 4318, role: 'host', workspaceRoot: join(root, 'workspaces'), bindAddress: '127.0.0.1' };
  assert.throws(() => saveRemoteSettings(env, settings), /Confirm/);
  saveRemoteSettings(env, settings, { root, confirmWorkspace: true });
  assert.equal(remoteSettings(env).workspaceRoot, settings.workspaceRoot);
  for (const url of ['http://8.8.8.8:4318', 'https://192.168.0.1', 'http://user:password@127.0.0.1', 'http://127.0.0.1/path', 'http://127.0.0.1/?token=x']) assert.throws(() => lanOrigin(url));
  assert.equal(privateAddress('172.16.1.2'), true); assert.equal(privateAddress('172.32.1.2'), false);
  await assert.rejects(lanFetch('http://8.8.8.8/api/state'), /LAN/);
});

test('host provisioning shares the interview, contains paths, rejects duplicate init, and keeps running after apply', async () => {
  const f = await setup();
  try {
    for (const slug of ['../escape', 'two/levels', '', '-bad', 'a'.repeat(65)]) assert.equal((await f.request('/api/interviews', { slug })).status, 400);
    const created = (await f.request('/api/interviews', { slug: 'sample', command: 'init-local', skipVerify: true })).body;
    const route = `/api/interviews/${created.id}`;
    const catalog = (await f.request(route + '/bootstrap')).body;
    assert.equal(catalog.hosted.command, 'init-local');
    assert.equal(catalog.questions.find((q) => q.id === 'user.agents').choices.length, 1);
    const preview = await f.request(route + '/preview', input); assert.equal(preview.status, 200);
    assert.equal(preview.body.destination, join(f.settings.workspaceRoot, 'javascript', 'sample'));
    assert.equal(existsSync(preview.body.destination), false);
    assert.equal((await f.request(route + '/apply', { ...input, answers: { ...input.answers, 'user.agents': ['claude', 'codex'] } })).status, 400);
    assert.equal((await f.request(route + '/apply', { ...input, secrets: { API_KEY: 'not-a-real-secret' } })).status, 400);
    const result = await f.request(route + '/apply', input); assert.equal(result.status, 200); assert.equal(result.body.ok, true);
    assert.equal(existsSync(join(preview.body.destination, '.yaw/manifest.json')), true);
    assert.equal(f.spawned.plans.length, 1); assert.ok(['python3', '/usr/bin/script'].includes(f.spawned.plans[0].command));
    assert.match(f.spawned.plans[0].args.join(' '), /remote-control.*--spawn=session/);
    assert.equal(f.spawned.plans[0].options.env.YAW_REMOTE_TELEGRAM_TOKEN, undefined);
    assert.equal((await f.request(route + '/apply', input)).status, 409);
    const collision = (await f.request('/api/interviews', { slug: 'sample' })).body;
    assert.equal((await f.request(`/api/interviews/${collision.id}/apply`, input)).status, 409);
    assert.equal((await f.request('/api/state')).status, 200);
    f.spawned.children[0].stdout.write('Trust /new/project? [y/N]');
    assert.equal(f.service.agents.list()[0].state, 'confirmation-required');
    f.service.agents.confirm(result.body.session.id);
    assert.equal(f.spawned.children[0].stdin.read().toString(), 'y\r');
    f.spawned.children[0].stdout.write('https://claude.ai/code/session_123456789\n');
    assert.equal(f.service.agents.list()[0].state, 'ready');
    assert.doesNotMatch(readFileSync(join(f.env.HOME, '.yaw/remote-state.json'), 'utf8'), /Trust \/new/);
  } finally { await f.close(); }
});

test('paired LAN devices have scoped interview access, revocation, and no host controls', async () => {
  const f = await setup();
  try {
    assert.equal((await fetch(f.service.address + '/api/state')).status, 401);
    assert.equal((await f.request('/api/state', undefined, { origin: 'http://attacker.invalid' })).status, 403);
    assert.equal((await f.request('/api/state', undefined, { 'x-forwarded-for': '127.0.0.1' })).status, 403);
    const token = 'a'.repeat(64), authorization = `Bearer ${token}`;
    const pending = await f.request('/api/pair/request', { name: 'Laptop', hash: digest(token) });
    await f.request('/api/pair/approve', { id: pending.body.id });
    assert.equal((await f.request('/api/state', undefined, { authorization })).status, 403);
    assert.equal((await f.request('/api/interviews', { slug: 'remote', command: 'init-local' }, { authorization })).status, 403);
    const created = await f.request('/api/interviews', { slug: 'remote', command: 'init-remote' }, { authorization });
    assert.equal(created.status, 200);
    assert.equal((await f.request(`/api/interviews/${created.body.id}/bootstrap`, undefined, { authorization })).body.hosted.command, 'init-remote');
    assert.equal((await f.request(`/api/interviews/${created.body.id}/bootstrap`)).status, 404);
    await f.request('/api/revoke', { id: pending.body.id });
    assert.equal((await f.request(`/api/interviews/${created.body.id}/bootstrap`, undefined, { authorization })).status, 401);
  } finally { await f.close(); }
});

test('host refuses symlinked language folders and preserves failed verification without launching', async () => {
  const f = await setup({ verify: async () => false });
  try {
    const outside = realpathSync(tmp()); symlinkSync(outside, join(f.settings.workspaceRoot, 'javascript'));
    const s = (await f.request('/api/interviews', { slug: 'no-escape' })).body;
    assert.equal((await f.request(`/api/interviews/${s.id}/apply`, input)).status, 400);
    assert.equal(existsSync(join(outside, 'no-escape')), false);
    const t = (await f.request('/api/interviews', { slug: 'failed-check' })).body;
    const python = { ...input, answers: { ...input.answers, 'arch.language': 'python' } };
    const result = await f.request(`/api/interviews/${t.id}/apply`, python);
    assert.equal(result.body.project.state, 'verification-failed'); assert.equal(f.spawned.plans.length, 0);
  } finally { await f.close(); }
});

test('native lifecycle notifications distinguish response completion and task completion and deduplicate', async () => {
  const f = await setup();
  try {
    const root = join(f.settings.workspaceRoot, 'plain'); mkdirSync(root);
    const session = f.service.agents.start({ id: 'project', slug: 'plain', path: root });
    const token = f.spawned.plans[0].options.env.YAW_NATIVE_TOKEN, messages = [];
    f.service.agents.on('notification', (e) => messages.push(e.text));
    const event = (name, extra = {}) => f.service.agents.event(token, { session: session.id, providerId: 'native-123', event: name, ...extra });
    assert.throws(() => f.service.agents.event('wrong', { session: session.id }), /Unknown native/);
    event('UserPromptSubmit'); event('Stop', { background: true }); assert.equal(messages.length, 0);
    event('Stop'); event('Stop'); event('TaskCompleted');
    assert.deepEqual(messages, ['plain: Response finished', 'plain: Task reported complete']);
    assert.throws(() => f.service.agents.event(token, { session: session.id, providerId: 'other', event: 'Stop' }), /Wrong provider/);
    const settings = JSON.parse(readFileSync(join(root, '.claude/settings.local.json'), 'utf8'));
    assert.equal(settings.hooks.Stop[0].hooks[0].async, undefined);
  } finally { await f.close(); }
});

test('Telegram questionnaires refuse disabled and client environments', async () => {
  const env = cleanEnv(realpathSync(tmp())), agents = new EventEmitter();
  const bot = new HostTelegram({ env, kitRoot: KIT_ROOT, store: { state: { offset: 0 }, save() {} }, agents, projects: {}, token: 'fake' });
  assert.deepEqual(await bot.handle({ update_id: 1 }), { refused: true });
  saveRemoteSettings(env, { enabled: true, port: 4318, role: 'client', address: 'http://127.0.0.1:4318' });
  assert.deepEqual(await bot.handle({ update_id: 2 }), { refused: true });
  await bot.close();
});

test('client pairing syncs defaults, presets and statistics both ways through the LAN hub', async () => {
  const f = await setup();
  const env = cleanEnv(realpathSync(tmp('yaw-client-home-')));
  try {
    saveRemoteSettings(env, { enabled: true, role: 'client', address: f.service.address, port: 4318 });
    writeUserProfile(env, stringify({ answers: { 'user.language': 'en' } }));
    saveSetupDefaults({ env, kitRoot: KIT_ROOT }, { modules: ['tasks'], answers: { 'tasks.use-github': false } });
    saveSetup({ env, kitRoot: KIT_ROOT, mode: 'quick', answers: input.answers, projectRoot: '/test/project', kit: '0.1.0', preset: true, profile: false });
    writeUserData(env, 'session-analysis.json', { rows: [{ id: 'statistic-123', agent: 'claude', started: '2026-10-29T10:00:00Z', ended: '2026-10-29T10:01:00Z', tokens_in: 100, tokens_out: 50 }] });
    assert.equal((await connectClient({ env, kitRoot: KIT_ROOT })).status, 'pending');
    const pending = (await f.request('/api/state')).body.pending;
    await f.request('/api/pair/approve', { id: pending[0].id });
    assert.equal((await connectClient({ env, kitRoot: KIT_ROOT })).status, 'connected');
    const view = f.service.hub.view();
    assert.equal(view.records['settings/profile'].answers['user.language'], 'en');
    assert.deepEqual(view.records['settings/setup-defaults'].modules, ['tasks']);
    assert.ok(Object.keys(view.records).some((k) => k.startsWith('presets/')));
    await f.request('/api/sync', {});
    assert.deepEqual(readUserData(f.env, 'setup-defaults.json').modules, ['tasks']);
    assert.equal(syncedSessions(f.env).length, 1);
    writeUserProfile(f.env, stringify({ answers: { 'user.language': 'de' } }));
    await f.request('/api/sync', {});
    assert.equal((await connectClient({ env, kitRoot: KIT_ROOT })).status, 'connected');
    assert.match(readFileSync(join(env.HOME, '.yaw/user-profile.yaml'), 'utf8'), /de/);
    assert.equal(Object.keys(readUserData(env, 'hub-sync-state.json').devices).length, 2);
  } finally { await f.close(); }
});

test('init-local can run outside the host folder and never initializes its current directory', async () => {
  const f = await setup(), cwd = realpathSync(tmp('yaw-other-cwd-')), stdout = capture(), stderr = capture();
  try {
    const file = writeAnswers(realpathSync(tmp()), stringify({ mode: input.mode, answers: input.answers, proposal: { status: 'confirmed', summary: 'Hosted test', profiles: ['node-cli'], modules: ['core'] } }));
    const result = await hostInit({ local: true, values: { slug: 'from-anywhere', answers: file, yes: true, 'skip-verify': true }, positionals: [], io: { cwd, env: f.env, kitRoot: KIT_ROOT, stdout, stderr, prompter: { interactive: false } } });
    assert.equal(result, 0); assert.equal(existsSync(join(cwd, '.yaw')), false);
    assert.equal(existsSync(join(f.settings.workspaceRoot, 'javascript/from-anywhere/.yaw/manifest.json')), true);
  } finally { await f.close(); }
});

test('background host and client survive launcher disconnect and stop through authenticated local control', { timeout: 20000 }, async () => {
  const env = cleanEnv(realpathSync(tmp('yaw-daemon-host-'))), base = realpathSync(tmp('yaw-daemon-work-'));
  const probe = net.createServer(); await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise((resolve) => probe.close(resolve));
  const settings = { enabled: true, role: 'host', port, bindAddress: '127.0.0.1', workspaceRoot: join(base, 'workspaces') };
  saveRemoteSettings(env, settings, { root: base, confirmWorkspace: true });
  const client = cleanEnv(realpathSync(tmp('yaw-daemon-client-')));
  try {
    const started = await startServerBackground({ env, kitRoot: KIT_ROOT, cwd: base });
    assert.equal(started.role, 'host'); assert.equal((await backgroundControl(env)).address, started.address);
    saveRemoteSettings(client, { enabled: true, role: 'client', port: 4318, address: started.address });
    await startServerBackground({ env: client, kitRoot: KIT_ROOT, cwd: base });
    const request = (path, input) => hostRequest({ env, local: true, path, input });
    let state;
    for (let n = 0; n < 30; n++) { state = await request('/api/state'); if (state.pending.length) break; await new Promise((resolve) => setTimeout(resolve, 50)); }
    assert.equal(state.pending.length, 1);
    await request('/api/pair/approve', { id: state.pending[0].id });
    const refreshed = await backgroundControl(client, 'refresh'); assert.equal(refreshed.connection.status, 'connected');
    assert.equal((await startServerBackground({ env, kitRoot: KIT_ROOT, cwd: base })).address, started.address);
  } finally {
    await backgroundControl(client, 'stop'); await backgroundControl(env, 'stop');
  }
});

test('legacy data-only pairings cannot initialize projects; owner browser actions require CSRF', async () => {
  const f = await setup();
  try {
    const legacy = f.service.hub.pair('Old data client');
    assert.equal((await f.request('/api/interviews', { slug: 'forbidden', command: 'init-remote' }, { authorization: `Bearer ${legacy.token}` })).status, 403);
    const ticket = (await f.request('/api/local-open', {})).body;
    const response = await fetch(ticket.url, { redirect: 'manual' });
    const cookie = response.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(ticket.url, { redirect: 'manual' })).status, 403);
    const state = await (await fetch(f.service.address + '/api/state', { headers: { cookie } })).json();
    const bad = await fetch(f.service.address + '/api/interviews', { method: 'POST', headers: { cookie, 'content-type': 'application/json', origin: f.service.address }, body: JSON.stringify({ slug: 'bad-csrf' }) });
    assert.equal(bad.status, 403);
    const good = await fetch(f.service.address + '/api/interviews', { method: 'POST', headers: { cookie, 'content-type': 'application/json', origin: f.service.address, 'x-yaw-token': state.csrf }, body: JSON.stringify({ slug: 'good-csrf' }) });
    assert.equal(good.status, 200);
  } finally { await f.close(); }
});

test('native launcher uses a real PTY, waits for explicit startup trust and stops its process group', { timeout: 15000, skip: !existsSync('/usr/bin/script') }, async () => {
  const root = realpathSync(tmp('yaw-native-pty-')), executable = join(root, 'fixture-claude');
  writeFileSync(executable, '#!/bin/sh\nprintf "Trust this-project? [y/N]"\nread -r answer\n[ "$answer" = "y" ] || exit 1\nprintf "https://claude.ai/code/fixture_session_123\\n"\nread -r finish\n', { mode: 0o700 });
  const store = { state: { sessions: [] }, save() {} }, env = { ...cleanEnv(realpathSync(tmp())), PATH: process.env.PATH, YAW_CLAUDE_BIN: executable };
  const agents = new NativeAgents({ store, env, kitRoot: KIT_ROOT, address: 'http://127.0.0.1:4318' });
  try {
    const session = agents.start({ id: 'project', path: root, slug: 'pty-test' });
    for (let n = 0; n < 100 && !agents.list()[0].startup; n++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(agents.list()[0].startup, 'workspace'); agents.confirm(session.id);
    for (let n = 0; n < 100 && agents.list()[0].state !== 'ready'; n++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(agents.list()[0].url, 'https://claude.ai/code/fixture_session_123');
    await agents.stop(session.id); assert.equal(agents.list()[0].state, 'stopped');
  } finally { await agents.close(); }
});
