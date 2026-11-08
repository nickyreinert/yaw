import { randomUUID } from 'node:crypto';
import { mkdirSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { readUserData, writeUserData, userDataDir } from '../lib/user-store.js';
import { portableSnapshot, portableScope, applyPortableRecords, validateVault, mergeRecords } from '../lib/data-sync.js';
import { requireValue } from './store.js';
import { requireRemoteEnabled } from '../lib/remote-settings.js';
import { lanOrigin, lanFetch } from './lan.js';

export function hubUrl(value) {
  const url = new URL(value);
  requireValue(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash,
    'Use a loopback http://host:port URL through an SSH tunnel');
  return url.origin;
}
export function configureHubClient({ env, url, tokenEnv = 'YAW_HUB_TOKEN', scopes = ['settings', 'presets', 'statistics'], migrate = false, serverMode = false }) {
  requireRemoteEnabled(env);
  const origin = serverMode ? lanOrigin(url) : hubUrl(url);
  requireValue(/^[A-Z][A-Z0-9_]{0,79}$/.test(tokenEnv), 'Give a credential environment variable name');
  requireValue(Array.isArray(scopes) && scopes.length && scopes.every((s) => ['settings', 'presets', 'statistics', 'tasks', 'knowledge'].includes(s)), 'Choose supported sync scopes');
  const old = readUserData(env, 'hub-sync.json');
  requireValue(!old || old.url === origin, 'Changing hub authority requires an explicit dataset migration');
  requireValue(!old || old.scopes.every((s) => scopes.includes(s)), 'Retain previously migrated scopes; changing authority requires an explicit migration');
  const folder = readUserData(env, 'sync-config.json');
  requireValue(migrate || scopes.every((s) => old?.scopes.includes(s)) || !folder?.scopes.some((s) => scopes.includes(s)), 'Back up the vault, import it on the hub, then use --migrate to switch these writers');
  writeUserData(env, 'hub-sync.json', { version: 1, url: origin, tokenEnv, scopes: [...new Set(scopes)], ...(serverMode ? { serverMode: true } : {}) });
  return { configured: true, url: origin, scopes };
}
export async function syncHub({ env, kitRoot, resolution, fetchFn = fetch }) {
  requireRemoteEnabled(env);
  requireValue(resolution === undefined || ['local', 'remote'].includes(resolution), 'Resolve conflicts with local or remote');
  const cfg = readUserData(env, 'hub-sync.json'); requireValue(cfg, 'Configure the hub client first');
  const saved = cfg.serverMode ? readUserData(env, 'server-client.json') : null;
  const token = cfg.serverMode && saved?.address === cfg.url ? saved.token : env[cfg.tokenEnv]; requireValue(typeof token === 'string' && /^[a-f0-9]{64}$/.test(token), 'Enter the paired-device credential in its environment variable');
  const origin = cfg.serverMode ? lanOrigin(cfg.url) : hubUrl(cfg.url), lock = join(userDataDir(env), 'hub-sync.lock');
  if (cfg.serverMode && fetchFn === fetch) fetchFn = lanFetch;
  mkdirSync(lock, { mode: 0o700 });
  try {
    const call = async (method, body) => {
      let response;
      try { response = await fetchFn(`${origin}/api/hub`, { method, redirect: 'error', headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) }); }
      catch { throw new Error('Hub is unavailable; local edits remain pending'); }
      requireValue(response.ok, response.status === 409 ? 'Hub changed during sync; retry to merge the current revision' : 'Hub rejected the request; check pairing and revocation', response.status);
      const text = await response.text(); requireValue(Buffer.byteLength(text) <= 16 * 1024 * 1024, 'Hub exchange exceeds 16 MiB');
      const data = JSON.parse(text); requireValue(data.schema === 1 && Number.isSafeInteger(data.revision), 'Unsupported hub response');
      validateVault({ version: 1, records: data.records, devices: data.devices }, kitRoot); return data;
    };
    const state = readUserData(env, 'hub-sync-state.json') ?? { base: {} };
    const snapshot = portableSnapshot({ env, kitRoot, scopes: cfg.scopes, serverMode: cfg.serverMode === true });
    const remote = await call('GET');
    requireRemoteEnabled(env);
    const subset = (records) => Object.fromEntries(Object.entries(records).filter(([key]) => cfg.scopes.includes(portableScope(key))));
    const merged = mergeRecords(snapshot.records, subset(remote.records), subset(state.base), resolution, snapshot.excluded);
    if (merged.conflicts.length) { writeUserData(env, 'hub-sync-state.json', { ...state, conflicts: merged.conflicts }); return { conflicts: merged.conflicts }; }
    const accepted = await call('POST', { schema: 1, revision: remote.revision, commandId: randomUUID(), records: merged.records, device: snapshot.device });
    requireRemoteEnabled(env);
    // Do not overwrite edits made locally while the request was in flight.
    requireValue(JSON.stringify(snapshot.records) === JSON.stringify(portableSnapshot({ env, kitRoot, scopes: cfg.scopes, serverMode: cfg.serverMode === true }).records), 'Local settings changed during sync; retry');
    // Files that exist locally but cannot be synced keep their content and their previous merge base.
    const records = Object.fromEntries(Object.entries(subset(accepted.records)).filter(([key]) => !snapshot.excluded.includes(key))); applyPortableRecords({ env, records });
    const kept = Object.fromEntries(Object.entries(state.base ?? {}).filter(([key]) => snapshot.excluded.includes(key)));
    writeUserData(env, 'hub-sync-state.json', { base: { ...kept, ...records }, revision: accepted.revision, deviceId: accepted.deviceId, devices: accepted.devices, conflicts: [], lastSync: new Date().toISOString() });
    return { revision: accepted.revision, conflicts: [], excluded: snapshot.excluded, message: 'Hub sync complete.' };
  } finally { rmdirSync(lock); }
}
