// The GitHub CLI behind one function (ADR-0010, ADR-0027): `gh(args, { input }) -> stdout`.
// Arguments are always an argv array, never a shell string. Modules take the function as an
// injectable `gh`, so tests replay canned output and never reach GitHub.

import { execFile, spawnSync } from 'node:child_process';

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

// The same, without blocking, with a time limit (the team module's session start runs several reads at once and
// must finish inside the hook timeout, ADR-0031). Resolves to stdout; rejects with a GhError.
export function ghAsync(args, { cwd, env, timeoutMs = 4000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { cwd, env, timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (!error) return resolve(stdout);
      if (error.code === 'ENOENT') return reject(new GhError('the GitHub CLI (gh) is not installed or not on the PATH'));
      if (error.killed) return reject(new GhError(`gh ${args.slice(0, 2).join(' ')} took longer than ${timeoutMs} ms`));
      const reason = String(stderr).trim().split('\n')[0] || `exit ${error.code}`;
      return reject(new GhError(`gh ${args.slice(0, 2).join(' ')} failed: ${reason}`));
    });
  });
}
