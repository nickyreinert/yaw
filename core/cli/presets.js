// `yaw presets list|show|delete` (Y-7.2, ADR-0043): saved setups in ~/.yaw/presets/.

import { deletePreset, listPresets, readPreset, userDir } from '../lib/user-store.js';
import { confirm } from './prompt.js';
import { UsageError } from './commands.js';

export async function presets({ values, positionals, io }) {
  const [action, name, ...extra] = positionals;
  if (!['list', 'show', 'delete'].includes(action)) throw new UsageError('use list, show <name> or delete <name>');
  if (extra.length > 0 || (action === 'list') === (name !== undefined)) throw new UsageError(action === 'list' ? 'list takes no name' : `${action} needs one preset name`);
  if (action === 'list') {
    const all = listPresets(io.env);
    if (all.length === 0) io.stdout.write(`no saved setups (${userDir(io.env)}/presets/)\n`);
    const width = Math.max(0, ...all.map((p) => p.name.length));
    for (const p of all) io.stdout.write(`${p.name.padEnd(width)}  ${[p.mode, p.created, p.description].filter(Boolean).join('  ')}\n`);
    return 0;
  }
  if (action === 'show') {
    io.stdout.write(readPreset(io.env, name));
    return 0;
  }
  readPreset(io.env, name); // fails with a clear message when it does not exist
  if (!values.yes) {
    if (!io.prompter.interactive) throw new UsageError('no terminal to confirm: run again with --yes');
    if (!(await confirm(io.prompter, `Delete preset "${name}"?`))) {
      io.stdout.write('cancelled; nothing was deleted\n');
      return 1;
    }
  }
  deletePreset(io.env, name);
  io.stdout.write(`deleted preset ${name}\n`);
  return 0;
}
