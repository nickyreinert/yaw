// Detached ntfy sender (ADR-0030): `node send.js '<payload json>'`. Reads the topic from the personal
// comfort.yaml itself, posts once with a timeout and prints nothing, whatever happens.

import { buildPayload, ntfyRequest } from './notify.js';
import { readPersonal } from './config.js';

async function main() {
  const given = JSON.parse(process.argv[2] ?? '{}');
  const payload = buildPayload({ project: given.project, task: given.task, status: given.status, minutes: given.minutes, summary: given.summary });
  const request = ntfyRequest(payload, readPersonal(process.env).config.notify?.ntfy);
  if (request === null) return;
  await fetch(request.url, { method: 'POST', headers: request.headers, body: request.body, signal: AbortSignal.timeout(8000), redirect: 'error' });
}

try {
  await main();
} catch { /* a notification that cannot be sent is not worth a message */ }
process.exit(0);
