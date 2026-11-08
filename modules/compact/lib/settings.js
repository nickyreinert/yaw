// Compact output settings (T-049, kickoff/16-compact-output.md §4). The levers are a team setting (T-027): the
// answer lives in .yaw/answers.yaml and is committed for everyone. YAW_COMPACT=0|1 overrides it per shell.

import { LEVERS, resolveLevers } from './levers.js';

export { LEVERS };

// -> { levers, source }, see resolveLevers.
export function resolveCompact({ env, answers = {} }) {
  return resolveLevers({ env, answers });
}
