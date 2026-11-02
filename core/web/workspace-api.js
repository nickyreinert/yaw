import { readProjectFile } from '../render/files.js';
import { readUserData, writeUserData } from '../lib/user-store.js';
import { CLASSIFIER_DEFAULTS, CLASSIFIER_LIMITS, classifierSamples, classifierSettings, collectAnalysis, previewClassification, probeClassifier, readAnalysis, scanSummary } from '../lib/session-analysis.js';
import { resetSources, saveSources, sourcesData } from '../lib/session-sources.js';
import { notificationSettings, saveNotifications, testNotifications } from '../../modules/comfort/lib/settings.js';
import { sessionsData, tasksSection } from './dashboard.js';
import { readManifest } from '../render/manifest.js';
import { enabledModules } from '../render/project.js';
import { FormError, assertSafe } from './form-model.js';
import { browseFolders } from './browse.js';
import { kickoffParts } from '../cli/kickoff.js';
import { parseMap } from '../../modules/code-map/lib/map.js';
import { removeKnowledge, saveKnowledge } from '../lib/knowledge-store.js';
import { interviewApply, interviewData, interviewAction, interviewPreview, saveTaxonomy, settingsFile, settingsFiles, taxonomyData } from './settings.js';
import { ProjectError } from '../render/project.js';
import { removeReviewPrompt, reviewPromptsData, saveReviewPrompt } from './review-prompts.js';
import { globalFile, globalFiles, presetAction, presetData, presetSave, presetsData, profileApply, profileData, profilePreview } from './global-settings.js';
import { configureSync, runSync, syncStatus } from '../lib/data-sync.js';
import { reviewSessions } from '../lib/session-insights.js';
import { createImproveRunner, improveSettings, saveImproveSettings, planningAgents } from './improve-agents.js';
import { previewPlanning, applyPlanning } from './planning.js';
import { lanInterfaces, defaultInterface } from '../lib/lan-address.js';
import { remoteSettings, saveRemoteSettings } from '../lib/remote-settings.js';

// Project setup problems (bad answers, missing manifest) are the user's to fix: report them, never as a 500.
import { loadSetupDefaults, saveSetupDefaults } from '../lib/setup-defaults.js';
import { improveHistory, savedImprovement, saveImprovement, importImprovement, deleteImprovement, retainImprovements, previewImprovement, applyImprovement } from '../lib/improve-store.js';
const userError = async (fn) => { try { return await fn(); } catch (e) { if (e instanceof ProjectError) throw new FormError(e.message); throw e; } };

export const WORKSPACE_ACTIONS = ['planning-agents', 'planning-start', 'planning-job', 'planning-clear', 'planning-preview', 'planning-apply', 'collect', 'evaluate', 'preferences', 'classifier-save', 'classifier-test', 'classifier-preview', 'classifier-pause', 'classifier-resume', 'classifier-stop', 'notifications', 'notification-test', 'knowledge-save', 'knowledge-remove', 'project-add', 'taxonomy-save', 'interview-action', 'interview-preview', 'interview-apply',
  'improve-history-save', 'improve-history-import', 'improve-history-read', 'improve-history-delete', 'improve-history-retention', 'improve-instruction-preview', 'improve-instruction-apply', 'setup-defaults-save', 'profile-preview', 'profile-apply', 'preset-save', 'preset-rename', 'preset-delete', 'review-prompt-save', 'review-prompt-remove', 'sync-setup', 'sync-run', 'session-sources-save', 'session-sources-reset', 'insights-review', 'improve-settings', 'improve-agent-start', 'improve-agent-clear', 'remote-settings', 'server-status', 'server-open'];
// Personal, not per workspace: Auto refresh applies to whichever Sessions page is open; the classifier is one local service.
export function webPreferences(env) {
  const doc = readUserData(env, 'web-preferences.json') ?? {};
  let classifier;
  try { classifier = classifierSettings(doc.classifier ?? {}); } catch { classifier = { ...CLASSIFIER_DEFAULTS }; }
  return { autoRefresh: doc.autoRefresh === true, classifier, defaults: CLASSIFIER_DEFAULTS, limits: CLASSIFIER_LIMITS };
}
const savePreferences = (env, change) => writeUserData(env, 'web-preferences.json', { ...(readUserData(env, 'web-preferences.json') ?? {}), ...change });
// `projects` (the dashboard's project switcher) resolves the `workspace` each request names; without it the API is
// bound to `root`. Every action and read runs against that one resolved project.
// The saved sources plus how many sessions the last scan found per agent.
const sourcesView = (env, data = sourcesData(env)) => {
  const found = {};
  for (const r of readAnalysis(env).rows) found[r.agent] = (found[r.agent] ?? 0) + 1;
  return { ...data, found };
};
export function createWorkspaceApi({ root: fixed, kitRoot, env, projects, fetchFn, spawnFn }) {
  const reviewer = createImproveRunner({ env, spawnFn }), planner = createImproveRunner({ env, spawnFn, purpose: 'planning' });
  let running = false;
  let classifierJob = null, resumePaused = null;
  const rootOf = (value) => projects ? projects.resolve(value) : fixed;
  const publicClassifierJob = () => classifierJob && ({
    status: classifierJob.status, session: classifierJob.session, sessions: classifierJob.sessions,
    turn: classifierJob.turn, turns: classifierJob.turns, complete: classifierJob.complete,
    unavailable: classifierJob.unavailable, skipped: classifierJob.skipped,
    sessionComplete: classifierJob.sessionComplete, message: classifierJob.message,
  });
  const resume = () => { const release = resumePaused; resumePaused = null; release?.(); };
  return {
    actions: WORKSPACE_ACTIONS,
    close: () => { planner.clear(); reviewer.clear(); classifierJob?.controller.abort(); resume(); },
    get: {
      '/api/global/features': (params) => {
        return { remoteControl: remoteSettings(env), hubMigrated: Boolean(readUserData(env, 'hub-sync.json')), folderSync: Boolean(readUserData(env, 'sync-config.json')?.scopes.some((scope) => ['settings', 'presets', 'statistics'].includes(scope))), interfaces: lanInterfaces(), defaultInterface: defaultInterface(), root: rootOf(params?.get('workspace')) };
      },
      '/api/improve/history': () => improveHistory({ env }),
      '/api/improve/settings': () => improveSettings(env),
      '/api/improve/job': () => reviewer.read(),
      '/api/global/session-sources': () => sourcesView(env),
      '/api/global/sync': (params) => syncStatus({ env, selected: params?.get('device') }),
      '/api/sessions': (params) => sessionsData({ root: rootOf(params?.get('workspace')), kitRoot, env, projects }),
      '/api/global/setup-defaults': () => loadSetupDefaults({ env, kitRoot }),
      '/api/global/profile': () => profileData({ kitRoot, env }),
      '/api/global/presets': () => presetsData({ env }),
      '/api/global/preset': (params) => presetData({ env, name: params?.get('name') }),
      '/api/global/files': () => globalFiles({ env }),
      '/api/global/review-prompts': () => reviewPromptsData({ kitRoot, env }),
      '/api/review-prompts': (params) => userError(() => reviewPromptsData({ root: rootOf(params?.get('workspace')), kitRoot, env })),
      '/api/global/file': (params) => globalFile({ env, path: params?.get('path') ?? '' }),
      // Which known projects have the comfort module, so notifications reach them.
      '/api/global/comfort': () => (projects ? projects.list().projects : [{ root: fixed, name: fixed.split('/').pop() }]).map((p) => {
        let comfort = false;
        try { const manifest = readManifest(p.root); comfort = Boolean(manifest) && enabledModules(manifest).includes('comfort'); } catch { /* unreadable manifest */ }
        return { root: p.root, name: p.name, comfort };
      }),
      '/api/preferences': () => webPreferences(env),
      '/api/classifier-samples': () => classifierSamples(env),
      '/api/classification-job': () => publicClassifierJob(),
      '/api/notifications': (params) => notificationSettings({ root: rootOf(params?.get('workspace')), env }),
      '/api/settings': (params) => userError(() => settingsFiles({ root: rootOf(params?.get('workspace')), kitRoot })),
      '/api/settings/file': (params) => userError(() => settingsFile({ root: rootOf(params?.get('workspace')), kitRoot, path: params?.get('path') })),
      '/api/taxonomy': (params) => userError(() => taxonomyData({ root: rootOf(params?.get('workspace')), kitRoot })),
      '/api/kickoff': (params) => userError(() => {
        const root = rootOf(params?.get('workspace'));
        const manifest = readManifest(root);
        if (!manifest) return { available: false, message: 'This folder has no YAW setup. Run yaw init here.' };
        return { available: true, agents: planningAgents(env), ...kickoffParts({ root, manifest }) };
      }),
      '/api/browse': (params) => browseFolders(params?.get('path')),
      '/api/interview': (params) => userError(() => interviewData({ root: rootOf(params?.get('workspace')), kitRoot, env })),
      '/api/code-map': (params) => {
        const root = rootOf(params?.get('workspace'));
        const content = readProjectFile(root, 'docs/code-map.md');
        if (content && content.length > 256 * 1024) throw new FormError('Code map is larger than 256 KiB; use yaw map show');
        const text = content?.toString('utf8') ?? '';
        let model;
        try { model = text ? parseMap(text) : null; } catch (e) { throw new FormError(e.message); }
        return { content: text, areas: model?.areas ?? [], exclude: model?.exclude ?? [], depth: model?.depth ?? null,
          message: 'Read-only current-workspace map. Update explicitly with yaw map update; check with yaw map check.' };
      },
    },
    async action(name, input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new FormError('Expected action settings');
      if (name.startsWith('planning-')) {
        try {
          if (name === 'planning-agents') return { agents: planningAgents(env) };
          if (name === 'planning-job') return planner.read();
          if (name === 'planning-start') { assertSafe({ 'idea.text': input.prompt }, kitRoot); return planner.start(input); }
          if (name === 'planning-clear') { if (input.id !== planner.read()?.id) throw new FormError('This planning run is no longer active', 409); return planner.clear(); }
          const ctx = { root: rootOf(input.workspace), kitRoot, env, input };
          if (name === 'planning-preview') return previewPlanning(ctx);
          if (name === 'planning-apply') return await applyPlanning(ctx);
        } catch (e) { throw new FormError(e.message, e.status ?? 400); }
      }
      if (name.startsWith('improve-history-')) {
        try {
          const ctx = { env, kitRoot, input };
          if (name === 'improve-history-read') return savedImprovement({ env, id: input.id });
          if (name === 'improve-history-save') return saveImprovement(ctx);
          if (name === 'improve-history-import') return importImprovement(ctx);
          if (name === 'improve-history-delete') return deleteImprovement(ctx);
          if (name === 'improve-history-retention') return retainImprovements(ctx);
        } catch (e) { throw new FormError(e.message, e.status ?? 400); }
      }
      if (name === 'setup-defaults-save') {
        try { return saveSetupDefaults({ env, kitRoot }, input); } catch (e) { throw new FormError(e.message); }
      }
      if (['server-status', 'server-open'].includes(name)) {
        try {
          const { backgroundControl } = await import('../remote/background.js');
          if (name === 'server-status') return await backgroundControl(env, remoteSettings(env).role === 'client' ? 'refresh' : 'status') ?? { connection: { status: 'stopped' } };
          const { hostRequest } = await import('../remote/server-client.js');
          return await hostRequest({ env, local: true, path: '/api/local-open', input: {} });
        } catch (e) { throw new FormError(e.message); }
      }
      if (name === 'remote-settings') {
        const { workspace, confirmWorkspace, migrate, ...settings } = input;
        try {
          const root = rootOf(workspace);
          if (settings.role) {
            const { lanOrigin, lanInterfaces } = await import('../remote/lan.js');
            if (settings.role === 'client') settings.address = lanOrigin(settings.address);
            if (settings.role === 'host' && !lanInterfaces().includes(settings.bindAddress)) throw new Error('Choose a current LAN interface');
          }
          const saved = saveRemoteSettings(env, settings, { root, confirmWorkspace, migrate });
          if (saved.enabled && saved.role) {
            if (saved.role === 'client') { const { configureServerClient } = await import('../remote/server-client.js'); configureServerClient({ env, migrate }); }
            const { startServerBackground } = await import('../remote/background.js');
            await startServerBackground({ env, kitRoot, cwd: root });
          }
          return saved;
        } catch (e) { throw new FormError(e.message); }
      }
      if (['improve-settings', 'improve-agent-start', 'improve-agent-clear'].includes(name)) {
        try {
          if (name === 'improve-settings') return saveImproveSettings(env, input);
          if (name === 'improve-agent-start') return reviewer.start(input);
          if (input.id !== reviewer.read()?.id) throw new Error('This review is no longer active');
          return reviewer.clear();
        } catch (e) { throw new FormError(e.message); }
      }
      if (name === 'session-sources-save' || name === 'session-sources-reset') {
        try { return sourcesView(env, name === 'session-sources-save' ? saveSources(env, input.sources) : resetSources(env)); }
        catch (e) { throw new FormError(e.message); }
      }
      if (name === 'sync-setup' || name === 'sync-run') {
        try { return name === 'sync-setup' ? configureSync({ env, target: input.target, github: input.github, name: input.name, scopes: input.scopes }) : runSync({ env, kitRoot, resolution: input.resolution, name: input.name }); }
        catch (e) { throw new FormError(e.message); }
      }
      if (name === 'project-add') {
        if (!projects) throw new FormError('Project switching is not available here', 404);
        return projects.add(input.path);
      }
      // Global Settings: personal files under ~/.yaw, independent of the open workspace.
      if (name === 'profile-preview') return profilePreview({ kitRoot, env, input });
      if (name === 'profile-apply') return profileApply({ kitRoot, env, input });
      if (name === 'preset-save') return presetSave({ kitRoot, env, input });
      if (name === 'preset-rename' || name === 'preset-delete') return presetAction({ env, input, remove: name === 'preset-delete' });
      // Review prompts: scope global is the user's blueprint, scope project the open workspace's override.
      if ((name === 'review-prompt-save' || name === 'review-prompt-remove') && input.scope === 'global') {
        return name === 'review-prompt-save' ? saveReviewPrompt({ root: null, kitRoot, env, input }) : removeReviewPrompt({ root: null, env, input });
      }
      const root = rootOf(input.workspace);
      if (name === 'improve-instruction-preview' || name === 'improve-instruction-apply') {
        try { return (name === 'improve-instruction-preview' ? previewImprovement : applyImprovement)({ root, env, kitRoot, input }); }
        catch (e) { throw new FormError(e.message, e.status ?? 400); }
      }
      if (name === 'insights-review') {
        if (input.confirm !== true) throw new FormError('Confirm reading the selected local transcripts for temporary review');
        if (running) throw new FormError('A session scan or review is already running', 409);
        running = true;
        try { return await reviewSessions({ env, ids: input.ids, turn: input.turn, conversation: input.conversation === true }); }
        catch (e) { throw new FormError(e.message); }
        finally { running = false; }
      }
      if (name === 'review-prompt-save') return saveReviewPrompt({ root, kitRoot, env, input });
      if (name === 'review-prompt-remove') return removeReviewPrompt({ root, env, input });
      input = Object.fromEntries(Object.entries(input).filter(([k]) => k !== 'workspace'));
      if (name === 'knowledge-save') return saveKnowledge({ root, kitRoot, env, input: input.record });
      if (name === 'taxonomy-save') return userError(() => saveTaxonomy({ root, kitRoot, input }));
      if (name === 'interview-action') return userError(() => interviewAction({ root, kitRoot, env, input }));
      if (name === 'interview-preview') return userError(() => interviewPreview({ root, kitRoot, env, input }));
      if (name === 'interview-apply') {
        if (running) throw new FormError('Another workspace action is running', 409);
        running = true;
        try { return await userError(() => interviewApply({ root, kitRoot, env, input })); } finally { running = false; }
      }
      if (name === 'knowledge-remove') return removeKnowledge({ root, kitRoot, env, input: input.record });
      if (name === 'preferences') {
        if (typeof input.autoRefresh !== 'boolean') throw new FormError('Choose whether to refresh automatically');
        savePreferences(env, { autoRefresh: input.autoRefresh });
        return { message: input.autoRefresh ? 'Auto refresh on: opening a Sessions page reads new or changed transcripts. Classification never runs automatically.' : 'Auto refresh off: pages read saved results only.' };
      }
      if (name === 'classifier-save' || name === 'classifier-test') {
        let classifier;
        try { classifier = classifierSettings(input.classifier ?? {}); } catch (e) { throw new FormError(e.message); }
        if (name === 'classifier-save') { savePreferences(env, { classifier }); return { classifier, message: 'Classification settings saved.' }; }
        try { return await probeClassifier(classifier); } catch (e) { throw new FormError(e.message, 502); }
      }
      if (name === 'classifier-preview') {
        if (input.confirm !== true) throw new FormError('Confirm sending the selected session turns to local Laya for preview');
        if (running) throw new FormError('A session scan or classification is already running', 409);
        running = true;
        try { return await previewClassification({ env, root: rootOf(input.workspace), ids: input.ids, classifier: input.classifier, fetchFn }); }
        catch (e) { throw new FormError(e.message); }
        finally { running = false; }
      }
      if (name === 'classifier-pause') {
        if (classifierJob?.status === 'running') {
          classifierJob.status = 'pausing';
          classifierJob.message = 'Pausing after the current turn.';
        }
        return publicClassifierJob();
      }
      if (name === 'classifier-resume') {
        if (['pausing', 'paused'].includes(classifierJob?.status)) {
          classifierJob.status = 'running';
          classifierJob.message = 'Classification resumed.';
          resume();
        }
        return publicClassifierJob();
      }
      if (name === 'classifier-stop') {
        if (classifierJob && ['running', 'pausing', 'paused'].includes(classifierJob.status)) {
          classifierJob.status = 'stopping';
          classifierJob.controller.abort();
          resume();
        }
        return publicClassifierJob();
      }
      if (name === 'notifications') {
        try { return saveNotifications({ root, env, input }); }
        catch (e) { throw new FormError(e.message); }
      }
      if (name === 'notification-test') {
        if (input.confirm !== true) throw new FormError('Confirm sending a test notification');
        try { return await testNotifications({ root, env }); }
        catch (e) { throw new FormError(e.message); }
      }
      if (!['collect', 'evaluate'].includes(name)) throw new FormError('Unknown workspace action', 404);
      if (name === 'evaluate' && input.confirm !== true) throw new FormError('Confirm reading session messages for local classification');
      if (running) throw new FormError('A session scan or classification is already running', 409);
      if (input.all !== undefined && typeof input.all !== 'boolean') throw new FormError('Choose current or all workspaces');
      running = true;
      const job = name === 'evaluate' ? {
        status: 'running', session: 0, sessions: 0, turn: 0, turns: 0,
        message: 'Preparing sessions for classification.', controller: new AbortController(),
      } : null;
      if (job) classifierJob = job;
      try {
        const result = await collectAnalysis({
          root, env, all: input.all === true, days: input.days ?? 'all', ids: input.ids, classify: name === 'evaluate',
          classifier: webPreferences(env).classifier, fetchFn,
          ...(job ? {
            signal: job.controller.signal,
            waitIfPaused: async () => {
              if (job.status === 'pausing') {
                job.status = 'paused';
                job.message = 'Paused after the current turn.';
              }
              if (job.status !== 'paused') return;
              await new Promise((resolve) => { resumePaused = resolve; });
              if (job.controller.signal.aborted) throw new Error('Classification stopped; unfinished results were not saved');
            },
            onProgress: ({ session, sessions, turn, turns, complete, sessionComplete }) => {
              Object.assign(job, { session, sessions, turn, turns, complete, sessionComplete,
                message: sessions ? `Session ${session} of ${sessions}${turns ? ` · turn ${turn} of ${turns}${complete ? ' complete' : ''}` : ''}` : 'No sessions to classify.',
              });
            },
          } : {}),
          tasksFor: (project) => { try { return tasksSection(project); } catch (e) { return { error: e.message }; } },
        });
        if (job) {
          job.status = 'completed';
          job.message = job.controller.signal.aborted ? 'Classification stopped; unfinished results were not saved.' :
            `Classified ${result.sessions} session(s).${result.skipped ? ` Skipped ${result.skipped} unavailable or unreadable transcripts; existing results kept.` : ''}`;
          Object.assign(job, { unavailable: result.unavailable, skipped: result.skipped, sessionComplete: true, complete: true });
        }
        return { ...result, message: `${scanSummary(result)} ${name === 'evaluate' ? result.sessions ? 'Local classifications included.' : 'No readable sessions to classify; no model was called.' : 'No model was called.'}` };
      } catch (e) {
        if (job) {
          job.status = job.controller.signal.aborted ? 'stopped' : 'failed';
          job.message = e.message;
        }
        throw new FormError(e.message);
      } finally { running = false; }
    },
    failed(error) { process.stderr.write(`yaw web workspace action failed (${error.name ?? 'Error'})\n`); },
  };
}
