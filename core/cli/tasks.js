// `yaw task <verb>` (Y-5.3, ADR-0010): thin wrapper; the logic is the tasks module's (modules/tasks/lib/cli.js).

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { enabledModules, requireManifest } from '../render/project.js';
import { UsageError } from './commands.js';

export async function task({ values, positionals, io }) {
  const manifest = requireManifest(io.cwd);
  if (!enabledModules(manifest).includes('tasks')) throw new UsageError('the tasks module is not installed; run: yaw add tasks');
  const lib = await import(pathToFileURL(join(io.kitRoot, 'modules', 'tasks', 'lib', 'cli.js')).href);
  const [verb, ...args] = positionals;
  try {
    return await lib.runTask({ verb, args, values, mode: manifest.modules.tasks.mode ?? 'local', io: { ...io, root: io.cwd } });
  } catch (e) {
    if (e instanceof lib.TaskUsageError) throw new UsageError(`${e.message}\n${lib.USAGE}`);
    throw e;
  }
}
