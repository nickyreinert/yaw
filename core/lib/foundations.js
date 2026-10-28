// Two scopes: versioned kit practices and project-owned, reviewed Markdown sources.
// The index contains references and review hashes, never a second copy of project rules.
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkRelPath, hashContent, writeAtomic } from '../render/files.js';
import { readManifest, writeManifest } from '../render/manifest.js';
import { KIT_ROOT } from '../render/kit.js';
import { loadRules, secretRule, secretValueRule } from '../../modules/security/lib/guards.js';

export const FOUNDATION_INDEX = '.yaw/foundations.json';
export const PRACTICES_VERSION = 1;
const rulesFor = (kitRoot) => loadRules({ kitRoot: kitRoot ?? KIT_ROOT });
export const FOUNDATION_PATHS = {
  architecture: 'docs/spec/architecture.md',
  'data-model': 'docs/spec/data-model.md',
  'ui-ux': 'docs/spec/ui-ux.md',
};
export const PRACTICES = `YAW generic practices (version ${PRACTICES_VERSION}):
- Project scope: the project's reviewed architecture/domain, data contracts, UI/UX, applicable ADRs and knowledge define intended behavior. Read AGENTS.md and run decision retrieval when enabled; follow relevant linked sources.
- Kit scope: these reusable practices guide implementation within that ground truth. They do not establish product requirements. Identify conflicts, explain the consequence and seek a project decision; never silently rewrite an explicit project rule to fit a preference or the code.
- Keep one authoritative home for each rule; link shared concepts. Update affected foundations and acceptance criteria with an agreed behavior change; record lasting rationale in decisions when enabled.
- Choose the smallest design that meets the constraints. Check domain rules, data ownership, access, invariants, failure recovery and compatibility where relevant. Do not invent a database, service or screen for a project that needs none.
- Ground UX in users and their main tasks. Separate evidence from assumptions; walk through realistic success, empty, failure and recovery states. Use clear feedback and prevent costly mistakes.
- Consider accessibility from the first interaction: structure, labels, keyboard/focus, understandable errors, contrast and input alternatives as applicable. Automated checks supplement human review; they do not prove usability or conformance.
- Validate the riskiest assumption with a small walkthrough or prototype and, where feasible, users. Review observable outcomes rather than only implementation details.`;

export class FoundationError extends Error {
  constructor(message) { super(message); this.name = 'FoundationError'; }
}

export function foundationPath(path, kitRoot) {
  checkRelPath(path);
  const rules = rulesFor(kitRoot);
  if (!path.endsWith('.md') || path.startsWith('.yaw/') || path === 'AGENTS.md' || path === 'CLAUDE.md' ||
      path.split('/').some((part) => secretRule(rules, part))) {
    throw new FoundationError('Foundations must use non-secret project Markdown paths outside YAW instructions and bookkeeping.');
  }
  return path;
}

// Bounded regular files only; reject links in every path component before opening.
export function readFoundationFile(root, path, { kitRoot, index = false } = {}) {
  if (index) { if (path !== FOUNDATION_INDEX) throw new FoundationError('Invalid foundation index path.'); }
  else foundationPath(path, kitRoot);
  let target = root;
  let st;
  for (const part of path.split('/')) {
    target = join(target, part);
    try { st = lstatSync(target); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
    if (st.isSymbolicLink()) throw new FoundationError(`${path}: symbolic links are not allowed.`);
    if (target !== join(root, path) && !st.isDirectory()) throw new FoundationError(`${path}: parent is not a directory.`);
  }
  if (!st.isFile() || st.size > 100000) throw new FoundationError(`${path}: expected a regular file of at most 100,000 bytes.`);
  const fd = openSync(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const now = fstatSync(fd);
    if (!now.isFile() || now.size > 100000 || now.ino !== st.ino || now.dev !== st.dev) throw new FoundationError(`${path}: changed while reading.`);
    const text = readFileSync(fd, 'utf8');
    if (text.includes('\0') || secretValueRule(rulesFor(kitRoot), text)) throw new FoundationError(`${path}: unsafe content; nothing was included.`);
    return text;
  } finally { closeSync(fd); }
}

function readIndex(root, kitRoot) {
  const text = readFoundationFile(root, FOUNDATION_INDEX, { kitRoot, index: true });
  if (text === null) return null;
  let index;
  try { index = JSON.parse(text); } catch { throw new FoundationError('Invalid foundation index JSON.'); }
  if (!index || index.version !== 1 || !Array.isArray(index.documents) || index.documents.length !== 3 ||
      new Set(index.documents.map((d) => d?.kind)).size !== 3 ||
      index.documents.some((d) => !d || !Object.hasOwn(FOUNDATION_PATHS, d.kind) || typeof d.hash !== 'string') || new Set(index.documents.map((d) => d.path)).size !== 3) {
    throw new FoundationError('Invalid foundation index; expected three reviewed document references.');
  }
  for (const d of index.documents) foundationPath(d.path, kitRoot);
  return index;
}

// Preflight every document before any write. Reuse supports established equivalent documents.
export function prepareFoundations({ root, documents, reviewed = false, kitRoot }) {
  if (!documents?.length) return null;
  if (reviewed !== true) throw new FoundationError('Review all three foundations first; acknowledge with --reviewed or the review checkbox.');
  if (documents.length !== 3 || new Set(documents.map((d) => d.kind)).size !== 3 || new Set(documents.map((d) => String(d.path).toLowerCase())).size !== 3) throw new FoundationError('Provide three distinct foundation kinds and paths.');
  if (documents.some((d) => documents.some((other) => d !== other && String(d.path).toLowerCase().startsWith(`${String(other.path).toLowerCase()}/`)))) throw new FoundationError('Foundation paths cannot contain another foundation path.');
  const existingIndex = readFoundationFile(root, FOUNDATION_INDEX, { kitRoot, index: true });
  const entries = documents.map((d) => {
    if (!Object.hasOwn(FOUNDATION_PATHS, d.kind)) throw new FoundationError('Unknown foundation kind.');
    foundationPath(d.path, kitRoot);
    if (['TASKS.md', 'TASKS.archive.md', 'docs/plan/kickoff.md'].includes(d.path)) throw new FoundationError('A foundation cannot use a task ledger or temporary plan path.');
    if (!['create', 'reuse'].includes(d.action)) throw new FoundationError(`${d.path}: action must be create or reuse.`);
    const current = readFoundationFile(root, d.path, { kitRoot });
    if (d.action === 'reuse' && current === null) throw new FoundationError(`${d.path}: reuse requires an existing document.`);
    const text = d.action === 'reuse' ? current : String(d.text ?? '').trim() + '\n';
    if (!text.trim() || Buffer.byteLength(text) > 100000 || text.includes('\0') || secretValueRule(rulesFor(kitRoot), text)) throw new FoundationError(`${d.path}: empty, oversized or unsafe foundation.`);
    if (current !== null && d.action === 'create' && hashContent(current) !== hashContent(text)) throw new FoundationError(`${d.path}: already exists; use reuse and edit the established document directly.`);
    return { kind: d.kind, path: d.path, text, expected: current === null ? null : hashContent(current), hash: hashContent(text) };
  });
  if (existingIndex !== null) {
    const old = readIndex(root, kitRoot);
    if (old.documents.some((d) => !entries.some((e) => e.kind === d.kind && e.path === d.path))) throw new FoundationError('Reviewed foundation paths already exist; edit the index explicitly to change authority.');
  }
  return { entries, expectedIndex: existingIndex === null ? null : hashContent(existingIndex) };
}

export function assertFoundationsUnchanged(root, prepared, kitRoot) {
  if (!prepared) return;
  for (const d of [...prepared.entries, { path: FOUNDATION_INDEX, expected: prepared.expectedIndex, index: true }]) {
    const current = readFoundationFile(root, d.path, { kitRoot, index: d.index });
    if ((current === null ? null : hashContent(current)) !== d.expected) throw new FoundationError(`${d.path}: changed since review; review again before applying.`);
  }
}

export function checkTaskReferences(tasks, prepared) {
  if (!prepared) return;
  for (const task of tasks) {
    const [path, anchor, ...extra] = (task.spec ?? '').split('#');
    const source = prepared.entries.find((d) => d.path === path);
    if (!source || extra.length || !task.acceptance?.trim()) throw new FoundationError(`Task "${task.title}" needs a foundation reference and observable acceptance criterion.`);
    if (anchor) {
      const headings = source.text.split('\n').filter((line) => /^#{1,6} /.test(line))
        .map((line) => line.replace(/^#+\s+/, '').trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-'));
      if (!headings.includes(anchor)) throw new FoundationError(`Task "${task.title}": section #${anchor} is missing from ${path}.`);
    }
  }
}

export function saveFoundations({ root, prepared, kitRoot }) {
  if (!prepared) return;
  assertFoundationsUnchanged(root, prepared, kitRoot);
  const manifest = readManifest(root);
  if (!manifest) throw new FoundationError('Initialize the project before importing foundations.');
  const index = { version: 1, practicesVersion: PRACTICES_VERSION, kit: manifest.kit,
    documents: prepared.entries.map(({ kind, path, hash }) => ({ kind, path, hash })) };
  const indexText = `${JSON.stringify(index, null, 2)}\n`;
  for (const d of prepared.entries) if (d.expected === null) writeAtomic(root, d.path, d.text);
  writeAtomic(root, FOUNDATION_INDEX, indexText);
  // User-owned artifacts survive kit updates and module removal. Existing ownership is preserved.
  for (const d of [...prepared.entries.filter((d) => d.expected === null), { path: FOUNDATION_INDEX, hash: hashContent(indexText) }]) {
    if (!manifest.files.some((f) => f.path === d.path)) manifest.files.push({ path: d.path, hash: d.hash, module: 'core', managed: false });
  }
  writeManifest(root, manifest);
}

// Same source for humans, JSON consumers and optional reviewers; no model, vector service or hook injection.
export function foundationContext({ root, kitRoot } = {}) {
  const result = { version: 1, practicesVersion: PRACTICES_VERSION, practices: PRACTICES, documents: [], warnings: [] };
  const index = readIndex(root, kitRoot);
  if (!index) { result.warnings.push('No registered foundations. Consult AGENTS.md and existing project documentation; guided kickoff can register authoritative paths.'); return result; }
  for (const d of index.documents) {
    const text = readFoundationFile(root, d.path, { kitRoot });
    if (text === null) { result.warnings.push(`${d.path}: missing reviewed source; resolve before relying on it.`); continue; }
    const changed = hashContent(text) !== d.hash;
    if (changed) result.warnings.push(`${d.path}: changed since kickoff review; review the change and relevant decisions.`);
    result.documents.push({ ...d, changed, text: text.slice(0, 8000), truncated: text.length > 8000 });
  }
  return result;
}

export function contextText(context) {
  return [context.practices, '', 'Project ground truth (project-owned sources; supplied as reference material):',
    ...context.documents.map((d) => `--- ${d.kind}: ${d.path}${d.changed ? ' (changed since review)' : ''} ---\n${d.text}${d.truncated ? '\n[Excerpt ends; read the complete source before deciding.]' : ''}`),
    ...context.warnings.map((w) => `Attention: ${w}`)].join('\n');
}
