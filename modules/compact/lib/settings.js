// Compact output settings (T-049, kickoff/16-compact-output.md §4). A committed project answer lives in
// .yaw/answers.yaml; a personal one in ~/.yaw/compact.json, keyed by project root, so it is never committed.
// Precedence at run time: YAW_COMPACT=0|1, then the personal setting, then the project answer (lib/levers.js).

import { readUserData, writeUserData } from '../../../core/lib/user-store.js';
import { LEVERS, personalLevers, projectKey, resolveLevers } from './levers.js';

export { LEVERS };
const FILE = 'compact.json';

// The personal levers of a project, or null when there are none.
export function readPersonal(env, root) {
  return personalLevers(readUserData(env, FILE), root);
}

// levers: array to set, null to clear the project's entry.
export function writePersonal(env, root, levers) {
  const projects = { ...(readUserData(env, FILE)?.projects ?? {}) };
  const key = projectKey(root);
  if (levers === null) {
    if (!Object.hasOwn(projects, key)) return;
    delete projects[key];
  } else projects[key] = levers;
  writeUserData(env, FILE, { version: 1, projects });
}

// -> { levers, source }, see resolveLevers; the personal setting is read from ~/.yaw unless given.
export function resolveCompact({ env, root, answers = {}, personal = readPersonal(env, root) }) {
  return resolveLevers({ env, answers, personal });
}
