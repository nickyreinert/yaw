import { readProjectFile } from '../render/files.js';
import { readUserData, writeUserData } from '../lib/user-store.js';
import { CLASSIFIER_DEFAULTS, CLASSIFIER_LIMITS, classifierSamples, classifierSettings, collectAnalysis, previewClassification, probeClassifier, readAnalysis, scanSummary } from '../lib/session-analysis.js';
import { resetSources, saveSources, sourcesData } from '../lib/session-sources.js';
import { notificationSettings, saveNotifications, testNotifications } from '../../modules/comfort/lib/settings.js';
import { sessionsData, tasksSection } from './dashboard.js';
import { readManifest } from '../render/manifest.js';
import { enabledModules } from '../render/project.js';
import { FormError } from './form-model.js';
import { browseFolders } from './browse.js';
import { kickoffParts } from '../cli/kickoff.js';
import { parseMap } from '../../modules/code-map/lib/map.js';
import { removeKnowledge, saveKnowledge } from '../lib/knowledge-store.js';
import { interviewApply, interviewData, interviewPreview, saveTaxonomy, settingsFile, settingsFiles, taxonomyData } from './settings.js';
import { ProjectError } from '../render/project.js';
import { removeReviewPrompt, reviewPromptsData, saveReviewPrompt } from './review-prompts.js';
import { globalFile, globalFiles, presetAction, presetsData, profileApply, profileData, profilePreview } from './global-settings.js';
import { configureSync, runSync, syncStatus } from '../lib/data-sync.js';

// Project setup problems (bad answers, missing manifest) are the user's to fix: report them, never as a 500.
const userError = async (fn) => { try { return await fn(); } catch (e) { if (e instanceof ProjectError) throw new FormError(e.message); throw e; } };

export const WORKSPACE_ACTIONS = ['collect', 'evaluate', 'preferences', 'classifier-save', 'classifier-test', 'classifier-preview', 'classifier-pause', 'classifier-resume', 'classifier-stop', 'notifications', 'notification-test', 'knowledge-save', 'knowledge-remove', 'project-add', 'taxonomy-save', 'interview-preview', 'interview-apply',
  'profile-preview', 'profile-apply', 'preset-rename', 'preset-delete', 'review-prompt-save', 'review-prompt-remove', 'sync-setup', 'sync-run', 'session-sources-save', 'session-sources-reset'];
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
export function createWorkspaceApi({ root: fixed, kitRoot, env, projects, fetchFn }) {
  let running = false;
  let classifierJob = null, resumePaused = null;
  const rootOf = (value) => projects ? projects.resolve(value) : fixed;
  const publicClassifierJob = () => classifierJob && ({
    status: classifierJob.status, session: classifierJob.session, sessions: classifierJob.sessions,
    turn: classifierJob.turn, turns: classifierJob.turns, complete: classifierJob.complete,
    sessionComplete: classifierJob.sessionComplete, message: classifierJob.message,
  });
  const resume = () => { const release = resumePaused; resumePaused = null; release?.(); };
  return {
    actions: WORKSPACE_ACTIONS,
    get: {
      '/api/global/session-sources': () => sourcesView(env),
      '/api/global/sync': (params) => syncStatus({ env, selected: params?.get('device') }),
      '/api/sessions': (params) => sessionsData({ root: rootOf(params?.get('workspace')), kitRoot, env, projects }),
      '/api/global/profile': () => profileData({ kitRoot, env }),
      '/api/global/presets': () => presetsData({ env }),
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
        return { available: true, ...kickoffParts({ root, manifest }) };
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
      if (name === 'preset-rename' || name === 'preset-delete') return presetAction({ env, input, remove: name === 'preset-delete' });
      // Review prompts: scope global is the user's blueprint, scope project the open workspace's override.
      if ((name === 'review-prompt-save' || name === 'review-prompt-remove') && input.scope === 'global') {
        return name === 'review-prompt-save' ? saveReviewPrompt({ root: null, kitRoot, env, input }) : removeReviewPrompt({ root: null, env, input });
      }
      const root = rootOf(input.workspace);
      if (name === 'review-prompt-save') return saveReviewPrompt({ root, kitRoot, env, input });
      if (name === 'review-prompt-remove') return removeReviewPrompt({ root, env, input });
      input = Object.fromEntries(Object.entries(input).filter(([k]) => k !== 'workspace'));
      if (name === 'knowledge-save') return saveKnowledge({ root, kitRoot, env, input: input.record });
      if (name === 'taxonomy-save') return userError(() => saveTaxonomy({ root, kitRoot, input }));
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
          root, env, all: input.all === true, days: input.days ?? 'all', classify: name === 'evaluate',
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
          job.message = job.controller.signal.aborted ? 'Classification stopped; unfinished results were not saved.' : 'Classification complete.';
        }
        return { ...result, message: `${scanSummary(result)} ${name === 'evaluate' ? 'Local classifications included.' : 'No model was called.'}` };
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
