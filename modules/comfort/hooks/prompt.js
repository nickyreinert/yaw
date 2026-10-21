// UserPromptSubmit (kind: comfort; ADR-0030, ADR-0007): session hygiene. Keeps the per-session state and, when a
// threshold is crossed, returns one systemMessage for the user. Never additionalContext: prompt-time context would
// cost tokens on every turn (BUILD.md rule 5). The prompt text stays in memory.
import { onPrompt } from '../lib/hygiene.js';

export default function prompt(event, { root, env, manifest, prompt: text, transcript }) {
  return onPrompt({ event, root, env, manifest, prompt: text, transcript });
}
