// Local opt-in only: never synced as a personal default or activated by provider credentials.
import { readUserData, writeUserData } from './user-store.js';
import { realpathSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';

export const REMOTE_SETTINGS_FILE = 'remote-settings.json';
export function remoteSettings(env = process.env) {
  let doc;
  try { doc = readUserData(env, REMOTE_SETTINGS_FILE); } catch { /* Unreadable optional settings stay disabled without breaking ordinary commands. */ }
  try { validate(doc); return doc; } catch { return { enabled: false, port: 4318 }; }
}
export function requireRemoteEnabled(env) {
  if (!remoteSettings(env).enabled) throw new Error('Remote Control is disabled. Enable it in yaw web → Global → Settings → Features.');
}
function validate(input) {
  if (!input || Array.isArray(input) || Object.keys(input).some((key) => !['enabled', 'port', 'role', 'address', 'workspaceRoot', 'bindAddress'].includes(key)) || typeof input.enabled !== 'boolean' ||
    !Number.isInteger(input.port) || input.port < 1024 || input.port > 65535) throw new Error('Supply an enabled switch and a port from 1024 to 65535');
  if (input.role !== undefined && !['host', 'client'].includes(input.role)) throw new Error('Choose Host or Client');
  if (input.role === undefined && ['address', 'workspaceRoot', 'bindAddress'].some((key) => input[key] !== undefined)) throw new Error('Choose Host or Client');
  if (input.role === 'client' && (typeof input.address !== 'string' || !input.address || input.address.length > 2048 || input.workspaceRoot !== undefined || input.bindAddress !== undefined)) throw new Error('Supply one server address for the client');
  if (input.role === 'host' && (typeof input.workspaceRoot !== 'string' || !isAbsolute(input.workspaceRoot) || typeof input.bindAddress !== 'string' || input.address !== undefined)) throw new Error('Confirm a host workspace folder and LAN interface');
}
export function saveRemoteSettings(env, input, { root, confirmWorkspace = false, migrate = false } = {}) {
  validate(input);
  if (typeof confirmWorkspace !== 'boolean' || typeof migrate !== 'boolean') throw new Error('Workspace and migration confirmations must be true or false');
  const previous = remoteSettings(env);
  if (input.enabled && input.role === 'host') {
    const authority = readUserData(env, 'hub-sync.json');
    const folder = readUserData(env, 'sync-config.json');
    if (authority && !authority.hostMode) throw new Error('This machine is a hub client. Migrate its data authority before enabling Host mode');
    if (!authority?.hostMode && folder?.scopes.some((scope) => ['settings', 'presets', 'statistics'].includes(scope)) && !migrate) throw new Error('Confirm migration of existing folder/GitHub writers; sync and back up the vault first');
  }
  if (input.role === 'host' && (previous.role !== 'host' || previous.workspaceRoot !== input.workspaceRoot)) {
    if (!root || !confirmWorkspace || input.workspaceRoot !== join(realpathSync(root), 'workspaces')) throw new Error('Confirm that workspaces in the current folder will be the host workspace folder');
  }
  const settings = { ...input };
  if (settings.enabled && settings.role === 'host') writeUserData(env, 'hub-sync.json', { ...readUserData(env, 'hub-sync.json'), version: 1, hostMode: true, scopes: ['settings', 'presets', 'statistics'] });
  writeUserData(env, REMOTE_SETTINGS_FILE, settings); return settings;
}
