// Read-only knowledge browser. The server chooses the source roots; a request never supplies a file path.
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { yawHome } from '../hooks/dispatch.js';
import { parse } from '../lib/yaml.js';
import { loadRules, secretRule, secretValueRule } from '../../modules/security/lib/guards.js';
import { FormError } from './form-model.js';

const MAX_FILES = 1000, MAX_BYTES = 128 * 1024;
const stat = (path) => { try { return lstatSync(path); } catch { return null; } };
const kinds = new Set(['decision', 'notice', 'rule', 'preference', 'lesson', 'snippet', 'document']);
function readRegular(root, rel) {
  let path = root, expected;
  const rootStat = stat(root);
  if (!rootStat?.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Unsafe root');
  const checked = [{ path: root, entry: rootStat }];
  for (const part of rel.split('/')) {
    if (!part || part === '.' || part === '..') throw new Error('Invalid path');
    path = join(path, part); expected = stat(path);
    if (!expected || expected.isSymbolicLink()) throw new Error('Unsafe path');
    checked.push({ path, entry: expected });
  }
  if (!expected.isFile() || expected.size > MAX_BYTES) throw new Error('Record too large');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const actual = fstatSync(fd);
    if (!actual.isFile() || actual.dev !== expected.dev || actual.ino !== expected.ino || actual.size > MAX_BYTES) throw new Error('Record changed');
    for (const { path: checkedPath, entry } of checked) {
      const current = stat(checkedPath);
      if (!current || current.isSymbolicLink() || current.dev !== entry.dev || current.ino !== entry.ino) throw new Error('Path changed');
    }
    return readFileSync(fd, 'utf8');
  } finally { closeSync(fd); }
}
function metadata(text, path) {
  let front = {};
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (match) { try { const value = parse(match[1]); if (value && typeof value === 'object' && !Array.isArray(value)) front = value; } catch { /* still browse the document */ } }
  const field = (name) => text.match(new RegExp(`^- \\*\\*${name}:\\*\\* (.+)$`, 'mi'))?.[1]?.trim();
  const stem = basename(path, '.md');
  const inferred = /^ADR-/.test(stem) ? 'decision' : /^NOTICE-/.test(stem) ? 'notice' : /^(RULE|PREF(?:ERENCE)?|LESSON|SNIPPET)-/i.exec(stem)?.[1].toLowerCase().replace(/^pref$/, 'preference');
  const type = kinds.has(front.type) ? front.type : kinds.has(inferred) ? inferred : 'document';
  return {
    title: typeof front.title === 'string' ? front.title : text.match(/^#\s+(.+)$/m)?.[1] || stem,
    type, status: String(front.status ?? field('Status') ?? ''),
    category: String(front.category ?? field('Category') ?? ''),
    tags: Array.isArray(front.tags) ? front.tags.filter((t) => typeof t === 'string') : [],
  };
}
export function knowledgeData({ root, kitRoot, env, params = new URLSearchParams() }) {
  const scope = params.get('scope') || 'all', query = (params.get('q') || '').trim().toLowerCase();
  if (!['all', 'user', 'project'].includes(scope)) throw new FormError('Invalid knowledge scope.');
  const rules = loadRules({ kitRoot });
  const sources = [
    { key: 'decisions', scope: 'project', anchor: root, rel: '.decisions', label: '.decisions' },
    { key: 'project-knowledge', scope: 'project', anchor: root, rel: 'docs/knowledge', label: 'docs/knowledge' },
    { key: 'specs', scope: 'project', anchor: root, rel: 'docs/spec', label: 'docs/spec' },
    { key: 'user-knowledge', scope: 'user', anchor: yawHome(env), rel: 'knowledge', label: '~/.yaw/knowledge' },
  ];
  const records = [], sourcesInfo = [];
  let excluded = 0, limited = false;
  for (const source of sources) {
    if (scope !== 'all' && source.scope !== scope) continue;
    source.root = join(source.anchor, source.rel);
    const base = stat(source.root);
    const info = { scope: source.scope, path: source.label, state: !base ? 'missing' : base.isDirectory() && !base.isSymbolicLink() ? 'available' : 'blocked', records: 0 };
    let ancestor = source.anchor;
    for (const part of ['', ...source.rel.split('/')]) {
      if (part) ancestor = join(ancestor, part);
      const entry = stat(ancestor);
      if (entry?.isSymbolicLink()) info.state = 'blocked';
    }
    sourcesInfo.push(info);
    if (info.state !== 'available') continue;
    const walk = (dir, depth = 0) => {
      if (depth > 4) { limited = true; return; }
      let names; try { names = readdirSync(join(source.root, dir)).sort(); } catch { excluded++; return; }
      for (const name of names) {
        if (records.length >= MAX_FILES) { limited = true; return; }
        if (name.startsWith('.') || secretRule(rules, name)) continue;
        const rel = dir ? `${dir}/${name}` : name, entry = stat(join(source.root, rel));
        if (!entry || entry.isSymbolicLink()) { excluded++; continue; }
        if (entry.isDirectory()) { walk(rel, depth + 1); continue; }
        if (!entry.isFile() || !/\.md$/i.test(name)) continue;
        try {
          const content = readRegular(source.root, rel);
          if (secretValueRule(rules, content)) { excluded++; continue; }
          const meta = metadata(content, rel);
          const namespace = source.scope === 'user' && rel.includes('/') ? rel.split('/')[0] : 'default';
          records.push({ key: `${source.key}:${rel}`, scope: source.scope, namespace, path: `${source.label}/${rel}`, ...meta, modified: entry.mtime.toISOString(), content });
          info.records++;
        } catch { excluded++; }
      }
    };
    walk('');
  }
  const selected = records.filter((r) => (!params.get('namespace') || r.namespace === params.get('namespace')) &&
    (!params.get('type') || r.type === params.get('type')) && (!query || `${r.title}\n${r.path}\n${r.category}\n${r.tags.join(' ')}\n${r.content}`.toLowerCase().includes(query)));
  selected.sort((a, b) => a.title.localeCompare(b.title));
  const key = params.get('record');
  const detail = key ? selected.find((r) => r.key === key) : null;
  if (key && !detail) throw new FormError('Record unavailable in this scope or selection.', 404);
  const pageSize = 50, pages = Math.max(1, Math.ceil(selected.length / pageSize));
  const page = Math.min(pages, Math.max(1, Math.floor(Number(params.get('page')) || 1)));
  return {
    total: selected.length, page, pages, excluded, limited, sources: sourcesInfo,
    options: { namespaces: [...new Set(records.map((r) => r.namespace))].sort(), types: [...new Set(records.map((r) => r.type))].sort() },
    entries: selected.slice((page - 1) * pageSize, page * pageSize).map(({ content, ...r }) => r),
    record: detail ?? null,
  };
}
