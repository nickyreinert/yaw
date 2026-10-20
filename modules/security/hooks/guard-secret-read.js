// PreToolUse guard (kind: guard): deny tool calls that read secret files (.env*, keys, credentials).
// Paths come from the tool input (Read, Edit, Grep, apply_patch, ...) and from the words of a shell command.

import { commandWords, loadRules, secretRule } from '../lib/guards.js';

export default function guardSecretRead(event, { kitRoot, manifest }) {
  const rules = loadRules({ kitRoot, profiles: manifest.profiles });
  const candidates = [...event.input.paths, ...(event.input.command ? commandWords(event.input.command) : [])];
  for (const path of candidates) {
    const rule = secretRule(rules, path);
    if (rule) {
      return { decision: 'deny', reason: `YAW security (${rule.id}): ${rule.reason} Do not read or print secret files; ask the user to run the command and enter values themselves.` };
    }
  }
  return null;
}
