// The "Next steps" block at the end of yaw init (#167): where to start, where YAW keeps things, which tools
// the setup needs. Built from the written setup only; prints nothing that is not true for this project.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tasksMode } from '../lib/tasks.js';
import { hasProfile, loadProfile } from '../render/kit.js';
import { CODEX_HOOKS } from '../render/agents.js';
import { MODULE_TOOLS } from './tool-hints.js';

const AGENT_NAMES = { claude: 'Claude Code', codex: 'Codex', copilot: 'Copilot' };

export function nextSteps({ root, kitRoot, answers = {}, modules = [], profiles = [], files = [] }) {
  const agents = (answers['user.agents'] ?? []).filter((a) => AGENT_NAMES[a]);
  const has = (m) => modules.includes(m);
  const lines = [];
  const names = agents.map((a) => AGENT_NAMES[a]).join(' or ') || 'your coding agent';
  lines.push(`Start ${names} in this folder; it reads AGENTS.md${agents.includes('claude') ? ' (through CLAUDE.md)' : ''}.`);
  if (files.includes(CODEX_HOOKS)) {
    lines.push('Codex: run /hooks once and trust the YAW hooks (labelled "YAW <module>"); untrusted hooks never run. Trust them again after each yaw update.');
  }
  if (existsSync(join(root, 'README.md'))) lines.push('Your idea: README.md.');
  if (has('tasks')) {
    const mode = tasksMode(answers, { teamModule: has('team') });
    lines.push(mode === 'github'
      ? 'Tasks: GitHub issues; TASKS.md is a read-only view (just task sync, just task list).'
      : `Tasks: TASKS.md (just task list, just task new "title")${mode === 'both' ? ', mirrored to GitHub issues with just task sync' : ''}.`);
  }
  if (has('sessions')) lines.push('Sessions: yaw sessions list; the registry is ~/.yaw/yaw.db, on this machine only (never committed).');
  if (has('decisions')) lines.push('Decisions: .decisions/ (just decisions list, just decisions recall "topic").');
  lines.push('Dashboard: yaw web (sessions, tasks and decisions in your browser, local only).');
  lines.push('All recipes: just --list. Check the setup any time: yaw doctor.');
  const tools = new Set();
  for (const p of profiles) if (hasProfile(kitRoot, p)) for (const t of loadProfile(kitRoot, p).requires ?? []) tools.add(t);
  for (const m of modules) for (const { tool } of MODULE_TOOLS[m] ?? []) tools.add(tool);
  if (tools.size > 0) lines.push(`Tools this setup needs: ${[...tools].join(', ')} (plus git; YAW itself needs only Node).`);
  return lines;
}

export function printNextSteps(out, input) {
  out.write('\nNext steps\n');
  for (const line of nextSteps(input)) out.write(`  - ${line}\n`);
}
