import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { lanFetch } from '../core/remote/lan.js';

const serve = async (handler) => {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/x`, close: () => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); } };
};

test('lanFetch resolves bodyless statuses without throwing', async () => {
  for (const status of [204, 304]) {
    const s = await serve((_req, res) => { res.statusCode = status; res.end(); });
    try {
      const res = await lanFetch(s.url);
      assert.equal(res.status, status);
      assert.equal(await res.text(), '');
    } finally { await s.close(); }
  }
});

test('lanFetch rejects instead of throwing on invalid responses', async () => {
  const s = await serve((_req, res) => { res.statusCode = 200; res.write('partial'); setTimeout(() => res.destroy(), 20); });
  try { await assert.rejects(lanFetch(s.url), /LAN/); } finally { await s.close(); }
});
