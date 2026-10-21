// docs/code-map.md (Y-5.11, ADR-0033): declarations in the front matter, generated sections between markers,
// maintained text everywhere else. Pure functions on text and file lists; no file system access.
//
// parseMap(text)                      -> model (areas, exclude, depth, line numbers)
// updateText(text, model, files)      -> { text, changed, missing, orphans }   (only marker interiors change)
// checkMap(text, model, files)        -> { problems: [string], warnings: [string] }
// starterMap(files)                   -> the first docs/code-map.md for a project
// describe(text, id)                  -> first paragraph of an area's description

import { posix } from 'node:path';
import { parseDocument, stringify } from '../../../core/lib/yaml.js';
import { compare, matches } from './index.js';

export const MAP_FILE = 'docs/code-map.md';
export const PLACEHOLDER = "Describe this area's responsibility.";
const ID = /^[a-z0-9][a-z0-9-]*$/;
const CAP = 30;

export class MapFormatError extends Error {
  constructor(message, line) {
    super(`${MAP_FILE}${line ? `:${line}` : ''}: ${message}`);
    this.name = 'MapFormatError';
  }
}

// ---------------------------------------------------------------- front matter

function strings(value, where, line, { required = false } = {}) {
  if (value === undefined) {
    if (required) throw new MapFormatError(`${where} is required`, line);
    return [];
  }
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || v === '')) throw new MapFormatError(`${where} must be a list of non-empty strings`, line);
  return value;
}

function safePattern(p, where, line) {
  if (p.startsWith('/') || p.includes('\\') || p.split('/').includes('..')) throw new MapFormatError(`${where}: "${p}" must be a project-relative path without ".."`, line);
  return p;
}

export function parseMap(text) {
  if (text.includes('\r')) throw new MapFormatError('uses CRLF line endings; convert the file to LF');
  const lines = text.split('\n');
  if (lines[0] !== '---') throw new MapFormatError('must start with a front matter block ("---") that declares the areas', 1);
  const end = lines.indexOf('---', 1);
  if (end === -1) throw new MapFormatError('the front matter is not closed ("---")', 1);
  let doc;
  try {
    doc = parseDocument(lines.slice(1, end).join('\n'), { file: MAP_FILE });
  } catch (e) {
    if (e.name === 'YamlError') throw new MapFormatError(`front matter: ${e.reason}`, (e.line ?? 1) + 1);
    throw e;
  }
  const front = doc.value ?? {};
  if (typeof front !== 'object' || Array.isArray(front)) throw new MapFormatError('the front matter must be a mapping', 2);
  const known = new Set(['areas', 'exclude', 'depth']);
  for (const k of Object.keys(front)) if (!known.has(k)) throw new MapFormatError(`unknown front matter key "${k}"`, 2);
  if (!Array.isArray(front.areas) || front.areas.length === 0) throw new MapFormatError('front matter needs "areas": a list of areas', 2);
  const depth = front.depth ?? 2;
  if (!Number.isInteger(depth) || depth < 1 || depth > 6) throw new MapFormatError('depth must be a whole number from 1 to 6', 2);
  const areas = [];
  const seen = new Set();
  front.areas.forEach((a, i) => {
    const line = (doc.lines.get(`/areas/${i}`) ?? 1) + 1;
    if (a === null || typeof a !== 'object' || Array.isArray(a)) throw new MapFormatError(`areas[${i}] must be a mapping`, line);
    for (const k of Object.keys(a)) if (!['id', 'title', 'paths', 'entry', 'tests', 'relates', 'adrs'].includes(k)) throw new MapFormatError(`areas[${i}]: unknown key "${k}"`, line);
    if (typeof a.id !== 'string' || !ID.test(a.id)) throw new MapFormatError(`areas[${i}]: id must be lower-case letters, digits and "-"`, line);
    if (seen.has(a.id)) throw new MapFormatError(`area id "${a.id}" is declared twice`, line);
    seen.add(a.id);
    if (typeof a.title !== 'string' || a.title.trim() === '' || /[\n`|]/.test(a.title)) throw new MapFormatError(`area "${a.id}": title must be one line of plain text`, line);
    const pick = (key, opts) => strings(a[key], `area "${a.id}" ${key}`, line, opts).map((p) => (key === 'relates' || key === 'adrs' ? p : safePattern(p, `area "${a.id}" ${key}`, line)));
    areas.push({
      id: a.id, title: a.title.trim(), line,
      paths: pick('paths', { required: true }), entry: pick('entry'), tests: pick('tests'), relates: pick('relates'), adrs: pick('adrs'),
    });
  });
  const exclude = strings(front.exclude, 'exclude', 2).map((p) => safePattern(p, 'exclude', 2));
  return { areas, exclude, depth, bodyStart: end + 1 };
}

// ---------------------------------------------------------------- areas and files

// Every file belongs to the first area (in declaration order) whose paths match it.
export function assign(model, files) {
  const byArea = new Map(model.areas.map((a) => [a.id, []]));
  const uncovered = [];
  for (const f of files) {
    const area = model.areas.find((a) => a.paths.some((g) => matches(g, f)));
    if (area) byArea.get(area.id).push(f);
    else uncovered.push(f);
  }
  return { byArea, uncovered };
}

export function dirOf(path, depth) {
  const parts = path.split('/').slice(0, -1);
  return parts.length === 0 ? '.' : parts.slice(0, depth).join('/');
}

export function dirsOf(files, depth) {
  const dirs = new Set();
  for (const f of files) {
    const parts = f.split('/').slice(0, -1);
    if (parts.length === 0) dirs.add('.');
    // every directory down to `depth`, so a nested directory shows its parents too
    for (let i = 1; i <= Math.min(parts.length, depth); i++) dirs.add(parts.slice(0, i).join('/'));
  }
  return [...dirs].sort(compare);
}

const code = (list) => (list.length === 0 ? '-' : list.map((x) => `\`${x}\``).join(', '));
const cell = (s) => s.replace(/\|/g, '\\|');

// ---------------------------------------------------------------- generated sections

function overviewBlock(model) {
  const rows = model.areas.map((a) => `| \`${a.id}\` | ${cell(a.title)} | ${cell(code(a.paths))} | ${cell(code(a.entry))} | ${cell(code(a.tests))} |`);
  return ['| Area | Title | Paths | Entry points | Tests |', '|---|---|---|---|---|', ...rows];
}

function areaBlock(model, area, files) {
  const dirs = dirsOf(files, model.depth);
  const shown = dirs.slice(0, CAP).map((d) => `  - \`${d === '.' ? './' : `${d}/`}\``);
  if (dirs.length > CAP) shown.push(`  - … ${dirs.length - CAP} more, see \`yaw map show ${area.id}\``);
  return [
    `- Paths: ${code(area.paths)}`,
    `- Entry points: ${code(area.entry)}`,
    `- Tests: ${code(area.tests)}`,
    `- Relates to: ${code(area.relates)}`,
    `- ADRs: ${code(area.adrs)}`,
    `- Directories:${shown.length === 0 ? ' -' : ''}`,
    ...shown,
  ];
}

export function desiredBlocks(model, files) {
  const { byArea } = assign(model, files);
  const blocks = new Map([['overview', overviewBlock(model)]]);
  for (const a of model.areas) blocks.set(`area-${a.id}`, areaBlock(model, a, byArea.get(a.id)));
  return blocks;
}

// ---------------------------------------------------------------- markers

const MARKER = /^<!-- yaw:map:(begin|end) ([a-z0-9-]+) -->$/;

// Marker blocks of the body: [{ name, begin, end }] (line indexes). Throws MapFormatError with file:line.
export function findBlocks(lines, bodyStart) {
  const blocks = [];
  let open = null;
  let fence = null;
  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i];
    const f = /^\s*(```+|~~~+)/.exec(line);
    if (f && (fence === null || line.trim().startsWith(fence))) {
      fence = fence === null ? f[1] : null;
      continue;
    }
    if (fence !== null || !line.includes('yaw:map:')) continue;
    const m = MARKER.exec(line);
    if (!m) throw new MapFormatError(`malformed marker "${line.trim()}"`, i + 1);
    const [, kind, name] = m;
    if (name !== 'overview' && !(name.startsWith('area-') && ID.test(name.slice(5)))) throw new MapFormatError(`unknown marker name "${name}"`, i + 1);
    if (kind === 'begin') {
      if (open) throw new MapFormatError(`"${name}" begins inside "${open.name}" (line ${open.begin + 1})`, i + 1);
      if (blocks.some((b) => b.name === name)) throw new MapFormatError(`duplicate block "${name}"`, i + 1);
      open = { name, begin: i };
    } else {
      if (!open || open.name !== name) throw new MapFormatError(`end of "${name}" without a matching begin`, i + 1);
      blocks.push({ ...open, end: i });
      open = null;
    }
  }
  if (open) throw new MapFormatError(`block "${open.name}" is never closed`, open.begin + 1);
  return blocks;
}

const begin = (name) => `<!-- yaw:map:begin ${name} -->`;
const end = (name) => `<!-- yaw:map:end ${name} -->`;

// ---------------------------------------------------------------- update

// Rewrites the interior of every block; appends a heading, a placeholder and a block for a new area; removes blocks of
// areas that are no longer declared (their maintained text stays). Everything else is copied byte for byte.
export function updateText(text, model, files) {
  const lines = text.split('\n');
  const trailing = lines[lines.length - 1] === '';
  if (trailing) lines.pop();
  const blocks = findBlocks(lines, model.bodyStart);
  const want = desiredBlocks(model, files);
  const byName = new Map(blocks.map((b) => [b.name, b]));
  const changed = [];
  const orphans = [];
  const out = [];
  let i = 0;
  const emitBlock = (name) => out.push(begin(name), ...want.get(name), end(name));
  for (const b of blocks) {
    while (i < b.begin) out.push(lines[i++]);
    const old = lines.slice(b.begin + 1, b.end);
    if (want.has(b.name)) {
      const next = want.get(b.name);
      if (old.length !== next.length || old.some((l, k) => l !== next[k])) changed.push(b.name);
      emitBlock(b.name);
    } else {
      orphans.push(b.name);
    }
    i = b.end + 1;
  }
  while (i < lines.length) out.push(lines[i++]);

  const missing = [...want.keys()].filter((n) => !byName.has(n));
  if (missing.includes('overview')) {
    const h1 = out.findIndex((l, k) => k >= model.bodyStart && /^# /.test(l));
    const at = h1 === -1 ? model.bodyStart : h1 + 1;
    const insert = ['', begin('overview'), ...want.get('overview'), end('overview')];
    if (h1 === -1) insert.push('');
    out.splice(at, 0, ...insert);
  }
  for (const a of model.areas) {
    const name = `area-${a.id}`;
    if (!missing.includes(name)) continue;
    if (out.length > 0 && out[out.length - 1] !== '') out.push('');
    out.push(`## ${a.title}`, '', PLACEHOLDER, '', begin(name), ...want.get(name), end(name));
  }
  for (const n of missing) changed.push(n);
  const result = out.join('\n') + (trailing || missing.length > 0 ? '\n' : '');
  return { text: result, changed: [...new Set(changed)], missing, orphans };
}

// ---------------------------------------------------------------- check

function linksOf(lines, bodyStart) {
  const out = [];
  let fence = null;
  let inBlock = false;
  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i];
    const f = /^\s*(```+|~~~+)/.exec(line);
    if (f && (fence === null || line.trim().startsWith(fence))) {
      fence = fence === null ? f[1] : null;
      continue;
    }
    if (fence !== null) continue;
    if (MARKER.test(line)) inBlock = line.includes(':begin ');
    if (inBlock) continue;
    for (const m of line.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) out.push({ target: m[1], line: i + 1 });
  }
  return out;
}

export const REPAIR = 'run `just map update`';

// Mechanical freshness: stale sections, broken references, uncovered files. Reads nothing but the text and the file list.
export function checkMap(text, model, files) {
  const problems = [];
  const warnings = [];
  const fileSet = new Set(files);
  const exists = (path) => fileSet.has(path) || files.some((f) => f.startsWith(`${path}/`));
  const up = updateText(text, model, files);
  for (const name of up.missing) problems.push(`generated section "${name}" is missing: ${REPAIR}`);
  for (const name of up.changed.filter((n) => !up.missing.includes(n))) problems.push(`generated section "${name}" is stale: ${REPAIR}`);
  for (const name of up.orphans) problems.push(`generated section "${name}" belongs to an area that is no longer declared: ${REPAIR}`);

  const ids = new Set(model.areas.map((a) => a.id));
  const hasDecisions = files.some((f) => f.startsWith('.decisions/'));
  for (const a of model.areas) {
    for (const key of ['paths', 'entry', 'tests']) {
      for (const g of a[key]) {
        if (!files.some((f) => matches(g, f))) problems.push(`broken reference: area "${a.id}" ${key} "${g}" matches no file; fix it in ${MAP_FILE}`);
      }
    }
    for (const r of a.relates) if (!ids.has(r)) problems.push(`broken reference: area "${a.id}" relates to unknown area "${r}"; fix it in ${MAP_FILE}`);
    if (hasDecisions) for (const adr of a.adrs) if (!fileSet.has(`.decisions/${adr}.md`)) problems.push(`broken reference: area "${a.id}" names ${adr}, but .decisions/${adr}.md does not exist; fix it in ${MAP_FILE}`);
  }
  for (const { target, line } of linksOf(text.split('\n'), model.bodyStart)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('//')) continue;
    const path = target.replace(/[#?].*$/, '');
    if (path === '') continue;
    const resolved = posix.normalize(posix.join(posix.dirname(MAP_FILE), path)).replace(/\/$/, '');
    if (resolved.startsWith('..') || resolved.startsWith('/') || !exists(resolved)) problems.push(`broken reference: link "${target}" (${MAP_FILE}:${line}) points to a missing path; fix the link`);
  }

  const { uncovered } = assign(model, files);
  if (uncovered.length > 0) {
    const groups = new Map();
    for (const f of uncovered) {
      const top = f.includes('/') ? `${f.split('/')[0]}/` : f;
      groups.set(top, (groups.get(top) ?? 0) + 1);
    }
    const list = [...groups].slice(0, 10).map(([k, n]) => (k.endsWith('/') ? `${k} (${n})` : k)).join(', ');
    problems.push(`uncovered: ${uncovered.length} file${uncovered.length === 1 ? '' : 's'} in no area (${list}${groups.size > 10 ? ', …' : ''}); declare the area in ${MAP_FILE} or add the path to "exclude", then ${REPAIR}`);
  }
  const todo = text.split('\n').filter((l) => l === PLACEHOLDER).length;
  if (todo > 0) warnings.push(`${todo} area description${todo === 1 ? ' is' : 's are'} still the placeholder; describe them in ${MAP_FILE}`);
  return { problems, warnings };
}

// ---------------------------------------------------------------- starter

function areaId(name, used) {
  let id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'area';
  while (used.has(id)) id = `${id}-dir`;
  used.add(id);
  return id;
}

// One area per top-level directory plus "root" for the top-level files, so the first check passes.
export function starterMap(files) {
  const dirs = [...new Set(files.filter((f) => f.includes('/')).map((f) => f.split('/')[0]))].sort(compare);
  const used = new Set(['root']);
  const areas = dirs.map((d) => ({ id: areaId(d, used), title: d, paths: [`${d}/**`] }));
  areas.push({ id: 'root', title: 'Top-level files', paths: ['*'] });
  const front = stringify({ areas }, { header: false }).replace(/\n$/, '');
  const text = `---\n${front}\n---\n# Code map\n\nThe text outside the \`yaw:map\` blocks is yours: \`yaw map update\` rewrites only the blocks.\n`;
  return updateText(text, parseMap(text), files).text;
}

// ---------------------------------------------------------------- reading

// The first paragraph of the text between an area's heading and its generated block.
export function describe(text, id) {
  const lines = text.split('\n');
  const at = lines.indexOf(begin(`area-${id}`));
  if (at === -1) return [];
  let start = at - 1;
  while (start >= 0 && !/^#{1,6} /.test(lines[start])) start--;
  const para = [];
  for (const l of lines.slice(start + 1, at)) {
    if (l.trim() === '') {
      if (para.length > 0) break;
      continue;
    }
    para.push(l.trim());
  }
  return para;
}
