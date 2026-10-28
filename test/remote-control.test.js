import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { tmp, KIT_ROOT } from './helpers/fixtures.js';
import { makeProject } from './helpers/hooks.js';
import { remoteStore } from '../core/remote/store.js';
import { Supervisor } from '../core/remote/supervisor.js';
import { createHub } from '../core/remote/hub.js';
import { configureHubClient, syncHub } from '../core/remote/client.js';
import { configureSync, runSync } from '../core/lib/data-sync.js';
import { readUserData } from '../core/lib/user-store.js';
import { startRemoteServer } from '../core/remote/server.js';
import { TelegramController } from '../core/remote/telegram.js';
import { JsonPeer } from '../core/remote/rpc.js';
import { claudeAdapter } from '../core/remote/claude-adapter.js';
import { codexAdapter } from '../core/remote/codex-adapter.js';
import { sandboxPlan } from '../core/remote/adapters.js';

const environment = () => ({ HOME: realpathSync(tmp('yaw-remote-')), PATH: process.env.PATH });
function fixtureAdapter() {
  const instances = [];
  return { instances, capabilities: { input: true, resume: true, approvals: true, interrupt: true }, async start(context) {
    const w = { context, sent: [], stops: 0, async send(prompt) { this.sent.push(prompt); context.onEvent({ type: 'session', id: `native-${instances.length}` }); },
      async interrupt() { context.onEvent({ type: 'done' }); }, async stop() { this.stops++; } };
    instances.push(w); return w;
  } };
}
async function setup() {
  const env = environment(), store = remoteStore(env), adapter = fixtureAdapter();
  const supervisor = new Supervisor({ store, adapters: { claude: adapter, codex: adapter } });
  const project = supervisor.register(await makeProject({ modules: ['core'] }));
  return { env, store, adapter, supervisor, project, async close() { await supervisor.close(); store.close(); } };
}
const startInput = (project, extra = {}) => ({ action: 'new', commandId: 'command-0001', project: project.id, agent: 'claude', prompt: 'A private prompt that must stay out of metadata', ...extra });

test('remote supervisor routes exact sessions, deduplicates commands, owns workspaces and persists no content', async () => {
  const f = await setup();
  try {
    const input = startInput(f.project), receipt = await f.supervisor.command(input);
    assert.equal(receipt.status, 'dispatched');
    assert.equal((await f.supervisor.command(input)).duplicate, true);
    assert.equal(f.adapter.instances.length, 1);
    await assert.rejects(f.supervisor.command({ ...input, prompt: 'different' }), /already used/);
    await assert.rejects(f.supervisor.command({ ...input, commandId: 'command-0002' }), /managed writer/);
    await assert.rejects(f.supervisor.command({ action: 'send', commandId: 'command-0003', session: receipt.session, prompt: 'busy prompt' }), /busy/);
    f.adapter.instances[0].context.onEvent({ type: 'message', role: 'assistant', text: 'Private assistant output' });
    f.adapter.instances[0].context.onEvent({ type: 'done' });
    await f.supervisor.command({ action: 'send', commandId: 'command-0004', session: receipt.session, prompt: 'Follow up' });
    assert.deepEqual(f.adapter.instances[0].sent, [input.prompt, 'Follow up']);
    const stored = readFileSync(join(f.env.HOME, '.yaw/remote-state.json'), 'utf8');
    assert.doesNotMatch(stored, /private prompt|Private assistant|Follow up/);
    assert.equal(f.supervisor.events(receipt.session).events.some((e) => e.text === input.prompt), true);
    await f.supervisor.command({ action: 'interrupt', commandId: 'command-0005', session: receipt.session });
    assert.equal(f.supervisor.session(receipt.session).state, 'idle');
    await f.supervisor.command({ action: 'stop', commandId: 'command-0006', session: receipt.session });
    assert.equal(f.adapter.instances[0].stops, 1);
  } finally { await f.close(); }
});

test('remote approvals are bound to one session and turn, resolve once across channels, and expire denied', async () => {
  const f = await setup();
  try {
    const s = (await f.supervisor.command(startInput(f.project))).session;
    const pending = f.adapter.instances[0].context.request({ tool: 'Bash', input: { command: 'touch result.txt' } });
    const requestId = f.supervisor.decisions()[0].requestId;
    assert.equal(f.supervisor.session(s).state, 'waiting-approval');
    await assert.rejects(f.supervisor.command({ action: 'approve', commandId: 'approve-bad', session: s, requestId: 'stale' }), /stale/);
    await f.supervisor.command({ action: 'approve', commandId: 'approve-0001', session: s, requestId }, 'browser');
    assert.deepEqual(await pending, { allow: true, answers: undefined });
    await assert.rejects(f.supervisor.command({ action: 'approve', commandId: 'approve-0002', session: s, requestId }, 'telegram'), /stale/);
    f.supervisor.approvalMs = 10;
    const expired = f.adapter.instances[0].context.request({ tool: 'Write', input: { file_path: '/work/another' } });
    const keepAlive = setTimeout(() => {}, 100);
    assert.deepEqual(await expired, { allow: false }); clearTimeout(keepAlive);
    assert.equal(f.supervisor.decisions().length, 0);
  } finally { await f.close(); }
});

test('remote restart preserves receipts, marks workers unknown, shows replay gaps and resumes an exact provider ID', async () => {
  const f = await setup();
  const input = startInput(f.project), receipt = await f.supervisor.command(input), epoch = f.supervisor.epoch;
  await f.close();
  const store = remoteStore(f.env), adapter = fixtureAdapter(), supervisor = new Supervisor({ store, adapters: { claude: adapter } });
  try {
    assert.equal(supervisor.session(receipt.session).state, 'unknown');
    assert.equal(supervisor.events(receipt.session, 1, epoch).gap, true);
    assert.equal((await supervisor.command(input)).duplicate, true);
    assert.equal((await supervisor.command(input)).status, 'unknown');
    assert.equal(adapter.instances.length, 0);
    await supervisor.command({ action: 'resume', commandId: 'resume-0001', session: receipt.session, prompt: 'Continue exact conversation' });
    assert.equal(adapter.instances[0].context.session.providerSession, 'native-1');
  } finally { await supervisor.close(); store.close(); }
});

test('remote service lock refuses a second writer and releases on close', () => {
  const env = environment(), store = remoteStore(env);
  assert.throws(() => remoteStore(env), /lock exists/); store.close();
  const reopened = remoteStore(env); reopened.close();
});

test('hub assigns revisions, rejects stale writes, keeps deletions, deduplicates receipts and revokes credentials', () => {
  const env = environment(), store = remoteStore(env), hub = createHub({ store, env, kitRoot: KIT_ROOT });
  try {
    const paired = hub.pair('MacBook'), device = hub.authenticate(paired.token);
    assert.equal(hub.devices()[0].token, undefined);
    const input = { schema: 1, revision: 0, commandId: 'hub-command-1', records: { 'settings/profile': { answers: { 'user.language': 'en' } } }, device: { name: 'MacBook', updated: new Date().toISOString(), rows: [] } };
    assert.equal(hub.exchange(device, input).revision, 1);
    assert.equal(hub.exchange(device, input).duplicate, true);
    assert.throws(() => hub.exchange(device, { ...input, commandId: 'hub-command-2' }), /Revision conflict/);
    assert.equal(hub.exchange(device, { ...input, commandId: 'hub-command-3', revision: 1, records: { 'settings/profile': null } }).records['settings/profile'], null);
    assert.throws(() => hub.exchange(device, { ...input, commandId: 'hub-command-4', revision: 2, records: { '../../bad': {} } }), /Unknown portable/);
    hub.revoke(device.id); assert.equal(hub.authenticate(paired.token), null);
    assert.equal(readFileSync(join(env.HOME, '.yaw/remote-state.json'), 'utf8').includes(paired.token), false);
  } finally { store.close(); }
});

test('hub client migration excludes old transport writers and performs conflict-aware sync without losing local paths', async () => {
  const serverEnv = environment(), store = remoteStore(serverEnv), hub = createHub({ store, env: serverEnv, kitRoot: KIT_ROOT });
  try {
    const env = environment(), folder = realpathSync(tmp('yaw-vault-'));
    configureSync({ env, target: folder, scopes: ['settings'] });
    assert.throws(() => configureHubClient({ env, url: 'http://127.0.0.1:4318', scopes: ['settings'] }), /Back up/);
    configureHubClient({ env, url: 'http://127.0.0.1:4318', scopes: ['settings'], migrate: true });
    assert.throws(() => runSync({ env, kitRoot: KIT_ROOT }), /migrated/);
    const paired = hub.pair('MacBook'); env.YAW_HUB_TOKEN = paired.token;
    const profile = join(env.HOME, '.yaw/user-profile.yaml');
    writeFileSync(profile, 'answers:\n  user.language: en\n  user.knowledge-path: /device/only\n');
    const fetchFn = async (_url, options) => {
      const d = hub.authenticate(options.headers.authorization.slice(7));
      if (!d) return Response.json({}, { status: 403 });
      return Response.json(options.method === 'GET' ? { ...hub.view(), deviceId: d.id } : hub.exchange(d, JSON.parse(options.body)));
    };
    const result = await syncHub({ env, kitRoot: KIT_ROOT, fetchFn });
    assert.equal(result.revision, 1);
    assert.equal(readUserData(env, 'hub-sync-state.json').deviceId, paired.id);
    assert.match(readFileSync(profile, 'utf8'), /\/device\/only/);
    assert.equal(hub.view().records['settings/profile'].answers['user.knowledge-path'], undefined);
    const second = hub.pair('Second device');
    hub.exchange(hub.authenticate(second.token), { schema: 1, revision: 1, commandId: 'second-device-edit', records: { 'settings/profile': { answers: { 'user.language': 'de' } } }, device: { name: 'Second device', updated: new Date().toISOString(), rows: [] } });
    writeFileSync(profile, 'answers:\n  user.language: fr\n  user.knowledge-path: /device/only\n');
    assert.deepEqual((await syncHub({ env, kitRoot: KIT_ROOT, fetchFn })).conflicts, ['settings/profile']);
    assert.match(readFileSync(profile, 'utf8'), /fr/);
    assert.deepEqual((await syncHub({ env, kitRoot: KIT_ROOT, fetchFn, resolution: 'remote' })).conflicts, []);
    assert.match(readFileSync(profile, 'utf8'), /de/);
    assert.match(readFileSync(profile, 'utf8'), /\/device\/only/);
    assert.equal(Object.keys(readUserData(env, 'hub-sync-state.json').devices).length, 2);
    assert.throws(() => configureHubClient({ env, url: 'http://nas.local:4318' }), /loopback/);
    hub.revoke(paired.id); await assert.rejects(syncHub({ env, kitRoot: KIT_ROOT, fetchFn }), /rejected/);
  } finally { store.close(); }
});

test('remote HTTP requires owner login, exact origin and CSRF; paired devices have data-only access', async () => {
  const env = environment(), adapter = fixtureAdapter(), ownerToken = 'test-owner-credential-'.repeat(3);
  const service = await startRemoteServer({ env, kitRoot: KIT_ROOT, ownerToken, adapters: { claude: adapter }, signals: false });
  try {
    assert.equal(service.server.address().address, '127.0.0.1');
    assert.equal((await fetch(`${service.url}/api/state`)).status, 401);
    assert.equal((await fetch(`${service.url}/api/state`, { headers: { origin: 'https://wrong.example' } })).status, 403);
    const login = await fetch(`${service.url}/api/login`, { method: 'POST', headers: { origin: service.url, 'content-type': 'application/json' }, body: JSON.stringify({ token: ownerToken }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0], csrf = (await login.json()).csrf;
    const post = (path, body, extra = {}) => fetch(`${service.url}/api/${path}`, { method: 'POST', headers: { cookie, origin: service.url, 'content-type': 'application/json', 'x-yaw-token': csrf, ...extra }, body: JSON.stringify(body) });
    assert.equal((await post('device', { name: 'paired' }, { 'x-yaw-token': 'wrong' })).status, 403);
    const paired = await (await post('device', { name: 'paired' })).json();
    assert.equal((await fetch(`${service.url}/api/hub`, { headers: { authorization: `Bearer ${paired.token}` } })).status, 200);
    assert.equal((await fetch(`${service.url}/api/state`, { headers: { authorization: `Bearer ${paired.token}` } })).status, 401);
    await post('revoke', { id: paired.id });
    assert.equal((await fetch(`${service.url}/api/hub`, { headers: { authorization: `Bearer ${paired.token}` } })).status, 403);
    await post('logout', {});
    assert.equal((await fetch(`${service.url}/api/state`, { headers: { cookie } })).status, 401);
  } finally { await service.close(); }
});

test('Telegram refuses unauthorized, forwarded and duplicate updates, and routes exact targets through the controller', async () => {
  const f = await setup(), calls = [], bot = new TelegramController({ store: f.store, supervisor: f.supervisor, token: '123:fixture', kitRoot: KIT_ROOT,
    fetchFn: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return Response.json({ ok: true, result: {} }); } });
  f.store.state.telegram = { userId: '12', chatId: '12' }; bot.send = (text) => calls.push({ text });
  const update = (id, text, more = {}) => ({ update_id: id, message: { from: { id: 12 }, chat: { type: 'private', id: 12 }, text, ...more } });
  try {
    assert.equal((await bot.handle(update(1, '/status', { from: { id: 99 } }))).refused, true);
    assert.equal((await bot.handle(update(2, '/status', { forward_origin: {} }))).refused, true);
    const u = update(3, `/new ${f.project.id} claude Make a small change`), receipt = await bot.handle(u);
    assert.equal(receipt.status, 'dispatched');
    assert.equal((await bot.handle(u)).duplicate, true); assert.equal(f.adapter.instances.length, 1);
    const pending = f.adapter.instances[0].context.request({ tool: 'Write', input: { file_path: '/work/test.txt' } });
    const requestId = f.supervisor.decisions()[0].requestId;
    assert.equal((await bot.handle(update(4, `/approve ${receipt.session} ${requestId}`))).refused, true);
    await bot.handle(update(5, `/decision ${receipt.session} ${requestId}`));
    await bot.handle(update(6, `/approve ${receipt.session} ${requestId}`)); assert.equal((await pending).allow, true);
    assert.equal(calls.some((c) => c.body?.text.includes('/work/test.txt')), true);
  } finally { await bot.close(); await f.close(); }
});

test('JSON peers tolerate fragmented messages and reject provider errors without exposing raw details', async () => {
  const input = new PassThrough(), output = new PassThrough(), peer = new JsonPeer(input, output);
  const result = peer.request('test', {}); input.write('{"id":1,"res'); input.write('ult":{"ok":true}}\n');
  assert.deepEqual(await result, { ok: true });
  const rejected = peer.request('test', {}); input.write('{"id":2,"error":{"message":"sensitive provider error"}}\n');
  await assert.rejects(rejected, (e) => !e.message.includes('sensitive'));
});

test('Claude adapter loads project guidance, resumes exactly and translates decisions without permission bypass', async () => {
  let options, messages, resolveEnd;
  const end = new Promise((r) => { resolveEnd = r; });
  const query = (q) => {
    options = q.options; messages = q.prompt;
    return { async *[Symbol.asyncIterator]() { yield { type: 'system', subtype: 'init', session_id: 'native-resume' }; await end; }, async interrupt() {}, close() { resolveEnd(); } };
  };
  const events = [], adapter = claudeAdapter({ query, options: { session: 'native-resume' }, emit: (e) => events.push(e), request: async () => ({ allow: false }) });
  await adapter.start(); await adapter.send('message');
  assert.equal((await messages.next()).value.message.content, 'message');
  assert.equal(options.resume, 'native-resume'); assert.deepEqual(options.settingSources, ['project']);
  assert.equal(options.permissionMode, 'default'); assert.equal(options.maxBudgetUsd, 10);
  const decision = await options.canUseTool('Bash', { command: 'touch a' }, { signal: new AbortController().signal });
  assert.equal(decision.behavior, 'deny'); assert.equal(events[0].id, 'native-resume'); await adapter.stop();
});

test('Codex adapter performs handshake, handles scoped approvals and interrupts its exact thread/turn', async () => {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stdin = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
  const sent = [], events = []; let buffer = '';
  child.stdin.on('data', (chunk) => {
    buffer += chunk.toString(); let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const m = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1); sent.push(m);
      if (m.id && m.method) queueMicrotask(() => child.stdout.write(`${JSON.stringify({ id: m.id, result: m.method === 'thread/start' ? { thread: { id: 'thread-1' } } : m.method === 'turn/start' ? { turn: { id: 'turn-1' } } : {} })}\n`));
    }
  });
  const adapter = await codexAdapter({ child, emit: (e) => events.push(e), request: async () => ({ allow: true }) });
  await adapter.send('make changes');
  child.stdout.write(`${JSON.stringify({ id: 999, method: 'item/commandExecution/requestApproval', params: { threadId: 'thread-1', turnId: 'turn-1', command: 'touch test' } })}\n`);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(sent.find((m) => m.id === 999).result, { decision: 'accept' });
  await adapter.interrupt();
  assert.deepEqual(sent.find((m) => m.method === 'turn/interrupt').params, { threadId: 'thread-1', turnId: 'turn-1' });
  assert.equal(sent.find((m) => m.method === 'thread/start').params.approvalPolicy, 'untrusted');
  assert.equal(events[0].id, 'thread-1'); await adapter.stop();
});

test('managed execution fails closed off Linux and sandbox environment excludes controller credentials', () => {
  const env = environment();
  assert.throws(() => sandboxPlan({ kitRoot: KIT_ROOT, workspace: env.HOME, home: env.HOME, agent: 'claude', env, platform: 'darwin' }), /requires Linux/);
  assert.throws(() => sandboxPlan({ kitRoot: KIT_ROOT, workspace: KIT_ROOT, home: join(env.HOME, 'worker'), agent: 'claude', env, platform: 'linux' }), /separate from the controller/);
  const workspace = realpathSync(tmp('yaw-isolated-checkout-'));
  const plan = sandboxPlan({ kitRoot: KIT_ROOT, workspace, home: join(env.HOME, 'worker'), agent: 'claude',
    env: { ...env, YAW_REMOTE_BWRAP: process.execPath, ANTHROPIC_API_KEY: 'fixture-provider', YAW_REMOTE_OWNER_TOKEN: 'fixture-owner', YAW_REMOTE_TELEGRAM_TOKEN: 'fixture-bot' }, platform: 'linux' });
  assert.equal(plan.env.ANTHROPIC_API_KEY, 'fixture-provider'); assert.equal(plan.env.YAW_REMOTE_OWNER_TOKEN, undefined); assert.equal(plan.env.YAW_REMOTE_TELEGRAM_TOKEN, undefined);
  assert.equal(plan.args.includes('--unshare-all'), true); assert.equal(plan.args.includes('--die-with-parent'), true); assert.equal(plan.args.includes('/work'), true);
  assert.equal(existsSync(join(env.HOME, 'worker')), true);
});

test('worker limits include in-flight startups and failure leaves an unknown receipt without retrying', async () => {
  const f = await setup();
  let release;
  const gate = new Promise((r) => { release = r; });
  const original = f.adapter.start;
  f.adapter.start = async (...args) => { await gate; return original(...args); };
  f.supervisor.maxWorkers = 1;
  try {
    const start = f.supervisor.command(startInput(f.project));
    const other = f.supervisor.register(await makeProject({ modules: ['core'] }));
    await assert.rejects(f.supervisor.command(startInput(other, { commandId: 'parallel-command' })), /Worker limit/);
    release(); const receipt = await start;
    f.adapter.instances[0].context.onEvent({ type: 'done' });
    f.adapter.instances[0].send = async () => { throw new Error('raw provider error that must not escape'); };
    const input = { action: 'send', session: receipt.session, commandId: 'uncertain-command', prompt: 'Could have reached the provider' };
    const result = await f.supervisor.command(input);
    assert.equal(result.status, 'unknown'); assert.equal(f.supervisor.session(receipt.session).state, 'unknown');
    assert.equal((await f.supervisor.command(input)).duplicate, true);
  } finally { release(); await f.close(); }
});

test('Telegram queued output cannot redirect to a newly paired owner', async () => {
  const f = await setup(), deliveries = [];
  const bot = new TelegramController({ store: f.store, supervisor: f.supervisor, token: 'fixture', kitRoot: KIT_ROOT });
  bot.draining = true;
  f.store.state.telegram = { userId: '12', chatId: '12' }; bot.send('Original owner output');
  f.store.state.telegram = { userId: '13', chatId: '13' };
  bot.api = async (_method, input) => { deliveries.push(input); };
  bot.draining = false; await bot.drain(); assert.equal(deliveries.length, 0);
  await bot.close(); await f.close();
});

test('bounded output signals a reconnect gap and stop invalidates unanswered decisions', async () => {
  const f = await setup();
  try {
    const s = (await f.supervisor.command(startInput(f.project))).session;
    const first = f.supervisor.sequence;
    for (let i = 0; i < 210; i++) f.supervisor.event(s, 'message', { role: 'assistant', text: `Message ${i}` });
    assert.equal(f.supervisor.events(s, first, f.supervisor.epoch).gap, true);
    assert.equal(f.supervisor.events(s).gap, true);
    assert.equal(f.supervisor.events(s).events.length, 200);
    const pending = f.adapter.instances[0].context.request({ tool: 'Write', input: { file_path: '/work/file' } });
    await f.supervisor.command({ action: 'stop', commandId: 'stop-pending-command', session: s });
    assert.deepEqual(await pending, { allow: false }); assert.equal(f.supervisor.decisions().length, 0);
  } finally { await f.close(); }
});

test('stopping during startup prevents dispatch and keeps workspace ownership until the worker is reaped', async () => {
  const f = await setup(); let release;
  const gate = new Promise((r) => { release = r; }), original = f.adapter.start;
  f.adapter.start = async (...args) => { await gate; return original(...args); };
  try {
    const start = f.supervisor.command(startInput(f.project));
    const session = f.store.state.sessions[0].id;
    const stop = f.supervisor.command({ action: 'stop', session, commandId: 'stop-during-startup' });
    await assert.rejects(f.supervisor.command(startInput(f.project, { commandId: 'another-startup' })), /managed writer/);
    release(); const receipt = await start; await stop;
    assert.equal(receipt.outcome, 'stopped'); assert.equal(f.adapter.instances[0].sent.length, 0);
    assert.equal(f.supervisor.session(session).state, 'stopped'); assert.equal(f.adapter.instances[0].stops, 1);
  } finally { release(); await f.close(); }
});

test('a failed provider turn retains workspace ownership while its worker is alive', async () => {
  const f = await setup();
  try {
    const first = await f.supervisor.command(startInput(f.project));
    f.adapter.instances[0].context.onEvent({ type: 'done', failed: true });
    await assert.rejects(f.supervisor.command(startInput(f.project, { commandId: 'overlapping-after-failure' })), /managed writer/);
    await f.supervisor.command({ action: 'stop', session: first.session, commandId: 'release-failed-worker' });
    assert.equal((await f.supervisor.command(startInput(f.project, { commandId: 'new-after-failure' }))).status, 'dispatched');
  } finally { await f.close(); }
});
