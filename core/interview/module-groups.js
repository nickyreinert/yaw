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
