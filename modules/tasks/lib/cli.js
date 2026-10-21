// `yaw task <verb>` (ADR-0010): list, next, start, log, done, new, sync. `just task ...` calls it.
//
//   local, both   TASKS.md is the source; only `sync` (both) talks to GitHub.
//   github        issues are the source; TASKS.md is regenerated after every change.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTasks, renderTasks } from '../../../core/lib/tasks.js';
import { ARCHIVE, LedgerError, archiveText, doneTask, formatLedger, formatNext, issueNumber, logTask, newTask, oneLine, startTask } from './ledger.js';
import { createIssue, defaultGh, fetchView, journalComment, syncBoth } from './github.js';

export const TASKS_FILE = 'TASKS.md';
export const VERBS = ['list', 'next', 'start', 'log', 'done', 'new', 'sync'];
export const USAGE = [
  'usage: yaw task list | next | sync',
  '       yaw task start <id>',
  '       yaw task log <id> "text" [--resume "next step"] [--progress 0-100]',
  '       yaw task done <id>',
  '       yaw task new "title"',
  'ids: T-012 (local, both) or #41 (github)',
].join('\n');

export class TaskUsageError extends Error {}

const readIf = (root, rel) => (existsSync(join(root, rel)) ? readFileSync(join(root, rel), 'utf8') : null);

function readLedger(root) {
  const text = readIf(root, TASKS_FILE);
  if (text === null) throw new LedgerError(`${TASKS_FILE} is missing; run: yaw update`);
  return parseTasks(text, { file: TASKS_FILE });
}

const writeLedger = (root, ledger) => writeFileSync(join(root, TASKS_FILE), renderTasks(ledger));

// io: { root, stdout, stderr, env, gh, now }; mode: local | github | both (manifest.modules.tasks.mode).
export async function runTask({ verb, args = [], values = {}, mode = 'local', io }) {
  const { root, stdout, stderr } = io;
  const now = io.now ?? new Date();
  const gh = io.gh ?? ((a) => defaultGh(a, { cwd: root, env: io.env }));
  const need = (n, what) => {
    if (args.length < n) throw new TaskUsageError(`missing ${what}`);
  };
  if (!VERBS.includes(verb)) throw new TaskUsageError(verb ? `unknown verb "${verb}"` : 'missing verb');

  // Rewrite the generated view; a failure here must not hide that the change itself worked.
  const refresh = () => {
    try {
      writeLedger(root, fetchView(gh));
    } catch (e) {
      stderr.write(`task: could not refresh ${TASKS_FILE} (${e.message})\n`);
    }
  };

  if (mode === 'github') {
    switch (verb) {
      case 'sync': {
        const view = fetchView(gh);
        writeLedger(root, view);
        stdout.write(`${TASKS_FILE}: ${view.active.length} active, ${view.backlog.length} in the backlog\n`);
        return 0;
      }
      case 'list':
      case 'next': {
        try {
          writeLedger(root, fetchView(gh));
        } catch (e) {
          stderr.write(`task: using the last ${TASKS_FILE} (${e.message})\n`);
        }
        const ledger = readLedger(root);
        stdout.write(verb === 'list' ? formatLedger(ledger) : formatNext(ledger));
        return 0;
      }
      case 'start': {
        need(1, 'issue number');
        const n = issueNumber(args[0]);
        gh(['issue', 'edit', String(n), '--add-assignee', '@me']);
        stdout.write(`#${n} assigned to you\n`);
        refresh();
        return 0;
      }
      case 'log': {
        need(2, 'issue number and text');
        const n = issueNumber(args[0]);
        const body = journalComment(args[1], { now, resume: values.resume });
        if (oneLine(args[1]) === '') throw new LedgerError('a journal line needs text');
        gh(['issue', 'comment', String(n), '--body', body]);
        stdout.write(`#${n}: journal line posted as a comment\n`);
        refresh();
        return 0;
      }
      case 'done': {
        need(1, 'issue number');
        const n = issueNumber(args[0]);
        gh(['issue', 'comment', String(n), '--body', journalComment('ready for review', { now })]);
        stdout.write(`#${n}: marked ready for review; the pull request closes it\n`);
        refresh();
        return 0;
      }
      case 'new': {
        need(1, 'title');
        const title = oneLine(args[0]);
        if (title === '') throw new LedgerError('a task needs a title');
        const n = createIssue(gh, title);
        stdout.write(`#${n} ${title}\n`);
        refresh();
        return 0;
      }
    }
  }

  // local and both
  if (verb === 'sync') {
    if (mode !== 'both') throw new LedgerError('sync mirrors tasks to GitHub issues; this project tracks tasks locally only');
    const ledger = readLedger(root);
    const result = syncBoth({ ledger, archive: readIf(root, ledger.archive ?? ARCHIVE) ?? '', gh });
    if (result.actions.some((a) => a.kind === 'created' || a.kind === 'linked')) writeLedger(root, result.ledger);
    for (const w of result.warnings) stderr.write(`task: ${w}\n`);
    if (result.actions.length === 0) stdout.write('sync: nothing to do, issues are up to date\n');
    for (const a of result.actions) stdout.write(`sync: ${a.kind} ${a.id} -> #${a.issue}\n`);
    return 0;
  }
  const ledger = readLedger(root);
  switch (verb) {
    case 'list':
      stdout.write(formatLedger(ledger));
      return 0;
    case 'next':
      stdout.write(formatNext(ledger));
      return 0;
    case 'start': {
      need(1, 'task ID');
      const t = startTask(ledger, args[0]);
      writeLedger(root, ledger);
      stdout.write(`${t.id} ${t.title} — ${t.status}\n`);
      return 0;
    }
    case 'log': {
      need(2, 'task ID and text');
      const t = logTask(ledger, args[0], args[1], { now, resume: values.resume, progress: values.progress });
      writeLedger(root, ledger);
      stdout.write(`${t.id}: logged\n`);
      return 0;
    }
    case 'done': {
      need(1, 'task ID');
      const { task, line } = doneTask(ledger, args[0], { now });
      const file = ledger.archive;
      writeFileSync(join(root, file), archiveText(readIf(root, file), line));
      writeLedger(root, ledger);
      stdout.write(`${task.id} done, archived in ${file}\n`);
      return 0;
    }
    case 'new': {
      need(1, 'title');
      const item = newTask(ledger, args[0], readIf(root, ledger.archive ?? ARCHIVE) ?? '');
      writeLedger(root, ledger);
      stdout.write(`${item.id} ${item.title}\n`);
      return 0;
    }
  }
  return 0;
}
