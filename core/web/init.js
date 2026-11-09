import { spawn } from 'node:child_process';
import { setupPrompt } from '../lib/setup-prompts.js';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFormModel, assertSafe, FormError } from './form-model.js';
import { startFormServer } from './form-server.js';
import { editProject, initProject } from '../render/project.js';
import { gitInit, isGitRepo } from '../lib/git-init.js';
import { readManifest } from '../render/manifest.js';
import { hashContent, writeAtomic } from '../render/files.js';
import { assertFoundationsUnchanged, checkTaskReferences, prepareFoundations, readFoundationFile } from '../lib/foundations.js';
import { kitVersion } from '../render/kit.js';
import { saveSetup, seedPersonalPreferences } from '../lib/user-store.js';
import { validateSecretValues, writeEnvSecrets } from '../lib/env-secrets.js';
import { printReport } from '../cli/commands.js';
import { printNextSteps } from '../cli/next-steps.js';
import { kickoffPrompt, parseKickoffReply, planningFacts, PLAN_FILE, PlanError } from '../lib/kickoff.js';
import { importTasks, kickoffParts } from '../cli/kickoff.js';
import { tasksMode } from '../lib/tasks.js';
import { dashboardData } from './dashboard.js';
import { knowledgeData } from './knowledge.js';
import { createWorkspaceApi, WORKSPACE_ACTIONS } from './workspace-api.js';
import { planningAgents } from './improve-agents.js';
import { savePlanningFiles } from './planning.js';
import { loadRules, secretValueRule } from '../../modules/security/lib/guards.js';

export const DRAFT = '.yaw/draft.yaml';

// handoff: answers given so far in the terminal (#162), shown prefilled; never written before apply.
export function createFormApi({ root, kitRoot, env, verify, skipVerify = false, stderr, handoff = null, edit = false, sections = [], model: suppliedModel }) {
  const model = suppliedModel ?? createFormModel({ root, kitRoot, env, edit, sections });
  const workspace = createWorkspaceApi({ root, kitRoot, env });
  let agentState = null, agentRevision = 0;
  const setupState = () => ({ revision: agentRevision, setup: structuredClone(agentState ?? handoff ?? model.bootstrap().initial ?? { mode: 'quick', answers: {}, modules: null }) });
  // The values the planning chat may recommend, in the interview's own words.
  let lists;
  const stackLists = () => {
    if (!lists) {
      const questions = model.bootstrap().questions;
      const of = (id) => (questions.find((q) => q.id === id)?.choices ?? []).map((c) => typeof c === 'object' ? { value: c.value, label: c.label ?? c.value } : { value: c, label: c });
      lists = { languages: of('arch.language'), hosts: of('arch.runs-on') };
    }
    return lists;
  };
  const replyOf = (text) => {
    if (typeof text !== 'string' || Buffer.byteLength(text) > 100000) throw new FormError('Paste the answer of the planning chat (at most 100,000 UTF-8 bytes).');
    if (secretValueRule(loadRules({ kitRoot }), text)) throw new FormError('The plan looks like it contains a secret; remove it before importing.');
    try { return parseKickoffReply(text, { languages: stackLists().languages, hosts: stackLists().hosts }); }
    catch (e) { if (e instanceof PlanError) throw new FormError(e.message); throw e; }
  };
  const assertPlanUnchanged = (prepared) => {
    if (!prepared.plan) return;
    const current = readFoundationFile(root, PLAN_FILE, { kitRoot });
    if ((current === null ? null : hashContent(current)) !== prepared.planExpected) throw new FormError('The saved plan changed; review again.', 409);
  };
  const ensureNew = () => {
    if (edit) return model.assertUnchanged();
    if (readManifest(root)) throw new FormError('This project is already initialized; use yaw update', 409);
  };
  // The plan from the planning chat: kept as docs/plan/kickoff.md and, with the tasks module, added to TASKS.md.
  async function savePlan({ prepared, output }) {
    const { plan } = prepared;
    assertPlanUnchanged(prepared);
    savePlanningFiles({ root, kitRoot, plan, foundations: prepared.foundations, setupHash: prepared.planBasisHash });
    if (prepared.foundations) output.write(`Registered reviewed project foundations: ${prepared.foundations.entries.map((d) => d.path).join(', ')}\n`);
    output.write(`Saved the plan as ${PLAN_FILE}\n`);
    if (!prepared.modules.includes('tasks')) { output.write(`No task list yet: yaw add tasks, then yaw kickoff import ${PLAN_FILE}\n`); return; }
    if (tasksMode(prepared.doc.answers, { teamModule: prepared.modules.includes('team') }) === 'github') {
      output.write(`Tasks live in GitHub issues; create them when you are ready: yaw kickoff import ${PLAN_FILE}\n`);
      return;
    }
    try {
      const io = { cwd: root, kitRoot, env, stdout: output, stderr: output };
      const done = await importTasks({ root, plan: plan.tasks, io });
      output.write(`Added ${done.created} task(s) to TASKS.md${done.skipped ? `, skipped ${done.skipped}` : ''}\n`);
    } catch (e) {
      output.write(`Could not add the tasks (${e.message}); run: yaw kickoff import ${PLAN_FILE}\n`);
    }
  }
  return {
    actions: [...WORKSPACE_ACTIONS, 'kickoff-prompt', 'kickoff-reply', 'setup-prompts', 'setup-update', 'file-preview'],
    close: () => workspace.close(),
    get: {
      ...workspace.get,
      '/api/setup': setupState,
      '/api/dashboard': (params) => dashboardData({ root, kitRoot, env, params }),
      '/api/knowledge': (params) => knowledgeData({ root, kitRoot, env, params }),
    },
    bootstrap: () => ({ ...model.bootstrap(), skipVerify, handoff: agentState ?? handoff }),
    prepareApply(input) {
      ensureNew();
      if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new FormError('Expected a setup object');
      const { secrets, plan, planBasis, foundationsReviewed, foundationReview, ...setup } = input;
      const prepared = model.normalize(setup);
      if (plan !== undefined && plan !== null) {
        prepared.plan = replyOf(plan);
        assertSafe(planningFacts(planBasis ?? prepared.doc.answers), kitRoot);
        prepared.planBasisHash = hashContent(JSON.stringify(planningFacts(planBasis ?? prepared.doc.answers)));
        try {
          prepared.foundations = prepareFoundations({ root, kitRoot, documents: prepared.plan.foundations, reviewed: foundationsReviewed });
          checkTaskReferences(prepared.plan.tasks, prepared.foundations);
          if (prepared.foundations && JSON.stringify(foundationReview) !== JSON.stringify(prepared.foundations.entries.map(({ path, expected }) => ({ path, expected })))) throw new FormError('Foundation sources changed or were not previewed; load and review the plan again.', 409);
          const current = readFoundationFile(root, PLAN_FILE, { kitRoot });
          const text = prepared.plan.text.endsWith('\n') ? prepared.plan.text : `${prepared.plan.text}\n`;
          if (current !== null && hashContent(current) !== hashContent(text)) throw new FormError(`${PLAN_FILE} already exists; preserve or edit that plan before importing a different one.`, 409);
          prepared.planExpected = current === null ? null : hashContent(current);
        } catch (e) { throw new FormError(e.message, e.status ?? 400); }
      }
      try {
        prepared.secretValues = validateSecretValues(secrets, model.secretCatalog(prepared).names);
      } catch (e) {
        throw new FormError(e.message);
      }
      return prepared;
    },
    async action(name, input) {
      if (WORKSPACE_ACTIONS.includes(name)) return workspace.action(name, input);
      if (name === 'setup-update') {
        ensureNew();
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((key) => !['revision', 'setup'].includes(key))) throw new FormError('Expected revision and setup');
        if (input.revision !== agentRevision) throw new FormError('Setup changed; read /api/setup and review again', 409);
        model.normalize(input.setup, { allowIncomplete: true });
        // Keep explicit answers only: defaults are not user confirmation.
        const { mode, answers = {}, modules = null, gitInit = false, proposed = [] } = input.setup;
        agentState = structuredClone({ mode, answers, modules, gitInit, proposed }); agentRevision++;
        return setupState();
      }
      if (name === 'setup-prompts') {
        const prepared = model.normalize(input, { allowIncomplete: true });
        const catalog = model.bootstrap();
        const context = { answers: prepared.doc.answers, modules: prepared.modules, questions: catalog.questions, definitions: catalog.modules };
        return { interview: setupPrompt({ ...context, kind: 'interview' }), kickoff: prepared.unresolved.length ? '' : setupPrompt({ ...context, kind: 'kickoff' }), kickoffStatus: prepared.unresolved.length ? 'Complete essential project answers before copying the final prompt.' : '' };
      }
      if (name === 'prefill') {
        if (!input || typeof input !== 'object' || Array.isArray(input) ||
          Object.keys(input).some((k) => !['kind', 'name'].includes(k))) throw new FormError('Invalid prefill request');
        return model.prefill(input.kind, input.name);
      }
      if (name === 'kickoff-prompt') {
        if (!input || typeof input !== 'object' || Array.isArray(input.answers ?? {})) throw new FormError('Expected the answers so far');
        const answers = input.answers ?? {};
        // The prompt leaves for a third party: the same secret check as every saved answer.
        assertSafe(answers, kitRoot);
        const mode = tasksMode(answers, { teamModule: ['team', 'external-reviewers'].includes(answers['idea.team']) && answers['tasks.use-github'] !== false });
        return { prompt: kickoffPrompt({ answers, tasksMode: mode, stack: stackLists() }) };
      }
      if (name === 'kickoff-reply') {
        const reply = replyOf(input?.text);
        let foundations;
        try { foundations = prepareFoundations({ root, kitRoot, documents: reply.foundations, reviewed: true }); checkTaskReferences(reply.tasks, foundations); }
        catch (e) { throw new FormError(e.message); }
        return { idea: reply.idea, language: reply.language, runsOn: reply.runsOn, warnings: reply.warnings,
          foundations: foundations?.entries.map(({ kind, path, text }) => ({ kind, path, text })) ?? [],
          foundationReview: foundations?.entries.map(({ path, expected }) => ({ path, expected })) ?? [],
          tasks: reply.tasks.length, phases: [...new Set(reply.tasks.map((t) => t.phase))].length, titles: reply.tasks.slice(0, 6).map((t) => t.title) };
      }
      if (name === 'file-preview') return model.filePreview(input?.setup, input?.path);
      if (name === 'preview' || name === 'diff') return model.preview(input, name === 'diff');
      ensureNew();
      const prepared = model.normalize(input, { allowIncomplete: name === 'draft' });
      if (name === 'draft') {
        writeAtomic(root, DRAFT, prepared.text, { mode: 0o600 });
        return { message: `Draft saved to ${DRAFT}; no generated files were applied.` };
      }
      if (name === 'preset') {
        if (input.consent !== true || (input.saveProfile !== undefined && typeof input.saveProfile !== 'boolean')) {
          throw new FormError('Saving requires explicit consent for this save; nothing was stored');
        }
        let saved;
        try {
          saved = saveSetup({
            env, kitRoot, answers: prepared.doc.answers, mode: prepared.doc.mode,
            projectRoot: root, kit: kitVersion(kitRoot), preset: true, profile: input.saveProfile === true,
          });
        } catch (e) {
          if (e.message.startsWith('not saved,') || e.message.includes('cannot be read; fix or remove the file')) {
            throw new FormError('Existing user preferences are unreadable or invalid; nothing was saved. Fix the user-profile.yaml file first.');
          }
          throw e;
        }
        if (!saved.saved) throw new FormError('An answer looks like a secret; nothing was stored');
        return { message: `Saved preset ${saved.preset}${saved.profile ? ' and user profile' : ''}. Consent is not remembered.` };
      }
      throw new FormError('Unknown action', 404);
    },
    async apply(prepared, emit) {
      ensureNew();
      assertFoundationsUnchanged(root, prepared.foundations, kitRoot);
      assertPlanUnchanged(prepared);
      assertSafe(prepared.doc.answers, kitRoot);
      const output = { write: (text) => emit({ type: 'log', text: String(text) }) };
      emit({ type: 'log', text: 'Applying confirmed setup…\n' });
      if (prepared.gitInit && !isGitRepo(root)) {
        const git = gitInit(root);
        emit({ type: 'log', text: git.created ? 'Created a git repository (git init).\n' : `git init failed: ${git.error}; create it later with git init.\n` });
      }
      const result = edit
        ? await editProject({ root, kitRoot, answers: { text: prepared.text, doc: prepared.doc }, env })
        : await initProject({ root, kitRoot, answers: { text: prepared.text, doc: prepared.doc }, modules: prepared.modules, env });
      printReport(output, result);
      emit({ type: 'log', text: 'Wrote .yaw/answers.yaml and .yaw/manifest.json (team settings); personal settings stay in ~/.yaw/user-profile.yaml\n' });
      if (result.personalWarning) emit({ type: 'log', text: `${result.personalWarning}\n` });
      if (!edit) {
        try {
          const seeded = seedPersonalPreferences({ env, kitRoot, mode: prepared.doc.mode, answers: prepared.doc.answers, reviewed: prepared.reviewedPreferences });
          if (seeded.saved) output.write('Saved your first personal defaults; later project overrides keep them unchanged.\n');
        } catch { output.write('Personal defaults could not be saved; existing settings were left untouched. Use yaw defaults to review them.\n'); }
      }
      const saved = writeEnvSecrets(root, model.secretCatalog(prepared).names, prepared.secretValues);
      if (saved.preserved) emit({ type: 'log', text: 'Existing .env was preserved; submitted secret values were not saved.\n' });
      else if (saved.written) emit({ type: 'log', text: `Saved ${saved.written} secret value(s) to .env (mode 0600).\n` });
      let ok = true;
      let message;
      if (skipVerify) {
        emit({ type: 'log', text: 'Verification explicitly skipped (--skip-verify); run: just setup && just check\n' });
        message = 'Applied; verification skipped.';
      } else if (saved.written) {
        emit({ type: 'log', text: 'Verification skipped because new secrets were saved; review the project recipes before running: just setup && just check\n' });
        message = 'Applied with secrets; verification skipped. Review the project recipes before running just setup and just check.';
      } else {
        ok = await verify({ root, io: { env, stdout: output, stderr: output } });
        message = ok ? 'Applied and verified.' : 'Files applied, but verification failed. Fix the reported problem and run just setup && just check.';
      }
      if (prepared.plan) await savePlan({ prepared, output, result });
      printNextSteps(output, {
        root, kitRoot, answers: prepared.doc.answers, modules: prepared.modules,
        profiles: prepared.doc.proposal?.profiles ?? [], files: result.manifest.files.map((f) => f.path),
      });
      // The same kickoff guide and planning prompt `yaw init` prints on a terminal.
      emit({ type: 'kickoff', agents: planningAgents(env), ...kickoffParts({ root, manifest: readManifest(root) }) });
      emit({ type: 'done', ok, message });
    },
    failed(error) {
      // The browser gets no untrusted exception text (which could contain answer values).
      stderr?.write(`yaw init --web: ${error.name ?? 'Error'}${error.code ? ` (${error.code})` : ''}; operation failed\n`);
    },
  };
}

// The start token must never appear in argv (other local users can read process arguments): the browser opens a
// private launcher file (0600 in a 0700 folder) that redirects to the tokenized URL. The file is removed on close.
export function writeLauncher(url) {
  const dir = mkdtempSync(join(tmpdir(), 'yaw-web-'));
  const file = join(dir, 'open.html');
  const safe = url.replace(/[^A-Za-z0-9:/?=.]/g, '');
  writeFileSync(file, `<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="refresh" content="0;url=${safe}"><title>YAW setup</title>\n`, { mode: 0o600 });
  return { file, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

export function openBrowser(target, env) {
  const [command, args] = process.platform === 'darwin' ? ['open', [target]] :
    process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', target]] : ['xdg-open', [target]];
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, stdio: 'ignore' });
    child.once('error', () => resolve(false));
    child.once('close', (code) => resolve(code === 0));
  });
}

export async function initWeb({ io, skipVerify, verify, handoff, edit = false, sections = [], headless = false }) {
  const api = createFormApi({ root: io.cwd, kitRoot: io.kitRoot, env: io.env, verify, skipVerify, stderr: io.stderr, handoff, edit, sections });
  let finish;
  const done = new Promise((r) => { finish = r; });
  let exitCode = 1;
  const apply = api.apply;
  api.apply = async (...args) => {
    const emit = args[1];
    args[1] = (event) => {
      if (event.type === 'done') exitCode = event.ok ? 0 : 1;
      emit(event);
    };
    return apply(...args);
  };
  let launcher;
  const server = await startFormServer({ api, onClose: () => { launcher?.remove(); finish(exitCode); } });
  io.stdout.write(`YAW ${edit ? 'edit' : 'setup'} (local only). Open this one-time link:\n${server.url}\nNothing is written until Save draft, Save as preset, or Apply. Ctrl+C stops the server.\n`);
  if (headless) {
    io.stdout.write('Agent API: authenticate with the link above, then GET /api/bootstrap and /api/setup. POST /api/setup-update to configure; POST /api/preview to review, then POST /api/apply to write. See docs/setup-api.md.\n');
    return done;
  }
  let opened;
  try {
    if (io.openBrowser) opened = await io.openBrowser(server.url, io.env);
    else {
      launcher = writeLauncher(server.url);
      opened = await openBrowser(launcher.file, io.env);
    }
  } catch (e) {
    await server.close();
    throw e;
  }
  if (!opened) io.stdout.write('Browser could not be opened automatically; open the link above manually.\n');
  return done;
}
