import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, watchFile, unwatchFile, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { remoteSettings, REMOTE_SETTINGS_FILE } from '../lib/remote-settings.js';
import { readUserData, writeUserData, userDataDir } from '../lib/user-store.js';
import { portableSnapshot, applyPortableRecords, mergeRecords } from '../lib/data-sync.js';
import { FORM_ASSETS } from '../web/form-server.js';
import { FormError } from '../web/form-model.js';
import { remoteStore, safeDirectory, digest, requireValue, RemoteError } from './store.js';
import { createHub } from './hub.js';
import { NativeAgents } from './native-agent.js';
import { HostedProjects } from './host-projects.js';
import { HostTelegram } from './host-telegram.js';
import { allowedHosts, lanInterfaces, privateAddress } from './lan.js';

const CSP = "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const asset = (name, type) => [`/${name}`, [type, readFileSync(new URL(`../web/assets/${name}`, import.meta.url))]];
export const HOST_ASSETS = new Map([...FORM_ASSETS, ['/login.js', ['text/javascript', Buffer.from("location.replace('/' + location.hash);\n")]], asset('host.js', 'text/javascript'), asset('host-interview.js', 'text/javascript'), asset('host.css', 'text/css')]);
export const hostPage = (csrf) => readFileSync(new URL('../web/assets/host.html', import.meta.url), 'utf8').replace('YAW_CSRF', csrf);
async function jsonBody(req, max = 256 * 1024) {
  requireValue(String(req.headers['content-type']).split(';')[0].trim() === 'application/json', 'Expected JSON', 415);
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; requireValue(size <= max, 'Request exceeds limit', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new RemoteError('Malformed JSON'); }
}

export async function startHostServer({ env = process.env, kitRoot, port, signals = true, spawnFn, verify, fetchFn = fetch, syncInterval = 30000 } = {}) {
  const settings = remoteSettings(env);
  requireValue(settings.enabled && settings.role === 'host', 'Enable Server mode and choose Host');
  requireValue(lanInterfaces().includes(settings.bindAddress), 'Choose a current LAN interface; public and wildcard listeners are refused');
  safeDirectory(dirname(settings.workspaceRoot));
  try { mkdirSync(settings.workspaceRoot, { mode: 0o700 }); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  const root = safeDirectory(settings.workspaceRoot), store = remoteStore(env);
  const hub = createHub({ store, env, kitRoot, rollingReceipts: true });
  const ownerToken = randomBytes(32).toString('hex'), ownerHash = digest(ownerToken);
  const tickets = new Map(), logins = new Map(), pending = new Map(); let attempts = [], closing, telegram, timer;
  let address, hosts, agents, projects, syncHost, syncing = false, syncState = { status: 'starting' };
  const settingsFile = join(userDataDir(env), REMOTE_SETTINGS_FILE);
  const server = http.createServer(async (req, res) => {
    const send = (status, value, type = 'application/json') => {
      if (res.destroyed) return;
      res.writeHead(status, { 'content-type': `${type}; charset=utf-8`, 'content-security-policy': CSP, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
      res.end(type === 'application/json' ? JSON.stringify(value) : value);
    };
    try {
      requireValue(!closing && remoteSettings(env).enabled && remoteSettings(env).role === 'host', 'Host is stopping', 503);
      requireValue(privateAddress(req.socket.remoteAddress ?? ''), 'Only LAN peers are supported', 403);
      requireValue(!Object.keys(req.headers).some((k) => k === 'forwarded' || k.startsWith('x-forwarded-')), 'Proxy access is not enabled', 403);
      requireValue(req.rawHeaders.filter((_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === 'host').length === 1 && hosts.has(req.headers.host), 'Wrong host', 421);
      requireValue(req.headers.origin === undefined || req.headers.origin === `http://${req.headers.host}`, 'Wrong origin', 403);
      const url = new URL(req.url, address), now = Date.now();
      const bearer = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization ?? '')?.[1];
      const local = req.socket.remoteAddress === req.socket.localAddress || /^127\./.test(req.socket.remoteAddress ?? '');
      const localOwner = local && bearer && digest(bearer) === ownerHash;
      if (url.pathname === '/api/background-status' && req.method === 'GET') {
        requireValue(localOwner, 'Local owner authentication required', 403);
        return send(200, { role: 'host', address, fingerprint: digest(JSON.stringify(settings)) });
      }
      if (url.pathname === '/api/background-stop' && req.method === 'POST') {
        requireValue(localOwner, 'Local owner authentication required', 403);
        res.once('finish', () => close()); return send(200, { stopped: true });
      }
      if (url.pathname === '/api/native-event' && req.method === 'POST') {
        requireValue(local, 'Native hooks are host-local', 403); return send(200, agents.event(bearer, await jsonBody(req)));
      }
      if (url.pathname === '/api/pair/request' && req.method === 'POST') {
        attempts = attempts.filter((time) => now - time < 60000);
        requireValue(attempts.length < 10, 'Pairing rate limit; wait one minute', 429); attempts.push(now);
        for (const [id, p] of pending) if (p.expires < now) pending.delete(id);
        const input = await jsonBody(req);
        requireValue(typeof input.name === 'string' && /^[\p{L}\p{N} _.-]{1,64}$/u.test(input.name) && /^[a-f0-9]{64}$/.test(input.hash), 'Invalid pairing request');
        const existing = [...pending.values()].find((p) => p.hash === input.hash);
        if (existing) return send(200, { id: existing.id });
        requireValue(pending.size < 20, 'Pending pairing limit reached', 429);
        const p = { id: randomUUID(), name: input.name, hash: input.hash, expires: now + 5 * 60000 }; pending.set(p.id, p); return send(200, { id: p.id });
      }
      const device = hub.authenticate(bearer);
      if (url.pathname === '/api/pair/status' && req.method === 'GET') return send(200, { status: device ? 'approved' : [...pending.values()].some((p) => p.expires > now && p.hash === digest(bearer)) ? 'pending' : 'expired' });
      if (url.pathname === '/api/local-open' && req.method === 'POST') {
        requireValue(localOwner, 'Local owner authentication required', 403);
        for (const [key, expiry] of tickets) if (expiry < now) tickets.delete(key);
        requireValue(tickets.size < 30, 'Login link limit reached', 429);
        const token = randomBytes(32).toString('hex'); tickets.set(digest(token), now + 60000);
        return send(200, { url: `${address}/?t=${token}` });
      }
      const cookie = /(?:^|;\s*)yaw_host=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1];
      const login = cookie && logins.get(digest(cookie));
      const browserOwner = login?.expires > now;
      if (url.pathname === '/' && req.method === 'GET' && url.searchParams.has('t')) {
        const key = digest(url.searchParams.get('t')); requireValue(tickets.get(key) > now, 'Login link expired; run yaw host again', 403); tickets.delete(key);
        for (const [key, value] of logins) if (value.expires < now) logins.delete(key);
        requireValue(logins.size < 20, 'Browser session limit reached', 429);
        const token = randomBytes(32).toString('hex'); logins.set(digest(token), { csrf: randomBytes(32).toString('hex'), expires: now + 12 * 3600000 });
        if (req.headers['sec-fetch-mode'] === 'navigate') {
          res.setHeader('set-cookie', `yaw_host=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`);
          return send(200, '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Opening YAW Host</title><script src="/login.js" defer></script></head><body><a href="/">Continue</a></body></html>', 'text/html');
        }
        res.writeHead(303, { location: '/', 'set-cookie': `yaw_host=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }); return res.end();
      }
      if (req.method === 'GET' && (url.pathname === '/' || HOST_ASSETS.has(url.pathname))) {
        const asset = HOST_ASSETS.get(url.pathname); return send(200, asset?.[1] ?? hostPage(browserOwner ? login.csrf : ''), asset?.[0] ?? 'text/html');
      }
      const owner = localOwner || browserOwner;
      requireValue(owner || device, 'Open yaw host on the host, or pair this client', 401);
      if (req.method === 'POST' && !localOwner && browserOwner) requireValue(req.headers.origin === `http://${req.headers.host}` && req.headers['x-yaw-token'] === login.csrf, 'Invalid CSRF credential', 403);
      if (url.pathname === '/api/hub') {
        requireValue(device, 'Use a paired device credential', 403);
        if (req.method === 'GET') return send(200, { ...hub.view(), deviceId: device.id });
        requireValue(req.method === 'POST', 'Method not allowed', 405); return send(200, hub.exchange(device, await jsonBody(req, 16 * 1024 * 1024)));
      }
      const identity = owner ? 'owner' : device.id;
      const interview = /^\/api\/interviews\/([a-f0-9-]{36})\/(bootstrap|[a-z-]+)$/.exec(url.pathname);
      if (interview) {
        requireValue(owner || device.provision === true, 'Pair this device for hosted initialization first', 403);
        if (req.method === 'GET' && interview[2] === 'bootstrap') return send(200, projects.bootstrap(interview[1], identity));
        requireValue(req.method === 'POST', 'Method not allowed', 405);
        const result = await projects.action(interview[1], identity, interview[2], await jsonBody(req));
        if (interview[2] === 'apply') telegram?.send(`${result.project.slug}: ${result.message}`);
        return send(200, result);
      }
      if (url.pathname === '/api/interviews' && req.method === 'POST') {
        requireValue(owner || device.provision === true, 'Pair this device for hosted initialization first', 403);
        const input = await jsonBody(req);
        requireValue(owner || input.command === 'init-remote', 'Clients initialize remote projects only', 403);
        return send(200, projects.create(input, identity));
      }
      requireValue(owner, 'Owner access required', 403);
      if (req.method === 'GET' && url.pathname === '/api/state') return send(200, { root, address, csrf: login?.csrf ?? '', projects: store.state.projects, sessions: agents.list(),
        devices: hub.devices(), pending: [...pending.values()].filter((p) => p.expires > now).map(({ id, name, expires, hash }) => ({ id, name, expires, verification: hash.slice(0, 12) })), sync: syncState,
        telegram: { configured: Boolean(telegram), paired: Boolean(store.state.telegram), status: telegram?.health ?? 'disabled' } });
      requireValue(req.method === 'POST', 'Method not allowed', 405);
      const input = await jsonBody(req);
      if (url.pathname === '/api/sync') {
        requireValue(input.resolve === undefined || ['local', 'remote'].includes(input.resolve), 'Choose host or hub conflict resolution');
        await syncHost(input.resolve); return send(200, syncState);
      }
      if (url.pathname === '/api/pair/approve') {
        const p = pending.get(input.id); requireValue(p && p.expires > now, 'Pairing request expired', 409);
        requireValue(store.state.devices.length < 100, 'Device limit reached', 409);
        store.state.devices.push({ id: p.id, name: p.name, hash: p.hash, revoked: false, provision: true }); store.save(); pending.delete(p.id); return send(200, { approved: true });
      }
      if (url.pathname === '/api/revoke') { hub.revoke(input.id); return send(200, { revoked: true }); }
      if (url.pathname === '/api/native-confirm') return send(200, agents.confirm(input.session));
      if (url.pathname === '/api/native-stop') { await agents.stop(input.session); return send(200, { stopped: true }); }
      if (url.pathname === '/api/telegram-pair') { requireValue(telegram, 'Configure the host Telegram bot credential privately first'); return send(200, telegram.pair()); }
      if (url.pathname === '/api/telegram-revoke') { store.state.telegram = null; store.save(); return send(200, { revoked: true }); }
      if (url.pathname === '/api/logout') { logins.clear(); return send(200, { signedOut: true }); }
      if (url.pathname === '/api/stop') { res.once('finish', () => close()); return send(200, { stopped: true }); }
      throw new RemoteError('Not found', 404);
    } catch (e) { req.resume(); send(e instanceof RemoteError || e instanceof FormError ? e.status : 500, { error: e instanceof RemoteError || e instanceof FormError ? e.message : 'Host operation failed; inspect project status before retrying' }); }
  });
  const settingsChanged = () => { const next = remoteSettings(env); if (!next.enabled || next.role !== 'host' || next.port !== settings.port || next.bindAddress !== settings.bindAddress || next.workspaceRoot !== root) close(); };
  const onSignal = () => { close().catch(() => { process.exitCode = 1; }); };
  const close = () => closing ??= (async () => {
    clearInterval(timer); unwatchFile(settingsFile, settingsChanged);
    if (signals) { process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal); }
    await telegram?.close(); await projects?.close(); await agents?.close();
    if (server.listening) await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    writeUserData(env, 'server-runtime.json', null); store.close();
  })();
  try {
    server.requestTimeout = 35000; server.headersTimeout = 10000; server.maxConnections = 100;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port ?? settings.port, settings.bindAddress, resolve); });
    address = `http://${settings.bindAddress}:${server.address().port}`; hosts = allowedHosts(settings.bindAddress, server.address().port);
    agents = new NativeAgents({ env, store, kitRoot, address, spawnFn });
    projects = new HostedProjects({ root, kitRoot, env, store, agents, verify });
    writeUserData(env, 'server-runtime.json', { address, token: ownerToken });
    writeUserData(env, 'hub-sync.json', { version: 1, hostMode: true, url: address, scopes: ['settings', 'presets', 'statistics'] });
    if (env.YAW_REMOTE_TELEGRAM_TOKEN) { telegram = new HostTelegram({ store, projects, agents, token: env.YAW_REMOTE_TELEGRAM_TOKEN, kitRoot, env, fetchFn }); await telegram.start(); }
    // The host participates in the same portable merge protocol as its clients.
    const hostDevice = readUserData(env, 'host-device.json') ?? { id: randomUUID() }; writeUserData(env, 'host-device.json', hostDevice);
    syncHost = async (resolution) => {
      if (syncing || closing) return; syncing = true;
      try {
        const snapshot = portableSnapshot({ env, kitRoot, scopes: ['settings', 'presets', 'statistics'], name: 'Host', serverMode: true });
        const base = readUserData(env, 'host-sync-state.json') ?? { base: {} };
        const merged = mergeRecords(snapshot.records, hub.view().records, base.base, resolution);
        if (merged.conflicts.length) { syncState = { status: 'conflict', conflicts: merged.conflicts }; return; }
        const accepted = hub.exchange(hostDevice, { schema: 1, revision: hub.view().revision, commandId: randomUUID(), records: merged.records, device: snapshot.device });
        applyPortableRecords({ env, records: accepted.records }); writeUserData(env, 'host-sync-state.json', { base: accepted.records });
        writeUserData(env, 'hub-sync-state.json', { base: accepted.records, devices: accepted.devices, deviceId: hostDevice.id, revision: accepted.revision, lastSync: new Date().toISOString(), conflicts: [] });
        syncState = { status: 'connected', revision: accepted.revision };
      } catch { syncState = { status: 'failed' }; } finally { syncing = false; }
    };
    await syncHost(); timer = setInterval(() => syncHost(), syncInterval); timer.unref();
    watchFile(settingsFile, { interval: 500, persistent: false }, settingsChanged);
    if (signals) { process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal); }
    return { server, address, store, hub, agents, projects, close };
  } catch (e) { await close(); throw e; }
}
