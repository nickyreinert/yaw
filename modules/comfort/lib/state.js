// Small personal state of the comfort module under ~/.yaw/state/comfort/ (ADR-0030): one file per session
// (prompt count, topic vector, hint bookkeeping), the last `just check` result and the hygiene switch per
// project. Nothing here holds prompt text, transcript content, tool output or secrets. Every path is checked
// before it is used: ids are matched against a pattern, no component may be a link, files are written
// atomically with mode 0600 in 0700 directories. Nothing here throws to the caller that wants "best effort":
// the read functions return null, the write functions return false.

import { createHash } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homeDir, readSmallFile } from './config.js';

export const NATIVE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const AGENTS = ['claude', 'codex', 'copilot'];
const KEEP_MS = 14 * 24 * 60 * 60 * 1000; // session files older than this are removed
const MAX_STATE_BYTES = 256 * 1024;

export const projectKey = (realRoot) => createHash('sha256').update(String(realRoot)).digest('hex').slice(0, 24);

// ~/.yaw/state/comfort/<...parts>, created with 0700 and refused when any existing component is a link.
function dir(env, ...parts) {
  const home = homeDir(env);
  if (home === null) return null;
  let cur = home;
  for (const part of ['state', 'comfort', ...parts]) {
    cur = join(cur, part);
    try {
      const st = lstatSync(cur);
      if (st.isSymbolicLink() || !st.isDirectory()) return null;
    } catch (e) {
      if (e.code !== 'ENOENT') return null;
      try {
        mkdirSync(cur, { recursive: true, mode: 0o700 });
        chmodSync(cur, 0o700);
      } catch {
        return null;
      }
    }
  }
  return cur;
}

export function readJson(file) {
  const text = readSmallFile(file, MAX_STATE_BYTES);
  if (text === null) return null;
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    try {
      const st = lstatSync(file);
      if (st.isSymbolicLink() || !st.isFile()) return false;
    } catch (e) {
      if (e.code !== 'ENOENT') return false;
    }
    writeFileSync(tmp, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' });
    renameSync(tmp, file);
    return true;
  } catch {
    try {
      rmSync(tmp, { force: true });
    } catch { /* nothing to clean */ }
    return false;
  }
}

// ------------------------------------------------------------------------------------------ sessions

export function sessionFile(env, agent, native) {
  if (!AGENTS.includes(agent) || typeof native !== 'string' || !NATIVE_ID.test(native)) return null;
  const d = dir(env, 'sessions');
  return d === null ? null : join(d, `${agent}-${native}.json`);
}

export function readSession(env, agent, native) {
  const file = sessionFile(env, agent, native);
  return file === null ? null : readJson(file);
}

export function writeSession(env, agent, native, value) {
  const file = sessionFile(env, agent, native);
  return file === null ? false : writeJson(file, value);
}

// Remove session files not touched for 14 days (only files named like ours).
export function pruneSessions(env, now = Date.now()) {
  const d = dir(env, 'sessions');
  if (d === null) return;
  try {
    for (const name of readdirSync(d)) {
      if (!/^(claude|codex|copilot)-[A-Za-z0-9._-]+\.json$/.test(name)) continue;
      const st = lstatSync(join(d, name));
      if (st.isFile() && now - st.mtimeMs > KEEP_MS) rmSync(join(d, name), { force: true });
    }
  } catch { /* pruning is best effort */ }
}

// ------------------------------------------------------------------------------------------ last `just check`

function checkFile(env, realRoot) {
  const d = dir(env, 'check');
  return d === null ? null : join(d, `${projectKey(realRoot)}.json`);
}

export function readCheck(env, realRoot) {
  const file = checkFile(env, realRoot);
  const v = file === null ? null : readJson(file);
  return v && (v.status === 'pass' || v.status === 'fail') && typeof v.at === 'string' && !Number.isNaN(Date.parse(v.at)) ? v : null;
}

export function writeCheck(env, realRoot, status, at) {
  const file = checkFile(env, realRoot);
  return file === null ? false : writeJson(file, { v: 1, status, at });
}

// ------------------------------------------------------------------------------------------ hygiene switch

// { all: boolean, projects: [projectKey] }
export function readSwitch(env) {
  const d = dir(env);
  const v = d === null ? null : readJson(join(d, 'hygiene.json'));
  return { all: v?.all === true, projects: Array.isArray(v?.projects) ? v.projects.filter((k) => typeof k === 'string' && /^[0-9a-f]{24}$/.test(k)) : [] };
}

export function writeSwitch(env, value) {
  const d = dir(env);
  return d === null ? false : writeJson(join(d, 'hygiene.json'), { v: 1, all: value.all === true, projects: [...new Set(value.projects)] });
}

export const hygieneMuted = (env, realRoot) => {
  const s = readSwitch(env);
  return s.all || s.projects.includes(projectKey(realRoot));
};
