// `yaw hygiene | notify | statusline` (Y-5.8, ADR-0030): thin wrappers; the logic is the comfort module's
// (modules/comfort/lib/cli.js). The status line never fails: Claude Code would show the error as the line.

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { enabledModules, requireManifest } from '../render/project.js';
import { UsageError } from './commands.js';

const MAX_STDIN = 256 * 1024;

async function lib(io) {
  const manifest = requireManifest(io.cwd);
  if (!enabledModules(manifest).includes('comfort')) throw new UsageError('the comfort module is not installed; run: yaw add comfort');
  return import(pathToFileURL(join(io.kitRoot, 'modules', 'comfort', 'lib', 'cli.js')).href);
}

async function guarded(io, fn, usage) {
  const l = await lib(io);
  try {
    return await fn(l);
  } catch (e) {
    if (e instanceof l.ComfortUsageError) throw new UsageError(`${e.message}\n${l[usage]}`);
    throw e;
  }
}

export const hygiene = ({ values, positionals, io }) =>
  guarded(io, (l) => l.runHygiene({ args: positionals, values, io: { ...io, root: io.cwd } }), 'HYGIENE_USAGE');

export const notify = ({ values, positionals, io }) =>
  guarded(io, (l) => l.runNotify({ args: positionals, values, io: { ...io, root: io.cwd } }), 'NOTIFY_USAGE');

async function readStdin(stream) {
  const chunks = [];
  let size = 0;
  for await (const c of stream) {
    size += c.length;
    if (size > MAX_STDIN) break;
    chunks.push(Buffer.from(c));
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function statusline({ values, positionals, io }) {
  try {
    const l = await import(pathToFileURL(join(io.kitRoot, 'modules', 'comfort', 'lib', 'cli.js')).href);
    if (positionals.length > 0) return 0;
    const text = values.snippet ? '' : await readStdin(io.stdin ?? process.stdin);
    return l.runStatusline({ text, snippet: values.snippet, io: { ...io, root: io.cwd }, now: io.now ?? new Date() });
  } catch {
    return 0;
  }
}
