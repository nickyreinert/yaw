import { readUserData, writeUserData } from '../../../core/lib/user-store.js';
import { enabledModules } from '../../../core/render/project.js';
import { readManifest } from '../../../core/render/manifest.js';
import { readPersonal, resolveFeatures, settings } from './config.js';
import { buildPayload, notificationRequests } from './notify.js';

export function notificationSettings({ root, env }) {
  const personal = readPersonal(env);
  if (personal.error) throw new Error('Personal comfort settings are invalid; fix comfort.yaml before changing notifications');
  const config = settings(personal.config).notify;
  return {
    installed: enabledModules(readManifest(root) ?? { modules: {} }).includes('comfort'),
    enabled: resolveFeatures({ root, personal: personal.config }).features.includes('notifications'),
    minutes: config.minutes, terminal: config.terminal,
    telegram: { enabled: config.telegram?.enabled === true, tokenEnv: config.telegram?.tokenEnv ?? 'YAW_TELEGRAM_BOT_TOKEN', chatIdEnv: config.telegram?.chatIdEnv ?? 'YAW_TELEGRAM_CHAT_ID' },
    telegramReady: Boolean(config.telegram?.enabled && env[config.telegram.tokenEnv] && env[config.telegram.chatIdEnv]),
    ntfyConfigured: Boolean(config.ntfy),
    delivery: readUserData(env, 'notification-delivery.json'),
  };
}

export function validateNotifications(input) {
  const envName = (v) => typeof v === 'string' && /^[A-Z][A-Z0-9_]{0,79}$/.test(v);
  if (!input || Object.keys(input).some((k) => !['enabled', 'minutes', 'terminal', 'telegram'].includes(k)) ||
    typeof input.enabled !== 'boolean' || !Number.isInteger(input.minutes) || input.minutes < 0 || input.minutes > 1440 ||
    !['osc9', 'osc777', 'off'].includes(input.terminal) ||
    !input.telegram || Object.keys(input.telegram).some((k) => !['enabled', 'tokenEnv', 'chatIdEnv'].includes(k)) ||
    typeof input.telegram.enabled !== 'boolean' || !envName(input.telegram.tokenEnv) || !envName(input.telegram.chatIdEnv)) {
    throw new Error('Invalid notification settings. Supply environment variable names, never Telegram credentials');
  }
  return input;
}

export function saveNotifications({ root, env, input }) {
  notificationSettings({ root, env });
  validateNotifications(input);
  writeUserData(env, 'notification-settings.json', input);
  return { message: 'Personal notification settings saved for all comfort-enabled projects. Credentials are read from the server environment, never stored here.' };
}

export async function deliverNotifications({ payload, config, env, fetchFn = fetch }) {
  const requests = notificationRequests(payload, config, env);
  if (!requests.length && config.telegram?.enabled) throw new Error('Telegram is enabled but its environment credentials are missing or invalid');
  if (config.telegram?.enabled && !requests.some((r) => r.channel === 'telegram')) throw new Error('Telegram environment credentials are missing or invalid');
  const results = [];
  for (const request of requests) {
    let response;
    try {
      response = await fetchFn(request.url, { method: 'POST', headers: request.headers, body: request.body, redirect: 'error', signal: AbortSignal.timeout(8000) });
    } catch { throw new Error(`${request.channel} notification could not be delivered`); }
    if (!response.ok) throw new Error(`${request.channel} notification failed (HTTP ${response.status})`);
    if (request.channel === 'telegram') {
      let result;
      try { result = await response.json(); } catch { throw new Error('Telegram returned an invalid response'); }
      if (result?.ok !== true) throw new Error('Telegram refused the notification');
    }
    results.push(request.channel);
  }
  return results;
}

export async function testNotifications({ root, env, fetchFn }) {
  const view = notificationSettings({ root, env });
  if (!view.installed) throw new Error('Comfort is not enabled in this workspace; run yaw add comfort here first');
  const config = settings(readPersonal(env).config).notify;
  const channels = await deliverNotifications({ payload: buildPayload({ project: root, status: 'done', summary: 'test notification' }), config, env, fetchFn });
  if (!channels.length) throw new Error('No remote channel configured; terminal tests are available through yaw notify test');
  return { message: `Test notification sent via ${channels.join(', ')}.` };
}
