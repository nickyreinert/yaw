// `yaw self-update` and `yaw self-uninstall` (Y-2.8, ADR-0006).
// Both act only on the kit that install.sh put at ~/.yaw/kit, never on a development checkout.

import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, realpathSync, rmdirSync, rmSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { KIT_ROOT } from '../render/kit.js';
import { confirm } from './prompt.js';
import { UsageError } from './commands.js';

function git(kit, args, { allowFail = false } = {}) {
  const r = spawnSync('git', ['-C', kit, ...args], { encoding: 'utf8' });
  if (r.error) throw r.error;
  if (r.status !== 0 && !allowFail) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.trim()}`);
  return r.status === 0 ? r.stdout.trim() : null;
}

export function installedKit(kitRoot = KIT_ROOT) {
  const home = join(homedir(), '.yaw');
  const kit = join(home, 'kit');
  const real = (p) => (existsSync(p) ? realpathSync(p) : null);
  if (real(kit) === null || real(kitRoot) !== real(kit) || git(kit, ['config', '--get', 'yaw.channel'], { allowFail: true }) === null) {
    throw new UsageError(`self-update and self-uninstall work only on the kit installed by install.sh at ${kit} (this kit: ${kitRoot})`);
  }
  return { home, kit, channel: git(kit, ['config', '--get', 'yaw.channel']) };
}

function versionAt(kit, ref) {
  const text = git(kit, ['show', `${ref}:package.json`], { allowFail: true });
  return text ? JSON.parse(text).version : '?';
}

export function latestTag(kit) {
  const tags = git(kit, ['tag', '--list', 'v[0-9]*', '--sort=-v:refname']);
  return tags ? tags.split('\n')[0] : null;
}

export async function selfUpdate({ values, positionals, io }) {
  if (positionals.length > 0) throw new UsageError(`unexpected argument "${positionals[0]}"`);
  if (values.tag && values.channel) throw new UsageError('use either --tag or --channel');
  if (values.channel && values.channel !== 'main') throw new UsageError('--channel accepts only "main"');
  const { kit, channel } = installedKit(io.kitRoot);
  if (git(kit, ['status', '--porcelain'])) throw new Error(`${kit} has local changes; commit or discard them first`);
  git(kit, ['fetch', '--quiet', '--force', '--tags', 'origin']);

  let target;
  let nextChannel;
  if (values.tag) {
    target = values.tag.startsWith('v') ? values.tag : `v${values.tag}`;
    if (git(kit, ['rev-parse', '-q', '--verify', `refs/tags/${target}`], { allowFail: true }) === null) throw new Error(`tag ${target} does not exist`);
    nextChannel = 'tag';
  } else if (values.channel === 'main' || (!values.channel && channel === 'main')) {
    target = 'origin/main';
    nextChannel = 'main';
  } else {
    target = latestTag(kit);
    if (!target) throw new Error('no release tag yet; use yaw self-update --channel main');
    nextChannel = 'tag';
  }
  const oldRev = git(kit, ['rev-parse', 'HEAD']);
  const newRev = git(kit, ['rev-parse', `${target}^{commit}`]);
  const oldVersion = versionAt(kit, oldRev);
  const newVersion = versionAt(kit, newRev);
  if (oldRev === newRev) {
    git(kit, ['config', 'yaw.channel', nextChannel]);
    io.stdout.write(`kit ${oldVersion} is up to date (${target})\n`);
    return 0;
  }
  io.stdout.write(`changes ${oldVersion} -> ${newVersion} (${target}):\n`);
  const changelog = git(kit, ['diff', '--no-color', '--no-ext-diff', '-U0', oldRev, newRev, '--', 'CHANGELOG.md'], { allowFail: true }) ?? '';
  const added = changelog.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1));
  const lines = added.length > 0 ? added : (git(kit, ['log', '--oneline', '--no-decorate', `${oldRev}..${newRev}`], { allowFail: true }) ?? '').split('\n');
  for (const l of lines.filter(Boolean)) io.stdout.write(`  ${l}\n`);
  git(kit, ['checkout', '--quiet', '--detach', newRev]);
  git(kit, ['config', 'yaw.channel', nextChannel]);
  io.stdout.write(`switched kit ${oldVersion} -> ${newVersion}\n`);
  io.stdout.write('projects keep their pinned version until you run yaw update in them\n');
  return 0;
}

export async function selfUninstall({ values, positionals, io }) {
  if (positionals.length > 0) throw new UsageError(`unexpected argument "${positionals[0]}"`);
  const { home, kit } = installedKit(io.kitRoot);
  const link = join(homedir(), '.local', 'bin', 'yaw');
  let linkIsOurs = false;
  try {
    linkIsOurs = lstatSync(link).isSymbolicLink() && realpathSync(link) === realpathSync(join(kit, 'bin', 'yaw'));
  } catch { /* no link */ }
  io.stdout.write('yaw self-uninstall removes:\n');
  io.stdout.write(`  ${kit}\n`);
  if (linkIsOurs) io.stdout.write(`  ${link}\n`);
  if (!values.yes) {
    if (!io.prompter.interactive) throw new UsageError('confirmation needed: run again with --yes');
    if (!(await confirm(io.prompter, 'Uninstall the YAW kit?'))) {
      io.stdout.write('cancelled\n');
      return 1;
    }
  }
  if (linkIsOurs) unlinkSync(link);
  rmSync(kit, { recursive: true, force: true });
  const rest = existsSync(home) ? readdirSync(home) : [];
  if (existsSync(home) && rest.length === 0) rmdirSync(home);
  io.stdout.write('removed the kit and the yaw link\n');
  io.stdout.write('still there:\n');
  for (const name of rest.sort()) io.stdout.write(`  ${join(home, name)}\n`);
  io.stdout.write('  .yaw/ and generated files in your projects (run yaw remove core in a project to take YAW out of it)\n');
  if (!linkIsOurs && existsSync(link)) io.stdout.write(`  ${link} (not a link to this kit, left alone)\n`);
  return 0;
}
