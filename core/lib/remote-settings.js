// Local opt-in only: never synced as a personal default or activated by provider credentials.
import { readUserData, writeUserData } from './user-store.js';

export const REMOTE_SETTINGS_FILE = 'remote-settings.json';
export function remoteSettings(env = process.env) {
  let doc;
  try { doc = readUserData(env, REMOTE_SETTINGS_FILE); } catch { /* Unreadable optional settings stay disabled without breaking ordinary commands. */ }
  if (!doc || Array.isArray(doc) || Object.keys(doc).some((key) => !['enabled', 'port'].includes(key)) || typeof doc.enabled !== 'boolean' ||
    !Number.isInteger(doc.port) || doc.port < 1024 || doc.port > 65535) return { enabled: false, port: 4318 };
  return { enabled: doc.enabled, port: doc.port };
}
export function requireRemoteEnabled(env) {
  if (!remoteSettings(env).enabled) throw new Error('Remote Control is disabled. Enable it in yaw web → Global → Settings → Features.');
}
export function saveRemoteSettings(env, input) {
  if (!input || Array.isArray(input) || Object.keys(input).some((key) => !['enabled', 'port'].includes(key)) || typeof input.enabled !== 'boolean' ||
    !Number.isInteger(input.port) || input.port < 1024 || input.port > 65535) throw new Error('Supply an enabled switch and a port from 1024 to 65535');
  const settings = { enabled: input.enabled, port: input.port };
  writeUserData(env, REMOTE_SETTINGS_FILE, settings); return settings;
}
