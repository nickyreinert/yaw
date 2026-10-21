// UserPromptSubmit (kind: comfort; ADR-0028, ADR-0007): local recall on the prompt, shown to the user only.
// It names the records that may apply so the user can check that the agent cites them; the model reads the
// records itself at task start (`just decisions recall`, AGENTS.md rule). Never additionalContext: prompt-time
// context would cost tokens on every turn (BUILD.md rule 5). Silent when nothing matches; any error is
// swallowed by the dispatcher (fail open). Reads the committed index and taxonomy only: no network, no model.

import { retrieve } from '../../../core/lib/retrieval.js';
import { readIndex, readTaxonomy } from '../lib/journal.js';

const MAX_IDS = 3;
const MAX_SUMMARY = 60;
const MAX_MESSAGE = 300;

const clip = (s, n) => ([...s].length > n ? `${[...s].slice(0, n - 1).join('')}…` : s);
// The index is a committed, hand-editable file: no control characters (terminal escapes) reach the user's screen.
const plain = (s) => String(s ?? '').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();

export default function recall(event, { root, prompt }) {
  if (typeof prompt !== 'string' || prompt.trim() === '') return null;
  const index = readIndex(root);
  const { hits } = retrieve({ text: prompt, entries: index.entries, taxonomy: readTaxonomy(root), model: index.model });
  if (hits.length === 0) return null;
  const named = hits.slice(0, MAX_IDS).map((h) => `${h.entry.id} ${clip(plain(h.entry.summary), MAX_SUMMARY)}`);
  const more = hits.length > MAX_IDS ? ` (+${hits.length - MAX_IDS} more)` : '';
  return { systemMessage: clip(`YAW decisions that may apply: ${named.join('; ')}${more}. The agent should cite them (just decisions recall).`, MAX_MESSAGE) };
}
