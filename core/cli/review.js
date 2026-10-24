// `yaw review <run|gate|prompt|install>` (ADR-0055): thin wrapper; the logic is the review module's
// (modules/review/lib/cli.js). gate reads git's pre-push ref lines from stdin.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function review({ positionals, io }) {
  const lib = await import(pathToFileURL(join(io.kitRoot, 'modules', 'review', 'lib', 'cli.js')).href);
  const [verb, ...args] = positionals;
  let stdin = '';
  if (verb === 'gate') {
    try {
      stdin = io.stdinText ?? readFileSync(0, 'utf8');
    } catch { /* no ref lines: nothing to review */ }
  }
  try {
    return lib.runReview({ verb, args, io: { ...io, root: io.cwd }, stdin });
  } catch (e) {
    if (e instanceof lib.ReviewUsageError) {
      io.stderr.write(`yaw review: ${e.message}\n${lib.USAGE}\n`);
      return 2;
    }
    throw e;
  }
}
