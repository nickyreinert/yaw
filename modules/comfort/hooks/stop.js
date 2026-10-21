// Stop (kind: comfort; ADR-0030): "done" notification after a long turn. User-visible only, synchronous.
import { notifyTurn } from '../lib/notify.js';

export default function stop(event, { root, env }) {
  return notifyTurn({ event, root, env, status: 'done' });
}
