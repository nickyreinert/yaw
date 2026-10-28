// GitHub side of the tasks module (ADR-0010). Everything goes through an injected `gh(args) -> stdout`
// so tests replay recorded output; the default runs the GitHub CLI.
//
//   both mode:   syncBoth()   TASKS.md -> issues, one way, idempotent (an unchanged task makes no write call)
//   github mode: viewFromIssues() issues -> generated read-only ledger; journal lines are issue comments

import { GhError, defaultGh } from '../../../core/lib/gh.js';
import { EFFORTS, modelEffort } from '../../../core/lib/tasks.js';
import { localDate, oneLine, parseArchive } from './ledger.js';

export { GhError, defaultGh };

const json = (text, what) => {
  try {
    return JSON.parse(text);
  } catch {
    throw new GhError(`gh returned invalid JSON for ${what}`);
  }
};

export const LIMIT = '1000';
export const BACKLOG_MAX = 30;
export const JOURNAL_MARK = '<!-- yaw:journal -->';
const taskMark = (id) => `<!-- yaw:task ${id} -->`;
const normalise = (text) => String(text ?? '').replace(/\r\n?/g, '\n').trim();

// ------------------------------------------------------------------ both mode: TASKS.md -> issues

const FIELDS = [['brief', 'Brief'], ['model', 'Model / effort'], ['spec', 'Spec'], ['acceptance', 'Acceptance'], ['resume', 'Resume point'], ['note', 'Note']];

export function issueBody(task) {
  const lines = [taskMark(task.id), ''];
  // A backlog item keeps model and effort apart (#175); the issue gets the one Model / effort line.
  const fields = task.effort !== undefined ? { ...task, model: modelEffort(task.model, task.effort) } : task;
  for (const [key, label] of FIELDS) if (fields[key] !== undefined) lines.push(`**${label}:** ${fields[key]}`, '');
  if (task.progress !== undefined) lines.push(`**Progress:** ${task.progress} %`, '');
  lines.push('_Mirrored from TASKS.md by yaw (one way). Edit the task there; changes here are overwritten._');
  return lines.join('\n');
}

// -> { ledger (issue numbers filled in), calls, actions: [{ kind, id, issue }], warnings }
export function syncBoth({ ledger, archive = '', gh }) {
  const issues = json(gh(['issue', 'list', '--state', 'all', '--limit', LIMIT, '--json', 'number,title,state,body']), 'issue list');
  const byNumber = new Map(issues.map((i) => [i.number, i]));
  const byMark = new Map();
  for (const i of issues) {
    const m = /<!-- yaw:task (T-\d+) -->/.exec(i.body ?? '');
    if (m && !byMark.has(m[1])) byMark.set(m[1], i);
  }
  const actions = [];
  const warnings = [];
  for (const task of [...ledger.active, ...ledger.backlog]) {
    let existing = task.issue !== undefined ? byNumber.get(task.issue) : byMark.get(task.id);
    if (task.issue !== undefined && !existing) {
      warnings.push(`${task.id}: issue #${task.issue} was not found; not recreated`);
      continue;
    }
    const body = issueBody(task);
    if (!existing) {
      const url = gh(['issue', 'create', '--title', task.title, '--body', body]);
      const m = /\/issues\/(\d+)\s*$/.exec(url.trim());
      if (!m) throw new GhError('gh issue create did not print the issue URL');
      task.issue = Number(m[1]);
      actions.push({ kind: 'created', id: task.id, issue: task.issue });
      continue;
    }
    if (task.issue === undefined) {
      task.issue = existing.number; // linked through the marker (TASKS.md lost the number)
      actions.push({ kind: 'linked', id: task.id, issue: task.issue });
    }
    if (existing.title !== task.title || normalise(existing.body) !== normalise(body)) {
      gh(['issue', 'edit', String(existing.number), '--title', task.title, '--body', body]);
      actions.push({ kind: 'updated', id: task.id, issue: existing.number });
    }
    if (String(existing.state).toUpperCase() === 'CLOSED') {
      gh(['issue', 'reopen', String(existing.number)]);
      actions.push({ kind: 'reopened', id: task.id, issue: existing.number });
    }
  }
  for (const done of parseArchive(archive)) {
    const existing = done.issue !== undefined ? byNumber.get(done.issue) : undefined;
    if (existing && String(existing.state).toUpperCase() === 'OPEN') {
      gh(['issue', 'close', String(existing.number)]);
      actions.push({ kind: 'closed', id: done.id, issue: existing.number });
    }
  }
  return { ledger, actions, warnings };
}

// ------------------------------------------------------------------ github mode: issues -> read-only view

const STATUS = { todo: 'todo', 'in-progress': 'in progress', blocked: 'blocked', 'in-review': 'in review' };
const labelNames = (issue) => (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));
const labelValue = (issue, prefix) => labelNames(issue).find((n) => n.startsWith(prefix))?.slice(prefix.length);

const MODEL_BODY = /^\*\*Model \/ effort:\*\* (.+)$/m;

// Model tier and effort of an issue (#175): labels model:<tier> and effort:<level>, else the body line
// "**Model / effort:** sonnet · effort: medium". -> { model?, effort? }
export function issueModel(issue) {
  const label = labelValue(issue, 'model:');
  const effort = labelValue(issue, 'effort:');
  if (label) return { model: oneLine(label), ...(EFFORTS.includes(effort) ? { effort } : {}) };
  const m = MODEL_BODY.exec(normalise(issue.body));
  if (!m) return {};
  const [, tier, level] = /^(.+?)(?: · effort: (\S+))?$/.exec(oneLine(m[1]));
  return { model: tier, ...(EFFORTS.includes(level) ? { effort: level } : {}) };
}

function firstLine(body, max = 160) {
  for (const raw of normalise(body).split('\n')) {
    if (MODEL_BODY.test(raw)) continue;
    const line = oneLine(raw.replace(/^[#>*\-\s]+/, '').replace(/<!--.*?-->/g, ''));
    if (line) return line.length > max ? `${line.slice(0, max - 1)}…` : line;
  }
  return undefined;
}

// Journal comments are written by `just task log`: marker, "<date> text", optional "Resume point: text".
export function journalFromComments(comments, owner) {
  const entries = [];
  for (const c of comments ?? []) {
    if (!owner || typeof c.author?.login !== 'string' || c.author.login.toLowerCase() !== owner.toLowerCase()) continue;
    const body = normalise(c.body);
    if (!body.startsWith(JOURNAL_MARK)) continue;
    const lines = body.slice(JOURNAL_MARK.length).split('\n').map((l) => l.trim()).filter(Boolean);
    const m = /^(\d{4}-\d{2}-\d{2}) (.+)$/.exec(lines[0] ?? '');
    if (!m) continue;
    const resume = lines.slice(1).map((l) => /^Resume point: (.+)$/.exec(l)?.[1]).find(Boolean);
    entries.push({ date: m[1], text: m[2], resume });
  }
  return entries;
}

export function viewFromIssues({ mine, open, owner }) {
  const active = mine.map((issue) => {
    const entries = journalFromComments(issue.comments, owner);
    const task = { id: `#${issue.number}`, title: oneLine(issue.title), status: STATUS[labelValue(issue, 'status:')] ?? 'in progress' };
    const brief = /^\*\*Acceptance:\*\* (.+)$/m.exec(issue.body ?? '')?.[1] ?? firstLine(issue.body);
    if (brief) task.brief = brief;
    const hint = issueModel(issue);
    if (hint.model) task.model = modelEffort(hint.model, hint.effort);
    const spec = /^\*\*Spec:\*\* (.+)$/m.exec(issue.body ?? '')?.[1];
    if (spec) task.spec = spec;
    else if (issue.milestone?.title) task.spec = `Milestone ${oneLine(issue.milestone.title)}`;
    const resume = [...entries].reverse().find((e) => e.resume)?.resume;
    if (resume) task.resume = resume;
    if (entries.length > 0) task.journal = entries.slice(-3).map((e) => ({ date: e.date, text: e.text }));
    return task;
  }).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  const mineNumbers = new Set(mine.map((i) => i.number));
  const rank = (i) => {
    const p = /^P(\d)$/.exec(labelValue(i, 'priority:') ?? '');
    return p ? Number(p[1]) : 9;
  };
  const backlog = open
    .filter((i) => !mineNumbers.has(i.number))
    .sort((a, b) => rank(a) - rank(b) || a.number - b.number)
    .slice(0, BACKLOG_MAX)
    .map((i) => {
      const item = { id: `#${i.number}`, title: oneLine(i.title) };
      const note = [labelValue(i, 'priority:'), labelValue(i, 'estimate:')].filter(Boolean).join(' · ');
      if (note) item.note = note;
      Object.assign(item, issueModel(i));
      for (const [key, label] of [['spec', 'Spec'], ['acceptance', 'Acceptance']]) {
        const value = new RegExp(`^\\*\\*${label}:\\*\\* (.+)$`, 'm').exec(i.body ?? '')?.[1];
        if (value) item[key] = value;
      }
      return item;
    });
  return { readOnly: true, active, backlog };
}

const FIELD_LIST = 'number,title,body,labels,milestone,comments';

export function fetchView(gh) {
  const repo = json(gh(['repo', 'view', '--json', 'owner']), 'repository owner');
  const owner = repo.owner?.login;
  if (typeof owner !== 'string' || !owner) throw new GhError('gh returned no repository owner; task journals cannot be verified');
  const mine = json(gh(['issue', 'list', '--assignee', '@me', '--state', 'open', '--limit', '100', '--json', FIELD_LIST]), 'my issues');
  const open = json(gh(['issue', 'list', '--state', 'open', '--limit', '200', '--json', 'number,title,labels,body']), 'open issues');
  return viewFromIssues({ mine, open, owner });
}

export function journalComment(text, { now = new Date(), resume } = {}) {
  const line = oneLine(text);
  const lines = [JOURNAL_MARK, `${localDate(now)} ${line}`];
  if (resume !== undefined && oneLine(resume) !== '') lines.push('', `Resume point: ${oneLine(resume)}`);
  return lines.join('\n');
}

// "#41 Title" from `gh issue create` output (a URL).
export function createIssue(gh, title, body = '') {
  const url = gh(['issue', 'create', '--title', title, '--body', body]);
  const m = /\/issues\/(\d+)\s*$/.exec(url.trim());
  if (!m) throw new GhError('gh issue create did not print the issue URL');
  return Number(m[1]);
}
