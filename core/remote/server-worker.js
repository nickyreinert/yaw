import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { watchFile, unwatchFile } from 'node:fs';
import { remoteSettings, REMOTE_SETTINGS_FILE } from '../lib/remote-settings.js';
import { writeUserData, userDataDir } from '../lib/user-store.js';
import { remoteStore, digest, requireValue } from './store.js';
import { connectClient } from './server-client.js';

let service, ready = false;
process.once('disconnect', () => { if (!ready) service?.close(); });
process.once('message', async ({ kitRoot }) => {
  try {
    const settings = remoteSettings(), fingerprint = digest(JSON.stringify(settings));
    requireValue(settings.enabled && ['host', 'client'].includes(settings.role), 'Enable Server mode first');
    if (settings.role === 'host') {
      const { startHostServer } = await import('./host.js'); service = await startHostServer({ kitRoot });
    } else {
      const store = remoteStore(process.env), token = randomBytes(32).toString('hex');
      const file = join(userDataDir(process.env), REMOTE_SETTINGS_FILE);
      let connection = { status: 'connecting' }, busy = false, closing, timer;
      const server = http.createServer(async (req, res) => {
        req.resume();
        if (req.headers.host !== `127.0.0.1:${server.address().port}` || req.headers.origin !== undefined || req.headers.authorization !== `Bearer ${token}`) { res.writeHead(403); return res.end(); }
        res.setHeader('content-type', 'application/json');
        if (req.method === 'GET' && req.url === '/api/background-status') return res.end(JSON.stringify({ role: 'client', fingerprint, connection }));
        if (req.method === 'GET' && req.url === '/api/background-refresh') { await tick(); return res.end(JSON.stringify({ role: 'client', fingerprint, connection })); }
        if (req.method === 'POST' && req.url === '/api/background-stop') { res.once('finish', () => close()); return res.end('{"stopped":true}'); }
        res.writeHead(404); res.end('{}');
      });
      const changed = () => { if (digest(JSON.stringify(remoteSettings())) !== fingerprint) close(); };
      const close = () => closing ??= (async () => {
        clearInterval(timer); unwatchFile(file, changed); process.off('SIGINT', close); process.off('SIGTERM', close);
        await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
        writeUserData(process.env, 'server-runtime.json', null); store.close();
      })();
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      const address = `http://127.0.0.1:${server.address().port}`;
      writeUserData(process.env, 'server-runtime.json', { address, token });
      service = { close, address };
      const tick = async () => {
        if (busy || closing) return; busy = true;
        try { connection = await connectClient({ env: process.env, kitRoot }); }
        catch (e) { connection = { status: 'failed', message: e.status ? e.message : 'Sync failed; review existing sync authority and server pairing' }; }
        finally { busy = false; }
      };
      tick(); timer = setInterval(tick, 30000); timer.unref();
      watchFile(file, { interval: 500, persistent: false }, changed); process.once('SIGINT', close); process.once('SIGTERM', close);
    }
    if (!process.connected) return await service.close();
    process.send({ address: service.address, role: settings.role, fingerprint }, (error) => { if (error) service.close(); else ready = true; });
  } catch { await service?.close(); if (process.connected) process.send({ error: 'Server could not start. Check the selected LAN interface, port and existing service.' }, () => process.disconnect()); process.exitCode = 1; }
});
