// `yaw knowledge list|show|add|edit|remove`: global knowledge (~/.yaw/knowledge/<namespace>/) and, inside a YAW
// project, docs/knowledge, docs/spec and .decisions. The web dashboard uses the same store (core/lib/knowledge-store.js).

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { readManifest } from '../render/manifest.js';
import { knowledgeRecords } from '../web/knowledge.js';
import { contentHash, KNOWLEDGE_TYPES, removeKnowledge, saveKnowledge } from '../lib/knowledge-store.js';
import { confirm } from './prompt.js';
import { UsageError } from './commands.js';

const ACTIONS = ['list', 'show', 'add', 'edit', 'remove'];

function records(io, values) {
  const project = Boolean(readManifest(io.cwd));
  if (values.project && !project) throw new UsageError('this folder has no YAW setup; use --global or run yaw init');
  const scope = values.global ? 'user' : values.project ? 'project' : project ? 'all' : 'user';
  return knowledgeRecords({ root: io.cwd, kitRoot: io.kitRoot, env: io.env, scope }).records;
}

// A record by key, displayed path, path below its source, or file name without .md.
function find(io, values, ref) {
  const all = records(io, values), want = ref.toLowerCase();
  const exact = all.filter((r) => r.key === ref || r.path === ref || r.rel === ref);
  const hits = exact.length ? exact : all.filter((r) => basename(r.rel, '.md').toLowerCase() === want);
  if (hits.length === 0) throw new UsageError(`no knowledge record "${ref}"; see yaw knowledge list`);
  if (hits.length > 1) throw new UsageError(`"${ref}" matches several records, use the full path: ${hits.map((r) => r.path).join(', ')}`);
  return hits[0];
}

function readInput(file) {
  return file === '-' ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8');
}

function editText(io, text) {
  const editor = io.env.VISUAL || io.env.EDITOR;
  if (!editor || !io.prompter?.interactive) throw new UsageError('give the new text with --file <path|-> or set $EDITOR in a terminal');
  const dir = mkdtempSync(join(tmpdir(), 'yaw-knowledge-'));
  const file = join(dir, 'record.md');
  try {
    writeFileSync(file, text, { mode: 0o600 });
    const run = spawnSync(`${editor} "${file}"`, { stdio: 'inherit', shell: true, env: io.env });
    if (run.status !== 0) throw new UsageError('the editor exited with an error; nothing was saved');
    return readFileSync(file, 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function knowledge({ values, positionals, io }) {
  const [action, ref, ...extra] = positionals;
  if (!ACTIONS.includes(action)) throw new UsageError(`use ${ACTIONS.join(', ')}`);
  if (extra.length) throw new UsageError(`unexpected argument "${extra[0]}"`);
  if (values.global && values.project) throw new UsageError('use either --global or --project');
  const ctx = { root: io.cwd, kitRoot: io.kitRoot, env: io.env };
  if (action === 'list') {
    if (ref) throw new UsageError('list takes no record; filter with --type or --query');
    const q = values.query?.toLowerCase();
    const shown = records(io, values).filter((r) => (!values.type || r.type === values.type) &&
      (!q || `${r.title}\n${r.path}\n${r.tags.join(' ')}\n${r.content}`.toLowerCase().includes(q)));
    if (!shown.length) io.stdout.write('no knowledge records\n');
    for (const r of shown) io.stdout.write(`${r.path}  ${r.type}${r.status ? `/${r.status}` : ''}  ${r.title}\n`);
    return 0;
  }
  if (action === 'add') {
    if (!ref) throw new UsageError('add needs a title: yaw knowledge add "<title>"');
    if (values.global && values.spec) throw new UsageError('--spec is a project folder; leave out --global');
    if (!values.global && !readManifest(io.cwd)) throw new UsageError('this folder has no YAW setup; use --global for personal knowledge');
    if (values.type && !KNOWLEDGE_TYPES.includes(values.type)) throw new UsageError(`--type must be one of: ${KNOWLEDGE_TYPES.join(', ')}`);
    const body = values.body ?? (values.file ? readInput(values.file) : '');
    const result = await saveKnowledge({ ...ctx, input: {
      source: values.global ? 'user-knowledge' : values.spec ? 'specs' : 'project-knowledge', title: ref, type: values.type,
      tags: values.tag, body, ...(values.global && values.namespace ? { namespace: values.namespace } : {}),
    } });
    io.stdout.write(`${result.message}\n`);
    return 0;
  }
  if (!ref) throw new UsageError(`${action} needs a record (path, key or name such as RULE-0001)`);
  const record = find(io, values, ref);
  if (action === 'show') {
    io.stdout.write(record.content.endsWith('\n') ? record.content : `${record.content}\n`);
    return 0;
  }
  if (action === 'edit') {
    const content = values.file ? readInput(values.file) : editText(io, record.content);
    if (content === record.content) {
      io.stdout.write('no changes; nothing was saved\n');
      return 0;
    }
    const result = await saveKnowledge({ ...ctx, input: { key: record.key, expected: contentHash(record.content), content } });
    io.stdout.write(`${result.message}\n`);
    return 0;
  }
  if (!values.yes) {
    if (!io.prompter?.interactive) throw new UsageError('no terminal to confirm: run again with --yes');
    if (!(await confirm(io.prompter, `Delete ${record.path}? This cannot be undone.`))) {
      io.stdout.write('cancelled; nothing was deleted\n');
      return 1;
    }
  }
  const result = await removeKnowledge({ ...ctx, input: { key: record.key, expected: contentHash(record.content), confirm: true } });
  io.stdout.write(`${result.message}\n`);
  return 0;
}
