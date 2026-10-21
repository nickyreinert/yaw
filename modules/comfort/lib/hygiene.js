// Session hygiene (doc 11 §1, ADR-0030): on every prompt keep a small per-session state, compute drift, size,
// age and task switch, and when a threshold is crossed return one short message for the USER (systemMessage;
// BUILD.md rule 5): never a block, never model-visible. Local only: no network, no model. The prompt text is
// embedded in memory and dropped; only the 384-number topic vector is kept.

import { lstatSync } from 'node:fs';
import { isAbsolute, normalize } from 'node:path';
import { cosine, embed, roundVector } from '../../../core/lib/retrieval.js';
import { realRoot, snapshot } from '../../sessions/lib/registry.js';
import { readPersonal, resolveFeatures, settings } from './config.js';
import { hygieneMuted, pruneSessions, readSession, writeSession } from './state.js';

const MIN_PROMPTS_FOR_DRIFT = 3;
const MIN_PROMPTS_FOR_SIZE = 5;
const TOPIC_KEEP = 0.8; // weight of the old topic vector when a prompt is folded in
const TASK_ID = /\bT-\d{1,6}\b/g;

// Size in bytes of the transcript file the agent named. The path comes from the agent's payload, so it is
// checked like any outside path: absolute, normalised, a .jsonl file inside the user's home, no link. Only the
// size is read, never the content. null when anything is off.
export function transcriptBytes(transcript, env) {
  try {
    const home = typeof env?.HOME === 'string' && isAbsolute(env.HOME) ? env.HOME.replace(/\/+$/, '') : null;
    if (home === null || typeof transcript !== 'string' || transcript.length > 1024 || /[\u0000-\u001f\u007f]/.test(transcript)) return null;
    if (!isAbsolute(transcript) || normalize(transcript) !== transcript || !transcript.startsWith(`${home}/`) || !transcript.endsWith('.jsonl')) return null;
    const st = lstatSync(transcript);
    return st.isFile() && !st.isSymbolicLink() ? st.size : null;
  } catch {
    return null;
  }
}

// A session file somebody edited (or an older version wrote) is only used when every field has the right type;
// otherwise the session starts over.
export function usable(state) {
  const numbers = (a, max) => Array.isArray(a) && a.length <= max && a.every((x) => typeof x === 'number' && Number.isFinite(x));
  return state !== null && typeof state === 'object'
    && Number.isInteger(state.prompts) && state.prompts >= 0
    && typeof state.started === 'string' && !Number.isNaN(Date.parse(state.started))
    && numbers(state.topic, 384) && numbers(state.drifts, 2)
    && Array.isArray(state.refs) && state.refs.length <= 10 && state.refs.every((r) => typeof r === 'string' && r.length < 20)
    && (state.branch === null || typeof state.branch === 'string')
    && (state.lastHint === null || Number.isInteger(state.lastHint))
    && state.notified !== null && typeof state.notified === 'object' && !Array.isArray(state.notified);
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

export function foldTopic(topic, vector) {
  if (vector.length === 0) return topic;
  if (topic.length !== vector.length) return roundVector(vector);
  const mixed = topic.map((t, i) => TOPIC_KEEP * t + (1 - TOPIC_KEEP) * vector[i]);
  const norm = Math.sqrt(mixed.reduce((s, v) => s + v * v, 0)) || 1;
  return roundVector(mixed.map((v) => v / norm));
}

function duration(minutes) {
  if (minutes < 90) return `${Math.max(1, Math.round(minutes))} min`;
  return `${Math.round(minutes / 6) / 10} h`;
}

// What to do next, depending on what is installed (the sessions module owns /handoff, M8).
const nextStep = (manifest) => (manifest?.modules?.sessions?.enabled ? 'Suggest: /handoff, then /clear.' : 'Suggest: /clear and start fresh.');

// -> { systemMessage } | null. Updates ~/.yaw/state/comfort/sessions/<agent>-<id>.json. Never throws to the caller
// for state problems (no state = no hint); the dispatcher catches anything else.
export function onPrompt({ event, root, env, manifest, prompt, transcript, now = new Date(event.ts) }) {
  const personal = readPersonal(env).config;
  const { features } = resolveFeatures({ root, personal });
  const hygieneOn = features.includes('hygiene');
  // Notifications need the turn start, hygiene needs everything; with neither there is no reason to keep state.
  if (!hygieneOn && !features.includes('notifications')) return null;

  const project = realRoot(root);
  const cfg = settings(personal).hygiene;
  const read = readSession(env, event.agent, event.sessionId);
  const prior = usable(read) ? read : null;
  const state = prior ?? { v: 1, project, started: now.toISOString(), prompts: 0, topic: [], drifts: [], lastHint: null, branch: null, refs: [], notified: {} };
  if (prior === null) pruneSessions(env, now.getTime());
  state.prompts += 1;
  state.turnStart = now.toISOString();

  const snap = snapshot(project, env);
  if (prior === null) {
    state.branch = snap.branch;
    state.refs = snap.refs;
  }

  let message = null;
  if (hygieneOn && !hygieneMuted(env, project)) {
    const vector = typeof prompt === 'string' ? embed(prompt) : [];
    let drift = null;
    if (vector.length > 0 && state.topic.length === vector.length) {
      state.drifts = [...state.drifts.slice(-1), clamp01(1 - cosine(vector, state.topic))];
      if (state.prompts >= MIN_PROMPTS_FOR_DRIFT) drift = mean(state.drifts);
    }
    state.topic = vector.length === 0 ? state.topic : state.topic.length === 0 ? roundVector(vector) : foldTopic(state.topic, vector);

    const minutes = (now.getTime() - Date.parse(state.started)) / 60000;
    const bytes = transcriptBytes(transcript, env);
    const kbPerPrompt = bytes === null ? null : bytes / 1024 / state.prompts;
    const mentioned = typeof prompt === 'string' ? [...new Set(prompt.match(TASK_ID) ?? [])] : [];
    const switched = (state.refs.length > 0 && mentioned.some((t) => !state.refs.includes(t))) || (state.branch !== null && snap.branch !== null && snap.branch !== state.branch);

    const reasons = [];
    if (switched) reasons.push('a different task or branch');
    if (drift !== null && drift >= cfg.drift) reasons.push(`new topic, drift ${drift.toFixed(2)}`);
    if (state.prompts >= cfg.maxPrompts) reasons.push('many prompts');
    if (minutes >= cfg.maxAgeMinutes) reasons.push('a long session');
    if (kbPerPrompt !== null && state.prompts >= MIN_PROMPTS_FOR_SIZE && kbPerPrompt >= cfg.maxKbPerPrompt) reasons.push(`${Math.round(kbPerPrompt)} KB per prompt`);

    // A switch is reported once: the new branch and task become the session's own.
    if (snap.branch !== null) state.branch = snap.branch;
    state.refs = [...new Set([...state.refs, ...mentioned])].slice(-10);

    const cooled = state.lastHint === null || state.prompts - state.lastHint >= cfg.cooldownPrompts;
    if (reasons.length > 0 && cooled) {
      state.lastHint = state.prompts;
      message = `YAW hygiene: ${reasons.join(', ')} (${state.prompts} prompts, ${duration(minutes)}). ${nextStep(manifest)} Silence: yaw hygiene off`;
    }
  }
  writeSession(env, event.agent, event.sessionId, state);
  return message === null ? null : { systemMessage: message };
}
