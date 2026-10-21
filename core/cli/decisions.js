// `yaw decisions <verb>` (Y-5.6, ADR-0028): thin wrapper; the logic is the decisions module's
// (modules/decisions/lib/cli.js).

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { enabledModules, requireManifest } from '../render/project.js';
import { UsageError } from './commands.js';

export async function decisions({ values, positionals, io }) {
  const manifest = requireManifest(io.cwd);
  if (!enabledModules(manifest).includes('decisions')) throw new UsageError('the decisions module is not installed; run: yaw add decisions');
  const lib = await import(pathToFileURL(join(io.kitRoot, 'modules', 'decisions', 'lib', 'cli.js')).href);
  const [verb, ...args] = positionals;
  try {
    return await lib.runDecisions({ verb, args, values, io: { ...io, root: io.cwd } });
  } catch (e) {
    if (e instanceof lib.DecisionsUsageError) throw new UsageError(`${e.message}\n${lib.USAGE}`);
    throw e;
  }
}
