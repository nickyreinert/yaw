// Target-folder guard for yaw init (#168): YAW writes AGENTS.md, a justfile, .yaw/ and more into the current folder.
// Refuse the home and file-system root folders unless forced; ask before writing into a non-empty folder that is not
// already a project (no .git, no .yaw).

import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ProjectError } from '../render/project.js';
import { confirm } from './prompt.js';

const NOISE = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

function real(path) {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function isDir(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// -> { kind: 'home' | 'root' | 'project' | 'empty' | 'non-empty', entries, repos }
export function inspectFolder(root, env = {}, ignore = []) {
  const here = real(root) ?? root;
  if (dirname(here) === here) return { kind: 'root', entries: 0, repos: 0 };
  if (env.HOME && real(env.HOME) === here) return { kind: 'home', entries: 0, repos: 0 };
  const skip = new Set(ignore.map((p) => real(resolve(root, p))).filter(Boolean));
  const names = readdirSync(here).filter((n) => !NOISE.has(n) && !skip.has(join(here, n)));
  if (names.includes('.git') || names.includes('.yaw')) return { kind: 'project', entries: names.length, repos: 0 };
  if (names.length === 0) return { kind: 'empty', entries: 0, repos: 0 };
  const repos = names.filter((n) => isDir(join(here, n)) && existsSync(join(here, n, '.git'))).length;
  return { kind: 'non-empty', entries: names.length, repos };
}

// -> true to continue, false when the user declined. Throws when the folder is refused. `ignore`: paths that do not
// count as content (the --answers file).
export async function guardFolder({ root, io, force = false, yes = false, ignore = [] }) {
  const f = inspectFolder(root, io.env, ignore);
  if (f.kind === 'home' || f.kind === 'root') {
    const what = f.kind === 'home' ? 'your home folder' : 'the file-system root';
    if (force) {
      io.stderr.write(`warning: setting up YAW in ${what} (${root}) because of --force\n`);
      return true;
    }
    throw new ProjectError(`refusing to set up YAW in ${what} (${root}); create a project folder (mkdir my-project && cd my-project) and run yaw init there, or pass --force`);
  }
  if (f.kind !== 'non-empty' || force) return true;
  const lines = [
    `This folder is not empty (${f.entries} ${f.entries === 1 ? 'entry' : 'entries'}${f.repos ? `, ${f.repos} of them Git ${f.repos === 1 ? 'repository' : 'repositories'}` : ''}) and is not a Git repository or YAW project:`,
    `  ${root}`,
    'YAW writes AGENTS.md, a justfile, .yaw/ and more into this folder.',
  ];
  if (f.repos) lines.push('It looks like a folder of projects; run yaw init inside one project folder instead.');
  if (yes) {
    io.stderr.write(`warning: ${lines.join('\n')}\n`);
    return true;
  }
  io.stdout.write(`\n${lines.join('\n')}\n`);
  if (!io.prompter?.interactive) throw new ProjectError('confirmation needed for a non-empty folder: run again with --force, or in an empty or project folder');
  return confirm(io.prompter, 'Set up YAW in this folder anyway?');
}
