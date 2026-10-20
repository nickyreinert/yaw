// `yaw agents` (Y-4.7, doc 09 §3): compatibility matrix of the enabled modules (or, outside a project,
// every module of the kit) for the selected agents, from module.yaml and adapters/capabilities.yaml.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from '../lib/yaml.js';
import { formatError } from '../lib/schema.js';
import { hasModule, KitError, loadModule, schemas } from '../render/kit.js';
import { readManifest } from '../render/manifest.js';
import { enabledModules } from '../render/project.js';
import { UsageError } from './commands.js';

const PHASE1 = ['claude', 'codex', 'copilot'];

// Capability that stands in for an item when neither the item nor its module names the agent.
const HOOK_CAPABILITY = { guard: 'blockTool', comfort: 'userMessage', evaluation: 'hooks' };

export function loadCapabilities(kitRoot) {
  const file = join(kitRoot, 'adapters', 'capabilities.yaml');
  const { value, lines } = parseDocument(readFileSync(file, 'utf8'), { file });
  const errors = schemas().validate('capabilities.schema.json', value, { lines });
  if (errors.length > 0) throw new KitError(errors.map((e) => formatError(e, file)).join('\n'));
  return value;
}

function capabilityOf(kind, item) {
  if (kind === 'skill') return 'skills';
  if (item.kind === 'context') return item.event === 'SessionStart' ? 'sessionStartContext' : 'promptContext';
  return HOOK_CAPABILITY[item.kind];
}

// -> { support, via?, note? } for one cell
function cell({ caps, def, item, kind, agent }) {
  const own = item && typeof item === 'object' ? item.agents?.[agent] : undefined;
  if (own) return own;
  if (def.agents?.[agent]) return def.agents[agent];
  const fromCaps = item ? caps.agents[agent]?.capabilities?.[capabilityOf(kind, item)] : undefined;
  return fromCaps ?? { support: 'none', note: 'not declared' };
}

// -> { agents, rows: [{ label, cells: [{ support, via, note }] }], notes }
export function matrix({ kitRoot, modules, agents }) {
  const caps = loadCapabilities(kitRoot);
  const rows = [];
  for (const name of modules) {
    const def = loadModule(kitRoot, name);
    rows.push({ label: name, cells: agents.map((a) => cell({ caps, def, item: null, kind: 'module', agent: a })) });
    for (const h of def.outputs?.hooks ?? []) {
      rows.push({ label: `  hook ${h.name} (${h.kind}, ${h.event})`, cells: agents.map((a) => cell({ caps, def, item: h, kind: 'hook', agent: a })) });
    }
    for (const s of def.outputs?.skills ?? []) {
      const item = typeof s === 'string' ? { name: s } : s;
      rows.push({ label: `  skill ${item.name}`, cells: agents.map((a) => cell({ caps, def, item, kind: 'skill', agent: a })) });
    }
  }
  const notes = agents.filter((a) => caps.agents[a]?.note).map((a) => `${caps.agents[a].name}: ${caps.agents[a].note}`);
  return { agents, names: agents.map((a) => caps.agents[a]?.name ?? a), rows, notes };
}

export function renderMatrix(m) {
  const footnotes = [];
  const text = (c, agent) => {
    if (c.support === 'native' || (!c.note && !c.via)) return c.support;
    const line = `${agent}: ${[c.via, c.note].filter(Boolean).join('; ')}`;
    let n = footnotes.indexOf(line);
    if (n === -1) n = footnotes.push(line) - 1;
    return `${c.support} [${n + 1}]`;
  };
  const table = m.rows.map((r) => [r.label, ...r.cells.map((c, i) => text(c, m.agents[i]))]);
  const header = ['', ...m.names];
  const widths = header.map((h, i) => Math.max(h.length, ...table.map((r) => r[i].length)));
  const line = (cols) => cols.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd();
  const out = [line(header), ...table.map(line)];
  if (footnotes.length > 0) out.push('', ...footnotes.map((f, i) => `[${i + 1}] ${f}`));
  if (m.notes.length > 0) out.push('', 'notes:', ...m.notes.map((n) => `  ${n}`));
  return `${out.join('\n')}\n`;
}

export async function agents({ positionals, io }) {
  if (positionals.length > 0) throw new UsageError(`unexpected argument "${positionals[0]}"`);
  const manifest = readManifest(io.cwd);
  const dir = join(io.kitRoot, 'modules');
  const modules = manifest
    ? enabledModules(manifest).filter((m) => hasModule(io.kitRoot, m))
    : (existsSync(dir) ? readdirSync(dir).filter((n) => hasModule(io.kitRoot, n)).sort() : []);
  const selected = manifest ? manifest.agents : PHASE1;
  const m = matrix({ kitRoot: io.kitRoot, modules, agents: selected });
  io.stdout.write(manifest
    ? `yaw agents: ${modules.length} enabled module${modules.length === 1 ? '' : 's'}, agents ${selected.join(', ')}\n\n`
    : 'yaw agents: no project here; every module of the kit, phase-1 agents\n\n');
  io.stdout.write(renderMatrix(m));
  return 0;
}
