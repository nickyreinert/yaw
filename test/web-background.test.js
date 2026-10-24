import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../core/cli/main.js';
import { stateFile, writeBackgroundLauncher, writeState } from '../core/web/background.js';
import { startFormServer } from '../core/web/form-server.js';
import { KIT_ROOT, capture, tmp } from './helpers/fixtures.js';
import { makeProject } from './helpers/hooks.js';

test('background web persists, reopens with a new link, and stops without signalling arbitrary PIDs', async () => {
  const root = await makeProject({ modules: ['core'] });
  const env = { ...process.env, HOME: tmp('yaw-web-home-') };
  const stderr = capture();
  let url;
  const io = { cwd: root, env, kitRoot: KIT_ROOT, stdout: capture(), stderr, openBrowser: async (u) => { url = u; return true; } };
  try {
    assert.equal(await main(['web', '--background'], io), 0, stderr.text());
    const original = url;
    const response = await fetch(url, { redirect: 'manual' });
    assert.equal(response.status, 303);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    const file = stateFile(root, env);
    assert.equal(lstatSync(file).mode & 0o777, 0o600);
    assert.equal(lstatSync(join(env.HOME, '.yaw/web')).mode & 0o777, 0o700);
    assert.equal(await main(['web'], io), 0, stderr.text());
    assert.notEqual(url, original);
    assert.equal(new URL(url).port, new URL(original).port);
    assert.equal((await fetch(url, { redirect: 'manual' })).status, 303);
    assert.equal((await fetch(new URL('/', original), { headers: { cookie } })).status, 200, 'reopening does not invalidate existing tabs');
    const launcher = writeBackgroundLauncher({ root, env, url });
    assert.equal(lstatSync(launcher).mode & 0o777, 0o600);
    assert.equal(await main(['web', '--stop'], io), 0, stderr.text());
    for (let n = 0; n < 100 && existsSync(file); n++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(existsSync(file), false);
    assert.equal(existsSync(launcher), false);
    assert.equal(await main(['web', '--stop'], io), 0);
    assert.match(io.stdout.text(), /No background web server/);
  } finally {
    await main(['web', '--stop'], io);
  }
});

test('background web also serves setup in an empty folder; mutually exclusive flags are rejected', async () => {
  const root = tmp('yaw-web-project-');
  const env = { ...process.env, HOME: tmp('yaw-web-home-') };
  let url;
  const stderr = capture();
  const io = { cwd: root, env, kitRoot: KIT_ROOT, stdout: capture(), stderr, openBrowser: async (u) => { url = u; return true; } };
  try {
    assert.equal(await main(['web', '--background', '--stop'], io), 1);
    assert.match(stderr.text(), /use either/);
    assert.equal(await main(['web', '--background'], io), 0, stderr.text());
    const response = await fetch(url, { redirect: 'manual' });
    const cookie = response.headers.get('set-cookie').split(';')[0];
    const page = await (await fetch(new URL('/', url), { headers: { cookie } })).text();
    assert.match(page, /<title>YAW setup/);
  } finally {
    assert.equal(await main(['web', '--stop'], io), 0);
  }
});

test('background state and launcher refuse symlinks and never overwrite the target', async () => {
  const root = tmp('yaw-web-project-');
  const env = { HOME: tmp('yaw-web-home-') };
  const file = stateFile(root, env, true);
  const target = join(env.HOME, 'untouched');
  writeFileSync(target, 'untouched');
  symlinkSync(target, file);
  const stderr = capture();
  const io = { cwd: root, env, kitRoot: KIT_ROOT, stdout: capture(), stderr };
  assert.equal(await main(['web', '--stop'], io), 1);
  assert.match(stderr.text(), /ELOOP|symbolic link/);
  symlinkSync(target, `${file}.html`);
  assert.throws(() => writeBackgroundLauncher({ root, env, url: `http://127.0.0.1:12345/?t=${'a'.repeat(64)}` }), /ELOOP|symbolic link/);
  assert.equal(readFileSync(target, 'utf8'), 'untouched');
});

test('the managed server survives the CLI process exiting', async () => {
  const root = await makeProject({ modules: ['core'] });
  const env = { ...process.env, HOME: tmp('yaw-web-home-') };
  const entry = new URL('../core/cli/main.js', import.meta.url).href;
  const code = `import { main } from ${JSON.stringify(entry)}; process.exitCode = await main(['web', '--background'], { openBrowser: async () => true });`;
  const io = { cwd: root, env, kitRoot: KIT_ROOT, stdout: capture(), stderr: capture(), openBrowser: async () => true };
  try {
    const parent = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: root, env, timeout: 20000, stdio: 'pipe' });
    assert.equal(parent.error, undefined);
    assert.equal(parent.status, 0, parent.stderr.toString());
    assert.equal(await main(['web'], io), 0, io.stderr.text());
    assert.match(io.stdout.text(), /running in the background/);
  } finally {
    await main(['web', '--stop'], io);
  }
});

test('stale state is reported and removed, but a refused control request preserves a live server', async () => {
  const root = tmp('yaw-web-project-');
  const env = { HOME: tmp('yaw-web-home-') };
  const file = stateFile(root, env, true);
  const server = await startFormServer({ signals: false, controlToken: 'different-secret' });
  const io = { cwd: root, env, kitRoot: KIT_ROOT, stdout: capture(), stderr: capture() };
  writeState(file, { port: server.port, controlToken: 'a'.repeat(64) });
  try {
    assert.equal(await main(['web', '--stop'], io), 1);
    assert.match(io.stderr.text(), /refused stop \(403\)/);
    assert.equal(existsSync(file), true);
    assert.equal(server.server.listening, true);
  } finally {
    await server.close();
  }
  assert.equal(await main(['web', '--stop'], io), 0);
  assert.match(io.stdout.text(), /Removed stale background web state/);
  assert.equal(existsSync(file), false);
});

test('background setup changes to a dashboard on the same port after Apply', async () => {
  const root = tmp('yaw-web-project-');
  const env = { HOME: tmp('yaw-web-home-'), PATH: '/nonexistent' };
  let url;
  const io = { cwd: root, env, kitRoot: KIT_ROOT, stdout: capture(), stderr: capture(), openBrowser: async (u) => { url = u; return true; } };
  try {
    assert.equal(await main(['web', '--background'], io), 0, io.stderr.text());
    const original = url;
    const login = await fetch(url, { redirect: 'manual' });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const html = await (await fetch(new URL('/', url), { headers: { cookie } })).text();
    const csrf = html.match(/name="yaw-csrf" content="([a-f0-9]+)"/)[1];
    const response = await fetch(new URL('/api/apply', url), {
      method: 'POST',
      headers: { cookie, 'x-yaw-token': csrf, 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'quick', answers: { 'idea.text': 'Example tool.' }, profile: 'node-cli', modules: ['core'] }),
    });
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(response.status, 200, JSON.stringify(events));
    assert.equal(events.at(-1).type, 'done');
    // Wait for the private state to reflect the new listener before reopening.
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(await main(['web'], io), 0, io.stderr.text());
    assert.equal(new URL(url).port, new URL(original).port);
    const dashboardLogin = await fetch(url, { redirect: 'manual' });
    const dashboardCookie = dashboardLogin.headers.get('set-cookie').split(';')[0];
    const dashboard = await (await fetch(new URL('/', url), { headers: { cookie: dashboardCookie } })).text();
    assert.match(dashboard, /<title>YAW dashboard/);
  } finally {
    await main(['web', '--stop'], io);
  }
});
