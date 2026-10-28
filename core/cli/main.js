// CLI entry (Y-2.4, ADR-0019): command table, argument parsing with node:util parseArgs, help, version.

import { parseArgs } from 'node:util';
import { KIT_ROOT, kitVersion } from '../render/kit.js';
import { add, remove, status, update, UsageError } from './commands.js';
import { init } from './init.js';
import { edit } from './edit.js';
import { doctor } from './doctor.js';
import { selfUninstall, selfUpdate } from './self.js';
import { createPrompter } from './prompt.js';
import { runHook } from '../hooks/dispatch.js';
import { agents } from './agents.js';
import { sync } from './sync.js';
import { task } from './tasks.js';
import { kickoff } from './kickoff.js';
import { gh } from './gh.js';
import { decisions } from './decisions.js';
import { map } from './map.js';
import { review } from './review.js';
import { sessions } from './sessions.js';
import { hygiene, notify, statusline } from './comfort.js';
import { sessionStart } from './team.js';
import { presets } from './presets.js';
import { web } from './web.js';
import { knowledge } from './knowledge.js';
import { remoteSettings } from '../lib/remote-settings.js';

const yes = { yes: { type: 'boolean', short: 'y' } };

// The phase-1 command list (ADR-0019). Help and hook are dispatched separately.
export const COMMANDS = [
  { name: 'remote', optional: true, args: 'serve [--port 4318] | sync [--hub http://127.0.0.1:4318 --token-env YAW_HUB_TOKEN --scopes settings,presets,statistics --migrate] [--resolve local|remote] | status', summary: 'private data hub and agent-independent browser/Telegram controller (Linux workers)', options: { port: { type: 'string' }, hub: { type: 'string' }, 'token-env': { type: 'string' }, scopes: { type: 'string' }, migrate: { type: 'boolean' }, resolve: { type: 'string' } }, run: async (args) => (await import('./remote.js')).remote(args) },
  { name: 'init', args: '[--web | --answers <file> [--yes]] [--sync <folder|owner/repo>] [--skip-verify] [--force]', summary: 'set up YAW in this folder: interview or local browser form, confirm, write, verify', options: { web: { type: 'boolean' }, answers: { type: 'string' }, sync: { type: 'string' }, 'skip-verify': { type: 'boolean' }, force: { type: 'boolean' }, ...yes }, run: init },
  { name: 'web', args: '[--background | --stop] [--sync <folder|owner/repo>]', summary: 'open the local dashboard; configure an uninitialized folder in Workspace → Settings → Interview; --background keeps it running, --stop stops it', options: { background: { type: 'boolean' }, stop: { type: 'boolean' }, sync: { type: 'string' } }, run: web },
  { name: 'apply', args: '[--yes] [--strategy keep|take|merge] [--restore <path>] [--forget <path>]', summary: 're-render managed files from saved answers and the installed kit', options: { ...yes, strategy: { type: 'string' }, restore: { type: 'string', multiple: true }, forget: { type: 'string', multiple: true } }, run: update },
  { name: 'update', args: '[--yes] [--strategy keep|take|merge] [--restore <path>] [--forget <path>]', summary: 'alias for apply: re-render managed files', options: { ...yes, strategy: { type: 'string' }, restore: { type: 'string', multiple: true }, forget: { type: 'string', multiple: true } }, run: update },
  { name: 'edit', args: '[<section|question.id> ...] [--web] [--list] [--skip-verify]', summary: 'review saved setup answers in the terminal or browser; optionally limit the interview to sections or questions', options: { web: { type: 'boolean' }, list: { type: 'boolean' }, 'skip-verify': { type: 'boolean' } }, run: edit },
  { name: 'remove', args: '<module> [--yes] [--strategy keep|take|merge]', summary: 'remove a module and exactly its files', options: { ...yes, strategy: { type: 'string' } }, run: remove },
  { name: 'status', args: '', summary: 'show modules and files with their state', options: {}, run: status },
  { name: 'doctor', args: '', summary: 'check the kit, the manifest and the tools', options: {}, run: doctor },
  { name: 'self-update', args: '[--tag <tag> | --channel main]', summary: 'switch the installed kit to a newer tag', options: { tag: { type: 'string' }, channel: { type: 'string' } }, run: selfUpdate },
  { name: 'self-uninstall', args: '[--yes]', summary: 'remove the installed kit and the yaw link', options: { ...yes }, run: selfUninstall },
  { name: 'help', args: '[<command>]', summary: 'show this help', options: {} },
  { name: 'add', args: '<module> [--yes] [--strategy keep|take|merge]', summary: 'add a module, asking only its questions', options: { ...yes, strategy: { type: 'string' } }, run: add },
  { name: 'hook', args: '<event> --agent claude|codex|copilot --module <module>', summary: 'hook entry point for coding agents (reads the payload on stdin; always exits 0)', options: {} },
  { name: 'sync', args: 'setup --folder <path> | --github <owner/repo> [--name <device>] [--scopes settings,presets,statistics,tasks,knowledge] | run [--resolve local|remote] [--name <device>] | status [--device <id>] | --check', summary: 'sync portable settings and presets, merge device statistics, or check agent adapter drift', options: { check: { type: 'boolean' }, folder: { type: 'string' }, github: { type: 'string' }, name: { type: 'string' }, scopes: { type: 'string' }, resolve: { type: 'string' }, device: { type: 'string' } }, run: sync },
  { name: 'agents', args: '', summary: 'compatibility matrix of the enabled modules and agents', options: {}, run: agents },
  { name: 'task', args: '<list|next|start|log|done|new|sync> [...]', summary: 'task ledger helpers (tasks module; `just task ...` calls this)', options: { resume: { type: 'string' }, progress: { type: 'string' }, model: { type: 'string' }, effort: { type: 'string' } }, run: task },
  { name: 'kickoff', args: '[import <plan.md> [--dry-run]]', summary: 'kickoff guidance: print the planning prompt for your idea, import the plan as tasks with model tier and effort', options: { 'dry-run': { type: 'boolean' } }, run: kickoff },
  { name: 'gh', args: '<init|labels|protect|branch|commit|pr|pr-status|release|project-add|issue> [...]', summary: 'GitHub scripts (github module; `just gh-*`, `just branch` ... call this); guarded actions need a person at a terminal to confirm', options: { ...yes, owner: { type: 'string' }, public: { type: 'boolean' }, approvals: { type: 'string' }, verify: { type: 'boolean' }, check: { type: 'string', multiple: true }, type: { type: 'string' }, scope: { type: 'string' }, task: { type: 'string' }, title: { type: 'string' }, ready: { type: 'boolean' }, status: { type: 'string' }, body: { type: 'string' }, priority: { type: 'string' }, estimate: { type: 'string' } }, run: gh },
  { name: 'decisions', args: '<recall|record|query|list|rebuild|check|taxonomy|seed> [...]', summary: 'decision journal: ADRs and notices in .decisions/ (decisions module; `just decisions ...` calls this)', options: { type: { type: 'string' }, kind: { type: 'string' }, category: { type: 'string' }, subcategory: { type: 'string' }, summary: { type: 'string' }, context: { type: 'string' }, decision: { type: 'string' }, consequences: { type: 'string' }, consideration: { type: 'string' }, importance: { type: 'string' }, status: { type: 'string' }, supersedes: { type: 'string', multiple: true }, scope: { type: 'string', multiple: true }, 'review-by': { type: 'string' }, tag: { type: 'string', multiple: true }, ref: { type: 'string', multiple: true }, issue: { type: 'string' }, text: { type: 'string' }, path: { type: 'string', multiple: true }, keywords: { type: 'string' } }, run: decisions },
  { name: 'knowledge', args: '<list|show|add|edit|remove> [record|title] [...]', summary: 'add, edit and delete knowledge: personal (--global, ~/.yaw/knowledge) or this project (docs/knowledge, docs/spec with --spec, .decisions)', options: { ...yes, global: { type: 'boolean' }, project: { type: 'boolean' }, spec: { type: 'boolean' }, namespace: { type: 'string' }, type: { type: 'string' }, tag: { type: 'string', multiple: true }, body: { type: 'string' }, file: { type: 'string' }, query: { type: 'string' } }, run: knowledge },
  { name: 'map', args: '<update|check|show> [area|path-prefix]', summary: 'code map: refresh docs/code-map.md and the local index, check it (read-only), show an area (code-map module; `just map ...` calls this)', options: {}, run: map },
  { name: 'review', args: '<run|gate|prompt|install> [...]', summary: 'review agents: run one reviewer (quality, logic, ux, feature) on a change, the pre-push gate, print a reviewer prompt, or install the gate hook (review module; `just review ...` calls this)', options: {}, run: review },
  { name: 'sessions', args: '<find|for|resume|list|current|handoff|import|scan|evaluate|analytics> [...]', summary: 'session registry and explicit saved analytics: scan history, evaluate with local Laya, or read saved analytics (no automatic scan)', options: { all: { type: 'boolean' }, days: { type: 'string' }, endpoint: { type: 'string' }, title: { type: 'string' }, agent: { type: 'string' }, session: { type: 'string' }, 'dry-run': { type: 'boolean' } }, run: sessions },
  { name: 'session-start', args: '', summary: 'team mode: fetch, safe fast-forward, my issues and pull requests (team module; `just start` calls this)', options: {}, run: sessionStart },
  { name: 'hygiene', args: '[status|on|off] [--all]', summary: 'session hygiene hints: show the state, switch them on or off (comfort module)', options: { all: { type: 'boolean' } }, run: hygiene },
  { name: 'notify', args: '[status|test|send] [--status done|input|failed] [--minutes N] [--summary text]', summary: 'notifications after long runs: show the channels, send a test or a message (comfort module)', options: { status: { type: 'string' }, minutes: { type: 'string' }, summary: { type: 'string' } }, run: notify },
  { name: 'statusline', args: '[--snippet]', summary: 'status line for Claude Code (reads its JSON on stdin; comfort module)', options: { snippet: { type: 'boolean' } }, run: statusline },
  { name: 'presets', args: 'list | show <name> | delete <name> [--yes]', summary: 'list, show and delete saved setups in ~/.yaw/presets/', options: { ...yes }, run: presets },
];

export const HELP_GROUPS = [
  { title: 'Project setup and maintenance', names: ['init', 'edit', 'apply', 'update', 'presets', 'status', 'add', 'remove', 'agents'] },
  { title: 'Planning and project work (after init)', names: ['kickoff', 'task', 'decisions', 'knowledge', 'map', 'review', 'sessions'] },
  { title: 'Monitoring and collaboration', names: ['web', 'remote', 'session-start', 'gh', 'hygiene', 'notify'] },
  { title: 'YAW internal commands', names: ['doctor', 'self-update', 'self-uninstall', 'help'] },
  { title: 'Agent integration helpers', names: ['hook', 'sync', 'statusline'] },
];

export function usage(env = process.env) {
  const remoteEnabled = remoteSettings(env).enabled;
  const lines = [
    'usage: yaw <command> [options]',
    '       yaw --version',
    '',
    ...HELP_GROUPS.flatMap(({ title, names }) => [
      `${title}:`,
      ...names.filter((name) => name !== 'remote' || remoteEnabled).map((name) => {
        const c = COMMANDS.find((c) => c.name === name);
        return `  ${c.name.padEnd(15)} ${c.summary}`;
      }),
      '',
    ]),
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
    prompter: io.prompter ?? createPrompter({ env: io.env ?? process.env }),
    confirm: io.confirm, // tests script the typed "y" of guarded actions (ADR-0027); undefined asks on a real terminal
    gh: io.gh, // tests replay recorded gh output; undefined runs the GitHub CLI
    now: io.now,
    stdin: io.stdin,
    openBrowser: io.openBrowser,
  };
  const [first, ...rest] = argv;
  if (first === undefined || first === '--help' || first === '-h') {
    ctx.stdout.write(usage(ctx.env));
    return 0;
  }
  if (first === '--version') {
    ctx.stdout.write(`yaw ${kitVersion(ctx.kitRoot)}\n`);
    return 0;
  }
  const command = COMMANDS.find((c) => c.name === first);
  if (!command) {
    ctx.stderr.write(`yaw: unknown command "${first}"\n\n${usage(ctx.env)}`);
    return 1;
  }
  if (command.name === 'help') {
    const target = rest[0] && COMMANDS.find((c) => c.name === rest[0]);
    if (rest[0] && !target) {
      ctx.stderr.write(`yaw: unknown command "${rest[0]}"\n\n${usage(ctx.env)}`);
      return 1;
    }
    if (target?.optional && !remoteSettings(ctx.env).enabled) {
      ctx.stderr.write('Remote Control is disabled. Enable it in yaw web → Global → Settings → Features.\n'); return 1;
    }
    ctx.stdout.write(target ? commandUsage(target) : usage(ctx.env));
    return 0;
  }
  // The hook entry point parses its own arguments and never fails (ADR-0007): no usage, no stderr.
  if (command.name === 'hook') return runHook(rest, { ...ctx, stdin: io.stdin ?? process.stdin });
  if (command.optional && !remoteSettings(ctx.env).enabled) {
    ctx.stderr.write('Remote Control is disabled. Enable it in yaw web → Global → Settings → Features.\n'); return 1;
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
