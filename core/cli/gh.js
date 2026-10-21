// `yaw gh <verb>` (Y-5.5, ADR-0027): thin wrapper; the logic is the github module's (modules/github/lib/cli.js).

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPrompter, confirm } from './prompt.js';
import { enabledModules, requireManifest } from '../render/project.js';
import { UsageError } from './commands.js';

export async function gh({ values, positionals, io }) {
  const manifest = requireManifest(io.cwd);
  if (!enabledModules(manifest).includes('github')) throw new UsageError('the github module is not installed; run: yaw add github');
  const lib = await import(pathToFileURL(join(io.kitRoot, 'modules', 'github', 'lib', 'cli.js')).href);
  const [verb, ...args] = positionals;
  // A typed "y" only counts on a real terminal; without one there is no confirmer and guarded verbs refuse (ADR-0027).
  const tty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const confirmer = io.confirm ?? (tty ? (q) => confirm(createPrompter(), q) : undefined);
  // The sessions module (ADR-0029) supplies the Agent-Session trailer for `commit`; github does not import it.
  let sessionTrailer;
  if (enabledModules(manifest).includes('sessions')) {
    const reg = await import(pathToFileURL(join(io.kitRoot, 'modules', 'sessions', 'lib', 'registry.js')).href);
    sessionTrailer = () => reg.sessionTrailer({ root: io.cwd, env: io.env, now: io.now });
  }
  try {
    return await lib.runGh({
      verb, args, values, mode: manifest.modules.tasks?.mode, sessionTrailer,
      io: { ...io, root: io.cwd, confirm: confirmer },
    });
  } catch (e) {
    if (e instanceof lib.GhUsageError) throw e.showUsage ? new UsageError(`${e.message}\n${lib.USAGE}`) : new Error(e.message);
    throw e;
  }
}
