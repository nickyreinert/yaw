// Local form server (Y-7.3, ADR-0044). node:http only, bound to 127.0.0.1, no files written.
// Handshake: GET /?t=<start token> (valid once) sets a session cookie and redirects to /.
// Every later request needs the cookie; a POST also needs the same secret in the X-YAW-Token header.
import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';

export const IDLE_MS = 30 * 60 * 1000;
export const CSRF_HEADER = 'x-yaw-token';
const COOKIE = 'yaw_session';
const CSP = "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

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
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="yaw-csrf" content="${csrf}"><title>YAW setup</title></head>
<body><h1>YAW setup</h1><p>The form server is running. The form arrives with Y-7.4.</p></body></html>
`;
}

// Starts the server. Options: port (0 = random), idleMs, onClose, signals (default true: SIGINT stops it).
// Resolves { server, port, url, token, close() }; `url` carries the start token, never log it.
export async function startFormServer({ port = 0, idleMs = IDLE_MS, signals = true, onClose } = {}) {
  const startToken = randomBytes(32).toString('hex');
  const session = randomBytes(32).toString('hex');
  let used = false;
  let idle;
  let closed;
  let bound;
  const resetIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(() => close(), idleMs);
    idle.unref?.();
  };

  const server = http.createServer((req, res) => {
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
    if (req.method === 'GET' && url.pathname === '/' && url.searchParams.has('t')) {
      if (used || !same(url.searchParams.get('t'), startToken)) return fail(403, 'invalid token');
      used = true;
      resetIdle();
      res.writeHead(303, { location: '/', 'set-cookie': `${COOKIE}=${session}; HttpOnly; SameSite=Strict; Path=/`, 'cache-control': 'no-store', 'content-security-policy': CSP, 'x-content-type-options': 'nosniff' });
      return res.end();
    }
    if (!same(cookieOf(req, COOKIE), session)) return fail(403, 'missing or invalid token');
    resetIdle(); // only an authenticated request keeps the server alive
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (url.pathname !== '/') return fail(404, 'not found');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': CSP, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
      return res.end(req.method === 'HEAD' ? undefined : pageHtml(session));
    }
    if (req.method === 'POST') {
      // State changes: custom header (a cross-site form cannot set it) carrying the secret, plus the cookie above.
      if (!same(req.headers[CSRF_HEADER], session)) return fail(403, 'missing or invalid csrf header');
      req.resume();
      return fail(404, 'not found'); // no state-changing endpoint yet (Y-7.4/7.5)
    }
    return fail(405, 'method not allowed');
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  bound = server.address().port;

  function close() {
    closed ??= new Promise((resolve) => {
      clearTimeout(idle);
      process.removeListener('SIGINT', close);
      server.close(() => { onClose?.(); resolve(); });
      server.closeAllConnections();
    });
    return closed;
  }
  resetIdle();
  server.on('close', () => clearTimeout(idle));
  if (signals) process.once('SIGINT', close);

  return { server, port: bound, url: `http://127.0.0.1:${bound}/?t=${startToken}`, token: startToken, close };
}
