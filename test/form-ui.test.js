import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startFormServer, MAX_JSON_BYTES } from '../core/web/form-server.js';
import { createFormApi, DRAFT, writeLauncher } from '../core/web/init.js';
import { createFormModel, fullFileDiff } from '../core/web/form-model.js';
import { defaultModules, effectiveAnswers, toggleModules, visibleQuestions, installDialogCancellation } from '../core/web/assets/ui-state.js';
import { deriveFacts } from '../core/interview/facts.js';
import { runInterview } from '../core/interview/engine.js';
import { selectModules } from '../core/render/project.js';
import { readManifest } from '../core/render/manifest.js';
import { parse, stringify } from '../core/lib/yaml.js';
import { main } from '../core/cli/main.js';
import { verifyProject } from '../core/cli/init.js';
import { KIT_ROOT, capture, fakeJust, readTree, tmp } from './helpers/fixtures.js';

const setup = (extra = {}) => ({ mode: 'quick', profile: 'node-cli', answers: { 'arch.language': 'javascript', 'arch.runs-on': 'local' }, ...extra });
const fixture = () => {
  const root = tmp('yaw-form-project-'), home = tmp('yaw-form-home-');
  const env = { ...process.env, HOME: home, USERPROFILE: home, YAW_TEST_OFFLINE: '1' };
  return { root, home, env, kitRoot: KIT_ROOT };
};
async function serverFixture(t, extra = {}) {
  const f = fixture();
  const errors = capture();
  const api = createFormApi({ ...f, verify: verifyProject, skipVerify: true, stderr: errors, ...extra });
  const server = await startFormServer({ api, signals: false });
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.port}`;
  const handshake = await fetch(server.url, { redirect: 'manual' });
  const cookie = handshake.headers.get('set-cookie').split(';')[0];
  const html = await (await fetch(origin, { headers: { cookie } })).text();
  const token = html.match(/name="yaw-csrf" content="([a-f0-9]+)"/)[1];
  const headers = { cookie, origin, 'Content-Type': 'application/json', 'X-YAW-Token': token };
  const post = (name, body, changes = {}) => fetch(`${origin}/api/${name}`, {
    method: 'POST', headers: { ...headers, ...changes }, body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { ...f, server, origin, cookie, token, headers, post, api, errors };
}

test('web model: schema catalogue, local help, ownership and phase-3 choices', () => {
  const f = fixture(), m = createFormModel(f), c = m.bootstrap();
  assert.equal(c.questions[0].id, 'user.agents');
  assert.ok(c.questions[0].choices.find((x) => x.value === 'gemini').phase > 1);
  assert.match(c.questions[0].helpText, /agent/i);
  assert.ok(c.questions.some((q) => q.owner === 'team'));
  assert.match(c.agents.copilot.note, /recall/);
  assert.ok(c.profiles.some((p) => p.name === 'node-cli'));
  assert.deepEqual(readdirSync(f.root), []);
  assert.deepEqual(readdirSync(f.home), []);
});

test('workspace: setup exposes authenticated cross-project history and maintenance before initialization', async (t) => {
  const f = await serverFixture(t);
  assert.equal((await fetch(`${f.origin}/api/dashboard`)).status, 403);
  const res = await fetch(`${f.origin}/api/dashboard?days=all`, { headers: { cookie: f.cookie } });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.project.initialized, false);
  assert.equal(data.maintenance.available, false);
  assert.deepEqual(data.sessions, { available: false });
  assert.deepEqual(readdirSync(f.root), []);
  assert.deepEqual(readdirSync(f.home), []);
  assert.equal((await fetch(`${f.origin}/workspace.js`, { headers: { cookie: f.cookie } })).status, 200);
});

test('web model: normalization and browser defaults match the CLI interview', async () => {
  const f = fixture(), m = createFormModel(f), c = m.bootstrap();
  for (const mode of ['quick', 'full', 'standard']) {
    for (const expertise of ['layperson', 'intermediate', 'expert']) {
      const input = setup({ mode, answers: { 'user.expertise': expertise, 'idea.team': 'solo', 'tasks.use-github': false } });
      const normalized = m.normalize(input);
      let current;
      const cli = await runInterview({
        questions: normalized.answerQuestions, mode, kitRoot: KIT_ROOT,
        prompter: {
          show(text) {
            for (const q of normalized.answerQuestions) if (text.includes(q.label)) current = q;
          },
          ask: async () => Object.hasOwn(input.answers, current.id) ? String(input.answers[current.id]) : '',
        },
      });
      assert.deepEqual(normalized.doc.answers, cli.answers, `${mode}/${expertise}`);
      const browser = effectiveAnswers(c.questions.filter((q) => normalized.modules.includes(q.owner) || q.id === 'tasks.use-github'), input.answers, mode);
      assert.deepEqual(browser, normalized.doc.answers);
      assert.deepEqual(defaultModules(c.modules, c.questions, input.answers, mode),
        selectModules({ kitRoot: KIT_ROOT, mode, facts: deriveFacts(effectiveAnswers(c.questions, input.answers, mode)) }));
    }
  }
});

test('web state: toggles add dependencies, cascade removal and immediately hide questions', () => {
  const m = createFormModel(fixture()), c = m.bootstrap();
  const enabled = toggleModules(c.modules, ['core'], 'team', true);
  for (const n of ['core', 'team', 'tasks', 'github', 'git-hooks']) assert.ok(enabled.includes(n));
  const questions = visibleQuestions(c.questions, { 'idea.team': 'team' }, 'full', enabled);
  assert.ok(questions.some((q) => q.owner === 'team'));
  const removed = toggleModules(c.modules, enabled, 'github', false);
  assert.ok(!removed.includes('team') && !removed.includes('github'));
  assert.ok(!visibleQuestions(c.questions, { 'idea.team': 'team' }, 'full', removed).some((q) => q.owner === 'team'));
  assert.throws(() => m.normalize(setup({ modules: ['core', 'team'] })), /depends on/);
  const full = m.preview(setup({ mode: 'full', answers: { 'idea.team': 'team' } }));
  const lay = m.preview(setup({ mode: 'full', answers: { 'idea.team': 'team', 'user.expertise': 'layperson' } }));
  assert.ok(full.visible.length > lay.visible.length);
  const fIds = c.questions.filter((q) => q.mode === 'F').map((q) => q.id);
  assert.ok(lay.visible.every((id) => !fIds.includes(id)));
  assert.ok(lay.defaulted.some((id) => fIds.includes(id)));
});

test('web dialogs: Escape and native cancel close with cancellation, never a stale confirmation', () => {
  for (const previous of ['save', 'apply']) {
    const dialog = new EventTarget();
    dialog.open = true;
    dialog.returnValue = previous;
    let confirmations = 0, closed = 0;
    dialog.close = (value) => {
      dialog.open = false; dialog.returnValue = value; closed++;
      dialog.dispatchEvent(new Event('close'));
    };
    dialog.addEventListener('close', () => {
      if (dialog.returnValue === previous) confirmations++;
    });
    installDialogCancellation(dialog);
    const tab = new Event('keydown', { cancelable: true });
    Object.defineProperty(tab, 'key', { value: 'Tab' });
    dialog.dispatchEvent(tab);
    assert.equal(dialog.open, true); assert.equal(tab.defaultPrevented, false);
    const escape = new Event('keydown', { cancelable: true });
    Object.defineProperty(escape, 'key', { value: 'Escape' });
    dialog.dispatchEvent(escape);
    assert.equal(escape.defaultPrevented, true);
    assert.equal(dialog.open, false); assert.equal(dialog.returnValue, 'cancel');
    assert.equal(confirmations, 0); assert.equal(closed, 1);
    dialog.open = true; dialog.returnValue = previous;
    const cancel = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancel);
    assert.equal(cancel.defaultPrevented, true);
    assert.equal(dialog.open, false); assert.equal(dialog.returnValue, 'cancel');
    assert.equal(confirmations, 0); assert.equal(closed, 2);
  }
});

test('web API: preview and diff are read-only, rendered file list and bytes are real', async (t) => {
  const f = await serverFixture(t);
  const before = readTree(f.root);
  const preview = await (await f.post('preview', setup())).json();
  assert.equal(preview.profile, 'node-cli');
  assert.ok(preview.files.some((x) => x.path === 'AGENTS.md' && x.bytes > 100));
  assert.ok(preview.files.some((x) => x.path === '.yaw/manifest.json'));
  assert.ok(preview.footprint.baseCopies > 0 && preview.footprint.bytes > 1000);
  const diff = await (await f.post('diff', setup())).json();
  assert.match(diff.diff, /--- \/dev\/null\n\+\+\+ b\/AGENTS.md/);
  assert.match(diff.diff, /\+.*Rename|^\+.*YAW/m);
  assert.match(diff.diff, /b\/\.yaw\/answers.yaml/);
  assert.deepEqual(readTree(f.root), before);
  assert.deepEqual(readTree(f.home), {});
  assert.equal((await fetch(`${f.origin}/api/apply`, { headers: { cookie: f.cookie } })).status, 404);
});

test('web API: authenticated assets only; CSP, schema bootstrap and no outside assets', async (t) => {
  const f = await serverFixture(t);
  for (const path of ['/app.js', '/ui-state.js', '/app.css', '/api/bootstrap']) {
    assert.equal((await fetch(f.origin + path)).status, 403);
    const r = await fetch(f.origin + path, { headers: { cookie: f.cookie } });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
    const text = await r.text();
    assert.doesNotMatch(text, /(?:src|href)=["']https?:|fetch\(["']https?:|@import|url\(["']?https?:/);
    const head = await fetch(f.origin + path, { method: 'HEAD', headers: { cookie: f.cookie } });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  }
  assert.equal((await fetch(`${f.origin}/../package.json`, { headers: { cookie: f.cookie } })).status, 404);
});

test('web API: bounded JSON, explicit errors, CSRF and unavailable choices', async (t) => {
  const f = await serverFixture(t);
  assert.equal((await f.post('preview', setup(), { 'X-YAW-Token': '' })).status, 403);
  assert.equal((await f.post('preview', setup(), { origin: 'http://foreign.invalid' })).status, 403);
  assert.equal((await f.post('preview', setup(), { 'Content-Type': 'text/plain' })).status, 415);
  for (const body of ['{', 'null', '[]', '{"mode":"quick","answers":[]}', '{"mode":"unknown"}']) {
    const r = await f.post('preview', body);
    assert.equal(r.status, 400, body);
    assert.equal(typeof (await r.json()).error, 'string');
  }
  const huge = await f.post('preview', JSON.stringify({ mode: 'quick', answers: { 'idea.text': 'a'.repeat(MAX_JSON_BYTES) } }));
  assert.equal(huge.status, 413);
  assert.match((await huge.json()).error, /exceeds/);
  // Explicitly chunked: no Content-Length to trust.
  const chunked = await new Promise((resolve, reject) => {
    const req = http.request(`${f.origin}/api/preview`, { method: 'POST', headers: f.headers }, (res) => {
      let data = ''; res.on('data', (d) => { data += d; }); res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.write('{"mode":"quick","answers":{"idea.text":"');
    req.write('a'.repeat(MAX_JSON_BYTES)); req.end('"}}');
  });
  assert.equal(chunked.status, 413); assert.match(chunked.data, /exceeds/);
  for (const answers of [{ 'user.agents': ['gemini'] }, { 'user.agents': [] }, { 'user.expertise': 'wizard' }, { 'unknown.answer': 'oops' }, { 'idea.text': 3 }]) {
    assert.equal((await f.post('preview', setup({ answers }))).status, 400, JSON.stringify(answers));
  }
  assert.deepEqual(readTree(f.root), {});
});

test('web API: secret-like answers never echo, save, render or apply', async (t) => {
  const f = await serverFixture(t);
  const secret = 'ghp_' + 'a'.repeat(36);
  for (const name of ['preview', 'diff', 'draft', 'preset', 'apply']) {
    const response = await f.post(name, setup({ answers: { 'idea.text': secret }, consent: true }));
    assert.equal(response.status, 400, name);
    const text = await response.text();
    assert.match(text, /secret/i); assert.ok(!text.includes(secret));
  }
  const maliciousKey = await f.post('preview', setup({ answers: { ['user.password-' + secret]: 'value' } }));
  assert.equal(maliciousKey.status, 400);
  assert.ok(!(await maliciousKey.text()).includes(secret));
  assert.deepEqual(readTree(f.root), {});
  assert.deepEqual(readTree(f.home), {});
  assert.ok(!f.errors.text().includes(secret));
});

test('web API: entered secrets go only to a private .env, never answers, logs or responses, and skip recipes', async (t) => {
  let verifyCalls = 0;
  const f = await serverFixture(t, { skipVerify: false, verify: async () => { verifyCalls++; return true; } });
  const canary = 'YAW_SECRET_CANARY_9f3a "quoted" $punctuation';
  writeFileSync(join(f.root, '.env.example'), 'API_KEY=\nDATABASE_URL=\n');
  const response = await f.post('apply', { ...setup(), secrets: { API_KEY: canary } });
  const stream = await response.text();
  assert.equal(response.status, 200);
  assert.doesNotMatch(stream, /YAW_SECRET_CANARY_9f3a|quoted|punctuation/);
  assert.match(stream, /Saved 1 secret value/);
  assert.match(stream, /Verification skipped because new secrets were saved/);
  assert.equal(verifyCalls, 0, 'project-controlled verification recipes were not run');
  const answers = readFileSync(join(f.root, '.yaw/answers.yaml'), 'utf8');
  assert.doesNotMatch(answers, /YAW_SECRET_CANARY_9f3a|quoted|punctuation/);
  assert.equal(readFileSync(join(f.root, '.env'), 'utf8'), `API_KEY=${JSON.stringify(canary)}\nDATABASE_URL=\n`);
  assert.equal(statSync(join(f.root, '.env')).mode & 0o777, 0o600);
  assert.doesNotMatch(f.errors.text(), /YAW_SECRET_CANARY_9f3a|quoted|punctuation/);
  assert.deepEqual(readTree(f.home), {});
});

test('web API: existing .env is never read, overwritten or returned', async (t) => {
  const f = await serverFixture(t);
  const existing = 'API_KEY=EXISTING_TEST_CANARY\n';
  writeFileSync(join(f.root, '.env'), existing, { mode: 0o600 });
  writeFileSync(join(f.root, '.env.example'), 'API_KEY=\n');
  const response = await f.post('apply', { ...setup(), secrets: { API_KEY: 'NEW_TEST_CANARY' } });
  const stream = await response.text();
  assert.equal(response.status, 200);
  assert.match(stream, /Existing \.env was preserved/);
  assert.doesNotMatch(stream, /EXISTING_TEST_CANARY|NEW_TEST_CANARY/);
  assert.equal(readFileSync(join(f.root, '.env'), 'utf8'), existing);
});

test('web API: diff does not echo a secret already in a generated non-secret file', async (t) => {
  const f = await serverFixture(t);
  const secret = 'ghp_' + 'c'.repeat(36);
  writeFileSync(join(f.root, 'AGENTS.md'), `Local instructions\n${secret}\n`);
  const response = await f.post('diff', setup());
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.diff, /Kept unchanged: AGENTS.md/);
  assert.ok(!body.diff.includes(secret));
});

test('web API: diff and file plan match apply keeping conflicting existing outputs', async (t) => {
  const f = await serverFixture(t);
  const existing = { 'AGENTS.md': 'My own agent rules\n', justfile: 'custom:\n    echo original\n' };
  for (const [path, text] of Object.entries(existing)) writeFileSync(join(f.root, path), text);
  const before = readTree(f.root);
  const response = await f.post('diff', setup());
  assert.equal(response.status, 200);
  const preview = await response.json();
  for (const path of Object.keys(existing)) {
    assert.equal(preview.files.find((file) => file.path === path).action, 'kept');
    assert.ok(preview.diff.includes(`Kept unchanged: ${path}`));
    assert.ok(!preview.diff.includes(`+++ b/${path}\n`));
  }
  assert.ok(!preview.diff.includes('-My own agent rules'));
  assert.ok(!preview.diff.includes('-custom:'));
  assert.match(preview.diff, /\+\+\+ b\/\.yaw\/answers.yaml/);
  assert.deepEqual(readTree(f.root), before);
  const applied = await f.post('apply', setup());
  assert.match(await applied.text(), /"ok":true/);
  for (const [path, text] of Object.entries(existing)) assert.equal(readFileSync(join(f.root, path), 'utf8'), text);
});

test('web API: draft is an explicit private save, can resume, and does not initialize', async (t) => {
  const f = await serverFixture(t);
  const response = await f.post('draft', setup({ answers: { 'idea.text': 'A small tool' } }));
  assert.equal(response.status, 200);
  assert.match((await response.json()).message, /Draft saved/);
  assert.deepEqual(Object.keys(readTree(f.root)), [DRAFT]);
  assert.equal(statSync(join(f.root, DRAFT)).mode & 0o777, 0o600);
  assert.equal(readManifest(f.root), null);
  const resumed = await (await f.post('prefill', { kind: 'draft' })).json();
  assert.equal(resumed.answers['idea.text'], 'A small tool');
  assert.equal(resumed.profile, 'node-cli');
  assert.deepEqual(readTree(f.home), {});
  assert.equal((await f.post('apply', resumed)).status, 200);
  assert.ok(readManifest(f.root));
});

test('web API: preset/profile prefill stays editable, saves require consent each time', async (t) => {
  const f = await serverFixture(t);
  const input = setup({ answers: { 'user.language': 'en', 'idea.text': 'Original idea' } });
  assert.equal((await f.post('preset', input)).status, 400);
  assert.deepEqual(readTree(f.home), {});
  const saved = await f.post('preset', { ...input, consent: true, saveProfile: true });
  assert.equal(saved.status, 200);
  const files = Object.keys(readTree(f.home));
  const presetPath = files.find((p) => p.startsWith('.yaw/presets/'));
  const name = presetPath.split('/').pop().replace('.yaml', '');
  assert.ok(files.includes('.yaw/user-profile.yaml') && files.includes('.yaw/history.jsonl'));
  for (const path of files) assert.equal(statSync(join(f.home, path)).mode & 0o777, 0o600);
  const preset = await (await f.post('prefill', { kind: 'preset', name })).json();
  assert.equal(preset.answers['idea.text'], 'Original idea');
  assert.ok(!Object.hasOwn(preset, 'consent'));
  preset.profile = 'node-cli'; preset.answers['idea.text'] = 'Edited idea';
  assert.equal((await (await f.post('preview', preset)).json()).answers['idea.text'], 'Edited idea');
  const profile = await (await f.post('prefill', { kind: 'profile' })).json();
  assert.equal(profile.answers['user.language'], 'en');
  assert.ok(!Object.hasOwn(profile.answers, 'idea.text'));
  const snapshot = readTree(f.home);
  assert.equal((await f.post('preset', input)).status, 400);
  await f.post('preview', input);
  assert.deepEqual(readTree(f.home), snapshot);
  assert.equal((await f.post('prefill', { kind: 'preset', name: '../outside' })).status, 400);
});

test('web API: preset roundtrip preserves GitHub opt-out after its module is removed', async (t) => {
  const f = await serverFixture(t);
  const input = setup({ mode: 'full', answers: { 'idea.team': 'solo', 'tasks.use-github': false } });
  const first = await (await f.post('preview', input)).json();
  assert.equal(first.answers['tasks.use-github'], false);
  assert.ok(!first.modules.includes('github') && !first.modules.includes('ci'));
  assert.ok(first.visible.includes('tasks.use-github'), 'GitHub selection belongs to tasks and stays available after opting out');
  assert.equal((await f.post('preset', { ...input, consent: true })).status, 200);
  const presets = readdirSync(join(f.home, '.yaw', 'presets'));
  const saved = parse(readFileSync(join(f.home, '.yaw', 'presets', presets[0]), 'utf8'));
  assert.equal(saved.answers['tasks.use-github'], false);
  const resumed = await (await f.post('prefill', { kind: 'preset', name: presets[0].replace('.yaml', '') })).json();
  assert.equal(resumed.answers['tasks.use-github'], false);
  const restored = await (await f.post('preview', { ...resumed, profile: 'node-cli' })).json();
  assert.equal(restored.answers['tasks.use-github'], false);
  assert.ok(!restored.modules.includes('github') && !restored.modules.includes('ci'));
  const catalog = f.api.bootstrap();
  assert.ok(!defaultModules(catalog.modules, catalog.questions, resumed.answers, resumed.mode).includes('github'));
  assert.equal((await f.post('draft', { ...resumed, profile: 'node-cli' })).status, 200);
  assert.equal(parse(readFileSync(join(f.root, DRAFT), 'utf8')).answers['tasks.use-github'], false);
  const applied = await f.post('apply', { ...resumed, profile: 'node-cli' });
  assert.match(await applied.text(), /"ok":true/);
  assert.equal(parse(readFileSync(join(f.root, '.yaw', 'answers.yaml'), 'utf8')).answers['tasks.use-github'], false);
  assert.ok(!Object.hasOwn(readManifest(f.root).modules, 'github'));
  assert.ok(!Object.hasOwn(readManifest(f.root).modules, 'ci'));
});

test('web API: a secret in a saved preset or profile is not returned', async (t) => {
  const f = await serverFixture(t);
  const secret = 'ghp_' + 'b'.repeat(36);
  mkdirSync(join(f.home, '.yaw', 'presets'), { recursive: true });
  writeFileSync(join(f.home, '.yaw', 'presets', 'unsafe.yaml'), stringify({
    name: 'unsafe', mode: 'quick', answers: { 'idea.text': secret },
  }));
  const response = await f.post('prefill', { kind: 'preset', name: 'unsafe' });
  assert.equal(response.status, 400);
  assert.ok(!(await response.text()).includes(secret));
  writeFileSync(join(f.home, '.yaw', 'user-profile.yaml'), stringify({ answers: { 'user.language': secret } }));
  const profile = await f.post('prefill', { kind: 'profile' });
  assert.equal(profile.status, 400); assert.ok(!(await profile.text()).includes(secret));
});

test('web API: invalid saved preferences give explicit errors and remain untouched', async (t) => {
  const f = await serverFixture(t);
  mkdirSync(join(f.home, '.yaw', 'presets'), { recursive: true });
  writeFileSync(join(f.home, '.yaw', 'presets', 'broken.yaml'), 'answers: [\n');
  const preset = await f.post('prefill', { kind: 'preset', name: 'broken' });
  assert.equal(preset.status, 400);
  assert.match((await preset.json()).error, /unreadable or invalid/);
  writeFileSync(join(f.home, '.yaw', 'user-profile.yaml'), 'answers: [\n');
  const profile = await f.post('prefill', { kind: 'profile' });
  assert.equal(profile.status, 400);
  assert.match((await profile.json()).error, /unreadable or invalid/);
  const snapshot = readTree(f.home);
  const save = await f.post('preset', { ...setup(), consent: true, saveProfile: true });
  assert.equal(save.status, 400);
  assert.match((await save.json()).error, /nothing was saved/);
  assert.deepEqual(readTree(f.home), snapshot);
  assert.equal((await fetch(`${f.origin}/api/bootstrap`, { headers: { cookie: f.cookie } })).status, 200);
});

test('web API: apply streams logs, runs CLI verification, closes only after delivery', async (t) => {
  let verifyCalls = 0, release, reached;
  const wait = new Promise((r) => { release = r; });
  const entered = new Promise((r) => { reached = r; });
  const f = await serverFixture(t, {
    skipVerify: false,
    verify: async ({ root, io }) => {
      verifyCalls++; assert.equal(root, f.root);
      io.stdout.write('VERIFY START\n'); reached(); await wait; io.stdout.write('VERIFY END\n'); return true;
    },
  });
  const response = await f.post('apply', setup());
  assert.equal(response.headers.get('content-type'), 'application/x-ndjson; charset=utf-8');
  await entered;
  const reader = response.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /Applying|VERIFY START/);
  assert.ok(f.server.server.listening);
  assert.equal((await f.post('apply', setup())).status, 409);
  assert.equal((await f.post('draft', setup())).status, 409);
  assert.equal((await f.post('preset', { ...setup(), consent: true })).status, 409);
  const closed = new Promise((r) => f.server.server.once('close', r));
  release();
  let rest = '';
  for (;;) { const r = await reader.read(); if (r.done) break; rest += new TextDecoder().decode(r.value); }
  assert.match(rest, /VERIFY END/);
  const events = (first + rest).trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(events.at(-1), { type: 'done', ok: true, message: 'Applied and verified.' });
  assert.equal(verifyCalls, 1);
  await closed;
  assert.equal(f.server.server.listening, false);
  assert.ok(readManifest(f.root));
  assert.equal(parse(readFileSync(join(f.root, '.yaw/answers.yaml'), 'utf8')).proposal.profiles[0], 'node-cli');
  assert.deepEqual(readTree(f.home), {});
});

test('web API: failed verification reports files written, not success', async (t) => {
  const f = await serverFixture(t, { skipVerify: false, verify: async ({ io }) => { io.stderr.write('CHECK FAILED\n'); return false; } });
  const events = (await (await f.post('apply', setup())).text()).trim().split('\n').map(JSON.parse);
  assert.equal(events.at(-1).ok, false);
  assert.match(events.at(-1).message, /verification failed/);
  assert.ok(readManifest(f.root));
});

test('web diff: existing content, no change and missing final newline', () => {
  assert.equal(fullFileDiff('x', 'same\n', 'same\n'), '');
  assert.match(fullFileDiff('x', 'old', 'new\n'), /-old\n\\ No newline at end of file\n\+new/);
  assert.match(fullFileDiff('x', '', 'new\n'), /@@ -0,0 \+1,1 @@/);
});

test('CLI: --web works without a terminal, skip-verify is explicit, no user saves', async () => {
  const f = fixture(), stdout = capture(), stderr = capture();
  let opened = false, browserWork;
  const done = main(['init', '--web', '--skip-verify'], {
    ...f, cwd: f.root, stdout, stderr, prompter: { interactive: false },
    openBrowser(url) {
      opened = true;
      browserWork = (async () => {
        const handshake = await fetch(url, { redirect: 'manual' });
        const cookie = handshake.headers.get('set-cookie').split(';')[0], origin = new URL(url).origin;
        const html = await (await fetch(origin, { headers: { cookie } })).text();
        const token = html.match(/name="yaw-csrf" content="([a-f0-9]+)"/)[1];
        assert.deepEqual(readTree(f.root), {});
        const response = await fetch(`${origin}/api/apply`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json', 'X-YAW-Token': token }, body: JSON.stringify(setup()) });
        const log = await response.text();
        assert.match(log, /Verification explicitly skipped/);
        assert.match(log, /"ok":true/);
      })();
      return true;
    },
  });
  assert.equal(await done, 0); await browserWork;
  assert.ok(opened); assert.equal(stderr.text(), '');
  assert.match(stdout.text(), /one-time link/);
  assert.ok(readManifest(f.root)); assert.deepEqual(readTree(f.home), {});
});

test('CLI: --web verifies via just setup and just check; invalid combinations fail', async () => {
  const f = fixture(), stdout = capture(), stderr = capture();
  const bin = tmp('yaw-form-bin-'), log = fakeJust(bin);
  f.env.PATH = `${bin}:${process.env.PATH}`;
  let browserWork;
  const code = await main(['init', '--web'], {
    ...f, cwd: f.root, stdout, stderr, prompter: { interactive: false },
    openBrowser(url) {
      browserWork = (async () => {
        const r = await fetch(url, { redirect: 'manual' }), cookie = r.headers.get('set-cookie').split(';')[0], origin = new URL(url).origin;
        const page = await (await fetch(origin, { headers: { cookie } })).text();
        const token = page.match(/name="yaw-csrf" content="([a-f0-9]+)"/)[1];
        const applied = await fetch(`${origin}/api/apply`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json', 'X-YAW-Token': token }, body: JSON.stringify(setup()) });
        assert.match(await applied.text(), /Applied and verified/);
      })();
      return true;
    },
  });
  await browserWork;
  assert.equal(code, 0);
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), [`${realpathSync(f.root)} setup`, `${realpathSync(f.root)} check`]);
  for (const args of [['--web', '--answers', 'answers.yaml'], ['--web', '--yes']]) {
    const err = capture();
    assert.equal(await main(['init', ...args], { cwd: f.root, stdout: capture(), stderr: err, prompter: { interactive: false } }), 1);
    assert.match(err.text(), /cannot be combined/);
  }
  const err = capture();
  assert.equal(await main(['init', '--web'], { cwd: f.root, stdout: capture(), stderr: err, prompter: { interactive: false } }), 1);
  assert.match(err.text(), /already exists/);
});

test('launcher: the start token reaches the browser through a private file, never argv (Y-7.7)', () => {
  const url = 'http://127.0.0.1:4321/?t=abc123';
  const l = writeLauncher(url);
  assert.ok(!l.file.includes('abc123'), 'the path given to open/xdg-open carries no token');
  assert.equal(statSync(l.file).mode & 0o777, 0o600);
  assert.equal(statSync(join(l.file, '..')).mode & 0o777, 0o700);
  assert.match(readFileSync(l.file, 'utf8'), /http-equiv="refresh" content="0;url=http:\/\/127\.0\.0\.1:4321\/\?t=abc123"/);
  const hostile = writeLauncher('http://x/?t=1"><script>');
  assert.match(readFileSync(hostile.file, 'utf8'), /content="0;url=http:\/\/x\/\?t=1script">/, 'quotes and tags cannot break out');
  hostile.remove();
  l.remove();
  assert.throws(() => statSync(l.file));
});
