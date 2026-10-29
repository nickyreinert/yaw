// LAN transport pins DNS on every request. No redirects, proxy headers or public addresses.
import http from 'node:http';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { hostname } from 'node:os';
import { privateAddress } from '../lib/lan-address.js';
import { RemoteError, requireValue } from './store.js';

export { privateAddress, lanInterfaces, defaultInterface } from '../lib/lan-address.js';
export function lanOrigin(value) {
  let url;
  try { url = new URL(value.includes('://') ? value : `http://${value}`); } catch { throw new RemoteError('Enter a LAN server address'); }
  requireValue(url.protocol === 'http:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash && url.port !== '0', 'Use an http://LAN-host:port address without credentials or a path');
  const name = url.hostname.replace(/^\[|\]$/g, '');
  requireValue(!isIP(name) || privateAddress(name), 'Only LAN and loopback addresses are supported');
  return url.origin;
}
export const allowedHosts = (bind, port) => new Set([`${bind}:${port}`, `127.0.0.1:${port}`, `localhost:${port}`, `${hostname()}:${port}`, `${hostname()}.local:${port}`]);

export async function lanFetch(value, { method = 'GET', headers = {}, body, signal } = {}) {
  const url = new URL(value), origin = lanOrigin(url.origin);
  const name = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(name) ? [{ address: name, family: isIP(name) }] : await lookup(name, { all: true, verbatim: true });
  requireValue(addresses.length && addresses.every((x) => privateAddress(x.address)), 'Server address must resolve only to LAN addresses');
  const target = addresses[0];
  return new Promise((resolve, reject) => {
    const req = http.request(new URL(url.pathname + url.search, origin), { method, headers, signal,
      lookup: (_host, options, callback) => callback(null, options.all ? [target] : target.address, target.family) }, (res) => {
      const chunks = []; let size = 0;
      res.on('data', (chunk) => { size += chunk.length; if (size > 16 * 1024 * 1024) res.destroy(new RemoteError('Server response exceeds 16 MiB')); else chunks.push(chunk); });
      res.on('error', reject);
      res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
    });
    req.setTimeout(signal ? 0 : 30000, () => req.destroy(new Error('Server request timed out')));
    req.on('error', () => reject(new RemoteError('LAN server is unavailable; pending work was not replayed', 503)));
    req.end(body);
  });
}
