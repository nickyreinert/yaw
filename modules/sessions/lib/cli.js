// `yaw sessions <verb>` (Y-5.7, ADR-0029; doc 12 §4): find, for, resume, list, current, handoff.
// `just sessions ...` calls it. Reads and writes the registry (lib/registry.js); `resume` prints the command
// and never runs it.

import { checkRelPath } from '../../../core/render/files.js';
import { THRESHOLD, cosine, embed } from '../../../core/lib/retrieval.js';
import { AGENTS, SESSION_ID, clean, currentSession, realRoot, recordSession, resumeCommand, withRegistry } from './registry.js';

export const VERBS = ['find', 'for', 'resume', 'list', 'current', 'handoff'];
export const USAGE = [
  'usage: yaw sessions find "<words>" [--all]          sessions of this project whose title, branch or links match',
  '       yaw sessions for <T-012|#34|ADR-0004|hash|file> [--all]   sessions linked to a task, decision, commit or file',
  '       yaw sessions resume <id>                    print the command that resumes a session (it is not run)',
  '       yaw sessions list [--all]                   the latest sessions',
  '       yaw sessions current                        the session id `just commit` puts into the Agent-Session trailer',
  '       yaw sessions handoff [--title "T-012 title"] [--agent claude|codex|copilot] [--session <id>]',
  '                                                   record this session in the registry (the /handoff skill calls it)',
  '--all searches every project, not only this one. YAW_SESSION=<id> overrides the current session.',
].join('\n');

export class SessionsUsageError extends Error {}

const SHOWN = 10;
const SCAN = 500;

function line(s) {
  return `${s.id}  ${String(s.started).slice(0, 10)}  ${clean(s.title) || '(untitled)'}${s.branch ? `  [${clean(s.branch)}]` : ''}`;
}

function candidates(db, { root, all }) {
  const rows = all
    ? db.prepare('SELECT * FROM sessions ORDER BY started DESC LIMIT ?').all(SCAN)
    : db.prepare('SELECT * FROM sessions WHERE project = ? ORDER BY started DESC LIMIT ?').all(realRoot(root), SCAN);
  const links = db.prepare('SELECT kind, ref FROM session_links WHERE session_id = ?');
  return rows.map((s) => ({ ...s, links: links.all(s.id) }));
}

function find(db, ctx, args) {
  const query = args.join(' ').trim();
  if (query === '') throw new SessionsUsageError('missing search words');
  const q = embed(query);
  const exact = query.toLowerCase();
  const hits = candidates(db, ctx)
    .map((s) => {
      const direct = s.id.toLowerCase().includes(exact) || s.links.some((l) => l.ref.toLowerCase() === exact);
      const text = [s.title, s.branch, ...s.links.filter((l) => l.kind !== 'file' && l.kind !== 'commit').map((l) => l.ref)].filter(Boolean).join(' ');
      return { s, score: direct ? 1 : cosine(q, embed(text)) };
    })
    .filter((h) => h.score >= THRESHOLD)
    .sort((a, b) => b.score - a.score || String(b.s.started).localeCompare(String(a.s.started)))
    .slice(0, SHOWN);
  return hits.map((h) => line(h.s));
}

// What kind of reference is this? -> { kind, ref }
function parseRef(raw) {
  const t = String(raw ?? '').trim();
  if (/^t-\d{1,6}$/i.test(t)) return { kind: 'task', ref: t.toUpperCase() };
  if (/^#?\d{1,9}$/.test(t) && Number(t.replace('#', '')) > 0) return { kind: 'task', ref: `#${Number(t.replace('#', ''))}` };
  if (/^(adr|notice)-\d+(-\d+)?$/i.test(t)) return { kind: 'decision', ref: t.toUpperCase() };
  if (/^[0-9a-f]{7,64}$/i.test(t)) return { kind: 'commit', ref: t.toLowerCase() };
  try {
    return { kind: 'file', ref: checkRelPath(t.replace(/^\.\//, '')) };
  } catch {
    throw new SessionsUsageError(`"${t}" is not a task, decision, commit or project-relative file`);
  }
}

function forRef(db, ctx, args) {
  if (args.length !== 1) throw new SessionsUsageError('usage: yaw sessions for <T-012|#34|ADR-0004|hash|file>');
  const { kind, ref } = parseRef(args[0]);
  const same = (l) => l.kind === kind && (kind === 'commit' ? l.ref.startsWith(ref) || ref.startsWith(l.ref) : l.ref === ref);
  return candidates(db, ctx).filter((s) => s.links.some(same)).slice(0, SHOWN * 2).map(line);
}

const quote = (s) => `'${s.replace(/'/g, "'\\''")}'`;

function resume(db, args) {
  const q = String(args[0] ?? '').trim();
  if (args.length !== 1 || q.length < 4) throw new SessionsUsageError('usage: yaw sessions resume <id> (at least 4 characters of the id)');
  const rows = db.prepare('SELECT * FROM sessions ORDER BY started DESC LIMIT 2000').all();
  const exact = rows.filter((s) => s.id === q);
  const found = exact.length > 0 ? exact : rows.filter((s) => s.id.startsWith(q) || s.id.slice(s.id.indexOf(':') + 1).startsWith(q));
  if (found.length === 0) throw new SessionsUsageError(`no session "${clean(q)}"; try: yaw sessions find "<words>"`);
  if (found.length > 1) throw new SessionsUsageError(`"${clean(q)}" matches ${found.length} sessions; give more of the id:\n${found.slice(0, SHOWN).map(line).join('\n')}`);
  const s = found[0];
  if (!SESSION_ID.test(s.id) || !AGENTS.includes(s.agent) || /[\u0000-\u001f\u007f]/.test(s.project)) throw new SessionsUsageError('this registry row looks damaged; not printing a command for it');
  // Rebuilt from the agent and the id, never taken from the stored `resume` text (the database is not trusted).
  const command = resumeCommand(s.agent, s.id.slice(s.id.indexOf(':') + 1));
  return [line(s), `cd ${quote(s.project)} && ${command}`, ...(s.transcript ? [`transcript: ${clean(s.transcript)}`] : [])];
}

function handoff(db, ctx, values) {
  const { root, env, now } = ctx;
  let id = values.session;
  if (id !== undefined && !SESSION_ID.test(id)) throw new SessionsUsageError('--session must look like claude:<id>');
  if (values.agent !== undefined && !AGENTS.includes(values.agent)) throw new SessionsUsageError(`--agent must be one of ${AGENTS.join(', ')}`);
  id ??= currentSession({ db, root, env, now });
  if (id === null) {
    if (!values.agent) throw new SessionsUsageError('no current session in the registry (hooks did not run); pass --agent claude|codex|copilot');
    id = `${values.agent}:handoff-${now.toISOString().replace(/\D/g, '').slice(0, 14)}`;
  }
  const [agent, native] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
  if (recordSession({ db, env, root, agent, native, now, end: true, title: values.title }) === null) {
    throw new SessionsUsageError(`could not record session "${clean(id)}": the id has an unexpected form`);
  }
  return [`session ${id} recorded${values.title ? `: ${clean(values.title)}` : ''}`];
}

export function runSessions({ verb, args = [], values = {}, io }) {
  if (!VERBS.includes(verb)) throw new SessionsUsageError(verb ? `unknown verb "${verb}"` : 'missing verb');
  const ctx = { root: io.root, env: io.env ?? process.env, now: io.now ?? new Date(), all: Boolean(values.all) };
  const out = io.stdout;
  const lines = withRegistry(ctx.env, (db) => {
    switch (verb) {
      case 'find': return find(db, ctx, args);
      case 'for': return forRef(db, ctx, args);
      case 'resume': return resume(db, args);
      case 'list': return candidates(db, ctx).slice(0, SHOWN).map(line);
      case 'handoff': return handoff(db, ctx, values);
      case 'current': {
        const id = currentSession({ db, root: ctx.root, env: ctx.env, now: ctx.now });
        return id ? [id] : null;
      }
    }
    return [];
  });
  if (lines === null) {
    io.stderr.write('no current session\n');
    return 1;
  }
  out.write(lines.length > 0 ? `${lines.join('\n')}\n` : 'no matching session\n');
  return 0;
}

