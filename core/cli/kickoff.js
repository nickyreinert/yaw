// `yaw kickoff` (#173): print the kickoff guide and the planning prompt; `yaw kickoff import <plan.md>` turns
// the plan into tasks through `yaw task new`, so every task store (local, both, github) works the same way.

import { kickoffGuide, kickoffPrompt, parseKickoffReply, PlanError } from '../lib/kickoff.js';
import { checkTaskReferences, contextText, foundationContext, prepareFoundations, readFoundationFile, saveFoundations } from '../lib/foundations.js';
import { modelEffort, parseTasks, tasksMode } from '../lib/tasks.js';
import { readProjectFile } from '../render/files.js';
import { enabledModules, readAnswers, requireManifest } from '../render/project.js';
import { UsageError } from './commands.js';
import { task } from './tasks.js';

// The guide lines and the planning prompt for a project; the terminal and the web UI show the same text.
export function kickoffParts({ root, manifest }) {
  const doc = readAnswers(root);
  const modules = enabledModules(manifest);
  const mode = tasksMode(doc.answers, { teamModule: modules.includes('team') });
  return {
    guide: kickoffGuide({ tasksMode: mode, hasTasks: modules.includes('tasks') }),
    prompt: kickoffPrompt({ answers: doc.answers, summary: doc.proposal?.summary ?? '', tasksMode: mode }),
  };
}

export function kickoffText({ root, manifest }) {
  const { guide, prompt } = kickoffParts({ root, manifest });
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

function readPlan(cwd, file, kitRoot) {
  const text = readFoundationFile(cwd, file, { kitRoot });
  if (text === null) throw new UsageError(`kickoff import: ${file} does not exist`);
  return text;
}

export async function kickoff({ values, positionals, io }) {
  const root = io.cwd;
  const manifest = requireManifest(root);
  const [verb, file, ...extra] = positionals;
  if (verb === 'context') {
    if (file || extra.length) throw new UsageError('kickoff context takes no positional arguments');
    const context = foundationContext({ root, kitRoot: io.kitRoot });
    io.stdout.write(values.json ? `${JSON.stringify(context, null, 2)}\n` : `${contextText(context)}\n`);
    return 0;
  }
  if (verb === 'ux') {
    if (file || extra.length) throw new UsageError('kickoff ux takes no positional arguments');
    io.stdout.write(`${contextText(foundationContext({ root, kitRoot: io.kitRoot }))}\n\nOptional UI/UX guidance: review this exact package before copying to your chosen local or external model. Ask for missing user evidence; label assumptions. Walk through the main task with realistic content, empty/error/recovery states and applicable accessibility criteria. Propose a small prototype or user walkthrough for the riskiest assumption. Return a candidate revision to the UI/UX foundation, linked domain/data effects and observable acceptance criteria. Surface conflicts for a project decision; do not change accepted documents automatically.\n`);
    return 0;
  }
  if (verb === undefined) {
    io.stdout.write(kickoffText({ root, manifest }));
    return 0;
  }
  if (verb !== 'import') throw new UsageError(`kickoff: unknown verb "${verb}"; use: yaw kickoff [import <plan.md> [--dry-run]]`);
  if (!file || extra.length > 0) throw new UsageError('kickoff import: give exactly one plan file');
  const hasTasks = enabledModules(manifest).includes('tasks');
  const needsTasks = () => new UsageError('kickoff import needs the tasks module; run: yaw add tasks');
  let plan;
  try {
    let text;
    try { text = readPlan(root, file, io.kitRoot); }
    catch (e) { if (!hasTasks && e instanceof UsageError) throw needsTasks(); throw e; }
    plan = parseKickoffReply(text);
    if (!hasTasks && !plan.foundations.length) throw needsTasks();
    if (!plan.tasks.length && !plan.foundations.length) throw new PlanError('no tasks found; the plan needs "## Phase" headings with "- [ ] task" lines');
  } catch (e) {
    if (e instanceof PlanError) throw new UsageError(`kickoff import: ${file}: ${e.message.startsWith('nothing found') ? 'no tasks found; ' : ''}${e.message}`);
    throw e;
  }
  const prepared = prepareFoundations({ root, kitRoot: io.kitRoot, documents: plan.foundations, reviewed: values.reviewed || values['dry-run'] });
  checkTaskReferences(plan.tasks, prepared);
  if (prepared) {
    for (const d of prepared.entries) io.stdout.write(`Foundation ${d.kind}: ${d.path}\n${d.text}\n`);
    if (!values['dry-run']) saveFoundations({ root, prepared, kitRoot: io.kitRoot });
  }
  if (!hasTasks) {
    io.stdout.write(`kickoff import: ${values['dry-run'] ? 'would save' : 'saved'} reviewed foundations; tasks remain in ${file}. Add the tasks module (yaw add tasks), then import again to create them.\n`);
    return 0;
  }
  const { code, created, skipped } = await importTasks({ root, plan: plan.tasks, io, dryRun: values['dry-run'] });
  if (code !== 0) return code;
  const verbDone = values['dry-run'] ? 'would add' : 'added';
  io.stdout.write(`kickoff import: ${verbDone} ${created} task(s), skipped ${skipped}${values['dry-run'] ? '; nothing was written (--dry-run)' : ''}\n`);
  return 0;
}

// Plan tasks -> `yaw task new`, so every task store (local, both, github) works the same way. Titles already in
// TASKS.md are skipped. -> { code, created, skipped }
export async function importTasks({ root, plan, io, dryRun = false }) {
  const values = { 'dry-run': dryRun };
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
      if (t.spec) io.stdout.write(`  spec: ${t.spec}\n  acceptance: ${t.acceptance}\n`);
      created++;
      continue;
    }
    const code = await task({ values: { ...(t.model ? { model: t.model } : {}), ...(t.effort ? { effort: t.effort } : {}), ...(t.spec ? { spec: t.spec } : {}), ...(t.acceptance ? { acceptance: t.acceptance } : {}) }, positionals: ['new', t.title], io });
    if (code !== 0) return { code, created, skipped };
    created++;
  }
  return { code: 0, created, skipped };
}
