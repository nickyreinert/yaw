// Explicit, previewed project-plan imports. Existing foundations remain authoritative and are never overwritten.
import { kickoffParts, importTasks } from '../cli/kickoff.js';
import { parseKickoffReply, planningFacts, PLAN_FILE } from '../lib/kickoff.js';
import { prepareFoundations, checkTaskReferences, readFoundationFile, saveFoundations } from '../lib/foundations.js';
import { enabledModules, readAnswers } from '../render/project.js';
import { collectQuestions } from '../render/kit.js';
import { readManifest, writeManifest } from '../render/manifest.js';
import { hashContent, readProjectFile, writeAtomic } from '../render/files.js';
import { unifiedDiff } from '../render/reconcile.js';
import { tasksMode } from '../lib/tasks.js';
import { FormError, assertSafe } from './form-model.js';

export function savePlanningFiles({ root, kitRoot, plan, foundations, setupHash }) {
  saveFoundations({ root, prepared: foundations, kitRoot, setupHash });
  const text = plan.text.endsWith('\n') ? plan.text : `${plan.text}\n`;
  writeAtomic(root, PLAN_FILE, text);
  const manifest = readManifest(root), hash = hashContent(text);
  const entry = manifest.files.find((f) => f.path === PLAN_FILE);
  if (!entry) manifest.files.push({ path: PLAN_FILE, module: 'core', managed: false, hash });
  else entry.hash = hash;
  writeManifest(root, manifest);
}
function prepare({ root, kitRoot, input }) {
  if (typeof input.text !== 'string' || !input.text.trim() || Buffer.byteLength(input.text) > 100000) throw new FormError('Paste a plan of at most 100,000 UTF-8 bytes.');
  assertSafe({ 'idea.text': input.text }, kitRoot);
  const manifest = readManifest(root);
  if (!manifest) throw new FormError('Finish project setup before importing a plan here.');
  const questions = collectQuestions(kitRoot, ['core']);
  const choices = (id) => (questions.find((q) => q.id === id)?.choices ?? []).map((c) => typeof c === 'object' ? c : { value: c, label: c });
  const plan = parseKickoffReply(input.text, { languages: choices('arch.language'), hosts: choices('arch.runs-on') });
  const foundations = prepareFoundations({ root, kitRoot, documents: plan.foundations, reviewed: true });
  checkTaskReferences(plan.tasks, foundations);
  const answers = readAnswers(root).answers;
  const expected = hashContent(JSON.stringify({ manifest, answers, previous: readFoundationFile(root, PLAN_FILE, { kitRoot }),
    foundations, tasks: readProjectFile(root, 'TASKS.md')?.toString('utf8') ?? null }));
  return { plan, foundations, answers, manifest, expected };
}
export function previewPlanning(ctx) {
  const p = prepare(ctx);
  return { expected: p.expected, foundations: p.foundations?.entries.map(({ kind, path, text, action, before }) => ({ kind, path, text, action, ...(action === 'update' ? { diff: unifiedDiff(path, before, text) } : {}) })) ?? [],
    tasks: p.plan.tasks.length, phases: new Set(p.plan.tasks.map((t) => t.phase)).size, warnings: p.plan.warnings,
    titles: p.plan.tasks.map((t) => t.title), hasTasks: enabledModules(p.manifest).includes('tasks'), taskMode: tasksMode(p.answers, { teamModule: enabledModules(p.manifest).includes('team') }) };
}
export async function applyPlanning({ root, kitRoot, env, input }) {
  if (input.reviewed !== true) throw new FormError('Review the plan and foundation documents first.');
  const p = prepare({ root, kitRoot, input });
  if (p.expected !== input.expected) throw new FormError('The plan or project changed since preview; review again.', 409);
  savePlanningFiles({ root, kitRoot, plan: p.plan, foundations: p.foundations, setupHash: hashContent(JSON.stringify(planningFacts(p.answers))) });
  let message = `Saved ${PLAN_FILE}.`;
  const modules = enabledModules(p.manifest);
  if (modules.includes('tasks')) {
    if (tasksMode(p.answers, { teamModule: modules.includes('team') }) === 'github') message += ' Create GitHub issues when ready with yaw kickoff import docs/plan/kickoff.md.';
    else {
      const sink = { write() {} };
      const result = await importTasks({ root, plan: p.plan.tasks, io: { cwd: root, kitRoot, env, stdout: sink, stderr: sink } });
      message += result.code ? ' Task creation did not finish; run yaw kickoff import docs/plan/kickoff.md.' : ` Added ${result.created} local tasks; skipped ${result.skipped} existing tasks.`;
    }
  } else message += ' Tasks remain in the plan; add the Tasks module to create work items.';
  return { ...kickoffParts({ root, manifest: readManifest(root) }), message };
}
