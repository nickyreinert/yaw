// SessionStart (kind: evaluation; ADR-0029, BUILD.md rule 5): register the session in ~/.yaw/yaw.db with its
// title from the active task. Prints and returns nothing, ever; any error is swallowed by the dispatcher.

import { recordSession, withRegistry } from '../lib/registry.js';

export default function register(event, { root, env, transcript }) {
  withRegistry(env, (db) => recordSession({ db, env, root, agent: event.agent, native: event.sessionId, transcript, now: event.ts }));
  return null;
}
