// Shared ordering for CLI choices and browser module cards.
export const GROUPS = [
  // Git & GitHub first: the answers there decide which other modules apply.
  ['github', 'Git & GitHub', 'Repository, commit checks and, on GitHub, issues and workflow rules.'],
  // Task List sits directly below Collaboration (Git & GitHub).
  ['tasks', 'Task List', 'Backlog, in-progress and done tasks with priorities for coding agents.'],
  ['basics', 'Coding Style', 'Rules, standards, local configuration and guards.'],
  ['memory', 'Advanced Coding Rules', 'Code map, decisions and sessions.'],
  ['quality', 'Review Sub-Agents', 'Code, logic, UI, feature and security reviews.'],
  ['comfort', 'Coding Assistance', 'Personal helpers on your machine; no model tokens.'],
];

// Card order inside a group (T-034): the Coding Style cards go rules, standards, tests, local settings, guard.
// "unit-tests" is the Unit Tests switch, which is a question rather than a module. Unlisted cards follow, in given order.
export const CARD_ORDER = { basics: ['core', 'standards', 'unit-tests', 'devenv', 'security'] };
export function orderCards(group, names) {
  const order = CARD_ORDER[group] ?? [];
  const rank = (name) => order.includes(name) ? order.indexOf(name) : order.length;
  return names.map((name, i) => [name, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([name]) => name);
}
