// `yaw hygiene | notify | statusline` (Y-5.8, ADR-0030): the logic behind core/cli/comfort.js.
// Output is for the person at the terminal; the ntfy topic is never printed.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { realRoot } from '../../sessions/lib/registry.js';
import { readPersonal, resolveFeatures, settings } from './config.js';
import { buildPayload, line, ntfyRequest, STATUSES, terminalSequence } from './notify.js';
import { hygieneMuted, projectKey, readSwitch, writeSwitch } from './state.js';
import { statusLine } from './statusline.js';
import { activeTasks } from '../../sessions/lib/registry.js';

export class ComfortUsageError extends Error {}

export const HYGIENE_USAGE = 'usage: yaw hygiene [status | on | off] [--all]';
export const NOTIFY_USAGE = 'usage: yaw notify [status | test | send --status done|input|failed [--minutes N] [--summary "text"]]';

const say = (io, text) => io.stdout.write(`${text}\n`);

// ------------------------------------------------------------------------------------------ hygiene

export function runHygiene({ args, values, io }) {
  const [verb = 'status', ...rest] = args;
  if (rest.length > 0) throw new ComfortUsageError(`unexpected argument "${rest[0]}"`);
  const env = io.env;
  const project = realRoot(io.root);
  const personal = readPersonal(env);

  if (verb === 'on' || verb === 'off') {
    const now = readSwitch(env);
    const key = projectKey(project);
    let next;
    if (verb === 'off') next = values.all ? { ...now, all: true } : { ...now, projects: [...now.projects, key] };
    else next = values.all ? { all: false, projects: [] } : { ...now, projects: now.projects.filter((k) => k !== key) };
    if (!writeSwitch(env, next)) throw new ComfortUsageError('cannot write ~/.yaw/state/comfort (is YAW_HOME an absolute path, and not a link?)');
    say(io, verb === 'off'
      ? `hygiene hints are off for ${values.all ? 'all projects' : 'this project'}; switch back on: yaw hygiene on${values.all ? ' --all' : ''}`
      : `hygiene hints are on for ${values.all ? 'all projects' : 'this project'}`);
    return 0;
  }
  if (verb !== 'status') throw new ComfortUsageError(`unknown verb "${verb}"`);

  const { features, source, team } = resolveFeatures({ root: io.root, personal: personal.config });
  const cfg = settings(personal.config).hygiene;
  const muted = hygieneMuted(env, project);
  const state = !features.includes('hygiene') ? 'off (not selected; see user.comfort or features in ~/.yaw/comfort.yaml)' : muted ? 'off (yaw hygiene off)' : 'on';
  say(io, `hygiene: ${state}`);
  say(io, `features: ${features.join(', ') || 'none'} (from ${source}${team && source !== 'personal' ? '; a team project ignores project answers' : ''})`);
  say(io, `thresholds: drift ${cfg.drift}, ${cfg.maxPrompts} prompts, ${cfg.maxAgeMinutes} min, ${cfg.maxKbPerPrompt} KB per prompt; at most one hint per ${cfg.cooldownPrompts} prompts`);
  say(io, `personal file: ${join('~', '.yaw', 'comfort.yaml')} ${personal.error ? `(unusable: ${personal.error})` : Object.keys(personal.config).length > 0 ? '(read)' : '(none; defaults)'}`);
  return 0;
}

// ------------------------------------------------------------------------------------------ notify

async function post(request) {
  try {
    const res = await fetch(request.url, { method: 'POST', headers: request.headers, body: request.body, signal: AbortSignal.timeout(8000), redirect: 'error' });
    return res.ok ? null : `ntfy answered ${res.status}`;
  } catch (e) {
    return `ntfy not reachable (${e?.name ?? 'error'})`;
  }
}

export async function runNotify({ args, values, io }) {
  const [verb = 'status', ...rest] = args;
  if (rest.length > 0) throw new ComfortUsageError(`unexpected argument "${rest[0]}"`);
  const personal = readPersonal(io.env);
  const cfg = settings(personal.config).notify;
  const ntfy = personal.config.notify?.ntfy;
  const configured = ntfy ? ntfyRequest(buildPayload({ project: 'x', status: 'done' }), ntfy) !== null : false;

  if (verb === 'status') {
    const { features } = resolveFeatures({ root: io.root, personal: personal.config });
    say(io, `notifications: ${features.includes('notifications') ? 'on' : 'off'}; only after runs of at least ${cfg.minutes} min`);
    say(io, `terminal: ${cfg.terminal}`);
    say(io, `ntfy: ${configured ? `configured (${new URL(ntfy.server ?? 'https://ntfy.sh').host})` : ntfy ? 'configured but invalid (topic or server)' : 'not configured'}`);
    if (personal.error) say(io, `personal file unusable: ${personal.error}`);
    return 0;
  }
  if (verb !== 'test' && verb !== 'send') throw new ComfortUsageError(`unknown verb "${verb}"`);

  const status = verb === 'test' ? 'done' : values.status;
  if (!STATUSES.includes(status)) throw new ComfortUsageError('--status must be done, input or failed');
  const minutes = values.minutes === undefined ? 0 : Number(values.minutes);
  if (!Number.isFinite(minutes) || minutes < 0) throw new ComfortUsageError('--minutes must be a number >= 0');
  const project = realRoot(io.root);
  const task = activeTasks(project)[0];
  const payload = buildPayload({ project, task: task?.ref ?? null, status, minutes, summary: verb === 'test' ? 'test notification' : values.summary ?? task?.title ?? null });

  say(io, `notification: ${line(payload)}`);
  if (cfg.terminal !== 'off' && io.stdout.isTTY) io.stdout.write(terminalSequence(cfg.terminal, payload));
  if (configured) {
    const problem = await post(ntfyRequest(payload, ntfy));
    say(io, problem ? `ntfy: failed, ${problem}` : 'ntfy: sent');
    return problem ? 1 : 0;
  }
  return 0;
}

// ------------------------------------------------------------------------------------------ statusline

// The settings.local.json snippet for a team repository (ADR-0013: the committed file never carries it).
export const STATUSLINE_COMMAND = 'r="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"; k="${YAW_KIT:-$HOME/.yaw/kit}"; [ ! -f "$r/.yaw/lib/bin/yaw" ] || k="$r/.yaw/lib"; [ ! -f "$k/bin/yaw" ] || node --no-warnings "$k/bin/yaw" statusline 2>/dev/null; exit 0';

export function runStatusline({ text, snippet, io, now = new Date() }) {
  if (snippet) {
    say(io, JSON.stringify({ statusLine: { type: 'command', command: STATUSLINE_COMMAND } }, null, 2));
    say(io, `put this in .claude/settings.local.json (this project) or ${join(homedir(), '.claude', 'settings.json')} (every project)`);
    return 0;
  }
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch { /* not JSON: print nothing */ }
  const out = statusLine(payload, { env: io.env, now });
  if (out !== '') io.stdout.write(`${out}\n`);
  return 0;
}
