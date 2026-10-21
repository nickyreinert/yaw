// Stop (kind: comfort): remind the user, not the model, when an active task has no journal line for today.
// A blocking Stop reason would be model-visible (BUILD.md rule 5), so this only returns a systemMessage.
// Once per session and task, so a long session is not nagged every turn. Local and both mode only: in GitHub
// mode TASKS.md is a read-only view and journal lines are issue comments (ADR-0010).

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTasks } from '../../../core/lib/tasks.js';
import { yawHome } from '../../../core/hooks/dispatch.js';
import { localDate } from '../lib/ledger.js';

const KEEP_SESSIONS = 50;

function remembered(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

export default function stopResumePoint(event, { root, env, manifest, now = new Date() }) {
  if (manifest.modules.tasks?.mode === 'github') return null;
  const file = join(root, 'TASKS.md');
  if (!existsSync(file)) return null;
  const today = localDate(now);
  const stale = parseTasks(readFileSync(file, 'utf8')).active.filter((t) => !(t.journal ?? []).some((j) => j.date === today));
  if (stale.length === 0) return null;

  const state = join(yawHome(env), 'state', 'tasks-stop.json');
  const seen = remembered(state);
  const key = event.sessionId ?? 'unknown';
  const told = new Set(seen[key] ?? []);
  const fresh = stale.filter((t) => !told.has(t.id));
  if (fresh.length === 0) return null;
  try {
    mkdirSync(join(yawHome(env), 'state'), { recursive: true });
    const next = { ...seen };
    delete next[key];
    next[key] = [...told, ...fresh.map((t) => t.id)]; // newest last
    const keep = Object.fromEntries(Object.entries(next).slice(-KEEP_SESSIONS));
    writeFileSync(`${state}.tmp`, JSON.stringify(keep));
    renameSync(`${state}.tmp`, state);
  } catch { /* without the note the reminder may repeat; it must not fail */ }

  const ids = fresh.map((t) => t.id).join(', ');
  return { systemMessage: `YAW tasks: no journal line for today on ${ids}. Log it: just task log ${fresh[0].id} "what changed" --resume "next step"` };
}
