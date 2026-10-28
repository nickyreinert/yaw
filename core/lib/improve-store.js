// Explicit saved verdicts, separate from metadata-only analytics and sync. No transcript discovery here.
import { randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readUserData, writeUserData } from './user-store.js';
import { hashContent, writeAtomic } from '../render/files.js';
import { effectivePrompt, promptLayers, savePrompt } from '../../modules/review/lib/prompts.js';
import { loadRules, secretValueRule } from '../../modules/security/lib/guards.js';
import { fullFileDiff } from '../web/form-model.js';

const FILE = 'improve-history.json';
const TARGETS = ['project-instructions', 'project-review-rules', 'personal-review-rules'];
const RETENTION = [7, 30, 90, 365];
export class ImproveError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const safe = (text, kitRoot, max = 32000) => {
  if (typeof text !== 'string' || !text.trim() || text.length > max || text.includes('\0') || secretValueRule(loadRules({ kitRoot }), text)) throw new ImproveError('Text is empty, too large or looks like it contains a secret.');
  return text.trim();
};
function history(env, now = Date.now()) {
  const doc = readUserData(env, FILE) ?? { version: 1, retentionDays: 30, records: [] };
  if (doc.version !== 1 || !RETENTION.includes(doc.retentionDays) || !Array.isArray(doc.records) || doc.records.length > 100 || doc.records.some((r) => !r || typeof r.id !== 'string' || !Number.isFinite(r.expiresAt))) throw new ImproveError('Saved Improve history is invalid; it was left untouched.');
  const records = doc.records.filter((r) => r.expiresAt > now);
  if (records.length !== doc.records.length) writeUserData(env, FILE, { ...doc, records });
  return { ...doc, records };
}
export function improveHistory({ env, now }) {
  const doc = history(env, now);
  return { retentionDays: doc.retentionDays, retentionChoices: RETENTION, records: doc.records.map(({ id, title, createdAt, expiresAt, assessment, applied }) => ({ id, title, createdAt, expiresAt, assessment, applied })) };
}
export function savedImprovement({ env, id, now }) {
  const record = history(env, now).records.find((r) => r.id === id);
  if (!record) throw new ImproveError('Saved verdict not found or expired.', 404);
  return record;
}
function parseVerdict(value, kitRoot) {
  const text = safe(value, kitRoot);
  let doc;
  try { doc = JSON.parse(text.replace(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/, '$1')); } catch { return { verdict: text }; }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || typeof doc.verdict !== 'string') throw new ImproveError('A structured verdict needs a verdict string.');
  const result = { verdict: safe(doc.verdict, kitRoot) };
  if (doc.assessment !== undefined) {
    const fields = { outcome: ['fulfilled', 'partial', 'unresolved', 'unknown'], collaboration: ['smooth', 'friction', 'recovered', 'unknown'], adherence: ['aligned', 'partial', 'diverged', 'unknown'] };
    if (!doc.assessment || typeof doc.assessment !== 'object' || Object.keys(doc.assessment).some((key) => !fields[key] || !fields[key].includes(doc.assessment[key]))) throw new ImproveError('Use supported outcome, collaboration and adherence labels.');
    result.assessment = Object.fromEntries(Object.keys(fields).map((key) => [key, doc.assessment[key] ?? 'unknown']));
  }
  if (doc.instruction !== undefined && doc.instruction !== '') result.instruction = safe(doc.instruction, kitRoot, 4000);
  if (doc.evidence !== undefined) {
    if (!Array.isArray(doc.evidence) || doc.evidence.length > 10) throw new ImproveError('Use at most ten evidence references.');
    result.evidence = doc.evidence.map((entry) => safe(entry, kitRoot, 500));
  }
  return result;
}
export function saveImprovement({ env, kitRoot, input, now = Date.now() }) {
  if (input.confirm !== true) throw new ImproveError('Confirm saving this verdict outside temporary review memory.');
  const doc = history(env, now);
  if (doc.records.length >= 100) throw new ImproveError('History holds 100 verdicts. Delete a record before saving another.');
  const record = { id: randomUUID(), title: safe(input.title ?? 'Reviewed conversation', kitRoot, 160), createdAt: now,
    expiresAt: now + doc.retentionDays * 86400000, ...parseVerdict(input.verdict, kitRoot) };
  if (input.includePrompt === true) record.prompt = safe(input.prompt, kitRoot, 24000);
  if (input.instruction?.trim()) record.instruction = safe(input.instruction, kitRoot, 4000);
  writeUserData(env, FILE, { ...doc, records: [record, ...doc.records] });
  return record;
}
export function importImprovement(ctx) {
  const text = safe(ctx.input.text, ctx.kitRoot, 64000);
  let doc;
  try { doc = JSON.parse(text); } catch {
    if (/^[\[{]/.test(text)) throw new ImproveError('The imported JSON is invalid.');
    return saveImprovement({ ...ctx, input: { ...ctx.input, title: 'Imported verdict', verdict: text, includePrompt: false } });
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new ImproveError('Import a JSON verdict object.');
  const verdict = JSON.stringify({ verdict: doc.verdict, assessment: doc.assessment, instruction: doc.instruction, evidence: doc.evidence });
  return saveImprovement({ ...ctx, input: { ...ctx.input, title: doc.title ?? 'Imported verdict', verdict,
    prompt: doc.prompt, includePrompt: ctx.input.includePrompt === true } });
}
export function deleteImprovement({ env, input, now }) {
  if (input.confirm !== true) throw new ImproveError('Confirm deleting the saved verdict. Applied project changes are kept.');
  const doc = history(env, now);
  if (!doc.records.some((r) => r.id === input.id)) throw new ImproveError('Saved verdict not found.', 404);
  writeUserData(env, FILE, { ...doc, records: doc.records.filter((r) => r.id !== input.id) });
  return { message: 'Deleted the saved verdict and any retained prompt. Applied project changes were kept.' };
}
export function retainImprovements({ env, input, now = Date.now() }) {
  if (input.confirm !== true || !RETENTION.includes(input.days)) throw new ImproveError('Confirm a supported retention period.');
  const doc = history(env, now);
  const records = doc.records.map((r) => ({ ...r, expiresAt: Math.min(r.expiresAt, r.createdAt + input.days * 86400000) })).filter((r) => r.expiresAt > now);
  writeUserData(env, FILE, { ...doc, retentionDays: input.days, records });
  return improveHistory({ env, now });
}

// Read only the fixed AGENTS.md target, never symlinks or arbitrary browser-supplied paths.
function instructions(root, kitRoot) {
  const path = join(root, 'AGENTS.md');
  let st;
  try { st = lstatSync(path); } catch (e) { if (e.code === 'ENOENT') throw new ImproveError('This project has no AGENTS.md. Initialize it first.'); throw e; }
  if (!st.isFile() || st.isSymbolicLink() || st.size > 32000) throw new ImproveError('AGENTS.md must be a regular file of at most 32,000 bytes.');
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const actual = fstatSync(fd);
    if (actual.ino !== st.ino || actual.dev !== st.dev || !actual.isFile() || actual.size > 32000) throw new ImproveError('AGENTS.md changed while reading.');
    const text = readFileSync(fd, 'utf8'); safe(text, kitRoot); return text;
  } finally { closeSync(fd); }
}
export function previewImprovement({ root, env, kitRoot, input }) {
  if (!TARGETS.includes(input.target)) throw new ImproveError('Choose project instructions, project review rules or personal review rules.');
  const snippet = safe(input.instruction, kitRoot, 4000);
  if (/<!--\s*\/?(?:yaw|improvement):/i.test(snippet)) throw new ImproveError('An instruction addition cannot contain management markers.');
  const project = input.target === 'project-instructions';
  const scope = input.target === 'personal-review-rules' ? 'global' : 'project';
  const current = project ? instructions(root, kitRoot) : effectivePrompt('rules', { root: scope === 'project' ? root : null, env, kitRoot }).text;
  const layerExpected = project ? null : promptLayers('rules', { root: scope === 'project' ? root : null, env, kitRoot })[scope === 'global' ? 'global' : 'project']?.hash ?? null;
  const path = project ? 'AGENTS.md' : scope === 'global' ? '~/.yaw/review/rules.md' : '.yaw/review/rules.md';
  const addition = `\n\n## Reviewed improvement\n\n${snippet}\n`;
  const after = current + addition;
  if (project && after.trimEnd().split('\n').length > 80) throw new ImproveError('This addition exceeds the AGENTS.md 80-line budget. Shorten it or choose review rules.');
  safe(after, kitRoot);
  return { target: input.target, path, instruction: snippet, layerExpected, expected: hashContent(current), afterHash: hashContent(after), diff: fullFileDiff(path, current, after) };
}
export function applyImprovement({ root, env, kitRoot, input }) {
  if (input.confirm !== true) throw new ImproveError('Review the exact instruction diff and confirm applying it.');
  const preview = previewImprovement({ root, env, kitRoot, input });
  if (input.expected !== preview.expected || input.afterHash !== preview.afterHash) throw new ImproveError('Instructions or the proposed addition changed; preview again.', 409);
  const project = input.target === 'project-instructions';
  if (project) {
    const current = instructions(root, kitRoot);
    if (hashContent(current) !== preview.expected) throw new ImproveError('Instructions changed; preview again.', 409);
    writeAtomic(root, 'AGENTS.md', `${current}\n\n## Reviewed improvement\n\n${preview.instruction}\n`);
  } else {
    const scope = input.target === 'personal-review-rules' ? 'global' : 'project';
    const text = effectivePrompt('rules', { root: scope === 'project' ? root : null, env, kitRoot }).text;
    if (hashContent(text) !== preview.expected) throw new ImproveError('Reviewer rules changed; preview again.', 409);
    savePrompt({ root, env, kitRoot, scope, kind: 'rules', expected: preview.layerExpected, text: `${text}\n\n## Reviewed improvement\n\n${preview.instruction}\n` });
  }
  return { message: `Applied the reviewed addition to ${preview.path}.`, ...preview };
}
