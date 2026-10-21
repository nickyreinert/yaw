// SessionStart (kind: context; ADR-0028, BUILD.md rule 5): re-inject at most 5 critical decisions, one short
// line each (ID and title), no record bodies. Nothing when no decision is marked critical. Claude and Codex
// only; Copilot gets the AGENTS.md rule and `just decisions recall` instead. Reads only the committed index;
// any error is swallowed by the dispatcher (fail open).

import { RETIRED } from '../../../core/lib/retrieval.js';
import { readIndex } from '../lib/journal.js';

export const MAX_CRITICAL = 5;
const MAX_TITLE = 100;

// The index is hand-editable: one line per decision, no control characters, clipped.
const line = (s) => {
  const t = String(s ?? '').replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();
  return [...t].length > MAX_TITLE ? `${[...t].slice(0, MAX_TITLE - 1).join('')}…` : t;
};

export default function sessionStartCritical(event, { root }) {
  const critical = readIndex(root).entries
    .filter((e) => e.type === 'decision' && e.importance === 'critical' && !RETIRED.includes(e.status))
    .slice(0, MAX_CRITICAL);
  if (critical.length === 0) return null;
  return { context: ['Critical decisions (always apply; full records: just decisions recall "<task>"):', ...critical.map((e) => `${e.id} ${line(e.summary)}`)].join('\n') };
}
