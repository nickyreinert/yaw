// Project switching for the single dashboard server: the browser names a workspace per request, and the server
// accepts it only when it is a known YAW project (opened with yaw web, added in the dashboard, or seen in a saved
// session scan) whose folder still has a YAW manifest. The server never serves arbitrary folders.
import { lstatSync, realpathSync } from 'node:fs';
import { basename, isAbsolute } from 'node:path';
import { readManifest } from '../render/manifest.js';
import { readUserData, writeUserData } from '../lib/user-store.js';
import { FormError } from './form-model.js';

const FILE = 'web-projects.json', LIMIT = 200;
const canonical = (path) => { try { return realpathSync(path); } catch { return null; } };
const isProject = (path) => {
  try { return lstatSync(path).isDirectory() && Boolean(readManifest(path)); } catch { return false; }
};

function candidates(env) {
  const saved = readUserData(env, FILE)?.projects ?? [];
  let scanned = [];
  try { scanned = (readUserData(env, 'session-analysis.json')?.rows ?? []).map((r) => r.project); } catch { /* listing still works */ }
  return [...new Set([...saved, ...scanned].filter((p) => typeof p === 'string' && isAbsolute(p)))];
}

export function rememberProject(env, path) {
  const root = typeof path === 'string' && isAbsolute(path) ? canonical(path) : null;
  if (!root || !isProject(root)) return null;
  const doc = readUserData(env, FILE) ?? {};
  doc.projects = [root, ...(doc.projects ?? []).filter((p) => p !== root)].slice(0, LIMIT);
  writeUserData(env, FILE, doc);
  return root;
}

export function projectSwitcher({ env, root }) {
  let preferred = canonical(root) ?? root;
  if (isProject(preferred)) rememberProject(env, preferred);
  return {
    // `yaw web` from another folder reuses this server and makes that folder the default for new tabs.
    open(path) {
      const opened = rememberProject(env, path);
      if (opened) preferred = opened;
      return opened;
    },
    resolve(value) {
      if (value === undefined || value === null || value === '') return preferred;
      if (typeof value !== 'string' || !isAbsolute(value)) throw new FormError('Choose a project from the project list.');
      const wanted = canonical(value);
      if (wanted && wanted === preferred) return preferred;
      if (!wanted || !candidates(env).includes(wanted) || !isProject(wanted)) throw new FormError('Unknown project; add its folder in the project switcher first.', 404);
      return wanted;
    },
    list() {
      const roots = [...new Set([preferred, ...candidates(env)])].filter(isProject).slice(0, LIMIT);
      return { current: preferred, projects: roots.map((p) => ({ root: p, name: basename(p) })).sort((a, b) => a.name.localeCompare(b.name)) };
    },
    add(path) {
      if (typeof path !== 'string' || !isAbsolute(path.trim()) || path.length > 4096) throw new FormError('Give the absolute path of a project folder.');
      const target = canonical(path.trim());
      if (!target) throw new FormError('That folder does not exist.');
      if (!isProject(target)) throw new FormError('That folder has no YAW setup (.yaw/manifest.json); run yaw init there first.');
      rememberProject(env, target);
      return { root: target, name: basename(target), message: `Added ${basename(target)} to the project switcher.` };
    },
  };
}
