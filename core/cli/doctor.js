// `yaw doctor` (Y-2.9): kit version vs. manifest pin, manifest consistency, CLI link, Node, git, just.

import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, realpathSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { basePath, hashContent, readProjectFile } from '../render/files.js';
import { KIT_ROOT, compareVersions, hasModule, kitVersion } from '../render/kit.js';
import { readManifest } from '../render/manifest.js';
import { fileStates } from '../render/project.js';
import { UsageError } from './commands.js';

export const NODE_FLOOR = '22.13.0';

function which(cmd, env) {
  for (const dir of (env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const p = join(dir, cmd);
    try {
      accessSync(p, constants.X_OK);
      return p;
    } catch { /* next */ }
  }
  return null;
}

export function runChecks({ cwd, kitRoot = KIT_ROOT, env = process.env, nodeVersion = process.versions.node }) {
  const checks = [];
  const add = (level, message) => checks.push({ level, message });
  const version = kitVersion(kitRoot);

  add(compareVersions(nodeVersion, NODE_FLOOR) >= 0 ? 'ok' : 'fail', `node ${nodeVersion} (needs >= 22.13)`);
  const git = which('git', env);
  add(git ? 'ok' : 'fail', git ? `git ${spawnSync(git, ['--version'], { encoding: 'utf8' }).stdout.trim().replace(/^git version /, '')}` : 'git not found (needed for install, update and merges)');
  const just = which('just', env);
  add(just ? 'ok' : 'warn', just ? `just found (${just})` : 'just not found: projects use it for setup and checks (macOS: brew install just; Linux: see https://just.systems)');

  const linked = which('yaw', env);
  const kitBin = join(kitRoot, 'bin', 'yaw');
  const real = (p) => {
    try {
      return realpathSync(p);
    } catch {
      return null;
    }
  };
  if (!linked) add('warn', `yaw is not on PATH; link ${kitBin} into ~/.local/bin or add that folder to PATH`);
  else if (real(linked) !== real(kitBin)) add('warn', `yaw on PATH (${linked}) is a different kit than this one (${kitRoot})`);
  else add('ok', `yaw on PATH -> ${kitRoot}`);
  const channel = git ? spawnSync(git, ['-C', kitRoot, 'config', '--get', 'yaw.channel'], { encoding: 'utf8' }).stdout.trim() : '';
  add('ok', `kit ${version} at ${kitRoot}${channel ? ` (channel: ${channel})` : ' (not installed by install.sh)'}`);

  let manifest;
  try {
    manifest = readManifest(cwd);
  } catch (e) {
    add('fail', e.message);
    return checks;
  }
  if (!manifest) {
    add('ok', 'no project here (no .yaw/manifest.json); project checks skipped');
    return checks;
  }
  add('ok', 'manifest valid');
  const cmp = compareVersions(version, manifest.kit);
  if (cmp === 0) add('ok', `project pinned to kit ${manifest.kit} = installed kit`);
  else if (cmp > 0) add('warn', `project pinned to kit ${manifest.kit}, installed ${version}: run yaw update (team mode: in its own PR)`);
  else add('fail', `project pinned to kit ${manifest.kit}, installed ${version} is older: run yaw self-update --tag v${manifest.kit}`);

  for (const [m, entry] of Object.entries(manifest.modules)) {
    if (entry.enabled && !hasModule(kitRoot, m)) add('warn', `module "${m}" is not in the installed kit`);
  }
  const states = fileStates(cwd, manifest);
  for (const s of states) {
    if (s.state === 'missing') add('warn', `${s.path} is missing (yaw update --restore ${s.path} or --forget ${s.path})`);
    if (s.state === 'conflict') add('fail', `${s.path} has unresolved merge conflict markers`);
    if (s.managed && s.state !== 'missing') {
      const base = readProjectFile(cwd, basePath(s.path), { kitOwned: true });
      if (base === null) add('warn', `${basePath(s.path)} is missing; merges for ${s.path} fall back to keep/take`);
      else if (hashContent(base) !== s.hash) add('warn', `${basePath(s.path)} does not match the manifest hash`);
    }
  }
  const edited = states.filter((s) => s.state === 'edited').length;
  add('ok', `${states.length} files in the manifest, ${edited} edited by you`);

  if (existsSync(join(cwd, 'justfile'))) {
    if (!just) add('warn', 'justfile present but just is not installed');
    else {
      const r = spawnSync(just, ['--list'], { cwd, encoding: 'utf8' });
      add(r.status === 0 ? 'ok' : 'fail', r.status === 0 ? 'just --list works' : `just --list failed: ${(r.stderr || '').trim().split('\n')[0]}`);
    }
  }
  return checks;
}

export async function doctor({ positionals, io }) {
  if (positionals.length > 0) throw new UsageError(`unexpected argument "${positionals[0]}"`);
  const checks = runChecks({ cwd: io.cwd, kitRoot: io.kitRoot, env: io.env });
  for (const c of checks) io.stdout.write(`${c.level.padEnd(5)} ${c.message}\n`);
  return checks.some((c) => c.level === 'fail') ? 1 : 0;
}
