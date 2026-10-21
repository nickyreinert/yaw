// Git state for the team module (ADR-0031): which branch, which issue, how far from upstream and the default branch.
// git runs with argument arrays (no shell), never prompts, and has a time limit; every read fails soft.

import { spawnSync } from 'node:child_process';
import { defaultBranch, loadConfig } from '../../github/lib/cli.js';
import { taskFromBranch } from '../../github/lib/names.js';

// -> git(args, { timeoutMs }) -> { status, stdout, stderr }; status is null when git is missing or timed out.
export function makeGit(root, env = process.env) {
  // git does not ask for credentials (it fails instead); an SSH passphrase prompt is cut off by the time limit.
  const quiet = { ...env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
  return (args, { timeoutMs = 3000 } = {}) => {
    const r = spawnSync('git', args, { cwd: root, env: quiet, encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024 });
    if (r.error) return { status: null, stdout: '', stderr: String(r.error.code ?? 'error') };
    return { status: r.status, stdout: String(r.stdout).trim(), stderr: String(r.stderr).trim() };
  };
}

// The adapter that github's defaultBranch() expects ({ allowFail } calls; status 0 or not).
const forGithub = (git) => (args) => {
  const r = git(args);
  return { status: r.status === 0 ? 0 : 1, stdout: r.stdout };
};

// .yaw/github.yaml when it is valid, else {} (a guard must not fail over a broken file; the recipes report it).
function config(root) {
  try {
    return loadConfig(root).value;
  } catch {
    return {};
  }
}

const count = (git, range) => {
  const r = git(['rev-list', '--count', range]);
  return r.status === 0 && /^\d+$/.test(r.stdout) ? Number(r.stdout) : null;
};

// The upstream of the current branch ("origin/feat/34-x"), or null.
function upstreamOf(git) {
  const r = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  return r.status === 0 && r.stdout !== '' ? r.stdout : null;
}

// -> null outside a git work tree, else
//    { branch ('' when detached), defaultBranch, issue (number|null), upstream, ahead, behind, behindDefault, dirty }
// `local: true` skips what the guards do not need (dirty, behindDefault).
export function branchState(root, git, { local = false } = {}) {
  if (git(['rev-parse', '--is-inside-work-tree']).stdout !== 'true') return null;
  const branch = git(['branch', '--show-current']).stdout;
  const base = defaultBranch(forGithub(git), config(root));
  const task = taskFromBranch(branch);
  const issue = task?.kind === 'issue' ? task.number : null;
  let upstream = branch === '' ? null : upstreamOf(git);
  // The default branch without tracking is compared with origin/<default>.
  if (!upstream && branch !== '' && branch === base && git(['show-ref', '--verify', '--quiet', `refs/remotes/origin/${base}`]).status === 0) upstream = `origin/${base}`;
  const ahead = upstream ? count(git, `${upstream}..HEAD`) : null;
  const behind = upstream ? count(git, `HEAD..${upstream}`) : null;
  const state = { branch, defaultBranch: base, issue, upstream, ahead, behind };
  if (local) return state;
  const dirty = git(['status', '--porcelain', '--untracked-files=no']).stdout !== '';
  const hasOriginDefault = git(['show-ref', '--verify', '--quiet', `refs/remotes/origin/${base}`]).status === 0;
  const behindDefault = branch !== '' && branch !== base && hasOriginDefault ? count(git, `HEAD..origin/${base}`) : null;
  return { ...state, dirty, behindDefault };
}

export const diverged = (s) => Boolean(s && s.ahead > 0 && s.behind > 0);
