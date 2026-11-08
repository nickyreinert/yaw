// Compact levers and their precedence (T-049), without the user store: imports node builtins only, so the
// lean compress hook (T-053, T-054) can resolve them. lib/settings.js reads and writes ~/.yaw/compact.json.

import { realpathSync } from 'node:fs';

export const LEVERS = ['recipes', 'hook'];

// The key of a project in ~/.yaw/compact.json.
export function projectKey(root) {
  try { return realpathSync(root); } catch { return root; }
}

// The personal levers of a project from the parsed compact.json, or null when there are none.
export function personalLevers(data, root) {
  const levers = data?.projects?.[projectKey(root)];
  return Array.isArray(levers) ? levers.filter((l) => LEVERS.includes(l)) : null;
}

// -> { levers, source: 'env' | 'personal' | 'project' | 'default' }. `answers` are the project's answers; a
// project that marked itself personal keeps its levers out of them, so they are not read as a committed choice.
export function resolveLevers({ env, answers = {}, personal = null }) {
  const project = answers['compact.personal'] === true || !Array.isArray(answers['compact.levers']) ? null : answers['compact.levers'];
  const configured = personal ?? project;
  if (env.YAW_COMPACT === '0') return { levers: [], source: 'env' };
  if (env.YAW_COMPACT === '1') return { levers: configured ?? [...LEVERS], source: 'env' };
  if (personal) return { levers: personal, source: 'personal' };
  if (project) return { levers: project, source: 'project' };
  return { levers: [], source: 'default' };
}
