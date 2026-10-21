// SessionStart (kind: context): re-inject the active task, a few lines, once per session start
// (doc 11; the only model-visible hook output, BUILD.md rule 5). Reads TASKS.md only: offline, fast.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTasks } from '../../../core/lib/tasks.js';

const MAX_TASKS = 3;
const MAX_RESUME = 200;

export default function sessionStartTask(event, { root }) {
  const file = join(root, 'TASKS.md');
  if (!existsSync(file)) return null;
  let ledger;
  try {
    ledger = parseTasks(readFileSync(file, 'utf8'));
  } catch {
    return null; // a hand-edited file that does not parse: stay quiet, `just task list` reports it
  }
  if (ledger.active.length === 0) return null;
  const lines = ['Active task(s) from TASKS.md; continue from the resume point unless told otherwise:'];
  for (const t of ledger.active.slice(0, MAX_TASKS)) {
    const progress = t.progress !== undefined ? ` (${t.progress} %)` : '';
    lines.push(`${t.id} ${t.title} — ${t.status}${progress}`);
    if (t.resume) lines.push(`  Resume point: ${t.resume.length > MAX_RESUME ? `${t.resume.slice(0, MAX_RESUME - 1)}…` : t.resume}`);
  }
  if (ledger.active.length > MAX_TASKS) lines.push(`(+${ledger.active.length - MAX_TASKS} more in TASKS.md)`);
  return { context: lines.join('\n') };
}
