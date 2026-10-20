// `yaw sync --check` (Y-4.6, ADR-0012): do the agent adapter files match what the kit renders?
// Adapter files: .agents/skills/**, .claude/skills/**, .claude/settings.json, .codex/hooks.json, .yaw/bin/yaw-hook.

import { hashContent, readProjectFile } from '../render/files.js';
import { isAdapterPath } from '../render/agents.js';
import { enabledModules, renderProject, requireManifest } from '../render/project.js';
import { UsageError } from './commands.js';

// -> [{ path, problem }] (empty: no drift)
export function adapterDrift({ root, kitRoot }) {
  const manifest = requireManifest(root);
  const { desired } = renderProject({ root, kitRoot, manifest, modules: enabledModules(manifest) });
  const paths = new Set([...desired.keys(), ...manifest.files.map((f) => f.path)].filter(isAdapterPath));
  const drift = [];
  for (const path of [...paths].sort()) {
    const want = desired.get(path);
    const have = readProjectFile(root, path);
    if (!want) {
      if (have !== null) drift.push({ path, problem: 'is no longer rendered by any enabled module' });
    } else if (have === null) drift.push({ path, problem: 'is missing' });
    else if (hashContent(have) !== hashContent(want.content)) drift.push({ path, problem: 'differs from its source' });
  }
  return drift;
}

export async function sync({ values, positionals, io }) {
  if (positionals.length > 0) throw new UsageError(`unexpected argument "${positionals[0]}"`);
  if (!values.check) throw new UsageError('phase 1 has only yaw sync --check; yaw update re-renders the adapter files');
  const drift = adapterDrift({ root: io.cwd, kitRoot: io.kitRoot });
  if (drift.length === 0) {
    io.stdout.write('yaw sync --check: agent adapter files match their source\n');
    return 0;
  }
  for (const d of drift) io.stdout.write(`drift: ${d.path} ${d.problem}\n`);
  io.stdout.write('run yaw update to re-render them (personal Claude settings belong in .claude/settings.local.json)\n');
  return 1;
}
