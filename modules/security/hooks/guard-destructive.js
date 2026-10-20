// PreToolUse guard (kind: guard): deny destructive shell commands (rm -rf, force push, prod deploy, and the
// stack guards of the project's profile).

import { commandRule, loadRules } from '../lib/guards.js';

export default function guardDestructive(event, { kitRoot, manifest }) {
  if (!event.input.command) return null;
  const rule = commandRule(loadRules({ kitRoot, profiles: manifest.profiles }), event.input.command);
  if (!rule) return null;
  return { decision: 'deny', reason: `YAW security (${rule.id}): ${rule.reason} Ask the user to run it themselves if it is intended.` };
}
