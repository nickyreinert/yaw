// PreToolUse guard (kind: guard; ADR-0031): no edit inside the project without an issue branch (doc 14 §2).

import { branchState, makeGit } from '../lib/git.js';
import { editDecision, touchesProject } from '../lib/guards.js';

export default function guardEdit(event, { root, env }) {
  if (!touchesProject(root, event.input.paths)) return null;
  const reason = editDecision(branchState(root, makeGit(root, env), { local: true }));
  return reason ? { decision: 'deny', reason } : null;
}
