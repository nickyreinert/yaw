// Why GitHub may not work yet (#166): shown next to "Use GitHub for the repo?" so a "no" (or a later failure) is
// explained. Local checks only, plus `gh auth status` with a short timeout; its output is discarded.

import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';

function onPath(cmd, env) {
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    try {
      accessSync(join(dir, cmd), constants.X_OK);
      return join(dir, cmd);
    } catch { /* next */ }
  }
  return null;
}

// gh keeps its login in hosts.yml; only its existence is checked (never its content). Without it gh is not
// logged in, and gh is not started (it would create its state folder in a fresh home).
function ghConfigured(env) {
  const dir = env.GH_CONFIG_DIR || (env.XDG_CONFIG_HOME ? join(env.XDG_CONFIG_HOME, 'gh') : env.HOME ? join(env.HOME, '.config', 'gh') : null);
  return dir ? existsSync(join(dir, 'hosts.yml')) : false;
}

function githubRemote(root) {
  try {
    return /url\s*=\s*\S*github\.com[:/]/i.test(readFileSync(join(root, '.git', 'config'), 'utf8'));
  } catch {
    return null;
  }
}

// -> { ready: boolean, reasons: [text] }
export function githubStatus({ root, env = process.env, run = spawnSync }) {
  const reasons = [];
  const gh = onPath('gh', env);
  if (!gh) reasons.push('gh (GitHub CLI) is not installed (macOS: brew install gh)');
  else if (!ghConfigured(env) && !env.GH_TOKEN && !env.GITHUB_TOKEN) reasons.push('gh is not logged in (run gh auth login)');
  else {
    const r = run(gh, ['auth', 'status', '--hostname', 'github.com'], { env, stdio: 'ignore', timeout: 5000 });
    if (r.error || r.status !== 0) reasons.push('gh is not logged in or GitHub is not reachable (run gh auth login)');
  }
  const remote = githubRemote(root);
  if (remote === false) reasons.push('this repository has no GitHub remote yet');
  return { ready: reasons.length === 0, reasons };
}

export function githubHint(status) {
  return status.ready
    ? 'GitHub check: gh is installed and logged in.'
    : `GitHub check: ${status.reasons.join('; ')}. Yes still works; the GitHub steps wait. No keeps tasks local.`;
}

// The questions with the GitHub check as the runtime status of tasks.use-github.
export function withGitHubHint(questions, status) {
  return questions.map((q) => (q.id === 'tasks.use-github' ? { ...q, status: githubHint(status) } : q));
}
