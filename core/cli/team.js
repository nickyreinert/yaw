// `yaw session-start` (Y-5.9, ADR-0031): thin wrapper; the logic is the team module's (modules/team/lib/cli.js).

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { enabledModules, requireManifest } from '../render/project.js';
import { UsageError } from './commands.js';

export async function sessionStart({ io }) {
  const manifest = requireManifest(io.cwd);
  if (!enabledModules(manifest).includes('team')) throw new UsageError('the team module is not installed; run: yaw add team');
  const lib = await import(pathToFileURL(join(io.kitRoot, 'modules', 'team', 'lib', 'cli.js')).href);
  return lib.runSessionStart({ io: { ...io, root: io.cwd } });
}
