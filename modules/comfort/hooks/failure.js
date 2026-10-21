// StopFailure (kind: comfort; ADR-0030): "failed" after a turn that ended in an API error or rate limit.
import { notifyTurn } from '../lib/notify.js';

export default function failure(event, { root, env }) {
  return notifyTurn({ event, root, env, status: 'failed' });
}
