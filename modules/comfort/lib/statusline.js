// Status line (doc 11 §1a, ADR-0030): one line for Claude Code's status line from its JSON on stdin. Rendered by
// the agent's UI, never sent to the model (BUILD.md rule 5 exempts it). Shows the active task, context size,
// prompt-cache state, a hygiene badge and the last `just check` result.
//
// The payload comes from the agent, so nothing in it is trusted: every field is type-checked and unknown
// fields are ignored. The prompt_cache / context_window shapes below are read defensively because they are not
// fixed by a recorded live payload yet (issue #94); a segment whose data is missing or unreadable is left out.

import { isAbsolute } from 'node:path';
import { activeTasks, clean, realRoot } from '../../sessions/lib/registry.js';
import { readCheck, readSession } from './state.js';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

function ago(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'now';
  if (m < 90) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

function context(payload) {
  const w = payload.context_window;
  if (!w || typeof w !== 'object') return null;
  const pct = num(w.used_percentage);
  if (pct !== null) return `ctx ${Math.round(pct)}%`;
  const used = num(w.total_input_tokens) ?? num(w.used_tokens);
  const size = num(w.context_window_size);
  if (used !== null && size) return `ctx ${Math.round((used / size) * 100)}%`;
  return used !== null ? `ctx ${Math.round(used / 1000)}k` : null;
}

function cache(payload) {
  const c = payload.prompt_cache;
  if (!c || typeof c !== 'object') return null;
  const state = c.state === 'warm' || c.warm === true ? 'warm' : c.state === 'cold' || c.warm === false ? 'cold' : null;
  if (state === null) return null;
  const left = num(c.seconds_remaining) ?? num(c.expires_in_seconds);
  return state === 'warm' && left !== null ? `cache warm ${Math.max(1, Math.round(left / 60))}m` : `cache ${state}`;
}

// -> the line ('' when there is nothing to show). now: Date.
export function statusLine(payload, { env, now = new Date() }) {
  if (!payload || typeof payload !== 'object') return '';
  const cwd = [payload.workspace?.current_dir, payload.cwd].find((p) => typeof p === 'string' && isAbsolute(p) && !/[\u0000-\u001f\u007f]/.test(p));
  const root = cwd ? realRoot(cwd) : null;
  const parts = [];
  const task = root ? activeTasks(root)[0] : null;
  if (task) parts.push(clean(task.ref));
  parts.push(context(payload), cache(payload));
  const id = typeof payload.session_id === 'string' ? payload.session_id : null;
  if (id && readSession(env, 'claude', id)?.lastHint != null) parts.push('hygiene: /clear?');
  const check = root ? readCheck(env, root) : null;
  if (check) parts.push(`check ${check.status === 'pass' ? 'ok' : 'FAILED'} ${ago(now.getTime() - Date.parse(check.at))}`);
  return parts.filter(Boolean).map(clean).join(' | ');
}
