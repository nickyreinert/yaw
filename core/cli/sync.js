// `yaw sync --check` (Y-4.6, ADR-0012): do the agent adapter files match what the kit renders?
// Adapter files: .agents/skills/**, .claude/skills/**, .claude/settings.json, .codex/hooks.json, .yaw/bin/yaw-hook.

import { hashContent, readProjectFile } from '../render/files.js';
import { isAdapterPath } from '../render/agents.js';
import { enabledModules, renderProject, requireManifest } from '../render/project.js';
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
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

// `yaw init --sync <folder | owner/repo>` and `yaw web --sync ...`: already set up YAW somewhere else? Connect this
// machine to the same sync folder (or private GitHub repository) and pull the portable settings and presets
// before the interview starts, so the presets are there to load. Needs no terminal prompt.
export function syncShortcut({ spec, io }) {
  const github = !isAbsolute(spec) && !existsSync(resolve(io.cwd, spec)) && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(spec);
  if (!github && !existsSync(resolve(io.cwd, spec))) throw new UsageError(`--sync ${spec}: that folder does not exist (mount your NAS first) and it is not an owner/repository`);
  try {
    configureSync({ env: io.env, kitRoot: io.kitRoot, target: github ? undefined : resolve(io.cwd, spec), github: github ? spec : undefined });
    const result = runSync({ env: io.env, kitRoot: io.kitRoot });
    if (result.conflicts?.length) throw new UsageError(`--sync: ${result.conflicts.length} setting(s) differ here and there (${result.conflicts.join(', ')}); choose with: yaw sync run --resolve local|remote, then run this command again`);
  } catch (e) {
    if (e instanceof UsageError) throw e;
    throw new UsageError(`--sync ${spec}: ${e.message}`);
  }
  io.stdout.write(`Synced portable settings and presets with ${github ? `GitHub ${spec}` : resolve(io.cwd, spec)}; presets are listed in the setup. Details: yaw sync status\n`);
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
