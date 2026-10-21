// PostToolUseFailure on Bash (kind: evaluation; ADR-0030, M8): remember that `just check` failed. Prints nothing.
import { recordCheck } from '../lib/check.js';

export default function checkFail(event, ctx) {
  return recordCheck(event, ctx, 'fail');
}
