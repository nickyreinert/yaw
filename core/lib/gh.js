// The GitHub CLI behind one function (ADR-0010, ADR-0027): `gh(args, { input }) -> stdout`.
// Arguments are always an argv array, never a shell string. Modules take the function as an
// injectable `gh`, so tests replay canned output and never reach GitHub.

import { spawnSync } from 'node:child_process';

export class GhError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GhError';
  }
}

export function defaultGh(args, { cwd, env, input } = {}) {
  const r = spawnSync('gh', args, { cwd, env, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error?.code === 'ENOENT') throw new GhError('the GitHub CLI (gh) is not installed or not on the PATH');
  if (r.error) throw new GhError(`gh could not run: ${r.error.code ?? r.error.message}`);
  if (r.status !== 0) {
    const reason = String(r.stderr).trim().split('\n')[0] || `exit ${r.status}`;
    throw new GhError(`gh ${args.slice(0, 2).join(' ')} failed: ${reason}`);
  }
  return r.stdout;
}
