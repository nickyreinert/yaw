import { readProjectFile } from '../render/files.js';
import { readUserData, writeUserData } from '../lib/user-store.js';
import { collectAnalysis, localEndpoint } from '../lib/session-analysis.js';
import { realRoot } from '../../modules/sessions/lib/registry.js';
import { notificationSettings, saveNotifications, testNotifications } from '../../modules/comfort/lib/settings.js';
import { tasksSection } from './dashboard.js';
import { FormError } from './form-model.js';
import { parseMap } from '../../modules/code-map/lib/map.js';

export const WORKSPACE_ACTIONS = ['collect', 'evaluate', 'preferences', 'notifications', 'notification-test'];
export const workspacePreferences = (env, root) => {
  const doc = readUserData(env, 'web-preferences.json') ?? {};
  return { refreshOnLoad: doc[realRoot(root)]?.refreshOnLoad === true, endpoint: doc.endpoint ?? 'http://127.0.0.1:8000' };
};
export function createWorkspaceApi({ root, kitRoot, env }) {
  let running = false;
  return {
    actions: WORKSPACE_ACTIONS,
    get: {
      '/api/preferences': () => workspacePreferences(env, root),
      '/api/notifications': () => notificationSettings({ root, env }),
      '/api/code-map': () => {
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
      if (name === 'preferences') {
        if (typeof input.refreshOnLoad !== 'boolean') throw new FormError('Choose whether to refresh on load');
        let endpoint;
        try { endpoint = localEndpoint(input.endpoint); } catch (e) { throw new FormError(e.message); }
        const doc = readUserData(env, 'web-preferences.json') ?? {};
        doc[realRoot(root)] = { refreshOnLoad: input.refreshOnLoad };
        doc.endpoint = endpoint;
        writeUserData(env, 'web-preferences.json', doc);
        return { message: 'Refresh preference and local Laya address saved. Classification never runs automatically.' };
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
      try {
        const result = await collectAnalysis({
          root, env, all: input.all === true, days: input.days ?? 'all', classify: name === 'evaluate',
          endpoint: workspacePreferences(env, root).endpoint,
          tasksFor: (project) => { try { return tasksSection(project); } catch (e) { return { error: e.message }; } },
        });
        return { ...result, message: `Saved ${result.sessions} session(s). ${name === 'evaluate' ? 'Local classifications included.' : 'No model was called.'}` };
      } catch (e) {
        throw new FormError(e.message);
      } finally { running = false; }
    },
    failed(error) { process.stderr.write(`yaw web workspace action failed (${error.name ?? 'Error'})\n`); },
  };
}
