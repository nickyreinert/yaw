// Notification (kind: comfort; ADR-0030): "needs input" when the agent waits on a permission or an idle prompt.
import { notifyTurn } from '../lib/notify.js';

export default function notification(event, { root, env, notificationType }) {
  if (notificationType !== 'permission_prompt' && notificationType !== 'idle_prompt') return null;
  return notifyTurn({ event, root, env, status: 'input' });
}
