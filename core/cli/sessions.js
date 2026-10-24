// `yaw sessions <verb>` (Y-5.7, ADR-0029; import #174): thin wrapper; the logic is the sessions module's
// (modules/sessions/lib/cli.js).

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { enabledModules, requireManifest } from '../render/project.js';
import { UsageError } from './commands.js';
import { collectAnalysis, readAnalysis, scanSummary } from '../lib/session-analysis.js';
import { tasksSection } from '../web/dashboard.js';
import { workspacePreferences } from '../web/workspace-api.js';
import { realRoot } from '../../modules/sessions/lib/registry.js';

export async function sessions({ values, positionals, io }) {
  const [verb, ...args] = positionals;
  if (['scan', 'evaluate', 'analytics'].includes(verb)) {
    if (args.length) throw new UsageError('usage: yaw sessions scan|evaluate|analytics [--all] [--days all|7|30|90] [--endpoint http://127.0.0.1:8000]');
    if (verb === 'analytics') {
      if (!['all', '7', '30', '90'].includes(values.days ?? 'all')) throw new UsageError('Choose all, 7, 30 or 90 days');
      const data = readAnalysis(io.env);
      const since = !values.days || values.days === 'all' ? -Infinity : Date.now() - Number(values.days) * 86400000;
      const rows = data.rows.filter((r) => (values.all || r.project === realRoot(io.cwd)) && Date.parse(r.started) >= since);
      io.stdout.write(`${JSON.stringify({ collected: data.collected, rows }, null, 2)}\n`);
      return 0;
    }
    io.stdout.write(`Reading ${values.all ? 'all workspaces' : 'this workspace'} session files explicitly; only aggregate metadata is saved.${verb === 'evaluate' ? ' Conversation text is sent only to the configured loopback Laya service.' : ' No model calls.'}\n`);
    const result = await collectAnalysis({
      root: io.cwd, env: io.env, all: values.all === true, days: values.days ?? 'all', classify: verb === 'evaluate',
      endpoint: values.endpoint ?? workspacePreferences(io.env, io.cwd).endpoint,
      tasksFor: (project) => { try { return tasksSection(project); } catch (e) { return { error: e.message }; } },
    });
    io.stdout.write(`${scanSummary(result)} Collected ${result.collected}\n`);
    return 0;
  }
  // `import` (#174) also works in a project without YAW or without the sessions module: it only fills ~/.yaw/yaw.db.
  if (verb !== 'import') {
    const manifest = requireManifest(io.cwd);
    if (!enabledModules(manifest).includes('sessions')) throw new UsageError('the sessions module is not installed; run: yaw add sessions');
  }
  const lib = await import(pathToFileURL(join(io.kitRoot, 'modules', 'sessions', 'lib', 'cli.js')).href);
  try {
    if (verb === 'import') return await lib.runImport({ args, values, io: { ...io, root: io.cwd } });
    return lib.runSessions({ verb, args, values, io: { ...io, root: io.cwd } });
  } catch (e) {
    if (e instanceof lib.SessionsUsageError) throw new UsageError(`${e.message}\n${lib.USAGE}`);
    throw e;
  }
}
