import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { createFormApi } from '../core/web/init.js';
import { startFormServer } from '../core/web/form-server.js';
import { main } from '../core/cli/main.js';
import { KIT_ROOT, capture, tmp } from './helpers/fixtures.js';

const fixture = () => {
  const root = tmp('yaw-setup-api-'), home = tmp('yaw-setup-home-');
  return { root, kitRoot: KIT_ROOT, env: { ...process.env, HOME: home, USERPROFILE: home, YAW_HOME: home, YAW_TEST_OFFLINE: '1' } };
};
const setup = { mode: 'pro', answers: { 'idea.text': 'An offline reading tracker for one person.', 'arch.language': 'javascript', 'arch.runs-on': 'local', 'tasks.use-github': false } };

test('setup prompts share validated answers and update without a reply/import cycle', async () => {
  const f = fixture(), api = createFormApi({ ...f, skipVerify: true });
  try {
    const partial = await api.action('setup-prompts', { mode: 'quick', answers: {} });
    assert.equal(partial.kickoff, ''); assert.match(partial.kickoffStatus, /Complete essential/);
    const first = await api.action('setup-prompts', setup);
    assert.match(first.interview, /offline reading tracker/);
    assert.match(first.interview, /one targeted question at a time/);
    assert.match(first.interview, /Architecture and Your Workflow/);
    assert.match(first.interview, /arch.language/);
    assert.match(first.interview, /Available modules/);
    for (const path of ['architecture.md', 'data-model.md', 'ui-ux.md']) assert.ok(first.kickoff.includes(path));
    assert.doesNotMatch(first.kickoff, /undefined|kickoff-format|Reply/);
    const next = await api.action('setup-prompts', { ...setup, answers: { ...setup.answers, 'idea.text': 'A shared library catalogue.', 'arch.framework': 'Express' } });
    assert.match(next.kickoff, /shared library catalogue/); assert.match(next.kickoff, /Express/);
    assert.doesNotMatch(next.kickoff, /offline reading tracker/);
    await assert.rejects(api.action('setup-prompts', { ...setup, answers: { 'arch.language': 'invalid' } }), /Invalid answer/);
    assert.deepEqual(readdirSync(f.root), []);
    assert.deepEqual(readdirSync(f.env.HOME), []);
  } finally { api.close(); }
});

test('setup REST state is authenticated, validated, revisioned and read-only until Apply', async (t) => {
  const f = fixture(), api = createFormApi({ ...f, skipVerify: true });
  const server = await startFormServer({ api, signals: false }); t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.port}`;
  assert.equal((await fetch(`${origin}/api/setup`)).status, 403);
  const login = await fetch(server.url, { redirect: 'manual' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const html = await (await fetch(origin, { headers: { cookie } })).text();
  const csrf = html.match(/name="yaw-csrf" content="([a-f0-9]+)"/)[1];
  const headers = { cookie, 'content-type': 'application/json', 'x-yaw-token': csrf };
  const post = (name, data, override = {}) => fetch(`${origin}/api/${name}`, { method: 'POST', headers: { ...headers, ...override }, body: JSON.stringify(data) });
  const read = () => fetch(`${origin}/api/setup`, { headers: { cookie } }).then((r) => r.json());
  assert.equal((await read()).revision, 0);
  assert.equal((await post('setup-update', { revision: 0, setup }, { 'x-yaw-token': '' })).status, 403);
  assert.equal((await post('setup-update', { revision: 0, setup: { ...setup, answers: { 'arch.language': 'invalid' } } })).status, 400);
  assert.equal((await read()).revision, 0);
  const updated = await (await post('setup-update', { revision: 0, setup })).json();
  assert.equal(updated.revision, 1);
  assert.equal(updated.setup.answers['idea.text'], setup.answers['idea.text']);
  assert.equal((await post('setup-update', { revision: 0, setup })).status, 409);
  const bootstrap = await (await fetch(`${origin}/api/bootstrap`, { headers: { cookie } })).json();
  assert.deepEqual(bootstrap.handoff, updated.setup);
  const preview = await (await post('preview', updated.setup)).json();
  assert.ok(preview.files.some((f) => f.path === 'AGENTS.md'));
  assert.deepEqual(readdirSync(f.root), []);
  const partial = await post('setup-update', { revision: 1, setup: { mode: 'quick', answers: {} } });
  assert.equal(partial.status, 200);
  assert.equal((await post('apply', (await partial.json()).setup)).status, 400);
  assert.deepEqual(readdirSync(f.root), []);
  const response = await post('apply', updated.setup);
  assert.equal(response.status, 200);
  const events = (await response.text()).trim().split('\n').map(JSON.parse);
  assert.equal(events.find((e) => e.type === 'done').ok, true);
  assert.ok(readdirSync(f.root).includes('AGENTS.md'));
});

test('CLI rejects conflicting API modes before launching a server', async () => {
  for (const args of [['--api', '--web'], ['--api', '--answers', 'answers.yaml'], ['--api', '--yes']]) {
    const f = fixture(), stdout = capture(), stderr = capture();
    const code = await main(['init', ...args], { cwd: f.root, kitRoot: KIT_ROOT, env: f.env, stdout, stderr, prompter: { interactive: false } });
    assert.notEqual(code, 0); assert.deepEqual(readdirSync(f.root), []);
  }
});

test('CLI API mode completes setup without opening a browser or terminal interview', { timeout: 10000 }, async () => {
  const f = fixture(), output = capture(), stderr = capture();
  let ready;
  const loginLink = new Promise((resolve) => { ready = resolve; });
  const stdout = { write(text) {
    output.write(text);
    const match = String(text).match(/http:\/\/127\.0\.0\.1:\d+\/\?t=[a-f0-9]+/);
    if (match) ready(match[0]);
    return true;
  } };
  const running = main(['init', '--api', '--skip-verify'], { cwd: f.root, kitRoot: KIT_ROOT, env: f.env, stdout, stderr,
    prompter: { interactive: false }, openBrowser() { throw new Error('API mode must not open a browser'); } });
  const link = await loginLink, origin = new URL(link).origin;
  const login = await fetch(link, { redirect: 'manual' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const html = await (await fetch(origin, { headers: { cookie } })).text();
  const token = html.match(/name="yaw-csrf" content="([a-f0-9]+)"/)[1];
  const response = await fetch(`${origin}/api/apply`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', 'x-yaw-token': token }, body: JSON.stringify(setup) });
  const events = (await response.text()).trim().split('\n').map(JSON.parse);
  assert.equal(events.find((e) => e.type === 'done').ok, true);
  assert.equal(await running, 0);
  assert.match(output.text(), /Agent API:/);
  assert.equal(stderr.text(), '');
});
