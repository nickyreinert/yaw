// `yaw decisions <verb>` (Y-5.6, ADR-0028; blueprint K3, K4): record, query, recall, rebuild, check, list,
// taxonomy, seed. `just decisions ...` calls it. Arguments are parsed by node:util parseArgs in
// core/cli/main.js (blueprint N12); this file validates their values.

import { execFileSync } from 'node:child_process';
import { isAbsolute, relative, sep } from 'node:path';
import { checkRelPath } from '../../../core/render/files.js';
import { retrieve } from '../../../core/lib/retrieval.js';
import { readAnswers } from '../../../core/render/project.js';
import {
  DIR, ID, IMPORTANCE, INDEX, JournalError, KINDS, REF_TYPES, TAXONOMY, buildIndex, checkJournal, hasPair,
  indexText, loadRecords, markSuperseded, nextId, oneLine, parseRecord, readIndex, readTaxonomy, readText,
  renderRecord, validateTaxonomy, writeText,
} from './journal.js';

export const VERBS = ['record', 'query', 'recall', 'rebuild', 'check', 'list', 'taxonomy', 'seed'];
export const USAGE = [
  'usage: yaw decisions recall "<task in one line>" [--path <file>]...',
  '       yaw decisions record --category <C> --subcategory <S> --summary "..." --context "..." --decision "..." --consequences "..."',
  '                            [--importance critical|high|normal|low] [--status accepted|proposed|provisional] [--supersedes <ID>]...',
  '                            [--scope <glob>]... [--review-by YYYY-MM-DD] [--tag <t>]... [--ref <type>:<value>]... [--issue <n>]',
  '       yaw decisions record --type notice --kind security|business-logic|privacy --category <C> --subcategory <S>',
  '                            --summary "..." --context "..." --consideration "..." [same options]',
  '       yaw decisions query --text "..." [--type decision|notice|all] [--category <C> --subcategory <S>] [--path <file>]...',
  '       yaw decisions list | rebuild | check | seed',
  '       yaw decisions taxonomy [add "<Category> / <Subcategory>" [--keywords "a, b"]]',
  `references: ${REF_TYPES.join(', ')} (e.g. --ref detail:.decisions/details/ADR-0012.md, --ref issue:#34)`,
  'a value that starts with "-" (a Markdown list) needs the = form: --decision="- first point"',
].join('\n');
const MAX_SHOWN = 5;

export class DecisionsUsageError extends Error {}

function localDate(now) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

// Paths given by the agent (`--path`) become project-relative POSIX paths; they are only matched against
// `scope` globs, never opened.
export function projectPaths(root, paths = []) {
  const out = [];
  for (const raw of paths) {
    let p = String(raw).trim();
    if (isAbsolute(p)) {
      const rel = relative(root, p);
      if (rel === '' || rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) continue;
      p = rel.split(sep).join('/');
    }
    p = p.replace(/^(\.\/)+/, '');
    if (p) out.push(p);
  }
  return out;
}

function text(value, what, { required = true, multiline = false } = {}) {
  const v = multiline ? String(value ?? '').replace(/\r\n/g, '\n').trim() : oneLine(value);
  if (required && !v) throw new DecisionsUsageError(`missing --${what}`);
  if (multiline && /^#{1,2} /m.test(v)) throw new DecisionsUsageError(`--${what}: lines must not start with "#" or "##" (they would end the section)`);
  return v;
}

function parseRef(raw) {
  const m = /^([a-z]+):(.+)$/.exec(String(raw).trim());
  if (!m || !REF_TYPES.includes(m[1])) throw new DecisionsUsageError(`--ref "${raw}": use <${REF_TYPES.join('|')}>:<value>`);
  const value = oneLine(m[2]);
  if (['detail', 'spec', 'code'].includes(m[1])) {
    const [path, symbol] = value.split('#');
    try {
      checkRelPath(path);
    } catch (e) {
      throw new DecisionsUsageError(`--ref ${m[1]}: ${e.message}`);
    }
    return m[1] === 'code' && symbol ? { type: m[1], path, symbol } : { type: m[1], path: value };
  }
  return { type: m[1], ref: value };
}

function parseScope(glob) {
  const g = oneLine(glob).replace(/^\.\//, '');
  if (!g || g.startsWith('/') || g.split('/').includes('..') || /[`,]/.test(g)) throw new DecisionsUsageError(`--scope "${glob}": a project-relative glob without ".." or commas`);
  return g;
}

// Team mode (doc 14, ADR-0010): IDs are <PREFIX>-<issue>-<n>; the issue comes from --issue or the branch.
function teamIssue(root, values, env) {
  let answers = {};
  try {
    answers = readAnswers(root).answers;
  } catch { /* no answers: solo */ }
  if ((answers['idea.team'] ?? 'solo') === 'solo') return null;
  if (values.issue !== undefined) {
    if (!/^#?[1-9]\d{0,8}$/.test(values.issue)) throw new DecisionsUsageError(`--issue "${values.issue}" is not an issue number`);
    return Number(values.issue.replace('#', ''));
  }
  let branch = '';
  try {
    branch = execFileSync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { /* not a git repository */ }
  const m = /^[a-z]+\/([1-9]\d{0,8})-/.exec(branch);
  if (!m) throw new DecisionsUsageError('team mode: record IDs carry the issue number; pass --issue <n> or work on an issue branch (<type>/<n>-<slug>)');
  return Number(m[1]);
}

function loadClean(root) {
  const { records, errors } = loadRecords(root);
  if (errors.length > 0) throw new JournalError(`fix these records first:\n${errors.join('\n')}`);
  return records;
}

function writeIndex(root, records) {
  writeText(root, INDEX, indexText(buildIndex(records)));
}

function record({ root, values, now, env }) {
  const type = values.type ?? 'decision';
  if (!['decision', 'notice'].includes(type)) throw new DecisionsUsageError(`--type "${type}" is not decision or notice`);
  const taxonomy = readTaxonomy(root);
  const category = text(values.category, 'category');
  const subcategory = text(values.subcategory, 'subcategory');
  if (!hasPair(taxonomy, category, subcategory)) {
    throw new JournalError(`"${category} / ${subcategory}" is not in ${TAXONOMY}; pick a listed pair (yaw decisions taxonomy) or add one deliberately: yaw decisions taxonomy add "${category} / ${subcategory}" --keywords "..."`);
  }
  const importance = values.importance ?? 'normal';
  if (!IMPORTANCE.includes(importance)) throw new DecisionsUsageError(`--importance must be one of ${IMPORTANCE.join(', ')}`);
  const status = values.status ?? 'accepted';
  if (!['accepted', 'proposed', 'provisional'].includes(status)) throw new DecisionsUsageError('--status must be accepted, proposed or provisional (superseding is --supersedes)');
  const kind = values.kind;
  if (type === 'notice' && !KINDS.includes(kind)) throw new DecisionsUsageError(`a notice needs --kind ${KINDS.join('|')}`);
  if (type === 'decision' && kind !== undefined) throw new DecisionsUsageError('--kind is for notices (--type notice)');
  const reviewBy = values['review-by'] ?? null;
  if (reviewBy !== null && !/^\d{4}-\d{2}-\d{2}$/.test(reviewBy)) throw new DecisionsUsageError('--review-by must be YYYY-MM-DD');
  const fields = {
    title: text(values.summary, 'summary'),
    context: text(values.context, 'context', { multiline: true }),
    body: type === 'decision' ? text(values.decision, 'decision', { multiline: true }) : text(values.consideration, 'consideration', { multiline: true }),
    consequences: type === 'decision' ? text(values.consequences, 'consequences', { multiline: true }) : '',
  };
  if (type === 'decision' && values.consideration !== undefined) throw new DecisionsUsageError('--consideration is for notices; a decision has --decision and --consequences');
  if (type === 'notice' && (values.decision !== undefined || values.consequences !== undefined)) throw new DecisionsUsageError('a notice has --consideration, not --decision / --consequences');

  const records = loadClean(root);
  let index = null;
  try {
    index = readIndex(root);
  } catch { /* a broken index is rebuilt below; IDs then come from the records */ }
  const supersedes = [...new Set(values.supersedes ?? [])];
  for (const s of supersedes) {
    if (!ID.test(s) || !records.some((r) => r.id === s)) throw new DecisionsUsageError(`--supersedes ${s}: no such record`);
  }
  const id = nextId(type, { records, index, issue: teamIssue(root, values, env) });
  const draft = {
    id, type, kind, date: localDate(now), category, subcategory, status, importance, supersedes,
    scope: (values.scope ?? []).map(parseScope), reviewBy, tags: (values.tag ?? []).map(oneLine).filter(Boolean),
    refs: (values.ref ?? []).map(parseRef), ...fields,
  };
  const file = `${id}.md`;
  const markdown = renderRecord(draft);
  const next = [...records, parseRecord(markdown, file)]; // the new record must read back
  const rewritten = new Map();
  for (const s of supersedes) {
    const old = `${s}.md`;
    const updated = markSuperseded(readText(root, `${DIR}/${old}`), id);
    rewritten.set(old, updated);
    next[next.findIndex((r) => r.id === s)] = parseRecord(updated, old);
  }
  writeText(root, `${DIR}/${file}`, markdown);
  for (const [old, updated] of rewritten) writeText(root, `${DIR}/${old}`, updated);
  writeIndex(root, next);
  return { id, superseded: supersedes };
}

function recallHits(root, { text: query, paths, type = 'all', pair = null, allCritical = false }) {
  const index = readIndex(root);
  const taxonomy = readTaxonomy(root);
  return retrieve({ text: query, entries: index.entries, taxonomy, paths: projectPaths(root, paths), model: index.model, type, pair, allCritical });
}

// The text the agent reads at task start (blueprint E4 stage 4 / K3). Short records are shown verbatim;
// detail docs are only named.
export function recallText(root, { text: query, paths = [] }) {
  const { hits } = recallHits(root, { text: query, paths, allCritical: true });
  if (hits.length === 0) return 'Decision retrieval (YAW): no matching decision or notice was found; say so in your work summary.\n';
  const shown = hits.slice(0, MAX_SHOWN);
  const blocks = [];
  for (const h of shown) {
    const body = readText(root, `${DIR}/${h.entry.id}.md`);
    if (body !== null) blocks.push(body.trim());
  }
  const out = [
    `Decision retrieval (YAW): apply the matching decisions, weigh the notices, and cite ${shown.map((h) => h.entry.id).join(', ')} in your work summary. Detail docs listed under References are not shown; open them when needed.`,
    '',
    blocks.join('\n\n---\n\n'),
  ];
  if (hits.length > shown.length) out.push('', `Also matching (lower ranked; yaw decisions query shows them): ${hits.slice(MAX_SHOWN).map((h) => h.entry.id).join(', ')}`);
  return `${out.join('\n')}\n`;
}

function seed({ root, now }) {
  const records = loadClean(root);
  const done = records.find((r) => r.tags.includes('proposal'));
  if (done) return { already: done.id };
  const proposal = readAnswers(root).proposal;
  if (!proposal) throw new JournalError('.yaw/answers.yaml has no proposal to record');
  const taxonomy = readTaxonomy(root);
  if (!hasPair(taxonomy, 'Architecture', 'Stack')) throw new JournalError(`${TAXONOMY} has no "Architecture / Stack"; add it: yaw decisions taxonomy add "Architecture / Stack" --keywords "stack, profile"`);
  const rejected = (proposal.rejected ?? []).map((r) => `- Rejected: ${oneLine(r.option)}: ${oneLine(r.reason)}`);
  const facts = [['Shape', proposal.shape], ['Data', proposal.data], ['Hosting', proposal.hosting]].filter(([, v]) => v).map(([k, v]) => `${k}: ${oneLine(v)}.`);
  const review = new Date(now.getTime() + 90 * 24 * 3600 * 1000);
  const draft = {
    id: nextId('decision', { records, index: null }),
    type: 'decision',
    date: localDate(now),
    category: 'Architecture',
    subcategory: 'Stack',
    status: 'provisional',
    importance: 'high',
    supersedes: [],
    scope: [],
    reviewBy: localDate(review),
    tags: ['proposal'],
    refs: [],
    title: `Build with ${proposal.profiles.join(' + ')}: ${oneLine(proposal.summary)}`,
    context: [`Proposed at setup (\`.yaw/answers.yaml#proposal\`) and confirmed by the user.${facts.length ? ` ${facts.join(' ')}` : ''}`, ...rejected].join('\n'),
    body: `Use the ${proposal.profiles.join(', ')} profile${proposal.profiles.length > 1 ? 's' : ''}: ${oneLine(proposal.summary)}`,
    consequences: 'Provisional: set the status to Accepted once the stack has proven itself, or record a replacement with --supersedes before the review date.',
  };
  const file = `${draft.id}.md`;
  const markdown = renderRecord(draft);
  const next = [...records, parseRecord(markdown, file)];
  writeText(root, `${DIR}/${file}`, markdown);
  writeIndex(root, next);
  return { id: draft.id };
}

function taxonomyVerb({ root, args, values, stdout }) {
  const taxonomy = readTaxonomy(root);
  if (args.length === 0) {
    for (const c of taxonomy.categories) for (const s of c.subcategories) stdout.write(`${c.name} / ${s.name}: ${s.keywords.join(', ')}\n`);
    return 0;
  }
  if (args[0] !== 'add' || args.length !== 2) throw new DecisionsUsageError('taxonomy add "<Category> / <Subcategory>" [--keywords "a, b"]');
  const parts = args[1].split('/').map(oneLine);
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new DecisionsUsageError(`"${args[1]}" must be "Category / Subcategory"`);
  const keywords = String(values.keywords ?? '').split(',').map((k) => oneLine(k).toLowerCase()).filter(Boolean);
  let category = taxonomy.categories.find((c) => c.name === parts[0]);
  if (!category) {
    category = { name: parts[0], subcategories: [] };
    taxonomy.categories.push(category);
  }
  let sub = category.subcategories.find((s) => s.name === parts[1]);
  const created = !sub;
  if (!sub) {
    sub = { name: parts[1], keywords: [] };
    category.subcategories.push(sub);
  }
  sub.keywords = [...new Set([...sub.keywords, ...keywords])];
  if (sub.keywords.length === 0) throw new DecisionsUsageError('a new subcategory needs --keywords (words people put in task descriptions)');
  validateTaxonomy(taxonomy);
  writeText(root, TAXONOMY, `${JSON.stringify(taxonomy, null, 2)}\n`);
  stdout.write(`${created ? 'added' : 'updated'} ${parts[0]} / ${parts[1]}: ${sub.keywords.join(', ')}\n`);
  return 0;
}

// io: { root, stdout, stderr, env, now }
export async function runDecisions({ verb, args = [], values = {}, io }) {
  const { root, stdout, stderr } = io;
  const now = io.now ?? new Date();
  if (!VERBS.includes(verb)) throw new DecisionsUsageError(verb ? `unknown verb "${verb}"` : 'missing verb');
  const noArgs = () => {
    if (args.length > 0) throw new DecisionsUsageError(`unexpected argument "${args[0]}"`);
  };
  switch (verb) {
    case 'record': {
      noArgs();
      const { id, superseded } = record({ root, values, now, env: io.env });
      stdout.write(`${id}\n`);
      if (superseded.length > 0) stderr.write(`marked superseded by ${id}: ${superseded.join(', ')}\n`);
      return 0;
    }
    case 'recall': {
      const query = args.join(' ').trim();
      if (!query) throw new DecisionsUsageError('recall needs the task text');
      stdout.write(recallText(root, { text: query, paths: values.path }));
      return 0;
    }
    case 'query': {
      noArgs();
      const query = text(values.text, 'text');
      const type = values.type ?? 'all';
      if (!['decision', 'notice', 'all'].includes(type)) throw new DecisionsUsageError('--type must be decision, notice or all');
      if ((values.category === undefined) !== (values.subcategory === undefined)) throw new DecisionsUsageError('give --category and --subcategory together');
      const pair = values.category ? { category: values.category, subcategory: values.subcategory } : null;
      const { hits } = recallHits(root, { text: query, paths: values.path, type, pair });
      stdout.write(`${JSON.stringify(hits.map((h) => ({ id: h.entry.id, file: `${DIR}/${h.entry.id}.md`, similarity: h.similarity, score: h.score, reason: h.reason })), null, 2)}\n`);
      return 0;
    }
    case 'rebuild': {
      noArgs();
      const records = loadClean(root);
      writeIndex(root, records);
      stdout.write(`${INDEX}: ${records.length} record${records.length === 1 ? '' : 's'}\n`);
      return 0;
    }
    case 'check': {
      noArgs();
      const { errors, warnings, count } = checkJournal(root, { today: localDate(now) });
      for (const w of warnings) stdout.write(`warning: ${w}\n`);
      for (const e of errors) stdout.write(`error: ${e}\n`);
      stdout.write(errors.length === 0 ? `decisions check: ${count} records, IDs unique, index up to date\n` : `decisions check: ${errors.length} error${errors.length === 1 ? '' : 's'}\n`);
      return errors.length === 0 ? 0 : 1;
    }
    case 'list': {
      noArgs();
      for (const r of loadClean(root)) stdout.write(`${r.id.padEnd(11)} ${r.status.padEnd(11)} ${r.importance.padEnd(8)} ${r.category} / ${r.subcategory}: ${r.title}\n`);
      return 0;
    }
    case 'taxonomy':
      return taxonomyVerb({ root, args, values, stdout });
    case 'seed': {
      noArgs();
      const r = seed({ root, now });
      stdout.write(r.already ? `already recorded: ${r.already}\n` : `${r.id}\n`);
      return 0;
    }
    default:
      return 1;
  }
}
