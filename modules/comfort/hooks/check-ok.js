// PostToolUse on Bash (kind: evaluation; ADR-0030, M8): remember that `just check` passed. Prints nothing.
import { recordCheck } from '../lib/check.js';

export default function checkOk(event, ctx) {
  return recordCheck(event, ctx, 'pass');
}
