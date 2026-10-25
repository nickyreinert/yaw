// Detached timer of the cache-warmth reminder (lib/cache.js): `node cache-timer.js <agent> <session> <stopAt> <seconds>`.
// Wakes every few seconds, ends quietly when the session moved on (next prompt, next turn), and sends one
// "cache cools soon" notification when the time is up. Prints nothing, whatever happens.

import { readPersonal } from './config.js';
import { kTokens } from './cache.js';
import { buildPayload } from './notify.js';
import { deliverNotifications } from './settings.js';
import { NATIVE_ID, readSession } from './state.js';

const [agent, sessionId, stopAt, seconds] = process.argv.slice(2);
const wait = Number(seconds);
const valid = ['claude', 'codex', 'copilot'].includes(agent) && NATIVE_ID.test(sessionId ?? '') && !Number.isNaN(Date.parse(stopAt))
  && Number.isFinite(wait) && wait >= 10 && wait <= 3600;
if (!valid) process.exit(0);

const deadline = Date.now() + wait * 1000;
const tick = async () => {
  const state = readSession(process.env, agent, sessionId);
  if (state === null || state.stopAt !== stopAt) process.exit(0);
  if (Date.now() < deadline) return;
  clearInterval(timer);
  try {
    const payload = buildPayload({ project: state.project, status: 'cache', summary: `context ≈ ${kTokens(state.cacheTokens ?? 0)} tokens; continue, or /handoff and /clear` });
    await deliverNotifications({ payload, config: readPersonal(process.env).config.notify ?? {}, env: process.env });
  } catch { /* a reminder is best effort */ }
  process.exit(0);
};
const timer = setInterval(tick, 5000);
