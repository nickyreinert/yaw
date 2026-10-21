// Stop and SessionEnd (kind: evaluation; ADR-0029): stamp the end of the turn / session and refresh the
// links (branch tasks, commits carrying the Agent-Session trailer, their files). Silent, fails open.

import { recordSession, withRegistry } from '../lib/registry.js';

export default function touch(event, { root, env, transcript }) {
  withRegistry(env, (db) => recordSession({ db, env, root, agent: event.agent, native: event.sessionId, transcript, now: event.ts, end: true }));
  return null;
}
