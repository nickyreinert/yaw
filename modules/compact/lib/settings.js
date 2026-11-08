// Compact output settings (T-049, kickoff/16-compact-output.md §4). A committed project answer lives in
// .yaw/answers.yaml; a personal one in ~/.yaw/compact.json, keyed by project root, so it is never committed.
// Precedence at run time: YAW_COMPACT=0|1, then the personal setting, then the project answer.

import { realpathSync } from 'node:fs';
import { readUserData, writeUserData } from '../../../core/lib/user-store.js';

export const LEVERS = ['recipes', 'hook'];
const FILE = 'compact.json';

function key(root) {
  try { return realpathSync(root); } catch { return root; }
}

// The personal levers of a project, or null when there are none.
export function readPersonal(env, root) {
  const levers = readUserData(env, FILE)?.projects?.[key(root)];
  return Array.isArray(levers) ? levers.filter((l) => LEVERS.includes(l)) : null;
}

// levers: array to set, null to clear the project's entry.
export function writePersonal(env, root, levers) {
  const projects = { ...(readUserData(env, FILE)?.projects ?? {}) };
  if (levers === null) {
    if (!Object.hasOwn(projects, key(root))) return;
    delete projects[key(root)];
  } else projects[key(root)] = levers;
  writeUserData(env, FILE, { version: 1, projects });
}

// -> { levers, source: 'env' | 'personal' | 'project' | 'default' }. `answers` are the project's answers; a
// project that marked itself personal keeps its levers out of them, so they are not read as a committed choice.
export function resolveCompact({ env, root, answers = {}, personal = readPersonal(env, root) }) {
  const project = answers['compact.personal'] === true || !Array.isArray(answers['compact.levers']) ? null : answers['compact.levers'];
  const configured = personal ?? project;
  if (env.YAW_COMPACT === '0') return { levers: [], source: 'env' };
  if (env.YAW_COMPACT === '1') return { levers: configured ?? [...LEVERS], source: 'env' };
  if (personal) return { levers: personal, source: 'personal' };
  if (project) return { levers: project, source: 'project' };
  return { levers: [], source: 'default' };
}
