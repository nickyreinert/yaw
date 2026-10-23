import { closeSync, fchmodSync, lstatSync, openSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveInside } from '../render/files.js';

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function envNames(example) {
  const names = [];
  for (const line of String(example).split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    if (match && !names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

export function validateSecretValues(values, names) {
  if (values === undefined) return {};
  if (values === null || typeof values !== 'object' || Array.isArray(values)) throw new Error('Invalid secret entries');
  const allowed = new Set(names);
  const selected = Object.create(null);
  for (const [name, value] of Object.entries(values)) {
    if (!ENV_NAME.test(name) || !allowed.has(name) || typeof value !== 'string' || value.length > 8192 || /[\0\r\n]/.test(value)) {
      throw new Error('Invalid secret entry; use a listed variable name and a single-line value up to 8192 characters');
    }
    if (value !== '') selected[name] = value;
  }
  return selected;
}

export function envFileExists(root) {
  try {
    lstatSync(join(root, '.env'));
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

// Creates a fresh, private .env only. It never reads or replaces an existing secret file.
export function writeEnvSecrets(root, names, values) {
  const entries = validateSecretValues(values, names);
  if (Object.keys(entries).length === 0) return { written: 0, preserved: false };
  const target = resolveInside(root, '.env');
  let fd;
  try {
    fd = openSync(target, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST') return { written: 0, preserved: true };
    throw error;
  }
  try {
    const content = `${names.map((name) => `${name}=${Object.hasOwn(entries, name) ? JSON.stringify(entries[name]) : ''}`).join('\n')}\n`;
    writeFileSync(fd, content, 'utf8');
    fchmodSync(fd, 0o600);
    return { written: Object.keys(entries).length, preserved: false };
  } catch (error) {
    closeSync(fd);
    fd = undefined;
    try {
      unlinkSync(target);
    } catch (cleanupError) {
      error.cleanupError = cleanupError;
    }
    throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
