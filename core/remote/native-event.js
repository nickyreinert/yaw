// Invoked only by local hooks in a hosted project. Never prints or forwards prompt/response content.
import http from 'node:http';
import { lanOrigin } from './lan.js';

try {
  let text = '';
  for await (const chunk of process.stdin) { text += chunk; if (Buffer.byteLength(text) > 2 * 1024 * 1024) throw new Error(); }
  const event = JSON.parse(text), name = process.argv[2];
  const address = lanOrigin(process.env.YAW_NATIVE_ADDRESS);
  const body = JSON.stringify({ session: process.env.YAW_NATIVE_SESSION, event: name, providerId: event.session_id,
    notification: event.notification_type, background: Boolean(event.background_tasks?.length || event.session_crons?.length) });
  const req = http.request(`${address}/api/native-event`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.YAW_NATIVE_TOKEN}` }, timeout: 2000 }, (res) => res.resume());
  req.on('timeout', () => req.destroy()); req.on('error', () => {}); req.end(body);
} catch { /* Hook failure never affects Claude or reaches the model. */ }
