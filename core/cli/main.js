// CLI entry (Y-2.4, ADR-0019): command table, argument parsing with node:util parseArgs, help, version.

import { parseArgs } from 'node:util';
import { KIT_ROOT, kitVersion } from '../render/kit.js';
import { add, remove, status, update, UsageError } from './commands.js';
import { init } from './init.js';
import { doctor } from './doctor.js';
import { selfUninstall, selfUpdate } from './self.js';
import { createPrompter } from './prompt.js';
import { runHook } from '../hooks/dispatch.js';
import { agents } from './agents.js';
import { sync } from './sync.js';
import { task } from './tasks.js';
import { gh } from './gh.js';
import { decisions } from './decisions.js';
import { sessions } from './sessions.js';

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
  { name: 'add', args: '<module> [--yes] [--strategy keep|take|merge]', summary: 'add a module, asking only its questions', options: { ...yes, strategy: { type: 'string' } }, run: add },
  { name: 'hook', args: '<event> --agent claude|codex|copilot --module <module>', summary: 'hook entry point for coding agents (reads the payload on stdin; always exits 0)', options: {} },
  { name: 'sync', args: '--check', summary: 'check that agent adapter files match their source (fails on drift)', options: { check: { type: 'boolean' } }, run: sync },
  { name: 'agents', args: '', summary: 'compatibility matrix of the enabled modules and agents', options: {}, run: agents },
  { name: 'task', args: '<list|next|start|log|done|new|sync> [...]', summary: 'task ledger helpers (tasks module; `just task ...` calls this)', options: { resume: { type: 'string' }, progress: { type: 'string' } }, run: task },
  { name: 'config', step: 5, summary: 'change .yaw/config.yaml' },
  { name: 'gh', args: '<init|labels|protect|branch|commit|pr|pr-status|release|project-add|issue> [...]', summary: 'GitHub scripts (github module; `just gh-*`, `just branch` ... call this); guarded actions need a person at a terminal to confirm', options: { ...yes, owner: { type: 'string' }, public: { type: 'boolean' }, approvals: { type: 'string' }, check: { type: 'string', multiple: true }, type: { type: 'string' }, scope: { type: 'string' }, task: { type: 'string' }, title: { type: 'string' }, ready: { type: 'boolean' }, status: { type: 'string' }, body: { type: 'string' }, priority: { type: 'string' }, estimate: { type: 'string' } }, run: gh },
  { name: 'decisions', args: '<recall|record|query|list|rebuild|check|taxonomy|seed> [...]', summary: 'decision journal: ADRs and notices in .decisions/ (decisions module; `just decisions ...` calls this)', options: { type: { type: 'string' }, kind: { type: 'string' }, category: { type: 'string' }, subcategory: { type: 'string' }, summary: { type: 'string' }, context: { type: 'string' }, decision: { type: 'string' }, consequences: { type: 'string' }, consideration: { type: 'string' }, importance: { type: 'string' }, status: { type: 'string' }, supersedes: { type: 'string', multiple: true }, scope: { type: 'string', multiple: true }, 'review-by': { type: 'string' }, tag: { type: 'string', multiple: true }, ref: { type: 'string', multiple: true }, issue: { type: 'string' }, text: { type: 'string' }, path: { type: 'string', multiple: true }, keywords: { type: 'string' } }, run: decisions },
  { name: 'sessions', args: '<find|for|resume|list|current|handoff> [...]', summary: 'agent session registry: find, link and resume sessions (sessions module; `just sessions ...` calls this)', options: { all: { type: 'boolean' }, title: { type: 'string' }, agent: { type: 'string' }, session: { type: 'string' } }, run: sessions },
  { name: 'session', step: 5, summary: 'rename the current session' },
  { name: 'session-start', step: 5, summary: 'team-mode sync at session start' },
  { name: 'hygiene', step: 5, summary: 'session hygiene reminders on/off' },
  { name: 'notify', step: 5, summary: 'send a notification' },
  { name: 'presets', step: 7, summary: 'list, show and delete saved setups' },
];

export function usage() {
  const built = COMMANDS.filter((c) => c.run || c.name === 'help' || c.name === 'hook');
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
    confirm: io.confirm, // tests script the typed "y" of guarded actions (ADR-0027); undefined asks on a real terminal
    gh: io.gh, // tests replay recorded gh output; undefined runs the GitHub CLI
    now: io.now,
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
    ctx.stdout.write(target ? (target.step ? `yaw ${target.name}: ${target.summary} (step ${target.step})\n` : commandUsage(target)) : usage());
    return 0;
  }
  // The hook entry point parses its own arguments and never fails (ADR-0007): no usage, no stderr.
  if (command.name === 'hook') return runHook(rest, { ...ctx, stdin: io.stdin ?? process.stdin });
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
