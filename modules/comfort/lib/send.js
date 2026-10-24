// Detached ntfy sender (ADR-0030): `node send.js '<payload json>'`. Reads the topic from the personal
// comfort.yaml itself, posts once with a timeout and prints nothing, whatever happens.

import { buildPayload } from './notify.js';
import { readPersonal } from './config.js';
import { deliverNotifications } from './settings.js';
import { writeUserData } from '../../../core/lib/user-store.js';

async function main() {
  const given = JSON.parse(process.argv[2] ?? '{}');
  const payload = buildPayload({ project: given.project, task: given.task, status: given.status, minutes: given.minutes, summary: given.summary });
  const channels = await deliverNotifications({ payload, config: readPersonal(process.env).config.notify ?? {}, env: process.env });
  writeUserData(process.env, 'notification-delivery.json', { ok: true, channels, date: new Date().toISOString() });
}

try {
  await main();
} catch {
  writeUserData(process.env, 'notification-delivery.json', { ok: false, message: 'Notification delivery failed. Check the channel settings and environment credentials, then send a test.', date: new Date().toISOString() });
}
process.exit(0);
