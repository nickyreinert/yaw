import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { startFormServer, IDLE_MS } from '../core/web/form-server.js';

async function withServer(fn, opts = {}) {
  const s = await startFormServer({ signals: false, ...opts });
  try { return await fn(s); } finally { await s.close(); }
}
const base = (s) => `http://127.0.0.1:${s.port}`;
async function session(s) {
  const r = await fetch(s.url, { redirect: 'manual' });
  assert.equal(r.status, 303);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const page = await (await fetch(`${base(s)}/`, { headers: { cookie } })).text();
  return { cookie, csrf: page.match(/name="yaw-csrf" content="([0-9a-f]+)"/)[1] };
}
function raw(port, head) {
  return new Promise((resolve) => {
    const c = net.connect(port, '127.0.0.1', () => c.write(head));
    let out = '';
    c.on('data', (d) => { out += d; });
    c.on('close', () => resolve(out));
    c.setTimeout(2000, () => c.destroy());
  });
}

test('form server: binds to 127.0.0.1 only', () => withServer(async (s) => {
  const a = s.server.address();
  assert.equal(a.address, '127.0.0.1');
  assert.equal(a.family, 'IPv4');
  assert.ok(a.port > 1023);
  assert.ok(!s.url.includes('0.0.0.0'));
}));

test('form server: requests without a token are refused', () => withServer(async (s) => {
  assert.equal((await fetch(`${base(s)}/`)).status, 403);
  assert.equal((await fetch(`${base(s)}/`, { headers: { cookie: 'yaw_session=nope' } })).status, 403);
}));

test('form server: a wrong start token is refused and does not use the real one up', () => withServer(async (s) => {
  assert.equal((await fetch(`${base(s)}/?t=${'0'.repeat(64)}`, { redirect: 'manual' })).status, 403);
  assert.equal((await fetch(s.url, { redirect: 'manual' })).status, 303);
}));

test('form server: the start token works once', () => withServer(async (s) => {
  assert.equal((await fetch(s.url, { redirect: 'manual' })).status, 303);
  assert.equal((await fetch(s.url, { redirect: 'manual' })).status, 403);
}));

test('form server: a valid session gets the page with CSP and the cookie flags', () => withServer(async (s) => {
  const r = await fetch(s.url, { redirect: 'manual' });
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  const setCookie = r.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  const ok = await fetch(`${base(s)}/`, { headers: { cookie: setCookie.split(';')[0] } });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-security-policy'), /default-src 'self'/);
  const html = await ok.text();
  assert.match(html, /YAW setup/);
  assert.doesNotMatch(html, /https?:\/\/(?!127\.0\.0\.1)/);
  assert.doesNotMatch(html, /\b(src|href)=/);
}));

test('form server: a foreign Host header is refused', () => withServer(async (s) => {
  const { cookie } = await session(s);
  const res = await raw(s.port, `GET / HTTP/1.1\r\nHost: evil.example\r\nCookie: ${cookie}\r\nConnection: close\r\n\r\n`);
  assert.match(res, /^HTTP\/1\.1 421/);
  const wrongPort = await raw(s.port, `GET / HTTP/1.1\r\nHost: 127.0.0.1:1\r\nCookie: ${cookie}\r\nConnection: close\r\n\r\n`);
  assert.match(wrongPort, /^HTTP\/1\.1 421/);
  const local = await raw(s.port, `GET / HTTP/1.1\r\nHost: localhost:${s.port}\r\nCookie: ${cookie}\r\nConnection: close\r\n\r\n`);
  assert.match(local, /^HTTP\/1\.1 200/);
}));

test('form server: a foreign Origin is refused', () => withServer(async (s) => {
  const { cookie } = await session(s);
  const res = await raw(s.port, `GET / HTTP/1.1\r\nHost: 127.0.0.1:${s.port}\r\nOrigin: https://evil.example\r\nCookie: ${cookie}\r\nConnection: close\r\n\r\n`);
  assert.match(res, /^HTTP\/1\.1 403/);
  const own = await fetch(`${base(s)}/`, { headers: { cookie, origin: base(s) } });
  assert.equal(own.status, 200);
}));

test('form server: POST needs the CSRF header; GET never changes state', () => withServer(async (s) => {
  const { cookie, csrf } = await session(s);
  const without = await fetch(`${base(s)}/apply`, { method: 'POST', headers: { cookie }, body: '{}' });
  assert.equal(without.status, 403);
  const wrong = await fetch(`${base(s)}/apply`, { method: 'POST', headers: { cookie, 'x-yaw-token': 'bad' }, body: '{}' });
  assert.equal(wrong.status, 403);
  const noCookie = await fetch(`${base(s)}/apply`, { method: 'POST', headers: { 'x-yaw-token': csrf }, body: '{}' });
  assert.equal(noCookie.status, 403);
  const valid = await fetch(`${base(s)}/apply`, { method: 'POST', headers: { cookie, 'x-yaw-token': csrf }, body: '{}' });
  assert.equal(valid.status, 404); // passes the checks; no endpoint yet
  assert.equal((await fetch(`${base(s)}/apply`, { headers: { cookie } })).status, 404);
  assert.equal((await fetch(`${base(s)}/`, { method: 'PUT', headers: { cookie, 'x-yaw-token': csrf } })).status, 405);
}));

test('form server: idle shutdown after the injected timeout, reset by requests', async () => {
  const s = await startFormServer({ signals: false, idleMs: 300 });
  const closed = new Promise((r) => s.server.once('close', r));
  const { cookie } = await session(s);
  await new Promise((r) => setTimeout(r, 200));
  await fetch(`${base(s)}/`, { headers: { cookie } }); // authenticated: resets the timer
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(s.server.listening, 'still up 400 ms in, the request reset the timer');
  await closed;
  assert.equal(s.server.listening, false);
  assert.equal(IDLE_MS, 30 * 60 * 1000);
});

test('form server: refused requests do not extend the idle timer', async () => {
  const s = await startFormServer({ signals: false, idleMs: 400 });
  const closed = new Promise((r) => s.server.once('close', r));
  const t0 = Date.now();
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 150));
    if (!s.server.listening) break;
    await raw(s.port, 'GET / HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n');
    await fetch(`${base(s)}/`).catch(() => {}); // no cookie
  }
  await closed;
  assert.ok(Date.now() - t0 < 900, 'closed on the original deadline');
});

test('form server: malformed request targets get 400 and do not crash', () => withServer(async (s) => {
  for (const target of ['//[', 'http://[']) {
    const res = await raw(s.port, `GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${s.port}\r\nConnection: close\r\n\r\n`);
    assert.match(res, /^HTTP\/1\.1 400/, target);
    const alive = await raw(s.port, `GET / HTTP/1.1\r\nHost: 127.0.0.1:${s.port}\r\nConnection: close\r\n\r\n`);
    assert.match(alive, /^HTTP\/1\.1 403/);
  }
}));

test('form server: Origin null and duplicate Host are refused', () => withServer(async (s) => {
  const { cookie } = await session(s);
  const nul = await raw(s.port, `GET / HTTP/1.1\r\nHost: 127.0.0.1:${s.port}\r\nOrigin: null\r\nCookie: ${cookie}\r\nConnection: close\r\n\r\n`);
  assert.match(nul, /^HTTP\/1\.1 403/);
  for (const hosts of [[`evil.example`, `127.0.0.1:${s.port}`], [`127.0.0.1:${s.port}`, `evil.example`]]) {
    const res = await raw(s.port, `GET / HTTP/1.1\r\nHost: ${hosts[0]}\r\nHost: ${hosts[1]}\r\nCookie: ${cookie}\r\nConnection: close\r\n\r\n`);
    assert.doesNotMatch(res, /^HTTP\/1\.1 200/, hosts.join(' + '));
  }
}));

test('form server: SIGINT stops the server', async () => {
  const code = `import { startFormServer } from ${JSON.stringify(new URL('../core/web/form-server.js', import.meta.url).href)};
const s = await startFormServer({ onClose: () => console.log('closed') });
console.log('ready');
`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  let sent = false;
  child.stdout.on('data', (d) => { out += d; if (!sent && out.includes('ready')) { sent = true; child.kill('SIGINT'); } });
  const [exitCode] = await once(child, 'exit');
  assert.equal(exitCode, 0);
  assert.match(out, /closed/);
  assert.doesNotMatch(out, /[0-9a-f]{64}/);
});
