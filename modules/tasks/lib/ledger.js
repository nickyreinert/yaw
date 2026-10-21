// Operations on a local task ledger (TASKS.md, local and both mode; ADR-0010). Pure functions over the
// parsed ledger of core/lib/tasks.js; the CLI reads and writes the files.

export const ARCHIVE = 'TASKS.archive.md';

export class LedgerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'LedgerError';
  }
}

// YYYY-MM-DD in local time (journal dates are the user's days).
export function localDate(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

// One line of free text for a ledger field: no line breaks, no padding.
export function oneLine(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

// "T-012", "t-12" or "12" -> "T-012"
export function localId(input) {
  const m = /^(?:T-?)?(\d+)$/i.exec(String(input ?? '').trim());
  if (!m) throw new LedgerError(`"${input}" is not a task ID (expected T-012)`);
  return `T-${m[1].padStart(3, '0')}`;
}

// "#41" or "41" -> 41
export function issueNumber(input) {
  const m = /^#?([1-9]\d*)$/.exec(String(input ?? '').trim());
  if (!m) throw new LedgerError(`"${input}" is not an issue number (expected #41)`);
  return Number(m[1]);
}

function requireLocal(ledger) {
  if (ledger.readOnly) throw new LedgerError('TASKS.md is a generated view of GitHub issues; use the issue commands');
}

// Archive lines: "- T-012 (#34) Title — done 2026-10-21"
export function parseArchive(text) {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    const m = /^- (T-\d+)(?: \(#(\d+)\))? (.+?) — done (\d{4}-\d{2}-\d{2})$/.exec(line);
    if (m) out.push({ id: m[1], ...(m[2] ? { issue: Number(m[2]) } : {}), title: m[3], date: m[4] });
  }
  return out;
}

export function archiveLine(task, date) {
  const issue = task.issue !== undefined ? ` (#${task.issue})` : '';
  return `- ${task.id}${issue} ${task.title} — done ${date}`;
}

export function nextLocalId(ledger, archiveText = '') {
  let max = 0;
  const ids = [...ledger.active, ...ledger.backlog].map((t) => t.id);
  for (const m of String(archiveText).matchAll(/\bT-(\d+)\b/g)) ids.push(`T-${m[1]}`);
  for (const id of ids) max = Math.max(max, Number(id.slice(2)) || 0);
  return `T-${String(max + 1).padStart(3, '0')}`;
}

function find(ledger, id) {
  const a = ledger.active.findIndex((t) => t.id === id);
  if (a !== -1) return { where: 'active', index: a, task: ledger.active[a] };
  const b = ledger.backlog.findIndex((t) => t.id === id);
  if (b !== -1) return { where: 'backlog', index: b, task: ledger.backlog[b] };
  throw new LedgerError(`${id} is not in TASKS.md`);
}

// Add to the end of the backlog. -> the new item
export function newTask(ledger, title, archiveText = '') {
  requireLocal(ledger);
  const clean = oneLine(title).replace(/ — /g, ' - ');
  if (clean === '') throw new LedgerError('a task needs a title');
  const item = { id: nextLocalId(ledger, archiveText), title: clean };
  ledger.backlog.push(item);
  return item;
}

// Move a backlog item to Active (or put an active one back to "in progress"). -> the active task
export function startTask(ledger, input) {
  requireLocal(ledger);
  const id = localId(input);
  const { where, index, task } = find(ledger, id);
  if (where === 'active') {
    task.status = 'in progress';
    return task;
  }
  ledger.backlog.splice(index, 1);
  const active = { id: task.id };
  if (task.issue !== undefined) active.issue = task.issue;
  active.title = task.title;
  active.status = 'in progress';
  active.progress = 0;
  if (task.note !== undefined) active.model = task.note;
  active.resume = 'Started; nothing logged yet.';
  ledger.active.push(active);
  return active;
}

// Journal line for an active task; optionally the resume point and the percentage.
export function logTask(ledger, input, text, { now = new Date(), resume, progress } = {}) {
  requireLocal(ledger);
  const id = localId(input);
  const { where, task } = find(ledger, id);
  if (where !== 'active') throw new LedgerError(`${id} is not active; run: just task start ${id}`);
  const line = oneLine(text);
  if (line === '') throw new LedgerError('a journal line needs text');
  task.journal = [...(task.journal ?? []), { date: localDate(now), text: line }];
  if (resume !== undefined) {
    const r = oneLine(resume);
    if (r === '') throw new LedgerError('the resume point is empty');
    task.resume = r;
  }
  if (progress !== undefined) {
    const n = Number(progress);
    if (!Number.isInteger(n) || n < 0 || n > 100) throw new LedgerError(`progress must be a whole number from 0 to 100, not "${progress}"`);
    task.progress = n;
  }
  return task;
}

// Take a task out of Active. -> { task, line } (the line goes to the archive file)
export function doneTask(ledger, input, { now = new Date() } = {}) {
  requireLocal(ledger);
  const id = localId(input);
  const { where, index, task } = find(ledger, id);
  if (where !== 'active') throw new LedgerError(`${id} is not active; run: just task start ${id}`);
  ledger.active.splice(index, 1);
  ledger.archive ??= ARCHIVE;
  return { task, line: archiveLine(task, localDate(now)) };
}

export function archiveText(existing, line) {
  const base = existing && existing.trim() !== '' ? existing.replace(/\n*$/, '\n') : '# Done\n\n';
  return `${base}${line}\n`;
}

// Plain-text listing for `just task list`.
export function formatLedger(ledger) {
  const out = ['Active'];
  if (ledger.active.length === 0) out.push('  (none)');
  for (const t of ledger.active) {
    const progress = t.progress !== undefined ? ` (${t.progress} %)` : '';
    out.push(`  ${t.id} ${t.title} — ${t.status}${progress}`);
    if (t.resume) out.push(`    resume: ${t.resume}`);
  }
  out.push('Backlog');
  if (ledger.backlog.length === 0) out.push('  (none)');
  for (const b of ledger.backlog) out.push(`  ${b.id} ${b.title}${b.note ? ` — ${b.note}` : ''}`);
  return `${out.join('\n')}\n`;
}

export function formatNext(ledger) {
  const b = ledger.backlog[0];
  if (!b) return 'No tasks in the backlog.\n';
  return `${b.id} ${b.title}${b.note ? ` — ${b.note}` : ''}\n`;
}
