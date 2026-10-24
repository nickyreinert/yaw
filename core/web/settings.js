// Settings view of the dashboard: the YAW files of one workspace, the decision categories and the interview.
// The server builds the file list; a request may only name a file from it. Reads are bounded and never follow
// links or open secret files. Writes: decision categories (taxonomy) and interview answers via yaw edit's engine.
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readManifest } from '../render/manifest.js';
import { ANSWERS, ProjectError, editProject, initProject, readAnswers } from '../render/project.js';
import { inspectFolder } from '../cli/folder-guard.js';
import { MANIFEST, BASE_DIR } from '../render/files.js';
import { gitInit, isGitRepo } from '../lib/git-init.js';
import { loadRules, secretRule } from '../../modules/security/lib/guards.js';
import { readRegular, MAX_BYTES } from './knowledge.js';
import { FormError, assertSafe, createFormModel } from './form-model.js';

const hash = (text) => `sha256:${createHash('sha256').update(text).digest('hex')}`;
const MAX_BASE_FILES = 500;
const MAX_DIFF = 256 * 1024;

// Files that grow with the project are shown on the Knowledge, Tasks and Code map pages instead.
const ELSEWHERE = /^(\.decisions\/|docs\/(knowledge|spec)\/|docs\/code-map\.md$|TASKS\.md$)/;
export const CATEGORIES = [
  { key: 'instructions', title: 'Agent instructions', command: 'yaw edit · yaw apply',
    test: (p) => /^(AGENTS|CLAUDE|GEMINI)\.md$|(^|\/)copilot-instructions\.md$|^\.github\/instructions\/|^\.claude\/(output-styles|skills|commands|agents)\/|^\.agents\//.test(p) },
  { key: 'hooks', title: 'Hooks & agent settings', command: 'yaw doctor',
    test: (p) => /(^|\/)(settings(\.local)?\.json|hooks\.json|config\.toml)$|^\.mcp\.json$|^\.yaw\/bin\/|^\.githooks\/|^\.husky\/|lefthook|^\.github\/hooks\//.test(p) },
  { key: 'recipes', title: 'Recipes', command: 'just --list · just check', test: (p) => /^justfile$|^just\//.test(p) },
  { key: 'records', title: 'YAW records', command: 'yaw status · yaw edit', test: (p) => p.startsWith('.yaw/') },
  { key: 'other', title: 'Other files', command: 'yaw apply', test: () => true },
];
const ABOUT = {
  'AGENTS.md': 'Rules every agent reads first. YAW owns the marked blocks; text outside them is yours.',
  'CLAUDE.md': 'Claude Code entry point; imports AGENTS.md.',
  '.claude/settings.json': 'Registers YAW hooks and read denials with Claude Code.',
  '.codex/hooks.json': 'Registers YAW hooks with Codex. Codex asks you to trust them once with /hooks.',
  '.yaw/bin/yaw-hook': 'Launcher every agent hook calls; finds the installed YAW and runs the hook.',
  justfile: 'Project recipes (just check, just test …). Imports the YAW recipe files.',
  [ANSWERS]: 'Your interview answers. Change them on the Interview tab; Apply re-renders the files that depend on them.',
  [MANIFEST]: 'Which files YAW wrote, from which module, and the kit version used.',
  [BASE_DIR]: 'Copies of what YAW last wrote. yaw apply compares against them so your own edits survive a merge.',
};

function entry(root, rel, rules) {
  if (/^\.env/.test(rel.split('/').at(-1)) || secretRule(rules, rel)) return null;
  let st;
  try { st = lstatSync(join(root, ...rel.split('/'))); } catch { return { path: rel, missing: true }; }
  if (st.isSymbolicLink() || !st.isFile()) return { path: rel, blocked: true };
  return { path: rel, size: st.size, modified: st.mtime.toISOString() };
}

function baseFiles(root, rules) {
  const out = [];
  const walk = (rel) => {
    let names;
    try { names = readdirSync(join(root, ...rel.split('/')), { withFileTypes: true }); } catch { return; }
    for (const d of names.sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= MAX_BASE_FILES) return;
      const child = `${rel}/${d.name}`;
      if (d.isDirectory()) walk(child);
      else if (d.isFile()) { const e = entry(root, child, rules); if (e) out.push(e); }
    }
  };
  try { if (lstatSync(join(root, BASE_DIR)).isDirectory()) walk(BASE_DIR); } catch { /* no base copies */ }
  return out;
}

// Every YAW file of the workspace, grouped. -> { available, kit, pinned, groups: [{ key, title, command, files }] }
export function settingsFiles({ root, kitRoot }) {
  const manifest = readManifest(root);
  if (!manifest) return { available: false };
  const answers = readAnswers(root);
  const rules = loadRules({ kitRoot, profiles: answers.proposal?.profiles ?? [] });
  const paths = [...new Set([...manifest.files.map((f) => f.path), ANSWERS, MANIFEST])].filter((p) => !ELSEWHERE.test(p) && !p.startsWith(`${BASE_DIR}/`));
  const byPath = new Map(manifest.files.map((f) => [f.path, f]));
  const groups = CATEGORIES.map(({ key, title, command }) => ({ key, title, command, files: [] }));
  let excluded = 0;
  for (const path of paths.sort()) {
    const e = entry(root, path, rules);
    if (!e) { excluded += 1; continue; }
    const m = byPath.get(path);
    const file = { ...e, module: m?.module ?? 'core', managed: m ? m.managed !== false : false, about: ABOUT[path] ?? null, editable: path === ANSWERS ? 'interview' : null };
    groups[CATEGORIES.findIndex((c) => c.test(path))].files.push(file);
  }
  const base = baseFiles(root, rules);
  if (base.length) groups.find((g) => g.key === 'records').files.push({ path: BASE_DIR, folder: true, about: ABOUT[BASE_DIR], files: base, limited: base.length >= MAX_BASE_FILES });
  return { available: true, pinned: manifest.kit, groups: groups.filter((g) => g.files.length), excluded };
}

// One file from the list above. The path must be listed; anything else is refused without a read.
export function settingsFile({ root, kitRoot, path }) {
  const list = settingsFiles({ root, kitRoot });
  if (!list.available) throw new FormError('Project not configured', 404);
  const known = list.groups.flatMap((g) => g.files.flatMap((f) => f.folder ? f.files : [f]));
  const file = typeof path === 'string' && known.find((f) => f.path === path);
  if (!file || file.missing || file.blocked) throw new FormError('File unavailable', 404);
  if (file.size > MAX_BYTES) return { ...file, content: null, tooLarge: true, limit: MAX_BYTES };
  let content;
  try { content = readRegular(root, path); } catch { throw new FormError('File unavailable', 404); }
  return { ...file, content };
}

// ------------------------------------------------------------------------------- decision categories

const journal = (kitRoot) => import(pathToFileURL(join(kitRoot, 'modules', 'decisions', 'lib', 'journal.js')).href);
const pairOf = (r) => `${r.category} / ${r.subcategory}`;

// -> { available, content, hash, usage: { "Category / Sub": [ids] } }
export async function taxonomyData({ root, kitRoot }) {
  const j = await journal(kitRoot);
  let content;
  try { content = j.readText(root, j.TAXONOMY); } catch (e) { throw new FormError(e.message); }
  if (content === null) return { available: false };
  const usage = {};
  try { for (const r of j.loadRecords(root).records) (usage[pairOf(r)] ??= []).push(r.id); }
  catch (e) { if (!(e instanceof j.JournalError)) throw e; }
  return { available: true, path: j.TAXONOMY, content, hash: hash(content), usage };
}

// A pair used by a decision can be neither removed nor renamed: those decisions would fail yaw decisions check.
export async function saveTaxonomy({ root, kitRoot, input }) {
  if (!input || typeof input.content !== 'string' || typeof input.expected !== 'string') throw new FormError('Expected taxonomy content and its hash');
  if (input.content.length > 64 * 1024) throw new FormError('Decision categories are larger than 64 KiB');
  const j = await journal(kitRoot);
  const current = await taxonomyData({ root, kitRoot });
  if (!current.available) throw new FormError(`${j.TAXONOMY} is missing; run yaw apply`, 404);
  if (current.hash !== input.expected) throw new FormError('Decision categories changed on disk; reload before saving', 409);
  let doc;
  try { doc = j.validateTaxonomy(JSON.parse(input.content)); }
  catch (e) { throw new FormError(e instanceof SyntaxError ? 'Decision categories are not valid JSON' : e.message); }
  const before = new Set(JSON.parse(current.content).categories.flatMap((c) => c.subcategories.map((s) => `${c.name} / ${s.name}`)));
  for (const c of doc.categories) for (const s of c.subcategories) {
    if (!before.has(`${c.name} / ${s.name}`) && s.keywords.length === 0) throw new FormError(`"${c.name} / ${s.name}" needs at least one keyword`);
  }
  const now = new Set(doc.categories.flatMap((c) => c.subcategories.map((s) => `${c.name} / ${s.name}`)));
  const lost = Object.keys(current.usage).filter((p) => !now.has(p));
  if (lost.length) {
    throw new FormError(`Still used: ${lost.map((p) => `"${p}" (${current.usage[p].join(', ')})`).join('; ')}. Move those decisions to another category first.`, 409);
  }
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  j.writeText(root, j.TAXONOMY, text);
  return { hash: hash(text), message: `Saved ${j.TAXONOMY}: ${now.size} categories. yaw decisions check still passes for every decision.` };
}

// ------------------------------------------------------------------------------- interview (yaw edit in the browser)

const answersHash = (root) => { const doc = readRegular(root, ANSWERS); return hash(doc); };
// An unconfigured workspace gets yaw init's model (first setup); a configured one yaw edit's. `expected` is the
// answers hash the browser opened, or null for a first setup; either way a change on disk meanwhile is a 409.
function editModel({ root, kitRoot, env, expected }) {
  const fresh = !readManifest(root);
  if (expected !== undefined && expected !== (fresh ? null : answersHash(root))) throw new FormError('The setup changed on disk; reload the Interview tab', 409);
  try { return createFormModel({ root, kitRoot, env, edit: !fresh }); }
  catch (e) { if (e instanceof ProjectError) throw new FormError(e.message); throw e; }
}
const setupInput = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new FormError('Expected interview answers');
  const { mode, answers, modules, gitInit } = input;
  return { mode, answers, modules, ...(gitInit === true ? { gitInit } : {}) };
};
// The same folder rules as yaw init (#168): never the home folder or the file-system root; a non-empty folder that
// is not a project needs an explicit confirmation.
function freshFolder(root, env) {
  const f = inspectFolder(root, env);
  if (f.kind === 'home' || f.kind === 'root') {
    return { refused: `YAW is not set up in ${f.kind === 'home' ? 'your home folder' : 'the file-system root'}. Add a project folder instead.` };
  }
  return { kind: f.kind, entries: f.entries, repos: f.repos, confirm: f.kind === 'non-empty' };
}

export function interviewData({ root, kitRoot, env }) {
  const fresh = !readManifest(root);
  const folder = fresh ? freshFolder(root, env) : null;
  if (folder?.refused) return { available: false, fresh, message: folder.refused };
  const b = editModel({ root, kitRoot, env }).bootstrap();
  const initial = fresh ? { mode: 'full', answers: {}, modules: null } : b.initial;
  return { available: true, fresh, folder, hash: fresh ? null : answersHash(root), kit: b.kit, profiles: b.profiles, modules: b.modules, questions: b.questions, initial, sectionNames: b.sectionNames ?? [], gitRepo: b.gitRepo };
}

export function interviewPreview({ root, kitRoot, env, input }) {
  const model = editModel({ root, kitRoot, env, expected: input?.expected });
  const p = model.preview(setupInput(input), true);
  const diff = p.diff.length > MAX_DIFF ? `${p.diff.slice(0, MAX_DIFF)}\n… diff cut at 256 KiB; run yaw edit in a terminal for the full diff\n` : p.diff;
  return { profile: p.profile, modules: p.modules, files: p.files.filter((f) => f.action !== 'kept'), kept: p.files.filter((f) => f.action === 'kept').length, diff };
}

export async function interviewApply({ root, kitRoot, env, input }) {
  const fresh = !readManifest(root);
  if (fresh) {
    const folder = freshFolder(root, env);
    if (folder.refused) throw new FormError(folder.refused);
    if (folder.confirm && input?.confirmFolder !== true) throw new FormError('This folder is not empty and not a project yet; confirm that YAW may write into it');
  }
  const model = editModel({ root, kitRoot, env, expected: input?.expected });
  const prepared = model.normalize(setupInput(input));
  if (fresh) assertSafe(prepared.doc.answers, kitRoot);
  let applied;
  if (prepared.gitInit && !isGitRepo(root)) {
    const git = gitInit(root);
    if (git.error) throw new FormError(`git init failed: ${git.error}`);
  }
  try {
    applied = fresh
      ? await initProject({ root, kitRoot, answers: { text: prepared.text, doc: prepared.doc }, modules: prepared.modules })
      : await editProject({ root, kitRoot, answers: prepared });
  } catch (e) { if (e instanceof ProjectError) throw new FormError(e.message); throw e; }
  const report = applied.report.filter((r) => r.action !== 'edited').map(({ path, action, reason }) => ({ path, action, reason: reason ?? null }));
  if (fresh) return { report, fresh, hash: answersHash(root), message: `Set up: ${report.length} file${report.length === 1 ? '' : 's'} written. Run just setup && just check in the project folder to verify.` };
  return { report, hash: answersHash(root), message: `Applied: ${report.length ? `${report.length} file${report.length === 1 ? '' : 's'} changed` : 'nothing to do'}. Run just check to verify.` };
}
