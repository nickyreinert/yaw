// Compress hook (T-054, kickoff/16-compact-output.md §4 L2, ADR-0007 kind compress): Claude Code PostToolUse on
// Bash, Grep and Read. Bash output loses ANSI codes, `\r` progress frames and repeated lines and is capped with
// the re-run hint; Grep content is grouped by file; a whole lockfile Read becomes a name@version list.
// Left alone: the `hook` lever off (YAW_COMPACT, then the project answer, as for the recipes), output
// under 512 bytes, commands asking for detail (-v, --verbose, --nocapture, YAW_VERBOSE=1), git diff|show, output
// that went through `yaw run`, images, every other Read and partial lockfile reads. Failed calls fire
// PostToolUseFailure, which is not registered. The dispatcher keeps only a smaller result (never worse) and
// fails open on any error; loaded by the lean entry (core/hooks/compress.js), so no kit, schema or user store.

import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseDocument } from '../../../core/lib/yaml.js';
import { resolveLevers } from '../lib/levers.js';
import { condense, groupGrep, isLockfile, lockfile } from '../lib/methods.js';

export const MIN_BYTES = 512;
const DETAIL = /(?:^|\s)(?:-v|--verbose|--nocapture)(?=\s|=|$)|\bYAW_VERBOSE=1\b/;
const DIFF = /\bgit\b[^|;&]*\s(?:diff|show)\b/;
const WRAPPED = /\byaw\s+run\b/;
const JUST = /(?:^|[\s;&|(])just\b/;

const size = (...texts) => texts.reduce((n, t) => n + Buffer.byteLength(typeof t === 'string' ? t : ''), 0);

function missing(e) {
  if (e?.code !== 'ENOENT') throw e;
}

// The levers, a team setting (T-027): YAW_COMPACT, then the project answer.
function levers(env, root) {
  let answers = {};
  try {
    answers = parseDocument(readFileSync(join(root, '.yaw', 'answers.yaml'), 'utf8')).value?.answers ?? {};
  } catch (e) { missing(e); }
  return resolveLevers({ env, answers }).levers;
}

function bash(command, r, on) {
  if (!command || r.isImage || DETAIL.test(command) || DIFF.test(command) || WRAPPED.test(command)) return null;
  if (on.includes('recipes') && JUST.test(command)) return null;
  if (size(r.stdout, r.stderr) < MIN_BYTES) return null;
  const out = { ...r };
  const used = new Set();
  for (const key of ['stdout', 'stderr']) {
    if (typeof r[key] !== 'string') continue;
    const { text, methods } = condense(r[key]);
    out[key] = text;
    for (const m of methods) used.add(m);
  }
  if (used.size === 0) return null;
  const method = ['ansi', 'progress', 'dedup', 'cap'].filter((m) => used.has(m)).join('+');
  return { updatedToolOutput: out, method };
}

function grep(r) {
  if (r.mode !== 'content' || typeof r.content !== 'string' || size(r.content) < MIN_BYTES) return null;
  const content = groupGrep(r.content);
  return content === null ? null : { updatedToolOutput: { ...r, content }, method: 'grep-group' };
}

function read(r) {
  const f = r.file;
  if (r.type !== 'text' || !f || typeof f.content !== 'string' || typeof f.filePath !== 'string' || !isLockfile(basename(f.filePath))) return null;
  if (f.startLine !== 1 || f.numLines < f.totalLines || size(f.content) < MIN_BYTES) return null;
  const content = lockfile(basename(f.filePath), f.content);
  return content === null ? null : { updatedToolOutput: { ...r, file: { ...f, content, numLines: content.split('\n').length } }, method: 'lockfile' };
}

export default function compress(ev, { root, env, toolResponse: r }) {
  if (env.YAW_VERBOSE === '1' || !r || typeof r !== 'object') return null;
  const on = levers(env, root);
  if (!on.includes('hook')) return null;
  if (ev.tool?.name === 'Bash') return bash(ev.input?.command, r, on);
  if (ev.tool?.name === 'Grep') return grep(r);
  if (ev.tool?.name === 'Read') return read(r);
  return null;
}
