// `yaw sync --check` (Y-4.6, ADR-0012): do the agent adapter files match what the kit renders?
// Adapter files: .agents/skills/**, .claude/skills/**, .claude/settings.json, .codex/hooks.json, .yaw/bin/yaw-hook.

import { hashContent, readProjectFile } from '../render/files.js';
import { isAdapterPath } from '../render/agents.js';
import { enabledModules, renderProject, requireManifest } from '../render/project.js';
import { UsageError } from './commands.js';
import { configureSync, runSync, syncStatus } from '../lib/data-sync.js';

// -> [{ path, problem }] (empty: no drift)
export function adapterDrift({ root, kitRoot }) {
  const manifest = requireManifest(root);
  const { desired } = renderProject({ root, kitRoot, manifest, modules: enabledModules(manifest) });
  const paths = new Set([...desired.keys(), ...manifest.files.map((f) => f.path)].filter(isAdapterPath));
  const recorded = new Map(manifest.files.map((f) => [f.path, f.hash]));
  const drift = [];
  for (const path of [...paths].sort()) {
    const want = desired.get(path);
    const have = readProjectFile(root, path);
    if (!want) {
      if (have !== null) drift.push({ path, problem: 'is no longer rendered by any enabled module', fix: 'yaw update' });
    } else if (have === null) {
      drift.push({ path, problem: 'is missing', fix: recorded.has(path) ? `yaw update --restore ${path}` : 'yaw update' });
    } else if (hashContent(have) !== hashContent(want.content)) {
      // the kit renders what the manifest recorded: the file was edited by hand (ADR-0003 keeps edits on update)
      const handEdit = recorded.get(path) === hashContent(want.content);
      drift.push({ path, problem: handEdit ? 'was edited by hand' : 'differs from its source', fix: handEdit ? `git checkout -- ${path} (or delete it and run yaw update --restore ${path})` : 'yaw update' });
    }
  }
  return drift;
}

export async function sync({ values, positionals, io }) {
  if (!values.check) {
    const [action = 'status', ...extra] = positionals;
    if (extra.length) throw new UsageError('Unexpected sync arguments');
    const args = { env: io.env, kitRoot: io.kitRoot, name: values.name, resolution: values.resolve };
    let result;
    if (action === 'setup') result = configureSync({ ...args, target: values.folder, github: values.github, scopes: values.scopes?.split(',') });
    else if (action === 'run') result = runSync(args);
    else if (action === 'status') result = syncStatus({ env: io.env, selected: values.device });
    else throw new UsageError('Use sync setup, run, status or --check');
    io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.conflicts?.length ? 2 : 0;
  }
  if (positionals.length > 0) throw new UsageError(`unexpected argument "${positionals[0]}"`);
  if (!values.check) throw new UsageError('phase 1 has only yaw sync --check; yaw update re-renders the adapter files');
  const drift = adapterDrift({ root: io.cwd, kitRoot: io.kitRoot });
  if (drift.length === 0) {
    io.stdout.write('yaw sync --check: agent adapter files match their source\n');
    return 0;
  }
  for (const d of drift) io.stdout.write(`drift: ${d.path} ${d.problem}; fix: ${d.fix}\n`);
  io.stdout.write('adapter files are generated; personal Claude settings belong in .claude/settings.local.json\n');
  return 1;
}
