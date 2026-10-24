// Knowledge editing (web and `yaw knowledge`): global records in ~/.yaw/knowledge/<namespace>/ and the current
// project's docs/knowledge, docs/spec and .decisions. Callers name a source and a record; this module builds the
// path, refuses links and secret-looking names or text, detects concurrent edits, and writes atomically.
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { writeAtomic } from '../render/files.js';
import { KNOWLEDGE_SOURCES, MAX_BYTES, readRegular, sourceAnchor } from '../web/knowledge.js';
import { loadRules, secretRule, secretValueRule } from '../../modules/security/lib/guards.js';
import { FormError } from '../web/form-model.js';

export const KNOWLEDGE_TYPES = ['rule', 'preference', 'lesson', 'snippet', 'document'];
export const contentHash = (text) => createHash('sha256').update(String(text)).digest('hex');
const NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;
const PART = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;

function sourceOf(name) {
  const source = KNOWLEDGE_SOURCES.find((s) => s.key === name);
  if (!source) throw new FormError('Unknown knowledge source.');
  return source;
}

function checkRel(rel, rules) {
  const parts = typeof rel === 'string' && rel.length <= 300 ? rel.split('/') : [];
  if (!parts.length || parts.length > 5 || parts.some((p) => !PART.test(p))) throw new FormError('Invalid knowledge record path.');
  if (!/\.md$/i.test(rel)) throw new FormError('Knowledge records are Markdown (.md) files.');
  if (parts.some((p) => secretRule(rules, p))) throw new FormError('That file name looks like a secret file; choose another name.');
}

// Refuses links and non-directories on the way; -> true when the record itself exists as a regular file.
function guardPath(anchor, rel) {
  let current = anchor;
  const parts = rel.split('/');
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]);
    let st;
    try { st = lstatSync(current); } catch (e) {
      if (e.code === 'ENOENT') return false;
      throw new FormError(`Cannot check ${rel} (${e.code}).`);
    }
    if (st.isSymbolicLink()) throw new FormError(`${rel} goes through a symbolic link; edit it outside YAW.`);
    const last = i === parts.length - 1;
    if (!last && !st.isDirectory()) throw new FormError(`${rel}: ${parts.slice(0, i + 1).join('/')} is not a folder.`);
    if (last && !st.isFile()) throw new FormError(`${rel} is not a regular file.`);
  }
  return true;
}

function checkContent(text, rules) {
  if (typeof text !== 'string' || !text.trim()) throw new FormError('The record text is empty.');
  if (text.includes('\0')) throw new FormError('The record text contains a NUL byte.');
  if (Buffer.byteLength(text) > MAX_BYTES) throw new FormError('Knowledge records are limited to 128 KiB.');
  const hit = secretValueRule(rules, text);
  if (hit) throw new FormError(`The text looks like it contains a secret (${hit.id ?? 'secret rule'}); nothing was saved.`);
}

// A parsed record reference: { source, anchor, rel (below the source), file (below the anchor) }.
function locate(key, ctx, rules) {
  const at = typeof key === 'string' ? key.indexOf(':') : -1;
  if (at < 1) throw new FormError('Choose a knowledge record.');
  const source = sourceOf(key.slice(0, at)), rel = key.slice(at + 1);
  checkRel(rel, rules);
  const anchor = sourceAnchor(source, ctx);
  return { source, anchor, rel, file: `${source.rel}/${rel}` };
}

function readCurrent(target) {
  if (!guardPath(target.anchor, target.file)) throw new FormError('The record no longer exists; reload the list.', 404);
  try { return readRegular(join(target.anchor, target.source.rel), target.rel); }
  catch (e) { throw new FormError(`Cannot read ${target.file}: ${e.message}.`); }
}

function write(target, text) {
  if (target.source.scope === 'user') mkdirSync(target.anchor, { recursive: true, mode: 0o700 });
  guardPath(target.anchor, target.file);
  writeAtomic(target.anchor, target.file, text, { mode: target.source.scope === 'user' ? 0o600 : 0o644 });
}

async function afterDecisions(target, root) {
  if (target.source.key !== 'decisions') return '';
  try {
    const lib = await import('../../modules/decisions/lib/cli.js');
    const sink = { write() {} };
    await lib.runDecisions({ verb: 'rebuild', io: { root, stdout: sink, stderr: sink } });
    return ' Decision index rebuilt.';
  } catch (e) {
    return ` The decision index could not be rebuilt (${e.message}); fix the record and run yaw decisions rebuild.`;
  }
}

const slug = (title) => title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

export function renderKnowledge({ title, type, tags = [], body = '' }) {
  const front = [`title: ${JSON.stringify(title)}`, `type: ${type}`];
  if (tags.length) front.push(`tags: ${JSON.stringify(tags)}`);
  return `---\n${front.join('\n')}\n---\n# ${title}\n\n${String(body).trim()}\n`;
}

// input: edit { key, expected, content } | create { source, title, type?, tags?, body?, namespace? (global only) }.
export async function saveKnowledge({ root, kitRoot, env, input }) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new FormError('Expected record details.');
  const rules = loadRules({ kitRoot }), ctx = { root, env };
  if (input.key !== undefined) {
    const target = locate(input.key, ctx, rules);
    if (contentHash(readCurrent(target)) !== input.expected) throw new FormError('The record changed on disk since you opened it; reload it and edit again.', 409);
    checkContent(input.content, rules);
    write(target, input.content);
    return { key: input.key, path: `${target.source.label}/${target.rel}`, message: `Saved ${target.source.label}/${target.rel}.${await afterDecisions(target, root)}` };
  }
  const source = sourceOf(input.source);
  if (source.key === 'decisions') throw new FormError('Create decision records with yaw decisions record so IDs and the index stay consistent; existing records can be edited here.');
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title || title.length > 200 || /[\r\n]/.test(title)) throw new FormError('Give a one-line title (up to 200 characters).');
  const type = input.type ?? (source.scope === 'user' ? 'rule' : 'document');
  if (!KNOWLEDGE_TYPES.includes(type)) throw new FormError(`Type must be one of: ${KNOWLEDGE_TYPES.join(', ')}.`);
  const tags = input.tags ?? [];
  if (!Array.isArray(tags) || tags.length > 20 || tags.some((t) => typeof t !== 'string' || !NAME.test(t))) throw new FormError('Tags are up to 20 lowercase words (a-z, 0-9, -).');
  const namespace = source.scope === 'user' ? input.namespace ?? 'personal' : null;
  if (namespace !== null && (typeof namespace !== 'string' || !NAME.test(namespace))) throw new FormError('Namespaces are lowercase words (a-z, 0-9, -).');
  if (source.scope !== 'user' && input.namespace !== undefined) throw new FormError('Namespaces apply to global knowledge only.');
  if (input.body !== undefined && typeof input.body !== 'string') throw new FormError('The record text must be text.');
  const content = renderKnowledge({ title, type, tags, body: input.body ?? '' });
  checkContent(content, rules);
  const anchor = sourceAnchor(source, ctx), base = slug(title) || 'note';
  for (let n = 1; n <= 100; n++) {
    const rel = `${namespace ? `${namespace}/` : ''}${base}${n > 1 ? `-${n}` : ''}.md`;
    checkRel(rel, rules);
    const target = { source, anchor, rel, file: `${source.rel}/${rel}` };
    if (guardPath(anchor, target.file)) continue;
    write(target, content);
    return { key: `${source.key}:${rel}`, path: `${source.label}/${rel}`, message: `Created ${source.label}/${rel}.` };
  }
  throw new FormError('Too many records with this title; choose another title.');
}

// input: { key, expected, confirm: true }. Deletes the file; there is no trash.
export async function removeKnowledge({ root, kitRoot, env, input }) {
  if (!input || input.confirm !== true) throw new FormError('Confirm deleting the record.');
  const target = locate(input.key, { root, env }, loadRules({ kitRoot }));
  if (contentHash(readCurrent(target)) !== input.expected) throw new FormError('The record changed on disk since you opened it; reload it before deleting.', 409);
  guardPath(target.anchor, target.file);
  unlinkSync(join(target.anchor, ...target.file.split('/')));
  return { key: input.key, message: `Deleted ${target.source.label}/${target.rel}.${await afterDecisions(target, root)}` };
}
