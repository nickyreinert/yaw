// Decision journal (Y-5.6, ADR-0028; blueprint D, E5, K4, K5): Markdown records are the truth, the index
// is derived from them. Records, taxonomy and index live in `.decisions/` of the project.
//
// Path safety (lesson of Y-5.3/5.5): every path is checked before any file I/O; no component may be a
// symbolic link (also one that stays inside the project); record files are only ever addressed as
// `.decisions/<validated ID>.md`, never through a path read from a record or from the index.

import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkRelPath, writeAtomic } from '../../../core/render/files.js';
import { DIMENSIONS, MODEL, embed, roundVector } from '../../../core/lib/retrieval.js';

export const DIR = '.decisions';
export const INDEX = `${DIR}/decisions.index.json`;
export const TAXONOMY = `${DIR}/taxonomy.json`;
export const INDEX_VERSION = 2;

export const STATUSES = ['proposed', 'accepted', 'provisional', 'superseded', 'deprecated'];
export const IMPORTANCE = ['critical', 'high', 'normal', 'low'];
export const KINDS = ['security', 'business-logic', 'privacy'];
export const REF_TYPES = ['detail', 'spec', 'code', 'issue', 'commit', 'session'];
const PATH_REFS = ['detail', 'spec', 'code'];

// Solo: ADR-0007 (sequential); team mode: ADR-34-1 (issue number, then a counter; ADR-0010).
export const ID = /^(ADR|NOTICE)-(\d{4,}|[1-9]\d*-[1-9]\d*)$/;
const PREFIX = { decision: 'ADR', notice: 'NOTICE' };

export class JournalError extends Error {}

// ------------------------------------------------------------------------------- safe file access

// Throws unless every existing component of rel is a real directory/file (no symlink) and the last one,
// if it exists, has the wanted type. -> absolute path, or null when it does not exist.
export function safePath(root, rel, { type = 'file' } = {}) {
  checkRelPath(rel);
  let cur = root;
  const parts = rel.split('/');
  for (let i = 0; i < parts.length; i += 1) {
    cur = join(cur, parts[i]);
    let st;
    try {
      st = lstatSync(cur);
    } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null;
      throw new JournalError(`${rel} cannot be checked (${e.code})`);
    }
    if (st.isSymbolicLink()) throw new JournalError(`${rel} must not be or go through a symbolic link`);
    const last = i === parts.length - 1;
    if (!last && !st.isDirectory()) throw new JournalError(`${rel}: ${parts.slice(0, i + 1).join('/')} is not a directory`);
    if (last && type === 'file' && !st.isFile()) throw new JournalError(`${rel} must be a regular file`);
    if (last && type === 'dir' && !st.isDirectory()) throw new JournalError(`${rel} must be a directory`);
  }
  return cur;
}

export function readText(root, rel) {
  const p = safePath(root, rel);
  return p === null ? null : readFileSync(p, 'utf8');
}

export function writeText(root, rel, text) {
  safePath(root, rel); // refuses symlinks before writeAtomic creates anything
  writeAtomic(root, rel, text);
}

// Does a referenced path exist? Only lstat, never a read; anything unsafe counts as "not usable".
// -> null (fine) or a problem text.
export function refProblem(root, path) {
  const rel = String(path).split('#')[0];
  try {
    checkRelPath(rel);
    if (rel.split('/')[0].toLowerCase() === '.git') return 'is inside .git';
    return safePath(root, rel, { type: 'any' }) === null ? 'does not exist' : null;
  } catch (e) {
    return `cannot be used (${e.message})`;
  }
}

// ------------------------------------------------------------------------------- taxonomy

export function validateTaxonomy(value, file = TAXONOMY) {
  const bad = (why) => new JournalError(`${file}: ${why}`);
  if (!value || typeof value !== 'object' || !Array.isArray(value.categories)) throw bad('needs "categories": [...]');
  const seen = new Set();
  for (const c of value.categories) {
    if (!c || typeof c.name !== 'string' || !c.name.trim() || !Array.isArray(c.subcategories)) throw bad('every category needs a "name" and "subcategories"');
    for (const s of c.subcategories) {
      if (!s || typeof s.name !== 'string' || !s.name.trim()) throw bad(`a subcategory of "${c.name}" has no name`);
      if (!Array.isArray(s.keywords) || s.keywords.some((k) => typeof k !== 'string' || !k.trim())) throw bad(`"${c.name} / ${s.name}" needs "keywords": ["..."]`);
      for (const n of [c.name, s.name]) if (/[/\n]/.test(n)) throw bad(`"${n}": names cannot contain "/" or line breaks`);
      const key = `${c.name}/${s.name}`;
      if (seen.has(key)) throw bad(`"${c.name} / ${s.name}" is listed twice`);
      seen.add(key);
    }
  }
  return value;
}

export function readTaxonomy(root) {
  const text = readText(root, TAXONOMY);
  if (text === null) throw new JournalError(`${TAXONOMY} is missing; run: yaw update`);
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new JournalError(`${TAXONOMY} is not valid JSON`);
  }
  return validateTaxonomy(value);
}

export function hasPair(taxonomy, category, subcategory) {
  return taxonomy.categories.some((c) => c.name === category && c.subcategories.some((s) => s.name === subcategory));
}

// ------------------------------------------------------------------------------- records

const META = /^- (?:\*\*)?([A-Za-z][A-Za-z ]*?):(?:\*\*)?[ \t]*(.*)$/;
const list = (v) => String(v ?? '').split(',').map((x) => oneLine(x.replace(/`/g, ''))).filter(Boolean);

// One-line text that is safe in a record heading or metadata line.
export function oneLine(text) {
  return String(text ?? '').replace(/<!--|-->/g, ' ').replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();
}

// Parse a record file. -> record; throws JournalError naming the file.
export function parseRecord(text, file) {
  const bad = (why) => new JournalError(`${DIR}/${file}: ${why}`);
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const head = /^# ((?:ADR|NOTICE)-[0-9-]+): (.+)$/.exec(lines[0] ?? '');
  if (!head) throw bad('the first line must be "# ADR-NNNN: Title" or "# NOTICE-NNNN: Title"');
  const [, id, title] = head;
  if (!ID.test(id)) throw bad(`"${id}" is not a record ID`);
  if (`${id}.md` !== file) throw bad(`the heading says ${id}, the file name must then be ${id}.md`);
  const type = id.startsWith('ADR-') ? 'decision' : 'notice';
  const meta = {};
  const sections = {};
  let current = null;
  for (const line of lines.slice(1)) {
    const h = /^## (.+?)\s*$/.exec(line);
    if (h) {
      current = h[1].toLowerCase();
      if (Object.hasOwn(sections, current)) throw bad(`section "## ${h[1]}" appears twice`);
      sections[current] = [];
      continue;
    }
    if (current === null) {
      const m = META.exec(line);
      if (m) meta[m[1].toLowerCase()] = m[2].trim();
      continue;
    }
    sections[current].push(line);
  }
  const section = (name) => (sections[name] ?? []).join('\n').trim();
  const category = (meta.category ?? '').split('/').map(oneLine);
  if (category.length !== 2 || !category[0] || !category[1]) throw bad('needs "- **Category:** Category / Subcategory"');
  const date = meta.date ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('needs "- **Date:** YYYY-MM-DD"');
  const status = (meta.status ?? (type === 'notice' ? 'accepted' : '')).toLowerCase();
  if (!STATUSES.includes(status)) throw bad(`status "${meta.status ?? ''}" is not one of ${STATUSES.join(', ')}`);
  const importance = (meta.importance ?? 'normal').toLowerCase();
  if (!IMPORTANCE.includes(importance)) throw bad(`importance "${meta.importance}" is not one of ${IMPORTANCE.join(', ')}`);
  const kind = type === 'notice' ? (meta.kind ?? '').toLowerCase() : undefined;
  if (type === 'notice' && !KINDS.includes(kind)) throw bad(`a notice needs "- **Kind:**" ${KINDS.join(' | ')}`);
  const reviewBy = meta['review by'] ?? null;
  if (reviewBy !== null && !/^\d{4}-\d{2}-\d{2}$/.test(reviewBy)) throw bad('"Review by" must be YYYY-MM-DD');
  const ids = (key) => {
    const v = list(meta[key]);
    for (const x of v) if (!ID.test(x)) throw bad(`"${key}": "${x}" is not a record ID`);
    return v;
  };
  const context = section('context');
  const body = type === 'decision' ? section('decision') : section('consideration');
  if (!context) throw bad('needs a "## Context" section');
  if (!body) throw bad(`needs a "## ${type === 'decision' ? 'Decision' : 'Consideration'}" section`);
  if (type === 'decision' && !section('consequences')) throw bad('needs a "## Consequences" section');
  const refs = [];
  for (const line of section('references').split('\n').filter((l) => l.trim())) {
    const r = /^- ([a-z]+): (.+)$/.exec(line.trim());
    if (!r || !REF_TYPES.includes(r[1])) throw bad(`reference "${line.trim()}" must be "- <${REF_TYPES.join('|')}>: <value>"`);
    const value = r[2].replace(/`/g, '').trim();
    if (PATH_REFS.includes(r[1])) {
      const [path, symbol] = value.split('#');
      refs.push(r[1] === 'code' && symbol ? { type: r[1], path, symbol } : { type: r[1], path: value });
    } else {
      refs.push({ type: r[1], ref: value });
    }
  }
  return {
    id,
    type,
    ...(kind ? { kind } : {}),
    file,
    title: oneLine(title),
    date,
    category: category[0],
    subcategory: category[1],
    status,
    importance,
    supersedes: ids('supersedes'),
    supersededBy: ids('superseded by'),
    scope: list(meta.scope),
    reviewBy,
    tags: list(meta.tags),
    refs,
    context,
    body,
    consequences: section('consequences'),
  };
}

// The one text recipe for every vector (blueprint N10): summary + context + decision | consideration.
export function embeddingText(record) {
  return `${record.title}\n${record.context}\n${record.body}`;
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Canonical Markdown of a new record (blueprint D4 plus the D2 fields).
export function renderRecord(r) {
  const meta = [
    `- **Date:** ${r.date}`,
    `- **Category:** ${r.category} / ${r.subcategory}`,
    r.type === 'notice' ? `- **Kind:** ${r.kind}` : null,
    r.type === 'decision' || r.status !== 'accepted' ? `- **Status:** ${cap(r.status)}` : null,
    `- **Importance:** ${r.importance}`,
    r.supersedes?.length ? `- **Supersedes:** ${r.supersedes.join(', ')}` : null,
    r.scope?.length ? `- **Scope:** ${r.scope.map((s) => `\`${s}\``).join(', ')}` : null,
    r.reviewBy ? `- **Review by:** ${r.reviewBy}` : null,
    r.tags?.length ? `- **Tags:** ${r.tags.join(', ')}` : null,
  ].filter(Boolean);
  const parts = [`# ${r.id}: ${r.title}`, '', ...meta, '', '## Context', '', r.context.trim(), ''];
  if (r.type === 'decision') parts.push('## Decision', '', r.body.trim(), '', '## Consequences', '', r.consequences.trim(), '');
  else parts.push('## Consideration', '', r.body.trim(), '');
  if (r.refs?.length) {
    parts.push('## References', '');
    for (const ref of r.refs) parts.push(`- ${ref.type}: ${ref.path ?? ref.ref}${ref.symbol ? `#${ref.symbol}` : ''}`);
    parts.push('');
  }
  return parts.join('\n');
}

// Mark an existing record as superseded by `by` (status line and "Superseded by"); other lines stay.
export function markSuperseded(text, by) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const end = lines.findIndex((l, i) => i > 0 && /^## /.test(l));
  const metaEnd = end === -1 ? lines.length : end;
  let hasStatus = false;
  let lastMeta = 0;
  const prior = [];
  for (let i = 1; i < metaEnd; i += 1) {
    const m = META.exec(lines[i]);
    if (!m) continue;
    lastMeta = i;
    const key = m[1].toLowerCase();
    if (key === 'status') {
      lines[i] = '- **Status:** Superseded';
      hasStatus = true;
    }
    if (key === 'superseded by') {
      prior.push(...list(m[2]));
      lines[i] = null;
    }
  }
  const byLine = `- **Superseded by:** ${[...new Set([...prior, by])].join(', ')}`;
  const insert = [hasStatus ? null : '- **Status:** Superseded', byLine].filter(Boolean);
  lines.splice(lastMeta + 1, 0, ...insert);
  return lines.filter((l) => l !== null).join('\n');
}

// ------------------------------------------------------------------------------- the journal

// Record files in `.decisions/` (top level only; details/ holds detail docs). Names that look like a record
// but are not valid IDs are reported, so a typo cannot hide a record.
// -> { records, errors: [text], strays: [file] }
export function loadRecords(root) {
  const dir = safePath(root, DIR, { type: 'dir' });
  if (dir === null) throw new JournalError(`${DIR}/ is missing; run: yaw update`);
  const records = [];
  const errors = [];
  for (const name of readdirSync(dir).sort()) {
    if (!/^(adr|notice)-.*\.md$/i.test(name)) continue;
    const id = name.slice(0, -3);
    if (!ID.test(id)) {
      errors.push(`${DIR}/${name}: "${id}" is not a record ID (ADR-NNNN, NOTICE-NNNN, or ADR-<issue>-<n> in team mode)`);
      continue;
    }
    try {
      records.push(parseRecord(readText(root, `${DIR}/${name}`), name));
    } catch (e) {
      if (!(e instanceof JournalError)) throw e;
      errors.push(e.message);
    }
  }
  return { records, errors };
}

// Index entry for a record: metadata + vector (blueprint D2, doc 12 §2). `summary` is the title.
export function indexEntry(r) {
  const entry = {
    id: r.id,
    type: r.type,
    ...(r.kind ? { kind: r.kind } : {}),
    file: r.file,
    date: r.date,
    category: r.category,
    subcategory: r.subcategory,
    summary: r.title,
    status: r.status,
    importance: r.importance,
    supersedes: r.supersedes,
    supersededBy: r.supersededBy,
    scope: r.scope,
    reviewBy: r.reviewBy,
    tags: r.tags,
    refs: r.refs,
    embeddingModel: MODEL,
    embedding: roundVector(embed(embeddingText(r))),
  };
  return entry;
}

const idOrder = (a, b) => {
  const k = (id) => id.split('-').slice(1).map(Number);
  const [x, y] = [k(a), k(b)];
  return a.split('-')[0].localeCompare(b.split('-')[0]) || x[0] - y[0] || (x[1] ?? 0) - (y[1] ?? 0);
};

export function buildIndex(records) {
  return { version: INDEX_VERSION, model: MODEL, dimensions: DIMENSIONS, entries: [...records].sort((a, b) => idOrder(a.id, b.id)).map(indexEntry) };
}

// Pretty JSON with every vector on one line: a changed record is a one-line diff (blueprint N15).
export function indexText(index) {
  const vectors = [];
  const text = JSON.stringify(index, (key, value) => (key === 'embedding' && Array.isArray(value) ? `\u0000${vectors.push(value) - 1}` : value), 2);
  return `${text.replace(/"\\u0000(\d+)"/g, (_, i) => JSON.stringify(vectors[Number(i)]))}\n`;
}

// The committed index (K5 skeleton when empty). Throws JournalError on a missing or corrupt file.
export function readIndex(root) {
  const text = readText(root, INDEX);
  if (text === null) throw new JournalError(`${INDEX} is missing; run: yaw decisions rebuild`);
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new JournalError(`${INDEX} is not valid JSON; run: yaw decisions rebuild`);
  }
  if (!value || !Array.isArray(value.entries)) throw new JournalError(`${INDEX} has no "entries"; run: yaw decisions rebuild`);
  const entries = value.entries.filter((e) => e && typeof e === 'object' && typeof e.id === 'string' && ID.test(e.id));
  return { ...value, entries };
}

// Next free ID. Solo: max + 1 over the record files and the index (an ID is never reused). Team mode
// (ADR-0010): <PREFIX>-<issue>-<n>.
export function nextId(type, { records, index, issue = null }) {
  const prefix = PREFIX[type];
  const ids = [...records.map((r) => r.id), ...(index?.entries ?? []).map((e) => e.id)].filter((id) => id.startsWith(`${prefix}-`));
  if (issue !== null) {
    const n = ids.map((id) => /^[A-Z]+-(\d+)-(\d+)$/.exec(id)).filter((m) => m && Number(m[1]) === issue).map((m) => Number(m[2]));
    return `${prefix}-${issue}-${Math.max(0, ...n) + 1}`;
  }
  const n = ids.map((id) => /^[A-Z]+-(\d{4,})$/.exec(id)).filter(Boolean).map((m) => Number(m[1]));
  return `${prefix}-${String(Math.max(0, ...n) + 1).padStart(4, '0')}`;
}

// `yaw decisions check` (part of `just check`): -> { errors: [text], warnings: [text], count }
export function checkJournal(root, { today }) {
  const errors = [];
  const warnings = [];
  const { records, errors: parseErrors } = loadRecords(root);
  errors.push(...parseErrors);
  let taxonomy = null;
  try {
    taxonomy = readTaxonomy(root);
  } catch (e) {
    if (!(e instanceof JournalError)) throw e;
    errors.push(e.message);
  }
  // IDs: file names are unique on disk; the same number with another spelling (ADR-7 vs ADR-0007) or a
  // heading copied into another file is caught by parseRecord (heading == file name) and here.
  const byNumber = new Map();
  for (const r of records) {
    const key = r.id.replace(/-0+(\d)/, '-$1');
    if (byNumber.has(key)) errors.push(`duplicate record ID: ${byNumber.get(key)} and ${r.id}`);
    else byNumber.set(key, r.id);
  }
  const known = new Set(records.map((r) => r.id));
  for (const r of records) {
    if (taxonomy && !hasPair(taxonomy, r.category, r.subcategory)) errors.push(`${r.id}: "${r.category} / ${r.subcategory}" is not in ${TAXONOMY}`);
    for (const x of [...r.supersedes, ...r.supersededBy]) if (!known.has(x)) errors.push(`${r.id}: refers to ${x}, which does not exist`);
    if (r.status === 'superseded' && r.supersededBy.length === 0) warnings.push(`${r.id}: superseded, but no "Superseded by"`);
    if (r.reviewBy && r.reviewBy < today && !['superseded', 'deprecated'].includes(r.status)) warnings.push(`${r.id}: review date ${r.reviewBy} has passed`);
    for (const ref of r.refs.filter((x) => x.path)) {
      const problem = refProblem(root, ref.path);
      if (problem) warnings.push(`${r.id}: reference ${ref.type} ${ref.path} ${problem}`);
    }
  }
  try {
    const index = readIndex(root);
    const seen = new Set();
    for (const e of index.entries) {
      if (seen.has(e.id)) errors.push(`${INDEX}: ${e.id} is listed twice`);
      seen.add(e.id);
    }
    if (parseErrors.length === 0 && indexText(index) !== indexText(buildIndex(records))) {
      errors.push(`${INDEX} does not match the records; run: yaw decisions rebuild`);
    }
  } catch (e) {
    if (!(e instanceof JournalError)) throw e;
    errors.push(e.message);
  }
  return { errors, warnings, count: records.length };
}
