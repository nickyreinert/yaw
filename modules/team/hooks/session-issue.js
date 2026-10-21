// SessionStart (kind: context; ADR-0031): the active issue, one line: the active-task re-injection of BUILD.md
// rule 5. Local only: the branch name and the title from the session-sync cache (no network). Off with the answer
// team.session-context: false.

import { readAnswers } from '../../../core/render/project.js';
import { branchState, makeGit } from '../lib/git.js';
import { cacheFile, readCache } from '../lib/sync.js';

export default function sessionIssue(event, { root, env }) {
  try {
    if (readAnswers(root).answers['team.session-context'] === false) return null;
  } catch { /* no answers file: the default (on) */ }
  const state = branchState(root, makeGit(root, env), { local: true });
  if (!state?.issue) return null;
  const title = readCache(cacheFile(root, env))?.data.issues.find((i) => i.number === state.issue)?.title;
  return { context: `Active issue: #${state.issue}${title ? ` "${title}"` : ''} (branch ${state.branch}).` };
}
