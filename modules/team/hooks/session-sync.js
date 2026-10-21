// SessionStart (kind: comfort; ADR-0031): fetch, safe fast-forward, my issues and pull requests, for the user only
// (systemMessage). Offline it shows the last result with its time; it never fails the session.

import { sessionStart } from '../lib/sync.js';

export default async function sessionSync(event, { root, env }) {
  const result = await sessionStart({ root, env });
  return result ? { systemMessage: result.lines.join('\n') } : null;
}
