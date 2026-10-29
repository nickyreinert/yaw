import { fork } from 'node:child_process';
import { remoteSettings } from '../lib/remote-settings.js';
import { readUserData } from '../lib/user-store.js';
import { lanFetch } from './lan.js';
import { digest, requireValue } from './store.js';

export async function backgroundControl(env, action = 'status') {
  const runtime = readUserData(env, 'server-runtime.json'); if (!runtime) return null;
  try {
    const response = await lanFetch(`${runtime.address}/api/background-${action}`, { method: action === 'stop' ? 'POST' : 'GET', headers: { authorization: `Bearer ${runtime.token}`, ...(action === 'stop' ? { 'content-type': 'application/json' } : {}) },
      ...(action === 'stop' ? { body: '{}' } : {}), signal: AbortSignal.timeout(5000) });
    requireValue(response.ok, 'Existing server refused local control; it was not replaced', response.status); return await response.json();
  } catch (e) { if (e.status === 503) return null; throw e; }
}
export async function startServerBackground({ env, kitRoot, cwd }) {
  const settings = remoteSettings(env);
  requireValue(settings.enabled && settings.role, 'Enable Server mode and choose Host or Client');
  let existing = await backgroundControl(env);
  if (existing && existing.fingerprint !== digest(JSON.stringify(settings))) {
    await backgroundControl(env, 'stop');
    for (let n = 0; n < 50 && existing; n++) { await new Promise((resolve) => setTimeout(resolve, 100)); existing = await backgroundControl(env); }
  }
  if (existing) {
    requireValue(existing.fingerprint === digest(JSON.stringify(settings)), 'Previous server is stopping for changed settings; retry shortly', 409);
    return existing;
  }
  const child = fork(new URL('./server-worker.js', import.meta.url), [], { cwd, env, detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: [] });
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { if (child.connected) child.disconnect(); reject(new Error('Server startup timed out')); }, 15000);
    const finish = (error, value) => { clearTimeout(timer); error ? reject(error) : resolve(value); };
    child.once('error', (e) => finish(e));
    child.once('exit', () => finish(new Error('Server exited before readiness; inspect host configuration')));
    child.once('message', (value) => finish(value.error ? new Error(value.error) : null, value));
    child.send({ kitRoot });
  });
  child.disconnect(); child.unref(); return result;
}
