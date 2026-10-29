// Review prompts (ADR-0056): five separate texts, each editable on two levels. A reviewer's prompt is the
// project's `.yaw/review/<kind>.md` (committed, shared with the team), else the user's blueprint
// `~/.yaw/review/<kind>.md`, else the kit default in `modules/review/prompts/`. `rules` holds the reporting rules
// every reviewer gets. Read-only behaviour and the VERDICT line are fixed in cli.js so an edit cannot break the gate.

import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeAtomic } from '../../../core/render/files.js';
import { userDir } from '../../../core/lib/user-store.js';
import { loadRules, secretValueRule } from '../../security/lib/guards.js';

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const PROMPT_KINDS = ['rules', 'quality', 'logic', 'ux', 'feature', 'security'];
export const PROMPT_LABELS = { rules: 'Reporting rules (all reviewers)', quality: 'Quality', logic: 'Business logic', ux: 'UI/UX', feature: 'Feature fit', security: 'Security' };
export const PROJECT_DIR = '.yaw/review';
const MAX_BYTES = 32 * 1024;
const hash = (text) => `sha256:${createHash('sha256').update(text).digest('hex')}`;

export class PromptError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'PromptError';
    this.status = status;
  }
}

function checkKind(kind) {
  if (!PROMPT_KINDS.includes(kind)) throw new PromptError(`unknown review prompt "${kind ?? ''}"; pick one of ${PROMPT_KINDS.join(', ')}`);
}

// anchor + rel: the folder that must already be trusted (project root, ~/.yaw) and the path below it.
function place(scope, { root, env }) {
  if (scope === 'project') {
    if (!root) throw new PromptError('no project for a project prompt');
    return { anchor: root, dir: PROJECT_DIR };
  }
  if (scope === 'global') return { anchor: userDir(env), dir: 'review' };
  throw new PromptError(`unknown scope "${scope}"; use project or global`);
}

// Refuses links and non-folders on the way: -> the text, or null when the file does not exist.
function readLayer(anchor, rel) {
  let current = anchor;
  const parts = rel.split('/');
  for (let i = 0; i < parts.length; i++) {
    current = join(current, parts[i]);
    let st;
    try { st = lstatSync(current); } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw new PromptError(`cannot check ${rel} (${e.code})`);
    }
    if (st.isSymbolicLink()) throw new PromptError(`${rel} goes through a symbolic link; edit it outside YAW`);
    const last = i === parts.length - 1;
    if (!last && !st.isDirectory()) throw new PromptError(`${parts.slice(0, i + 1).join('/')} is not a folder`);
    if (last && !st.isFile()) throw new PromptError(`${rel} is not a regular file`);
    if (last && st.size > MAX_BYTES) throw new PromptError(`${rel} is larger than 32 KiB`);
  }
  return readFileSync(current, 'utf8');
}

export function kitPrompt(kind, kitRoot = KIT) {
  checkKind(kind);
  return readFileSync(join(kitRoot, 'modules', 'review', 'prompts', `${kind}.md`), 'utf8');
}

function layer(scope, kind, ctx) {
  const { anchor, dir } = place(scope, ctx);
  const rel = `${dir}/${kind}.md`;
  const text = readLayer(anchor, rel);
  return text === null ? null : { text, hash: hash(text), path: scope === 'project' ? rel : `~/.yaw/${rel}` };
}

// -> { kind, label, kit, global, project, effective: { text, source } }; project is undefined without a root.
export function promptLayers(kind, { root, env, kitRoot = KIT }) {
  checkKind(kind);
  const kit = { text: kitPrompt(kind, kitRoot) };
  const global = layer('global', kind, { env });
  const project = root ? layer('project', kind, { root }) : undefined;
  const top = project ? ['project', project] : global ? ['global', global] : ['kit', kit];
  return { kind, label: PROMPT_LABELS[kind], kit, global, project, effective: { text: top[1].text, source: top[0] } };
}

export function allPrompts(ctx) {
  return PROMPT_KINDS.map((kind) => promptLayers(kind, ctx));
}

export function effectivePrompt(kind, ctx) {
  return promptLayers(kind, ctx).effective;
}

function checkText(text, kitRoot) {
  if (typeof text !== 'string' || !text.trim()) throw new PromptError('the prompt is empty; use reset to go back to the inherited prompt');
  if (text.includes('\0')) throw new PromptError('the prompt contains a NUL byte');
  if (Buffer.byteLength(text) > MAX_BYTES) throw new PromptError('review prompts are limited to 32 KiB');
  const hit = secretValueRule(loadRules({ kitRoot }), text);
  if (hit) throw new PromptError(`the prompt looks like it contains a secret (${hit.id ?? 'secret rule'}); nothing was saved`);
}

// `expected`: the hash of the file the editor opened, or null when it did not exist. A mismatch is a 409.
function assertExpected(current, expected) {
  if (expected === undefined) return;
  if ((current?.hash ?? null) !== expected) throw new PromptError('the prompt changed on disk; reload and edit again', 409);
}

export function savePrompt({ scope, kind, text, expected, root, env, kitRoot = KIT }) {
  checkKind(kind);
  const ctx = { root, env };
  const { anchor, dir } = place(scope, ctx);
  assertExpected(layer(scope, kind, ctx), expected);
  const body = text.endsWith('\n') ? text : `${text}\n`;
  checkText(body, kitRoot);
  if (scope === 'global') mkdirSync(anchor, { recursive: true, mode: 0o700 });
  readLayer(anchor, `${dir}/${kind}.md`); // refuse links before writing
  writeAtomic(anchor, `${dir}/${kind}.md`, body, { mode: scope === 'global' ? 0o600 : 0o644 });
  return { hash: hash(body), path: scope === 'project' ? `${dir}/${kind}.md` : `~/.yaw/${dir}/${kind}.md` };
}

// Removing a layer falls back to the next one (project -> blueprint -> kit default).
export function removePrompt({ scope, kind, expected, root, env }) {
  checkKind(kind);
  const ctx = { root, env };
  const current = layer(scope, kind, ctx);
  assertExpected(current, expected);
  if (!current) return { removed: false };
  const { anchor, dir } = place(scope, ctx);
  unlinkSync(join(anchor, dir, `${kind}.md`));
  return { removed: true };
}
