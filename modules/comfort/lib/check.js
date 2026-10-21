// The last `just check` result (M8, ADR-0030): recorded from the agent's own Bash tool calls. PostToolUse is a
// pass and PostToolUseFailure a fail; only a plain `just check` (no shell operators, so the exit code is the
// recipe's) counts. Runs the user typed themselves in a terminal are not seen. Silent: evaluation hook.

import { realRoot } from '../../sessions/lib/registry.js';
import { writeCheck } from './state.js';

export const JUST_CHECK = /^\s*just\s+check(?:\s+[A-Za-z0-9_.=:@/-]+)*\s*$/;

export function recordCheck(event, { root, env }, status) {
  const command = event.input?.command;
  if (typeof command !== 'string' || command.length > 500 || !JUST_CHECK.test(command)) return null;
  writeCheck(env, realRoot(root), status, event.ts);
  return null;
}
