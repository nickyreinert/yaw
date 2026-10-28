import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, watchFile, unwatchFile } from 'node:fs';
import { join } from 'node:path';
import { userDataDir } from '../lib/user-store.js';
import { REMOTE_SETTINGS_FILE, requireRemoteEnabled } from '../lib/remote-settings.js';
import { remoteStore, requireValue, RemoteError, digest } from './store.js';
import { Supervisor } from './supervisor.js';
import { executionAdapters } from './adapters.js';
import { createHub } from './hub.js';
import { TelegramController } from './telegram.js';

const CSP = "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
async function body(req, max = 256000) {
  requireValue(String(req.headers['content-type']).split(';')[0] === 'application/json', 'Expected JSON', 415);
  const chunks = []; let bytes = 0;
  for await (const chunk of req) { bytes += chunk.length; requireValue(bytes <= max, 'Request exceeds exchange limit', 413); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new RemoteError('Malformed JSON'); }
}
export async function startRemoteServer({ env = process.env, kitRoot, port = 0, adapters, store: injectedStore, fetchFn = fetch, signals = true, ownerToken = env.YAW_REMOTE_OWNER_TOKEN } = {}) {
  requireRemoteEnabled(env);
  requireValue(typeof ownerToken === 'string' && ownerToken.length >= 32, 'Enter YAW_REMOTE_OWNER_TOKEN privately (at least 32 characters)');
  const ownerHash = digest(ownerToken);
  const store = injectedStore ?? remoteStore(env);
  let server, telegram;
  const supervisor = new Supervisor({ store, adapters: adapters ?? executionAdapters({ env, kitRoot }) });
  const hub = createHub({ store, env, kitRoot });
  const logins = new Map(); let loginTimes = [], closing;
  const settingsFile = join(userDataDir(env), REMOTE_SETTINGS_FILE);
  const settingsChanged = () => { try { requireRemoteEnabled(env); } catch { close().catch(() => { process.exitCode = 1; }); } };
  const assets = new Map([
    ['/', ['text/html', readFileSync(new URL('../web/assets/remote.html', import.meta.url))]],
    ['/remote.js', ['text/javascript', readFileSync(new URL('../web/assets/remote.js', import.meta.url))]],
    ['/remote.css', ['text/css', readFileSync(new URL('../web/assets/remote.css', import.meta.url))]],
  ]);
  const close = () => closing ??= (async () => {
    unwatchFile(settingsFile, settingsChanged);
    if (signals) { process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal); }
    await telegram?.close(); await supervisor.close();
    if (server?.listening) await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    store.close();
  })();
  const onSignal = () => { close().catch(() => { process.exitCode = 1; }); };
  try {
    server = http.createServer(async (req, res) => {
      const send = (status, value, type = 'application/json') => {
        res.writeHead(status, { 'content-type': `${type}; charset=utf-8`, 'content-security-policy': CSP, 'cache-control': 'no-store',
          'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
        res.end(type === 'application/json' ? JSON.stringify(value) : value);
      };
      try {
        requireValue(!closing, 'Controller is stopping', 503);
        try { requireRemoteEnabled(env); } catch { throw new RemoteError('Remote Control is disabled', 403); }
        const bound = server.address().port, hosts = [`127.0.0.1:${bound}`, `localhost:${bound}`];
        requireValue(req.rawHeaders.filter((_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === 'host').length === 1 && hosts.includes(req.headers.host), 'Wrong host', 421);
        requireValue(req.headers.origin === undefined || hosts.some((host) => req.headers.origin === `http://${host}`), 'Wrong origin', 403);
        const url = new URL(req.url, `http://${hosts[0]}`);
        if (url.pathname === '/api/hub') {
          const auth = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization ?? ''), device = hub.authenticate(auth?.[1]);
          requireValue(device, 'Device is unpaired or revoked', 403);
          if (req.method === 'GET') return send(200, { ...hub.view(), deviceId: device.id });
          requireValue(req.method === 'POST', 'Method not allowed', 405);
          return send(200, hub.exchange(device, await body(req, 16 * 1024 * 1024)));
        }
        if (req.method === 'GET' && assets.has(url.pathname)) return send(200, assets.get(url.pathname)[1], assets.get(url.pathname)[0]);
        if (url.pathname === '/api/login' && req.method === 'POST') {
          requireValue(hosts.some((host) => req.headers.origin === `http://${host}`), 'Login requires the configured origin', 403);
          const now = Date.now(); loginTimes = loginTimes.filter((time) => now - time < 60000);
          requireValue(loginTimes.length < 10, 'Too many login attempts; wait one minute', 429); loginTimes.push(now);
          const input = await body(req);
          requireValue(typeof input.token === 'string' && same(digest(input.token), ownerHash), 'Owner credential refused', 403);
          for (const [key, value] of logins) if (value.expires < now) logins.delete(key);
          requireValue(logins.size < 20, 'Owner session limit reached; restart to revoke sessions', 409);
          const cookie = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex');
          logins.set(digest(cookie), { csrf, expires: now + 12 * 3600000 });
          res.setHeader('set-cookie', `yaw_remote=${cookie}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`);
          return send(200, { csrf });
        }
        const cookie = /(?:^|;\s*)yaw_remote=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie ?? ''), login = cookie && logins.get(digest(cookie[1]));
        requireValue(login && login.expires > Date.now(), 'Sign in to YAW Remote', 401);
        if (req.method === 'GET') {
          if (url.pathname === '/api/state') return send(200, { csrf: login.csrf, projects: store.state.projects, sessions: supervisor.list(), adapters: supervisor.capabilities(),
            devices: hub.devices(), hub: { schema: 1, revision: hub.view().revision }, telegram: { paired: store.state.telegram, status: telegram?.health ?? 'disabled' },
            decisions: supervisor.decisions().map(({ requestId, session, turn, expires }) => ({ requestId, session, turn, expires })) });
          if (url.pathname === '/api/events') return send(200, { ...supervisor.events(url.searchParams.get('session'), Number(url.searchParams.get('after') ?? 0), url.searchParams.get('epoch')),
            decisions: supervisor.decisions().filter((p) => p.session === url.searchParams.get('session')) });
          throw new RemoteError('Not found', 404);
        }
        requireValue(req.method === 'POST', 'Method not allowed', 405);
        requireValue(same(req.headers['x-yaw-token'] ?? '', login.csrf), 'Invalid CSRF credential', 403);
        const input = await body(req, url.pathname === '/api/import' ? 16 * 1024 * 1024 : 256000);
        if (url.pathname === '/api/command') return send(200, await supervisor.command(input));
        if (url.pathname === '/api/project') return send(200, supervisor.register(input.path));
        if (url.pathname === '/api/device') return send(200, hub.pair(input.name));
        if (url.pathname === '/api/revoke') { hub.revoke(input.id); return send(200, { revoked: true }); }
        if (url.pathname === '/api/import') return send(200, hub.import(input.vault));
        if (url.pathname === '/api/telegram') {
          requireValue(input.clear === true || (/^[1-9][0-9]{0,19}$/.test(input.userId) && input.userId === input.chatId), 'Pair one numeric user ID with their private chat ID');
          store.state.telegram = input.clear ? null : { userId: input.userId, chatId: input.chatId }; store.save(); return send(200, { paired: store.state.telegram });
        }
        if (url.pathname === '/api/logout') { logins.clear(); res.setHeader('set-cookie', 'yaw_remote=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return send(200, { revoked: true }); }
        throw new RemoteError('Not found', 404);
      } catch (e) {
        req.resume(); send(e instanceof RemoteError ? e.status : 500, { error: e instanceof RemoteError ? e.message : 'Remote operation failed. Check service setup and inspect the session before retrying.' });
      }
    });
    server.requestTimeout = 35000; server.headersTimeout = 10000;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    const url = `http://127.0.0.1:${server.address().port}`;
    if (env.YAW_REMOTE_TELEGRAM_TOKEN) { telegram = new TelegramController({ store, supervisor, token: env.YAW_REMOTE_TELEGRAM_TOKEN, fetchFn, dashboardUrl: url, kitRoot, env }); await telegram.start(); }
    watchFile(settingsFile, { interval: 500, persistent: false }, settingsChanged);
    requireRemoteEnabled(env);
    if (signals) { process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal); }
    return { server, supervisor, hub, store, url, close };
  } catch (e) { await close(); throw e; }
}
