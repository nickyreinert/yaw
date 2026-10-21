// Project commands: init, update, remove, status (ADR-0019).

import { MANIFEST } from '../render/files.js';
import { KIT_ROOT, kitVersion } from '../render/kit.js';
import { STRATEGIES } from '../render/reconcile.js';
import { addModule, enabledModules, fileStates, moduleQuestions, planAdd, planRemove, readAnswers, removeModule, renderProject, requireManifest, updateProject } from '../render/project.js';
import { runInterview, whenMatches } from '../interview/engine.js';
import { confirm } from './prompt.js';

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

const LABELS = {
  added: 'added',
  adopted: 'adopted (identical file existed)',
  updated: 'updated',
  rebased: 'updated (your edit already matched the kit)',
  kept: 'kept your version',
  taken: 'replaced with the kit version',
  merged: 'merged',
  conflict: 'CONFLICT',
  missing: 'missing (not recreated; --restore or --forget)',
  restored: 'restored',
  forgotten: 'forgotten (dropped from the manifest)',
  deleted: 'deleted',
  dropped: 'dropped from the manifest (file was already gone)',
  released: 'kept, owned by you',
  'owned-changed': 'owned by you, the kit version changed',
  'owned-kept': 'kept, owned by you',
};

export function printReport(out, result) {
  for (const r of result.report) {
    if (r.action === 'edited') continue;
    let line = `  ${LABELS[r.action] ?? r.action}: ${r.path}`;
    if (r.action === 'kept' && r.reason) line += ` (${r.reason})`;
    if (r.action === 'conflict') line += ` (${r.conflicts} conflict${r.conflicts === 1 ? '' : 's'}; resolve the markers, yaw doctor lists it)`;
    if (r.action === 'deleted' && r.reason) line += ` (${r.reason})`;
    out.write(`${line}\n`);
    if (r.diff) out.write(`${r.diff.replace(/\n?$/, '\n')}`);
  }
  for (const m of result.missingModules ?? []) out.write(`  warning: module "${m}" is not in this kit; its files were treated as removed\n`);
  for (const p of result.missingProfiles ?? []) out.write(`  warning: profile "${p}" is not in this kit; its files were treated as removed\n`);
  const changed = result.report.filter((r) => r.action !== 'edited').length;
  if (changed === 0) out.write('  nothing to do\n');
}

function parseStrategy(value) {
  if (value === undefined) return undefined;
  if (!STRATEGIES.includes(value)) throw new UsageError(`--strategy must be one of ${STRATEGIES.join(', ')}`);
  return value;
}

export async function update({ values, positionals, io }) {
  if (positionals.length > 0) throw new UsageError(`unexpected argument "${positionals[0]}"`);
  const strategy = parseStrategy(values.strategy);
  const interactive = !values.yes && io.prompter.interactive;
  if (!values.yes && !io.prompter.interactive && !strategy) io.stdout.write('no terminal: edited files are kept (same as --yes)\n');
  const before = requireManifest(io.cwd).kit;
  const result = await updateProject({
    root: io.cwd,
    kitRoot: io.kitRoot,
    strategy,
    interactive,
    prompter: io.prompter,
    restore: new Set(values.restore ?? []),
    forget: new Set(values.forget ?? []),
  });
  io.stdout.write(`yaw update (kit ${before} -> ${result.manifest.kit})\n`);
  printReport(io.stdout, result);
  return result.conflicts.length > 0 ? 1 : 0;
}

// yaw add <module>: only this module's questions; a missing dependency is reported, not installed.
export async function add({ values, positionals, io }) {
  if (positionals.length !== 1) throw new UsageError('usage: yaw add <module> [--yes] [--strategy keep|take|merge]');
  const [module] = positionals;
  const strategy = parseStrategy(values.strategy);
  const { enabled, definition } = planAdd({ root: io.cwd, kitRoot: io.kitRoot, module });
  const interactive = !values.yes && io.prompter.interactive;
  if (!values.yes && !io.prompter.interactive) throw new UsageError('no terminal for the questions: run again with --yes (defaults are used)');
  const answersDoc = readAnswers(io.cwd);
  const questions = moduleQuestions({ root: io.cwd, definition });
  let newAnswers = {};
  let defaulted = [];
  if (questions.length > 0) {
    if (interactive) {
      io.stdout.write(`yaw add ${module}: ${questions.length} question${questions.length === 1 ? '' : 's'} (Enter takes the default, ? explains). Nothing is written until you confirm.\n`);
      ({ answers: newAnswers, defaulted } = await runInterview({ questions, mode: answersDoc.mode, prompter: io.prompter, kitRoot: io.kitRoot, known: answersDoc.answers }));
    } else {
      for (const q of questions) {
        if (!whenMatches(q.when, { ...answersDoc.answers, ...newAnswers })) continue;
        newAnswers[q.id] = q.default;
        defaulted.push(q.id);
      }
    }
  }
  io.stdout.write(`\nyaw add ${module}\n`);
  for (const [id, value] of Object.entries(newAnswers)) {
    io.stdout.write(`  answer ${id}: ${Array.isArray(value) ? value.join(', ') : String(value)}${defaulted.includes(id) ? '  (default)' : ''}\n`);
  }
  if (interactive) {
    const manifest = requireManifest(io.cwd);
    const { desired } = renderProject({ root: io.cwd, kitRoot: io.kitRoot, manifest, modules: [...enabled, module], answersDoc: { ...answersDoc, answers: { ...answersDoc.answers, ...newAnswers } } });
    const known = new Set(manifest.files.map((f) => f.path));
    for (const [p, d] of desired) if (!known.has(p)) io.stdout.write(`  new file: ${p}${d.managed === false ? '  (your code from the start)' : ''}\n`);
    if (!(await confirm(io.prompter, `Add module ${module}?`))) {
      io.stdout.write('cancelled; nothing was written\n');
      return 1;
    }
  }
  const result = await addModule({ root: io.cwd, kitRoot: io.kitRoot, module, newAnswers, strategy, interactive, prompter: io.prompter });
  printReport(io.stdout, result);
  return result.conflicts.length > 0 ? 1 : 0;
}

export async function remove({ values, positionals, io }) {
  if (positionals.length !== 1) throw new UsageError('usage: yaw remove <module> [--yes] [--strategy keep|take|merge]');
  const [module] = positionals;
  const strategy = parseStrategy(values.strategy);
  const plan = planRemove({ root: io.cwd, kitRoot: io.kitRoot, module });
  io.stdout.write(`yaw remove ${module}\n`);
  const states = new Map(fileStates(io.cwd, plan.manifest).map((f) => [f.path, f.state]));
  for (const f of plan.files) {
    const state = states.get(f.path);
    const what = !f.managed ? 'keep (owned by you)'
      : state === 'missing' ? 'drop from the manifest (file is gone)'
        : state === 'unedited' ? 'delete'
          : 'edited by you: delete only if you confirm or pass --strategy take, else keep';
    io.stdout.write(`  ${what}: ${f.path}\n`);
  }
  for (const f of plan.fragments) io.stdout.write(`  remove its part from: ${f.path}\n`);
  if (module === 'core') io.stdout.write(`  delete ${MANIFEST} and .yaw/base/ (YAW is removed from this project)\n`);
  if (!values.yes) {
    if (!io.prompter.interactive) throw new UsageError('confirmation needed: run again with --yes');
    if (!(await confirm(io.prompter, `Remove module ${module}?`))) {
      io.stdout.write('cancelled\n');
      return 1;
    }
  }
  const result = await removeModule({
    root: io.cwd, kitRoot: io.kitRoot, module, strategy, interactive: !values.yes && io.prompter.interactive, prompter: io.prompter,
  });
  printReport(io.stdout, result);
  return result.conflicts.length > 0 ? 1 : 0;
}

export async function status({ positionals, io }) {
  if (positionals.length > 0) throw new UsageError(`unexpected argument "${positionals[0]}"`);
  const manifest = requireManifest(io.cwd);
  const states = fileStates(io.cwd, manifest);
  const out = io.stdout;
  out.write(`kit: project pinned to ${manifest.kit}, installed ${kitVersion(io.kitRoot ?? KIT_ROOT)}\n`);
  out.write(`preset: ${manifest.preset}   profiles: ${manifest.profiles.join(', ')}   agents: ${manifest.agents.join(', ')}\n\n`);
  out.write('modules:\n');
  for (const m of enabledModules(manifest)) {
    const count = manifest.files.filter((f) => f.module === m).length;
    const parts = manifest.files.filter((f) => (f.fragments ?? []).some((x) => x.module === m)).length;
    const opts = Object.entries(manifest.modules[m]).filter(([k]) => k !== 'enabled').map(([k, v]) => `${k}=${v}`).join(' ');
    out.write(`  ${m.padEnd(16)} ${count} file${count === 1 ? '' : 's'}${parts ? `, parts in ${parts} shared file${parts === 1 ? '' : 's'}` : ''}${opts ? `  ${opts}` : ''}\n`);
  }
  out.write('\nfiles:\n');
  const width = Math.max(4, ...states.map((s) => s.path.length));
  out.write(`  ${'path'.padEnd(width)}  ${'module'.padEnd(14)} state\n`);
  for (const s of states) {
    const fragments = (s.fragments ?? []).map((x) => x.module).join(', ');
    out.write(`  ${s.path.padEnd(width)}  ${s.module.padEnd(14)} ${s.state}${fragments ? `  (parts: ${fragments})` : ''}\n`);
  }
  return 0;
}
