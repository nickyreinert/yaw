// `yaw map <update|check|show>` (Y-5.11, ADR-0033): thin wrapper; the logic is the code-map module's
// (modules/code-map/lib/cli.js).

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { enabledModules, requireManifest } from '../render/project.js';
import { UsageError } from './commands.js';

export async function map({ positionals, io }) {
  const manifest = requireManifest(io.cwd);
  if (!enabledModules(manifest).includes('code-map')) throw new UsageError('the code-map module is not installed; run: yaw add code-map');
  const lib = await import(pathToFileURL(join(io.kitRoot, 'modules', 'code-map', 'lib', 'cli.js')).href);
  const [verb, ...args] = positionals;
  try {
    return lib.runMap({ verb, args, io: { ...io, root: io.cwd } });
  } catch (e) {
    if (e instanceof lib.MapUsageError) {
      io.stderr.write(`yaw map: ${e.message}\n${lib.USAGE}\n`);
      return 2;
    }
    throw e;
  }
}
