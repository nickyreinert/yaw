// `yaw kickoff` (#173): print the kickoff guide and the planning prompt; `yaw kickoff import <plan.md>` turns
// the plan into tasks through `yaw task new`, so every task store (local, both, github) works the same way.

import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { kickoffGuide, kickoffPrompt, parsePlan, PlanError } from '../lib/kickoff.js';
import { modelEffort, parseTasks, tasksMode } from '../lib/tasks.js';
import { readProjectFile } from '../render/files.js';
import { enabledModules, readAnswers, requireManifest } from '../render/project.js';
import { UsageError } from './commands.js';
import { task } from './tasks.js';

export function kickoffText({ root, manifest }) {
  const doc = readAnswers(root);
  const modules = enabledModules(manifest);
  const mode = tasksMode(doc.answers, { teamModule: modules.includes('team') });
  const guide = kickoffGuide({ tasksMode: mode, hasTasks: modules.includes('tasks') });
  const prompt = kickoffPrompt({ answers: doc.answers, summary: doc.proposal?.summary ?? '', tasksMode: mode });
  return `Kickoff\n${guide.map((l, i) => `  ${i + 1}. ${l}\n`).join('')}\n----- prompt -----\n${prompt}\n----- end of prompt -----\n`;
}

function existingTitles(root) {
  const buf = readProjectFile(root, 'TASKS.md');
  if (buf === null) return new Set();
  try {
    const ledger = parseTasks(buf.toString('utf8'));
    return new Set([...ledger.active, ...ledger.backlog].map((t) => t.title.toLowerCase()));
  } catch {
    return new Set();
  }
}

function readPlan(cwd, file) {
  const path = resolve(cwd, file);
  let st;
  try {
    st = statSync(path);
  } catch {
    throw new UsageError(`kickoff import: ${file} does not exist`);
  }
  if (!st.isFile()) throw new UsageError(`kickoff import: ${file} is not a file`);
  return readFileSync(path, 'utf8');
}

export async function kickoff({ values, positionals, io }) {
  const root = io.cwd;
  const manifest = requireManifest(root);
  const [verb, file, ...extra] = positionals;
  if (verb === undefined) {
    io.stdout.write(kickoffText({ root, manifest }));
    return 0;
  }
  if (verb !== 'import') throw new UsageError(`kickoff: unknown verb "${verb}"; use: yaw kickoff [import <plan.md> [--dry-run]]`);
  if (!file || extra.length > 0) throw new UsageError('kickoff import: give exactly one plan file');
  if (!enabledModules(manifest).includes('tasks')) throw new UsageError('kickoff import needs the tasks module; run: yaw add tasks');
  let plan;
  try {
    plan = parsePlan(readPlan(root, file));
  } catch (e) {
    if (e instanceof PlanError) throw new UsageError(`kickoff import: ${file}: ${e.message}`);
    throw e;
  }
  const seen = existingTitles(root);
  let created = 0;
  let skipped = 0;
  for (const t of plan) {
    const hint = t.model ? ` (${modelEffort(t.model, t.effort)})` : '';
    if (seen.has(t.title.toLowerCase())) {
      io.stdout.write(`skip  ${t.title} (already in TASKS.md)\n`);
      skipped++;
      continue;
    }
    seen.add(t.title.toLowerCase());
    if (values['dry-run']) {
      io.stdout.write(`would add  [${t.phase}] ${t.title}${hint}\n`);
      created++;
      continue;
    }
    const code = await task({ values: { ...(t.model ? { model: t.model } : {}), ...(t.effort ? { effort: t.effort } : {}) }, positionals: ['new', t.title], io });
    if (code !== 0) return code;
    created++;
  }
  const verbDone = values['dry-run'] ? 'would add' : 'added';
  io.stdout.write(`kickoff import: ${verbDone} ${created} task(s), skipped ${skipped}${values['dry-run'] ? '; nothing was written (--dry-run)' : ''}\n`);
  return 0;
}
