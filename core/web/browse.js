// Folder browser for the local UI (project switcher, sync target): lists sub-folders only, never files, and only
// to an authenticated local session. Hidden folders are left out.
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { FormError } from './form-model.js';

const LIMIT = 500;
const isDir = (path) => { try { return statSync(path).isDirectory(); } catch { return false; } };

export function browseFolders(path) {
  const start = path ? String(path) : homedir();
  if (!isAbsolute(start) || start.length > 4096) throw new FormError('Give an absolute folder path.');
  let dir;
  try { dir = realpathSync(start); } catch { throw new FormError('That folder does not exist.', 404); }
  if (!isDir(dir)) throw new FormError('That is not a folder.', 404);
  let names;
  try { names = readdirSync(dir, { withFileTypes: true }); } catch { throw new FormError('That folder cannot be read.', 403); }
  const entries = names.filter((e) => !e.name.startsWith('.') && (e.isDirectory() || (e.isSymbolicLink() && isDir(join(dir, e.name)))))
    .map((e) => ({ name: e.name, path: join(dir, e.name), yaw: existsSync(join(dir, e.name, '.yaw', 'manifest.json')) }))
    .sort((a, b) => a.name.localeCompare(b.name)).slice(0, LIMIT);
  return { path: dir, parent: dirname(dir) === dir ? null : dirname(dir), home: homedir(), yaw: existsSync(join(dir, '.yaw', 'manifest.json')), entries };
}
