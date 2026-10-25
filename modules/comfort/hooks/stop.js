// Stop (kind: comfort; ADR-0030): "done" notification after a long turn. User-visible only, synchronous.
import { onStop } from '../lib/cache.js';
import { notifyTurn } from '../lib/notify.js';

export default function stop(event, { root, env, transcript }) {
  const out = notifyTurn({ event, root, env, status: 'done' });
  onStop({ event, root, env, transcript });
  return out;
}
