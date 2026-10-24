// A fresh folder is no git repository yet (ADR-0055): commit checks (git-hooks) and the review push gate need one,
// so init offers `git init`; `yaw edit` can do it later.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { REVIEWERS, reviewTriggers } from '../render/kit.js';

export function isGitRepo(root) {
  return existsSync(join(root, '.git'));
}

export function wantsGit(modules, answers = {}) {
  if (modules.includes('git-hooks')) return true;
  const t = reviewTriggers(answers);
  return modules.includes('review') && REVIEWERS.some((k) => t[k] === 'push');
}

// -> { created: boolean, error?: string }
export function gitInit(root) {
  if (isGitRepo(root)) return { created: false };
  const r = spawnSync('git', ['init', '--quiet'], { cwd: root, encoding: 'utf8' });
  if (r.error || r.status !== 0) return { created: false, error: (r.stderr || r.error?.message || 'git init failed').trim() };
  return { created: true };
}
