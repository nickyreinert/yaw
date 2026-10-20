// Agent adapter rendering (ADR-0012, ADR-0021): hook registrations in the agents' settings files,
// the project hook shim, skill copies, and which agent a path belongs to.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { checkRelPath } from './files.js';

export const HOOK_SHIM = '.yaw/bin/yaw-hook';
export const CLAUDE_SETTINGS = '.claude/settings.json';
export const CODEX_HOOKS = '.codex/hooks.json';
export const HOOK_TIMEOUT_SECONDS = 10;

// The shim's source in the kit (POSIX sh, ADR-0006); shellcheck in kit CI lints it.
export const SHIM_SOURCE = join(import.meta.dirname, '..', 'hooks', 'yaw-hook.sh');

// Agents whose settings file registers a module's hooks. Copilot runs the hooks of
// .claude/settings.json (ADR-0021), so it has no file of its own (no double firing).
const SETTINGS = { claude: CLAUDE_SETTINGS, codex: CODEX_HOOKS };

// Tool names in module.yaml matchers are Claude's. Codex reports shell commands as Bash and file
// edits as apply_patch (Codex hooks docs); tools Codex does not have are dropped.
const CODEX_TOOLS = { Bash: 'Bash', Edit: 'apply_patch', Write: 'apply_patch', MultiEdit: 'apply_patch' };

export function isAdapterPath(path) {
  return path === CLAUDE_SETTINGS || path === CODEX_HOOKS || path === HOOK_SHIM
    || path.startsWith('.agents/skills/') || path.startsWith('.claude/skills/');
}

// Which selected agents a module template path is for; null = every project.
// .claude/settings.json is read by Claude and by Copilot.
export function pathWanted(path, agents) {
  if (path === CLAUDE_SETTINGS) return agents.includes('claude') || agents.includes('copilot');
  if (path.startsWith('.claude/')) return agents.includes('claude');
  if (path.startsWith('.codex/')) return agents.includes('codex');
  return true;
}

// Support level of a module item for an agent: the item's own agents map, else the module's.
export function support(def, item, agent) {
  return (item && typeof item === 'object' ? item.agents?.[agent]?.support : undefined)
    ?? def.agents?.[agent]?.support ?? 'none';
}

// A matcher in module.yaml: empty or "*" matches every tool; "A|B" lists names; anything else is a
// regular expression anchored at both ends (Claude Code matcher rules).
function alternatives(matcher) {
  if (matcher === undefined || matcher === '' || matcher === '*') return null;
  return /^[A-Za-z0-9_|]+$/.test(matcher) ? matcher.split('|').filter(Boolean) : undefined;
}

// The matcher to register for an agent; null = every tool; '' = the agent has none of these tools.
export function matcherFor(agent, matcher) {
  const alts = alternatives(matcher);
  if (alts === null) return null;
  if (agent !== 'codex') return matcher;
  if (alts === undefined) return matcher; // a regex: registered as is
  return [...new Set(alts.map((a) => CODEX_TOOLS[a]).filter(Boolean))].join('|');
}

// Does an item's matcher accept one of the tool names (native name plus its Claude equivalents)?
export function matcherAccepts(agent, matcher, toolNames) {
  if (matcher === undefined || matcher === '' || matcher === '*') return true;
  const translated = agent === 'codex' && alternatives(matcher) !== undefined ? matcherFor(agent, matcher) : matcher;
  if (translated === '') return false;
  const re = new RegExp(`^(?:${translated})$`);
  return toolNames.some((n) => re.test(n));
}

// The command an agent runs for one module's hooks on one event. The shim path is found from the
// project root: Claude sets CLAUDE_PROJECT_DIR; Codex runs commands in the session cwd and Copilot
// sets no project variable, so git (or the cwd) gives the root.
export function hookCommand(agent, event, module) {
  return `sh "\${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/${HOOK_SHIM}" ${event} --agent ${agent} --module ${module}`;
}

// Hook registrations of the enabled modules, as JSON parts of the agents' settings files (ADR-0004
// composition: lists concatenate, so every module adds its own entries and removing it removes them).
// One entry per module and event; the matcher is the union of that module's items for the event.
// -> [{ path, module, kind: 'part', content }]
export function hookParts({ definitions, modules, agents }) {
  const parts = [];
  for (const name of modules) {
    const def = definitions.get(name);
    const hooks = def.outputs?.hooks ?? [];
    for (const [agent, path] of Object.entries(SETTINGS)) {
      const runsHere = agent === 'claude' ? ['claude', 'copilot'].filter((a) => agents.includes(a)) : agents.includes(agent) ? [agent] : [];
      if (runsHere.length === 0) continue;
      const byEvent = new Map();
      for (const item of hooks) {
        if (!runsHere.some((a) => support(def, item, a) !== 'none')) continue;
        const m = matcherFor(agent, item.matcher);
        if (m === '') continue;
        if (!byEvent.has(item.event)) byEvent.set(item.event, []);
        byEvent.get(item.event).push(m);
      }
      if (byEvent.size === 0) continue;
      const json = { hooks: {} };
      for (const [event, matchers] of byEvent) {
        const entry = {};
        if (!matchers.includes(null)) entry.matcher = [...new Set(matchers.flatMap((m) => m.split('|')))].join('|');
        entry.hooks = [{ type: 'command', command: hookCommand(agent, event, name), timeout: HOOK_TIMEOUT_SECONDS }];
        json.hooks[event] = [entry];
      }
      parts.push({ path, module: name, kind: 'part', content: `${JSON.stringify(json)}\n` });
    }
  }
  return parts;
}

export function hasHooks({ definitions, modules, agents }) {
  return hookParts({ definitions, modules, agents }).length > 0;
}

// Skill files of a module: modules/<m>/skills/<name>/** -> .agents/skills/<name>/** (always) and
// .claude/skills/<name>/** (Claude selected). Copies, not templates (ADR-0012).
// -> [[path, Buffer]]
export function skillFiles({ moduleDir, def, agents }) {
  const out = [];
  for (const item of def.outputs?.skills ?? []) {
    const name = typeof item === 'string' ? item : item.name;
    const dir = join(moduleDir, 'skills', name);
    if (!existsSync(join(dir, 'SKILL.md'))) throw new Error(`skill "${name}": ${join(dir, 'SKILL.md')} not found`);
    for (const rel of walk(dir)) {
      const content = readFileSync(join(dir, rel));
      out.push([checkRelPath(`.agents/skills/${name}/${rel}`), content]);
      if (agents.includes('claude')) out.push([checkRelPath(`.claude/skills/${name}/${rel}`), content]);
    }
  }
  return out;
}

function walk(dir, prefix = '') {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(join(dir, name)).isDirectory()) out.push(...walk(join(dir, name), rel));
    else out.push(rel);
  }
  return out;
}

export function shimContent() {
  return readFileSync(SHIM_SOURCE);
}
