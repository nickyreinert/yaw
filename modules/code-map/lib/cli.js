// `yaw map <update|check|show>` (Y-5.11, ADR-0033). Exit codes: 0 ok, 1 the map is stale / invalid, 2 usage or environment.

import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { kitVersion } from '../../../core/render/kit.js';
import { MapEnvError, cacheFile, diffIndex, gitInfo, listFiles, readCache, readMapFile, refresh, writeCache } from './index.js';
import { MAP_FILE, MapFormatError, assign, checkMap, describe, dirOf, parseMap, starterMap, updateText } from './map.js';

export const USAGE = 'usage: yaw map update | check | show [area|path-prefix]';
const VERBS = ['update', 'check', 'show'];
const SHOW_LINES = 40;

export class MapUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MapUsageError';
  }
}

// Read the map file, the exclusions it declares and the file list. `model` is null when the file is missing.
function load(root, kitRoot) {
  const info = gitInfo(root);
  if (!info) throw new MapEnvError('not inside a git work tree; the code map needs git to list the project files');
  const { state, text } = readMapFile(root, MAP_FILE);
  let model = null;
  let formatError = null;
  if (state === 'ok') {
    try {
      model = parseMap(text);
    } catch (e) {
      if (!(e instanceof MapFormatError)) throw e;
      formatError = e;
    }
  }
  const { files } = listFiles(root, { kitRoot, exclude: model?.exclude ?? [] });
  return { info, state, text, model, formatError, files };
}

// The cache is an optimisation: read it, reconcile it with the tree, write it back. Never fatal.
function reconcile({ root, info, files, env, kitRoot, now }) {
  const file = cacheFile(env, info);
  const before = readCache(file, info);
  const index = refresh(root, files, { cache: before });
  writeCache(file, info, index, { kit: kitVersion(kitRoot), now });
  return { index, changes: before ? diffIndex(before.files, index) : null };
}

// docs/code-map.md: temp file in the same directory, re-read right before the rename; a change in between aborts.
function writeMap(root, text, expected, { beforeCommit } = {}) {
  const target = join(root, MAP_FILE);
  mkdirSync(dirname(target), { recursive: true });
  const tmp = join(dirname(target), `.code-map.md.yaw-${process.pid}-${randomBytes(4).toString('hex')}`);
  try {
    writeFileSync(tmp, text, { flag: 'wx' });
    beforeCommit?.();
    const now = readMapFile(root, MAP_FILE);
    if ((now.text ?? null) !== expected) return false;
    renameSync(tmp, target);
    return true;
  } finally {
    try { unlinkSync(tmp); } catch { /* renamed or never created */ }
  }
}

function report(stdout, changes) {
  if (!changes) return;
  for (const r of changes.renamed) stdout.write(`index: renamed ${r.from} -> ${r.to}\n`);
  const n = (list, word) => (list.length > 0 ? `${list.length} ${word}` : null);
  const parts = [n(changes.added, 'added'), n(changes.edited, 'edited'), n(changes.deleted, 'deleted'), n(changes.renamed, 'renamed')].filter(Boolean);
  if (parts.length > 0) stdout.write(`index: ${parts.join(', ')}\n`);
}

function update({ root, io, env, kitRoot, hooks }) {
  const { stdout, stderr } = io;
  const ctx = load(root, kitRoot);
  if (ctx.formatError) throw ctx.formatError;
  const { info, files } = ctx;
  const { changes } = reconcile({ root, info, files, env, kitRoot, now: io.now?.getTime?.() });
  report(stdout, changes);
  if (ctx.state === 'missing') {
    if (!writeMap(root, starterMap(files), null, hooks)) {
      stderr.write(`${MAP_FILE} appeared while update ran; run again\n`);
      return 1;
    }
    stdout.write(`${MAP_FILE}: created; describe each area, then commit it\n`);
    return 0;
  }
  const up = updateText(ctx.text, ctx.model, files);
  if (up.text === ctx.text) {
    stdout.write(`${MAP_FILE}: up to date\n`);
    return 0;
  }
  if (!writeMap(root, up.text, ctx.text, hooks)) {
    stderr.write(`${MAP_FILE} changed during update; nothing was written, run again\n`);
    return 1;
  }
  const areas = up.changed.map((n) => n.replace(/^area-/, '')).filter((n) => n !== 'overview');
  stdout.write(`${MAP_FILE}: updated ${up.changed.join(', ') || 'removed blocks'}\n`);
  if (areas.length > 0) stdout.write(`review the descriptions of: ${areas.join(', ')} (in this PR)\n`);
  for (const o of up.orphans) stdout.write(`removed the generated block of "${o.replace(/^area-/, '')}" (not declared any more); its text stays in ${MAP_FILE}, review it\n`);
  return 0;
}

function check({ root, io, kitRoot }) {
  const { stdout, stderr } = io;
  const ctx = load(root, kitRoot);
  const problems = [];
  const warnings = [];
  if (ctx.state === 'missing') problems.push(`${MAP_FILE} does not exist: run \`just map update\``);
  else if (ctx.formatError) problems.push(`${ctx.formatError.message}; fix it, then run \`just map update\``);
  else {
    const r = checkMap(ctx.text, ctx.model, ctx.files);
    problems.push(...r.problems);
    warnings.push(...r.warnings);
  }
  for (const w of warnings) stderr.write(`code-map: warning: ${w}\n`);
  if (problems.length === 0) {
    stdout.write(`code-map: ok (${ctx.files.length} files)\n`);
    return 0;
  }
  stderr.write(`code-map: ${problems.length} problem${problems.length === 1 ? '' : 's'}\n${problems.map((p) => `  - ${p}`).join('\n')}\n`);
  return 1;
}

function show({ root, args, io, env, kitRoot }) {
  const ctx = load(root, kitRoot);
  if (ctx.state === 'missing') throw new MapEnvError(`${MAP_FILE} does not exist; run \`just map update\``);
  if (ctx.formatError) throw ctx.formatError;
  const { model, files, text } = ctx;
  reconcile({ root, info: ctx.info, files, env, kitRoot, now: io.now?.getTime?.() });
  const lines = [];
  if (checkMap(text, model, files).problems.length > 0) lines.push('note: the code map is stale; run `just map update`');
  const { byArea } = assign(model, files);
  const target = args[0];
  const area = target ? model.areas.find((a) => a.id === target) : null;
  if (!target) {
    for (const a of model.areas) {
      const first = (describe(text, a.id)[0] ?? '').split(/(?<=[.!?])\s/)[0];
      lines.push(`${a.id}: ${a.title}, ${byArea.get(a.id).length} files${first ? `. ${first}` : ''}`);
    }
  } else if (area) {
    lines.push(`${area.id}: ${area.title}`, ...describe(text, area.id).slice(0, 4));
    if (area.entry.length > 0) lines.push(`entry points: ${area.entry.join(', ')}`);
    if (area.tests.length > 0) lines.push(`tests: ${area.tests.join(', ')}`);
    if (area.relates.length > 0) lines.push(`relates to: ${area.relates.join(', ')}`);
    if (area.adrs.length > 0) lines.push(`ADRs: ${area.adrs.join(', ')}`);
    lines.push(...groupedFiles(byArea.get(area.id)));
  } else {
    const prefix = target.replace(/\/+$/, '');
    const hit = files.filter((f) => f === prefix || f.startsWith(`${prefix}/`));
    if (hit.length === 0) throw new MapUsageError(`"${target}" is neither an area nor a path prefix with files; areas: ${model.areas.map((a) => a.id).join(', ')}`);
    lines.push(`${prefix}: ${hit.length} file${hit.length === 1 ? '' : 's'}`, ...groupedFiles(hit));
  }
  const shown = lines.length > SHOW_LINES ? [...lines.slice(0, SHOW_LINES - 1), `… ${lines.length - SHOW_LINES + 1} more`] : lines;
  io.stdout.write(`${shown.join('\n')}\n`);
  return 0;
}

function groupedFiles(files) {
  const groups = new Map();
  for (const f of files) {
    const d = dirOf(f, 99);
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d).push(f.split('/').pop());
  }
  return [...groups].map(([d, names]) => `${d === '.' ? './' : `${d}/`} (${names.length}): ${names.slice(0, 6).join(', ')}${names.length > 6 ? ', …' : ''}`);
}

export function runMap({ verb, args = [], io, hooks = {} }) {
  if (!VERBS.includes(verb)) throw new MapUsageError(verb ? `unknown verb "${verb}"` : 'missing verb');
  if (verb !== 'show' && args.length > 0) throw new MapUsageError(`unexpected argument "${args[0]}"`);
  if (verb === 'show' && args.length > 1) throw new MapUsageError(`unexpected argument "${args[1]}"`);
  const ctx = { root: io.root, args, io, env: io.env ?? process.env, kitRoot: io.kitRoot, hooks };
  try {
    return { update, check, show }[verb](ctx);
  } catch (e) {
    if (e instanceof MapEnvError) {
      io.stderr.write(`yaw map: ${e.message}\n`);
      return 2;
    }
    if (e instanceof MapFormatError) {
      io.stderr.write(`yaw map: ${e.message}\n`);
      return 1;
    }
    throw e;
  }
}

// Used by `yaw remove code-map`: delete this worktree's cache file.
export { gitInfo, removeCache } from './index.js';
