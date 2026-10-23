// `yaw sessions <verb>` (Y-5.7, ADR-0029; import #174): thin wrapper; the logic is the sessions module's
// (modules/sessions/lib/cli.js).

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { enabledModules, requireManifest } from '../render/project.js';
import { UsageError } from './commands.js';

export async function sessions({ values, positionals, io }) {
  const [verb, ...args] = positionals;
  // `import` (#174) also works in a project without YAW or without the sessions module: it only fills ~/.yaw/yaw.db.
  if (verb !== 'import') {
    const manifest = requireManifest(io.cwd);
    if (!enabledModules(manifest).includes('sessions')) throw new UsageError('the sessions module is not installed; run: yaw add sessions');
  }
  const lib = await import(pathToFileURL(join(io.kitRoot, 'modules', 'sessions', 'lib', 'cli.js')).href);
  try {
    if (verb === 'import') return await lib.runImport({ args, values, io: { ...io, root: io.cwd } });
    return lib.runSessions({ verb, args, values, io: { ...io, root: io.cwd } });
  } catch (e) {
    if (e instanceof lib.SessionsUsageError) throw new UsageError(`${e.message}\n${lib.USAGE}`);
    throw e;
  }
}
