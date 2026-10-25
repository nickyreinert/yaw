// Prompt-cache warmth reminder (doc 11 §3, ADR-0030): Claude's prompt cache goes cold after 5 minutes (1 hour on
// a subscription). A cold cache means the whole context is paid for again on the next prompt, so two cheap
// helpers, both without a single model token:
//   - Stop: when remote channels (ntfy / Telegram) are set up, a detached timer sends "cache cools soon" shortly
//     before the cache expires, unless the next prompt arrives first;
//   - UserPromptSubmit: when you come back after the cache expired, one line for you says what it cost.
// There is deliberately no keep-alive ping. The context size is an estimate from the transcript size (only the
// size is read, never the content); below `minTokens` nothing is sent or said.

import { join } from 'node:path';
import { readPersonal, resolveFeatures, settings } from './config.js';
import { ntfyRequest, spawnDetached } from './notify.js';
import { transcriptBytes, usable } from './hygiene.js';
import { readSession, writeSession } from './state.js';

const TIMER_JS = join(import.meta.dirname, 'cache-timer.js');
export const TTL_SECONDS = { '5m': 300, '1h': 3600 };
const BYTES_PER_TOKEN = 5; // JSONL transcripts carry metadata around the text: a little more than 4 characters per token

// The cache lifetime in seconds: the setting Claude Code itself uses wins, then the personal file, then 5 minutes.
export function cacheSeconds({ cfg, env }) {
  const named = TTL_SECONDS[env?.CLAUDE_CODE_PROMPT_CACHE_TTL] ? env.CLAUDE_CODE_PROMPT_CACHE_TTL : cfg.ttl;
  return TTL_SECONDS[named] ?? TTL_SECONDS['5m'];
}
export const warnAhead = (ttl, cfg) => (ttl >= 3600 ? 300 : cfg.warnSeconds);
export const estimateTokens = (bytes) => Math.round(bytes / BYTES_PER_TOKEN);
export const kTokens = (n) => `${Math.max(1, Math.round(n / 1000))}k`;

// Stop: remember when the turn ended and, with a remote channel, start the timer. Prints nothing.
export function onStop({ event, root, env, transcript, spawnFn }) {
  const personal = readPersonal(env).config;
  if (event.agent !== 'claude' || !resolveFeatures({ root, personal }).features.includes('cache-reminder')) return;
  const state = readSession(env, event.agent, event.sessionId);
  if (!usable(state)) return;
  const cfg = settings(personal).cache;
  const bytes = transcriptBytes(transcript, env);
  const tokens = bytes === null ? 0 : estimateTokens(bytes);
  if (tokens < cfg.minTokens) {
    delete state.stopAt;
    writeSession(env, event.agent, event.sessionId, state);
    return;
  }
  const stopAt = new Date(event.ts).toISOString();
  state.stopAt = stopAt;
  state.cacheTokens = tokens;
  writeSession(env, event.agent, event.sessionId, state);
  const remote = personal.notify?.telegram?.enabled || (personal.notify?.ntfy && ntfyRequest({ project: 'x', status: 'done' }, personal.notify.ntfy));
  if (!remote) return;
  const ttl = cacheSeconds({ cfg, env });
  spawnDetached(TIMER_JS, [event.agent, event.sessionId, stopAt, String(Math.max(10, ttl - warnAhead(ttl, cfg)))], env, spawnFn);
}

// UserPromptSubmit: the cache expired while the user was away -> one line for the user, else null.
export function cacheCooled({ state, cfg, env, now }) {
  if (typeof state.stopAt !== 'string' || !Number.isInteger(state.cacheTokens)) return null;
  const away = (now.getTime() - Date.parse(state.stopAt)) / 1000;
  if (!(away > cacheSeconds({ cfg, env })) || state.cacheTokens < cfg.minTokens) return null;
  return `YAW cache: it went cold while you were away; this prompt re-caches ≈ ${kTokens(state.cacheTokens)} tokens. Before a long break: /handoff, then /clear.`;
}
