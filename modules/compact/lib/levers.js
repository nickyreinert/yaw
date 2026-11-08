// Compact levers and their precedence (T-049), without the user store: imports nothing, so the lean compress
// hook (T-053, T-054) can resolve them. The levers are a team setting (T-027), read from the project answers.

export const LEVERS = ['recipes', 'hook'];

// -> { levers, source: 'env' | 'project' | 'default' }. `answers` are the project's answers.
export function resolveLevers({ env, answers = {} }) {
  const project = Array.isArray(answers['compact.levers']) ? answers['compact.levers'] : null;
  if (env.YAW_COMPACT === '0') return { levers: [], source: 'env' };
  if (env.YAW_COMPACT === '1') return { levers: project ?? [...LEVERS], source: 'env' };
  if (project) return { levers: project, source: 'project' };
  return { levers: [], source: 'default' };
}
