// PreToolUse guard (kind: guard; ADR-0031): no commit on and no push to the default branch, no force push,
// no --no-verify (doc 14 §2). git is only asked when the command contains a git commit or push.

import { branchState, makeGit } from '../lib/git.js';
import { gitCalls, gitDecision } from '../lib/guards.js';

export default function guardGit(event, { root, env }) {
  const command = event.input.command;
  if (!command || !gitCalls(command).some((c) => c.sub === 'commit' || c.sub === 'push')) return null;
  const reason = gitDecision(command, branchState(root, makeGit(root, env), { local: true }));
  return reason ? { decision: 'deny', reason } : null;
}
