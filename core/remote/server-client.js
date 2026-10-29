import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { remoteSettings, requireRemoteEnabled } from '../lib/remote-settings.js';
import { readUserData, writeUserData } from '../lib/user-store.js';
import { configureHubClient, syncHub } from './client.js';
import { lanOrigin, lanFetch } from './lan.js';
import { digest, requireValue } from './store.js';

export async function hostRequest({ env, path, input, local = false, fetchFn = lanFetch, timeout = 600000 }) {
  requireRemoteEnabled(env);
  const settings = remoteSettings(env);
  const cfg = local ? readUserData(env, 'server-runtime.json') : readUserData(env, 'server-client.json');
  requireValue(local ? settings.role === 'host' : settings.role === 'client', `This command requires ${local ? 'Host' : 'Client'} mode`);
  requireValue(cfg && (local || cfg.address === lanOrigin(settings.address)), 'Connect to the configured server first');
  const response = await fetchFn(`${lanOrigin(cfg.address)}${path}`, { method: input === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${cfg.token}`, ...(input === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }), signal: AbortSignal.timeout(timeout) });
  const value = await response.json();
  requireValue(response.ok, value.error ?? 'Server request failed', response.status);
  return value;
}

export function configureServerClient({ env, migrate = false }) {
  requireRemoteEnabled(env);
  const settings = remoteSettings(env);
  requireValue(settings.role === 'client', 'Choose Client mode');
  const address = lanOrigin(settings.address);
  let cfg = readUserData(env, 'server-client.json');
  if (!cfg || cfg.address !== address) {
    requireValue(!readUserData(env, 'hub-sync.json') || readUserData(env, 'hub-sync.json').url === address, 'Changing hub authority requires an explicit dataset migration');
    cfg = { address, token: randomBytes(32).toString('hex'), migrate };
    writeUserData(env, 'server-client.json', cfg);
  }
  if (migrate && !cfg.migrate) { cfg.migrate = true; writeUserData(env, 'server-client.json', cfg); }
  return cfg;
}
export async function connectClient({ env, kitRoot, migrate = false, fetchFn = lanFetch }) {
  const cfg = configureServerClient({ env, migrate }), address = cfg.address;
  if (!cfg.request) {
    const response = await fetchFn(`${address}/api/pair/request`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: hostname().replace(/[^\p{L}\p{N} _.-]/gu, '').slice(0, 64) || 'Client', hash: digest(cfg.token) }), signal: AbortSignal.timeout(10000) });
    const value = await response.json(); requireValue(response.ok, value.error ?? 'Pairing request refused');
    cfg.request = value.id; writeUserData(env, 'server-client.json', cfg);
  }
  const status = await hostRequest({ env, path: '/api/pair/status', fetchFn });
  if (status.status !== 'approved') {
    if (status.status === 'expired') { delete cfg.request; writeUserData(env, 'server-client.json', cfg); }
    return { ...status, verification: digest(cfg.token).slice(0, 12) };
  }
  configureHubClient({ env, url: address, serverMode: true, migrate: cfg.migrate || migrate });
  const result = await syncHub({ env, kitRoot, fetchFn });
  return { status: result.conflicts?.length ? 'conflict' : 'connected', ...result };
}
