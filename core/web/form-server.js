// Local form transport (Y-7.3/7.4, ADR-0044). Only explicit API save/apply actions write files.
// Handshake: GET /?t=<start token> (valid once) sets a session cookie and redirects to /.
// Every later request needs the cookie; a POST also needs the same secret in the X-YAW-Token header.
import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { FormError } from './form-model.js';

export const IDLE_MS = 30 * 60 * 1000;
export const CSRF_HEADER = 'x-yaw-token';
const CSP = "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
export const MAX_JSON_BYTES = 256 * 1024;
const assets = new Map([
  ['/login.js', ['text/javascript; charset=utf-8', Buffer.from("location.replace('/');\n")]],
  ['/app.js', ['text/javascript; charset=utf-8', readFileSync(new URL('./assets/app.js', import.meta.url))]],
  ['/app.css', ['text/css; charset=utf-8', readFileSync(new URL('./assets/app.css', import.meta.url))]],
  ['/ui-state.js', ['text/javascript; charset=utf-8', readFileSync(new URL('./assets/ui-state.js', import.meta.url))]],
  ['/workspace.js', ['text/javascript; charset=utf-8', readFileSync(new URL('./assets/workspace.js', import.meta.url))]],
  ['/yaw-shark.svg', ['image/svg+xml', readFileSync(new URL('./assets/yaw-shark.svg', import.meta.url))]],
]);

async function readJson(req) {
  if (String(req.headers['content-type'] ?? '').split(';')[0].trim() !== 'application/json') {
    req.resume();
    throw new FormError('Expected Content-Type: application/json', 415);
  }
  const chunks = [];
  await new Promise((resolve, reject) => {
    let length = 0;
    function cleanup() {
      req.removeListener('data', data);
      req.removeListener('end', end);
      req.removeListener('aborted', aborted);
      req.removeListener('error', failed);
    }
    function data(chunk) {
      length += chunk.length;
      if (length > MAX_JSON_BYTES) {
        cleanup();
        req.resume();
        reject(new FormError('JSON body exceeds 256 KiB', 413));
      } else chunks.push(chunk);
    }
    function end() { cleanup(); resolve(); }
    function aborted() { cleanup(); reject(new FormError('JSON request was interrupted')); }
    function failed() { cleanup(); reject(new FormError('Could not read JSON request')); }
    req.on('data', data).once('end', end).once('aborted', aborted).once('error', failed);
  });
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new FormError('Malformed JSON body'); }
}

function same(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && timingSafeEqual(x, y);
}

function cookieOf(req, name) {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

function pageHtml(csrf) {
  return readFileSync(new URL('./assets/index.html', import.meta.url), 'utf8').replace('YAW_CSRF', csrf);
}

// Starts the server. Options: port (0 = random), idleMs, onClose, signals (default true: SIGINT stops it).
// Resolves { server, port, url, token, close() }; `url` carries the start token, never log it.
// `page`, `assets` and `get` let another local page (the dashboard, #172) reuse the same handshake and checks;
// `get` maps a GET path under /api/ to a function returning JSON.
export async function startFormServer({ port = 0, idleMs = IDLE_MS, signals = true, onClose, api, page = pageHtml, assets: served = assets, get = {}, controlToken } = {}) {
  let startToken = randomBytes(32).toString('hex');
  const session = randomBytes(32).toString('hex');
  const cookieName = `yaw_session_${randomBytes(8).toString('hex')}`;
  let used = false;
  let idle;
  let closed;
  let bound;
  let applying = false;
  const resetIdle = () => {
    clearTimeout(idle);
    if (applying || idleMs === 0) return;
    idle = setTimeout(() => close(), idleMs);
    idle.unref?.();
  };

  const server = http.createServer(async (req, res) => {
    const fail = (code, msg) => {
      res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8', 'content-security-policy': CSP, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(`${msg}\n`);
    };
    let hostCount = 0;
    for (let i = 0; i < req.rawHeaders.length; i += 2) if (req.rawHeaders[i].toLowerCase() === 'host') hostCount++;
    if (hostCount !== 1) return fail(400, 'bad host');
    const hosts = [`127.0.0.1:${bound}`, `localhost:${bound}`];
    if (!hosts.includes(String(req.headers.host ?? '').toLowerCase())) return fail(421, 'wrong host');
    const origin = req.headers.origin;
    if (origin !== undefined && !hosts.some((h) => origin === `http://${h}`)) return fail(403, 'wrong origin');

    let url;
    try { url = new URL(req.url, `http://127.0.0.1:${bound}`); } catch { return fail(400, 'bad request'); }
    if (controlToken && req.method === 'POST' && ['/api/web/open', '/api/web/stop'].includes(url.pathname)) {
      req.resume();
      if (!same(req.headers['x-yaw-control'], controlToken)) return fail(403, 'invalid control token');
      if (url.pathname === '/api/web/stop') {
        res.writeHead(200, headers('application/json'));
        res.once('finish', () => close({ graceful: true }));
        return res.end('{"stopped":true}');
      }
      startToken = randomBytes(32).toString('hex');
      used = false;
      res.writeHead(200, headers('application/json'));
      return res.end(JSON.stringify({ url: `http://127.0.0.1:${bound}/?t=${startToken}` }));
    }
    const authenticated = same(cookieOf(req, cookieName), session);
    const setCookie = `${cookieName}=${session}; HttpOnly; SameSite=Strict; Path=/${idleMs > 0 ? `; Max-Age=${Math.floor(idleMs / 1000)}` : ''}`;
    if (req.method === 'GET' && url.pathname === '/' && url.searchParams.has('t')) {
      if (!authenticated && (used || !same(url.searchParams.get('t'), startToken))) return fail(403, 'invalid token; run yaw web for a new login link');
      used = true;
      resetIdle();
      // Commit a same-origin document before navigating, so Strict cookies survive file-launcher navigation.
      if (req.headers['sec-fetch-mode'] === 'navigate') {
        res.writeHead(200, { ...headers('text/html; charset=utf-8'), 'set-cookie': setCookie });
        return res.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Opening YAW</title><script src="/login.js" defer></script></head><body><a href="/">Continue to YAW</a></body></html>');
      }
      res.writeHead(303, { location: '/', 'set-cookie': setCookie, 'cache-control': 'no-store', 'content-security-policy': CSP, 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
      return res.end();
    }
    if (!authenticated) return fail(403, 'missing or invalid token; run yaw web for a new login link');
    res.setHeader('set-cookie', setCookie);
    resetIdle(); // only an authenticated request keeps the server alive
    if (req.method === 'GET' || req.method === 'HEAD') {
      const asset = url.pathname === '/login.js' ? assets.get(url.pathname) : served.get(url.pathname);
      if (url.pathname === '/' || asset) {
        res.writeHead(200, { 'content-type': asset?.[0] ?? 'text/html; charset=utf-8', 'content-security-policy': CSP, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
        return res.end(req.method === 'HEAD' ? undefined : asset?.[1] ?? page(session));
      }
      if (api?.bootstrap && url.pathname === '/api/bootstrap') {
        try { return json(200, api.bootstrap(), req.method === 'HEAD'); }
        catch (e) { return error(e); }
      }
      const reads = { ...api?.get, ...get };
      if (Object.hasOwn(reads, url.pathname)) {
        try { return json(200, await reads[url.pathname](url.searchParams), req.method === 'HEAD'); }
        catch (e) { return error(e); }
      }
      return fail(404, 'not found');
    }
    if (req.method === 'POST') {
      // State changes: custom header (a cross-site form cannot set it) carrying the secret, plus the cookie above.
      if (!same(req.headers[CSRF_HEADER], session)) return fail(403, 'missing or invalid csrf header');
      if (!api || !['preview', 'diff', 'draft', 'preset', 'prefill', 'apply', ...(api.actions ?? [])].some((p) => url.pathname === `/api/${p}`) ||
        (url.pathname === '/api/apply' && !api.apply)) {
        req.resume();
        return fail(404, 'not found');
      }
      try {
        if (applying) throw new FormError('Apply is already running; this session is read-only', 409);
        const input = await readJson(req);
        if (applying) throw new FormError('Apply is already running', 409);
        if (url.pathname === '/api/apply') {
          // Validate before starting the stream; once apply starts, never accept another mutation.
          const prepared = api.prepareApply(input);
          applying = true;
          clearTimeout(idle);
          res.writeHead(200, headers('application/x-ndjson; charset=utf-8'));
          const emit = (event) => { if (!res.destroyed) res.write(`${JSON.stringify(event)}\n`); };
          try { await api.apply(prepared, emit); }
          catch (e) {
            emit({ type: 'error', message: e instanceof FormError ? e.message : 'Apply failed; files may have been written. Inspect the project before retrying.' });
            api.failed?.(e);
          }
          res.once('finish', () => close({ graceful: true }));
          res.end();
          if (res.destroyed) close({ graceful: true });
          return;
        }
        return json(200, await api.action(url.pathname.slice(5), input));
      } catch (e) { return error(e); }
    }
    return fail(405, 'method not allowed');

    function headers(type) {
      return { 'content-type': type, 'content-security-policy': CSP, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' };
    }
    function json(status, body, head = false) {
      res.writeHead(status, { ...headers('application/json; charset=utf-8'), ...(status === 413 ? { connection: 'close' } : {}) });
      res.end(head ? undefined : JSON.stringify(body));
    }
    function error(e) {
      if (!(e instanceof FormError)) api?.failed?.(e);
      return json(e instanceof FormError ? e.status : 500, { error: e instanceof FormError ? e.message : 'Setup failed. No success was recorded; check the terminal and project state.' });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  bound = server.address().port;

  function close({ graceful = false } = {}) {
    closed ??= new Promise((resolve) => {
      clearTimeout(idle);
      process.removeListener('SIGINT', close);
      process.removeListener('SIGTERM', close);
      server.close(() => { onClose?.(); resolve(); });
      if (graceful) server.closeIdleConnections();
      else server.closeAllConnections();
    });
    return closed;
  }
  resetIdle();
  server.on('close', () => clearTimeout(idle));
  if (signals) {
    process.once('SIGINT', close);
    process.once('SIGTERM', close);
  }

  return { server, port: bound, url: `http://127.0.0.1:${bound}/?t=${startToken}`, token: startToken, close };
}
