import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { remoteSettings, requireRemoteEnabled } from '../lib/remote-settings.js';
import { hostRequest, connectClient } from '../remote/server-client.js';
import { startServerBackground } from '../remote/background.js';
import { projectSlug } from '../remote/host-projects.js';
import { chooseMode, confirmStack } from './init.js';
import { runInterview } from '../interview/engine.js';
import { parseAnswers } from '../render/project.js';
import { confirm } from './prompt.js';
import { UsageError } from './commands.js';
import { hostedWeb } from '../web/hosted-init.js';
import { chooseInitModules } from './init-modules.js';
import { selectedByPolicy } from '../interview/depth.js';
import { orderSetupQuestions } from '../interview/policy.js';

export async function hostInit({ values, positionals, io, local = false }) {
  requireRemoteEnabled(io.env);
  const command = local ? 'init-local' : 'init-remote', settings = remoteSettings(io.env);
  if (settings.role !== (local ? 'host' : 'client')) throw new UsageError(`yaw ${command} requires ${local ? 'Host' : 'Client'} mode`);
  if (positionals.length) throw new UsageError('Use --slug for the project slug');
  if (values.web && (values.answers || values.yes)) throw new UsageError('--web cannot be combined with --answers or --yes');
  await startServerBackground({ env: io.env, kitRoot: io.kitRoot, cwd: io.cwd });
  if (!local) {
    const connection = await connectClient({ env: io.env, kitRoot: io.kitRoot });
    if (connection.status !== 'connected') throw new UsageError(connection.status === 'conflict' ? 'Resolve shared-data conflicts with yaw remote sync --resolve local|remote, then retry' : `Approve this client in the host Web UI${connection.verification ? ` (pairing ${connection.verification})` : ''}, then retry`);
  }
  const request = (path, input) => hostRequest({ env: io.env, path, input, local });
  let slug = values.slug;
  if (!slug && values.web) return hostedWeb({ io, command, local, skipVerify: Boolean(values['skip-verify']) });
  while (!projectSlug(slug)) {
    if (!io.prompter.interactive) throw new UsageError('Provide --slug with lower-case letters, digits and single hyphens');
    slug = (await io.prompter.ask('Project slug > ')).trim();
  }
  if (!values.web && !values.answers && !io.prompter.interactive) throw new UsageError(`Use yaw ${command} --slug <slug> --answers <file> --yes`);
  const session = await request('/api/interviews', { slug, command, skipVerify: Boolean(values['skip-verify']) });
  if (values.web) return hostedWeb({ io, command, local, id: session.id });
  const catalog = await request(`/api/interviews/${session.id}/bootstrap`);
  const browser = async (handoff) => {
    if (handoff) await request(`/api/interviews/${session.id}/handoff`, handoff);
    io.prompter.close?.(); return hostedWeb({ io, command, local, id: session.id });
  };
  let input;
  if (values.answers) {
    if (!values.yes && !io.prompter.interactive) throw new UsageError('Confirmation required; use --yes');
    const doc = parseAnswers(readFileSync(resolve(io.cwd, values.answers), 'utf8'));
    input = { mode: doc.mode, answers: doc.answers, ...(doc.proposal?.modules ? { modules: doc.proposal.modules } : {}), gitInit: true };
  } else {
    io.stdout.write(`yaw ${command} · ${slug}\nHost workspace: ${catalog.hosted.workspaceRoot}\n`);
    const mode = await chooseMode({ prompter: io.prompter });
    if (mode === 'web') return browser({ mode: 'quick', answers: {} });
    let selected = mode, defaults = {};
    if (mode === 'previous') {
      if (!catalog.presets.length) throw new UsageError('No presets on the host; choose a setup depth');
      io.stdout.write(`${catalog.presets.map((p) => p.name).join('\n')}\n`);
      const name = (await io.prompter.ask('Preset name > ')).trim();
      const preset = await request(`/api/interviews/${session.id}/prefill`, { kind: 'preset', name });
      selected = preset.mode; defaults = preset.answers;
    }
    const result = await runInterview({ questions: orderSetupQuestions(catalog.questions), mode: selected, defaults, prompter: io.prompter, kitRoot: io.kitRoot, allowWeb: true });
    input = { mode: selected, answers: result.answers, gitInit: true };
    if (result.web) return browser(input);
    const stack = await confirmStack({ prompter: io.prompter, profiles: catalog.profiles, questions: catalog.questions, answers: result.answers });
    if (stack === 'web') return browser(input);
    input.answers = stack.answers;
    if (['pro', 'all', 'full'].includes(selected)) {
      const selection = await chooseInitModules({ prompter: io.prompter, definitions: catalog.modules, defaults: catalog.modules.filter((m) => m.savedDefault).map((m) => m.name), answers: input.answers });
      if (selection.web) return browser(input);
      input.modules = selectedByPolicy(catalog.modules, { answers: input.answers, modules: selection.modules });
    }
  }
  const preview = await request(`/api/interviews/${session.id}/preview`, input);
  io.stdout.write(`\nHost destination: ${preview.destination}\nProfile: ${preview.profile}\nAgent: Claude Code\nModules: ${preview.modules.join(', ')}\nFiles: ${preview.files.length}\n`);
  if (preview.unresolved.length) throw new UsageError(`Complete essential answers: ${preview.unresolved.join(', ')}`);
  if (!values.yes && !(await confirm(io.prompter, 'Initialize this project on the host and launch Claude Remote Control?'))) return 1;
  const result = await request(`/api/interviews/${session.id}/apply`, input);
  io.stdout.write(`${result.message}\n${result.project.path}\n`);
  if (result.session?.url) io.stdout.write(`${result.session.url}\n`);
  io.stdout.write('Use the host Web UI for native startup confirmations and the Claude connection link.\n');
  return result.ok ? 0 : 1;
}
