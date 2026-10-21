// Notifications (doc 11 §2, ADR-0030): "done", "needs input" or "failed", sent to the USER only, and only when
// the run took at least N minutes (default 3). The payload is built from a closed set of fields: project folder
// name, task id, status, duration and a one-line task title. It never holds code, diffs, tool output, the
// agent's last message or secrets; free text (the task title) is cleaned and redacted on the way in.
//
// Channels in phase 1: the terminal (OSC 9 / OSC 777 via the hook's terminalSequence) and ntfy. A hook never
// waits for the network: ntfy goes out from a detached child process (lib/send.js) that prints nothing.

import { spawn } from 'node:child_process';
import { basename, join } from 'node:path';
import { realRoot, activeTasks, clean } from '../../sessions/lib/registry.js';
import { readPersonal, resolveFeatures, settings } from './config.js';
import { usable } from './hygiene.js';
import { readSession, writeSession } from './state.js';

export const STATUSES = ['done', 'input', 'failed'];
const LABEL = { done: 'done', input: 'needs your input', failed: 'failed' };
const MAX_SUMMARY = 80;
const MAX_PROJECT = 40;
const SEND_JS = join(import.meta.dirname, 'send.js');
const NTFY_TOPIC = /^[A-Za-z0-9_-]{1,64}$/;

const clip = (s, n) => ([...s].length > n ? `${[...s].slice(0, n - 1).join('')}…` : s);

// A task title or other free text, made safe for a phone screen: no control characters, no code spans, nothing
// that looks like a key or token. Anything long and unbroken is treated as a secret.
export function redact(text) {
  return clean(String(text ?? '')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\b(?:sk|pk|rk|ghp|gho|ghs|ghu|github_pat|xox[a-z]|AKIA|ASIA|glpat|npm|AIza)[-_A-Za-z0-9]{8,}/g, '[redacted]')
    .replace(/[A-Za-z0-9+/=_-]{24,}/g, '[redacted]'));
}

// -> the closed payload. `summary` is optional free text (a task title).
export function buildPayload({ project, task = null, status, minutes = 0, summary = null }) {
  if (!STATUSES.includes(status)) throw new Error(`unknown status "${status}"`);
  const folder = clip(clean(basename(String(project ?? ''))).replace(/[^\p{L}\p{N} ._-]/gu, ''), MAX_PROJECT);
  const text = summary === null || summary === undefined ? '' : clip(redact(summary), MAX_SUMMARY);
  return {
    project: folder || 'project',
    task: typeof task === 'string' && /^(T-\d{1,6}|#\d{1,9})$/.test(task) ? task : null,
    status,
    minutes: Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0,
    summary: text === '' ? null : text,
  };
}

// One line for any channel: "photo-renamer T-012: done after 5 min - Online invite flow".
export function line(payload) {
  const head = `${payload.project}${payload.task ? ` ${payload.task}` : ''}: ${LABEL[payload.status]}`;
  const after = payload.minutes > 0 ? ` after ${payload.minutes} min` : '';
  return `${head}${after}${payload.summary ? ` - ${payload.summary}` : ''}`;
}

// The terminal escape sequence for OSC 9 (iTerm2, Ghostty, WezTerm) or OSC 777 (urxvt style). Control
// characters and the OSC separator are removed so the text cannot end or extend the sequence.
export function terminalSequence(kind, payload) {
  const text = line(payload).replace(/[\u0000-\u001f\u007f-\u009f;]+/g, ' ');
  if (kind === 'osc777') return `\u001b]777;notify;YAW;${text}\u0007`;
  if (kind === 'osc9') return `\u001b]9;YAW ${text}\u0007`;
  return null;
}

// ------------------------------------------------------------------------------------------ ntfy

// The request for a payload, or null when ntfy is not (validly) configured. The topic is a secret: it only
// ever appears in the URL of this request.
export function ntfyRequest(payload, ntfy) {
  if (!ntfy || typeof ntfy.topic !== 'string' || !NTFY_TOPIC.test(ntfy.topic)) return null;
  let server;
  try {
    server = new URL(ntfy.server ?? 'https://ntfy.sh');
  } catch {
    return null;
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(server.hostname);
  if (!(server.protocol === 'https:' || (server.protocol === 'http:' && local)) || server.username || server.password || (server.pathname !== '/' && server.pathname !== '')) return null;
  return {
    url: `${server.origin}/${ntfy.topic}`,
    headers: { Title: 'YAW', Priority: payload.status === 'done' ? 'default' : 'high', 'Content-Type': 'text/plain; charset=utf-8' },
    body: line(payload),
  };
}

// Fire and forget: a detached node process posts the request and prints nothing. The payload goes in argv (it
// holds no secret); the child reads the topic from the personal file itself, so it never shows up in `ps`.
export function sendDetached(payload, env, spawnFn = spawn) {
  const home = env.YAW_HOME || env.HOME;
  if (!home) return false;
  try {
    const child = spawnFn(process.execPath, ['--no-warnings', SEND_JS, JSON.stringify(payload)], {
      detached: true,
      stdio: 'ignore',
      env: { PATH: env.PATH ?? '', HOME: env.HOME ?? '', ...(env.YAW_HOME ? { YAW_HOME: env.YAW_HOME } : {}) },
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------------------------------ hooks

// Shared by the Stop, Notification and StopFailure hooks. -> { systemMessage?, terminalSequence? } | null
export function notifyTurn({ event, root, env, status, now = new Date(event.ts), spawnFn }) {
  const personal = readPersonal(env).config;
  const { features } = resolveFeatures({ root, personal });
  if (!features.includes('notifications')) return null;
  const cfg = settings(personal).notify;

  const state = readSession(env, event.agent, event.sessionId);
  if (!usable(state) || typeof state.turnStart !== 'string' || Number.isNaN(Date.parse(state.turnStart))) return null;
  const minutes = (now.getTime() - Date.parse(state.turnStart)) / 60000;
  if (minutes < cfg.minutes) return null;
  // once per turn and kind (a Stop is followed by an idle prompt; a permission prompt can repeat)
  if (state.notified?.[status] === state.prompts) return null;
  state.notified = { ...(state.notified ?? {}), [status]: state.prompts };
  writeSession(env, event.agent, event.sessionId, state);

  const task = activeTasks(realRoot(root))[0] ?? null;
  const payload = buildPayload({ project: realRoot(root), task: task?.ref ?? null, status, minutes, summary: task?.title ?? null });
  if (personal.notify?.ntfy && ntfyRequest(payload, personal.notify.ntfy)) sendDetached(payload, env, spawnFn);

  if (cfg.terminal === 'off') return null;
  // Claude takes an escape sequence; Codex has only the user message
  return event.agent === 'claude' ? { terminalSequence: terminalSequence(cfg.terminal, payload) } : { systemMessage: `YAW: ${line(payload)}` };
}
