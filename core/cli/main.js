// CLI entry (Y-2.4, ADR-0019): command table, argument parsing with node:util parseArgs, help, version.

import { parseArgs } from 'node:util';
import { KIT_ROOT, kitVersion } from '../render/kit.js';
import { remove, status, update, UsageError } from './commands.js';
import { init } from './init.js';
import { doctor } from './doctor.js';
import { selfUninstall, selfUpdate } from './self.js';
import { createPrompter } from './prompt.js';

const yes = { yes: { type: 'boolean', short: 'y' } };

// The phase-1 command list (ADR-0019). Commands without `run` are planned for a later step.
export const COMMANDS = [
  { name: 'init', args: '[--answers <file> [--yes]] [--skip-verify]', summary: 'set up YAW in this folder: interview, confirm, write, verify', options: { answers: { type: 'string' }, 'skip-verify': { type: 'boolean' }, ...yes }, run: init },
  { name: 'update', args: '[--yes] [--strategy keep|take|merge] [--restore <path>] [--forget <path>]', summary: 're-render managed files from the installed kit', options: { ...yes, strategy: { type: 'string' }, restore: { type: 'string', multiple: true }, forget: { type: 'string', multiple: true } }, run: update },
  { name: 'remove', args: '<module> [--yes] [--strategy keep|take|merge]', summary: 'remove a module and exactly its files', options: { ...yes, strategy: { type: 'string' } }, run: remove },
  { name: 'status', args: '', summary: 'show modules and files with their state', options: {}, run: status },
  { name: 'doctor', args: '', summary: 'check the kit, the manifest and the tools', options: {}, run: doctor },
  { name: 'self-update', args: '[--tag <tag> | --channel main]', summary: 'switch the installed kit to a newer tag', options: { tag: { type: 'string' }, channel: { type: 'string' } }, run: selfUpdate },
  { name: 'self-uninstall', args: '[--yes]', summary: 'remove the installed kit and the yaw link', options: { ...yes }, run: selfUninstall },
  { name: 'help', args: '[<command>]', summary: 'show this help', options: {} },
  { name: 'apply', step: 3, summary: 'apply .yaw/answers.yaml again' },
  { name: 'add', step: 5, summary: 'add a module, asking only its questions' },
  { name: 'hook', step: 4, summary: 'hook entry point for coding agents' },
  { name: 'sync', step: 4, summary: 'render skills per agent; --check fails on drift' },
  { name: 'agents', step: 4, summary: 'compatibility matrix of the enabled modules' },
  { name: 'config', step: 5, summary: 'change .yaw/config.yaml' },
  { name: 'gh', step: 5, summary: 'GitHub setup and helpers' },
  { name: 'decisions', step: 5, summary: 'decision journal (ADRs, notices)' },
  { name: 'sessions', step: 5, summary: 'find and resume agent sessions' },
  { name: 'session', step: 5, summary: 'rename the current session' },
  { name: 'session-start', step: 5, summary: 'team-mode sync at session start' },
  { name: 'hygiene', step: 5, summary: 'session hygiene reminders on/off' },
  { name: 'notify', step: 5, summary: 'send a notification' },
  { name: 'presets', step: 7, summary: 'list, show and delete saved setups' },
];

export function usage() {
  const built = COMMANDS.filter((c) => c.run || c.name === 'help');
  const planned = COMMANDS.filter((c) => c.step);
  const lines = [
    'usage: yaw <command> [options]',
    '       yaw --version',
    '',
    'commands:',
    ...built.map((c) => `  ${c.name.padEnd(15)} ${c.summary}`),
    '',
    'coming later in phase 1:',
    ...planned.map((c) => `  ${c.name.padEnd(15)} ${c.summary} (step ${c.step})`),
    '',
    'yaw help <command> shows its options.',
  ];
  return `${lines.join('\n')}\n`;
}

function commandUsage(c) {
  return `usage: yaw ${c.name}${c.args ? ` ${c.args}` : ''}\n  ${c.summary}\n`;
}

// argv without "node bin/yaw". Returns the exit code.
export async function main(argv, io = {}) {
  const ctx = {
    stdout: io.stdout ?? process.stdout,
    stderr: io.stderr ?? process.stderr,
    cwd: io.cwd ?? process.cwd(),
    env: io.env ?? process.env,
    kitRoot: io.kitRoot ?? KIT_ROOT,
    prompter: io.prompter ?? createPrompter(),
  };
  const [first, ...rest] = argv;
  if (first === undefined || first === '--help' || first === '-h') {
    ctx.stdout.write(usage());
    return 0;
  }
  if (first === '--version') {
    ctx.stdout.write(`yaw ${kitVersion(ctx.kitRoot)}\n`);
    return 0;
  }
  const command = COMMANDS.find((c) => c.name === first);
  if (!command) {
    ctx.stderr.write(`yaw: unknown command "${first}"\n\n${usage()}`);
    return 1;
  }
  if (command.name === 'help') {
    const target = rest[0] && COMMANDS.find((c) => c.name === rest[0]);
    if (rest[0] && !target) {
      ctx.stderr.write(`yaw: unknown command "${rest[0]}"\n\n${usage()}`);
      return 1;
    }
    ctx.stdout.write(target ? (target.run ? commandUsage(target) : `yaw ${target.name}: ${target.summary} (step ${target.step})\n`) : usage());
    return 0;
  }
  if (!command.run) {
    ctx.stderr.write(`yaw ${command.name}: not available yet; it comes with step ${command.step} of phase 1\n`);
    return 1;
  }
  let parsed;
  try {
    parsed = parseArgs({ args: rest, options: { help: { type: 'boolean', short: 'h' }, ...command.options }, allowPositionals: true, strict: true });
  } catch (e) {
    ctx.stderr.write(`yaw ${command.name}: ${e.message}\n${commandUsage(command)}`);
    return 1;
  }
  if (parsed.values.help) {
    ctx.stdout.write(commandUsage(command));
    return 0;
  }
  try {
    return await command.run({ values: parsed.values, positionals: parsed.positionals, io: ctx });
  } catch (e) {
    ctx.stderr.write(`yaw ${command.name}: ${e.message}\n`);
    if (e instanceof UsageError) ctx.stderr.write(commandUsage(command));
    return 1;
  } finally {
    ctx.prompter.close?.();
  }
}
