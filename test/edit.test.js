import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../core/cli/main.js';
import { collectQuestions } from '../core/render/kit.js';
import { editProject, readAnswers, requireManifest } from '../core/render/project.js';
import { createFormApi } from '../core/web/init.js';
import { createFormModel } from '../core/web/form-model.js';
import { startFormServer } from '../core/web/form-server.js';
import { KIT_ROOT, capture, readTree, scripted, tmp } from './helpers/fixtures.js';
import { makeProject } from './helpers/hooks.js';

const env = () => ({ HOME: tmp('yaw-edit-home-'), PATH: process.env.PATH });
const ioFor = (root, prompter = scripted()) => ({ cwd: root, env: env(), kitRoot: KIT_ROOT, stdout: capture(), stderr: capture(), prompter });
const modelFor = (root, sections = []) => createFormModel({ root, kitRoot: KIT_ROOT, env: env(), edit: true, sections });

function interview(replies = {}, confirm = 'y') {
  const p = scripted();
  const questions = collectQuestions(KIT_ROOT, ['core', 'comfort']);
  p.ask = async (prompt) => {
    p.asked.push(prompt);
    if (prompt.startsWith('Review in the')) return 't';
    if (prompt.startsWith('Setup depth')) return '';
    if (prompt === 'Apply these setup changes? [y/N] ') return confirm;
    if (prompt.includes('Apply these setup changes?')) return confirm;
    const label = p.shown.join('').split('\n').filter((l) => /^  \d+\/\d+ /.test(l)).at(-1)?.replace(/^  \d+\/\d+ /, '');
    const question = questions.find((q) => q.label === label);
    assert.ok(question, `unexpected prompt: ${prompt}`);
    return replies[question.id] ?? '';
  };
  return p;
}

test('apply and update use the same rendering workflow and conflict options', async () => {
  const root = await makeProject({ modules: ['core'] });
  const io = ioFor(root);
  assert.equal(await main(['apply', '--yes'], io), 0, io.stderr.text());
  const applied = readTree(root);
  assert.equal(await main(['update', '--yes'], io), 0, io.stderr.text());
  assert.deepEqual(readTree(root), applied);
  assert.match(io.stdout.text(), /yaw apply \(kit/);
  assert.equal(await main(['apply', '--strategy', 'invalid'], io), 1);
});

test('section editing previews without writes, preserves unrelated answers and edited files, then updates manifest agents', async () => {
  const root = await makeProject({ modules: ['core'] });
  appendFileSync(join(root, 'AGENTS.md'), '\nMy local instructions.\n');
  const model = modelFor(root, ['user']);
  const before = readTree(root);
  const input = { ...model.initial, answers: { ...model.initial.answers, 'user.agents': ['claude'] } };
  assert.throws(() => model.normalize({ ...input, answers: { ...input.answers, 'idea.text': 'Must not change' } }), /outside the selected/);
  const preview = model.preview(input, true);
  assert.deepEqual(readTree(root), before);
  assert.equal(preview.answers['idea.text'], readAnswers(root).answers['idea.text']);
  assert.equal(preview.files.find((f) => f.path === 'AGENTS.md').action, 'kept');
  const prepared = model.normalize(input);
  await editProject({ root, kitRoot: KIT_ROOT, answers: prepared });
  assert.deepEqual(requireManifest(root).agents, ['claude']);
  assert.equal(readTree(root)['AGENTS.md'], before['AGENTS.md']);
  assert.equal(readAnswers(root).answers['idea.text'], 'A tiny command-line tool.');
});

test('edit rejects unknown selectors, invalid settings and stale editors without writing', async () => {
  const root = await makeProject({ modules: ['core'] });
  const before = readTree(root);
  assert.throws(() => modelFor(root, ['not-a-section']), /Unknown interview section/);
  const model = modelFor(root, ['user.language']);
  assert.throws(() => model.normalize({ ...model.initial, mode: 'full' }), /Section editing cannot change/);
  assert.throws(() => model.normalize({ ...model.initial, answers: { 'user.language': 1 } }), /Invalid answer/);
  assert.deepEqual(readTree(root), before);
  appendFileSync(join(root, '.yaw/answers.yaml'), '\n# concurrent edit\n');
  assert.throws(() => model.normalize(model.initial), /changed since this editor opened/);
});

test('edit CLI reviews a question with saved defaults and cancellation writes nothing', async () => {
  const root = await makeProject({ modules: ['core'] });
  const before = readTree(root);
  const cancel = ioFor(root, interview({ 'idea.text': 'Updated idea.' }, 'n'));
  assert.equal(await main(['edit', 'idea.text', '--skip-verify'], cancel), 1, cancel.stderr.text());
  assert.deepEqual(readTree(root), before);
  const io = ioFor(root, interview({ 'idea.text': 'Updated idea.' }));
  assert.equal(await main(['edit', 'idea.text', '--skip-verify'], io), 0, io.stderr.text());
  assert.equal(readAnswers(root).answers['idea.text'], 'Updated idea.');
  assert.deepEqual(readAnswers(root).answers['user.agents'], ['claude', 'codex', 'copilot']);
  assert.equal(io.prompter.asked.filter((q) => q.includes('(? help, skip)')).length, 1);
});

test('edit without selectors reruns the interview and lists sections without prompting', async () => {
  const root = await makeProject({ modules: ['core'] });
  const io = ioFor(root, interview());
  assert.equal(await main(['edit', '--skip-verify'], io), 0, io.stderr.text());
  assert.ok(io.prompter.asked.some((q) => q.startsWith('Setup depth')));
  assert.match(io.stdout.text(), /stack: node-cli/);
  assert.equal(await main(['edit', '--list'], ioFor(root)), 0);
  assert.equal(await main(['edit'], { ...ioFor(root), prompter: { interactive: false } }), 1);
});

test('explicit question editing asks beyond the saved Quick depth without changing it', async () => {
  const root = await makeProject({ modules: ['core', 'comfort'] });
  const question = collectQuestions(KIT_ROOT, ['core', 'comfort']).find((q) => q.mode !== 'Q' && !q.when);
  assert.ok(question);
  const p = interview();
  const io = ioFor(root, p);
  assert.equal(await main(['edit', question.id, '--skip-verify'], io), 0, io.stderr.text());
  assert.equal(p.asked.filter((q) => q.includes('(? help, skip)')).length, 1);
  assert.equal(readAnswers(root).mode, 'quick');
  assert.deepEqual(requireManifest(root).modules.core.enabled, true);
});

test('edit refuses secret-like saved answers before showing them', async () => {
  const root = await makeProject({ modules: ['core'] });
  const canary = 'ghp_' + 'X'.repeat(36);
  const text = readTree(root)['.yaw/answers.yaml'].replace('A tiny command-line tool.', canary);
  writeFileSync(join(root, '.yaw/answers.yaml'), text);
  const io = ioFor(root);
  assert.equal(await main(['edit', '--list'], io), 1);
  assert.doesNotMatch(io.stdout.text() + io.stderr.text(), new RegExp(canary));
  assert.match(io.stderr.text(), /looks like a secret/);
});

test('browser edit is prefilled, enforces section boundaries and applies through authenticated API', async () => {
  const root = await makeProject({ modules: ['core'] });
  const api = createFormApi({ root, kitRoot: KIT_ROOT, env: env(), edit: true, sections: ['idea.text'], skipVerify: true, verify: async () => true });
  const server = await startFormServer({ api, signals: false });
  try {
    const origin = new URL('/', server.url);
    const cookie = (await fetch(server.url, { redirect: 'manual' })).headers.get('set-cookie').split(';')[0];
    const html = await (await fetch(origin, { headers: { cookie } })).text();
    const csrf = html.match(/name="yaw-csrf" content="([a-f0-9]+)"/)[1];
    const bootstrap = await (await fetch(new URL('/api/bootstrap', origin), { headers: { cookie } })).json();
    assert.equal(bootstrap.editing, true);
    assert.equal(bootstrap.initial.answers['idea.text'], 'A tiny command-line tool.');
    const input = { ...bootstrap.initial, answers: { ...bootstrap.initial.answers, 'idea.text': 'Browser edit.' } };
    const response = await fetch(new URL('/api/apply', origin), {
      method: 'POST', headers: { cookie, 'content-type': 'application/json', 'x-yaw-token': csrf }, body: JSON.stringify(input),
    });
    const events = (await response.text()).trim().split('\n').map(JSON.parse);
    assert.equal(response.status, 200, JSON.stringify(events));
    assert.equal(events.at(-1).ok, true);
    assert.equal(readAnswers(root).answers['idea.text'], 'Browser edit.');
  } finally { await server.close(); }
});

test('edit --web and terminal browser choice hand off saved answers', async () => {
  for (const args of [['edit', 'idea', '--web', '--skip-verify'], ['edit', 'idea', '--skip-verify']]) {
    const root = await makeProject({ modules: ['core'] });
    const io = ioFor(root, scripted(['w']));
    const before = readTree(root);
    io.openBrowser = async (url) => {
      const login = await fetch(url, { redirect: 'manual' });
      const cookie = login.headers.get('set-cookie').split(';')[0];
      const origin = new URL('/', url);
      const bootstrap = await (await fetch(new URL('/api/bootstrap', url), { headers: { cookie } })).json();
      assert.equal(bootstrap.handoff.answers['idea.text'], 'A tiny command-line tool.');
      const html = await (await fetch(origin, { headers: { cookie } })).text();
      const csrf = html.match(/name="yaw-csrf" content="([a-f0-9]+)"/)[1];
      const response = await fetch(new URL('/api/apply', url), {
        method: 'POST', headers: { cookie, 'content-type': 'application/json', 'x-yaw-token': csrf },
        body: JSON.stringify({ ...bootstrap.handoff, answers: { ...bootstrap.handoff.answers, 'idea.text': 'Handed off.' } }),
      });
      assert.equal(response.status, 200);
      assert.match(await response.text(), /"ok":true/);
      return true;
    };
    assert.equal(await main(args, io), 0, io.stderr.text());
    assert.notDeepEqual(readTree(root), before);
    assert.equal(readAnswers(root).answers['idea.text'], 'Handed off.');
  }
});

test('changing the stack updates manifest and preserves user-owned scaffolding', async () => {
  const root = await makeProject({ modules: ['core'] });
  writeFileSync(join(root, 'src/index.js'), '// user code\n');
  const model = modelFor(root);
  const prepared = model.normalize({ ...model.initial, answers: { ...model.initial.answers, 'arch.language': 'html', 'arch.runs-on': 'static' } });
  await editProject({ root, kitRoot: KIT_ROOT, answers: prepared });
  assert.deepEqual(requireManifest(root).profiles, ['static-site']);
  assert.equal(readTree(root)['src/index.js'], '// user code\n');
});

test('an unexpected browser launcher error closes the edit server and reports failure', async () => {
  const root = await makeProject({ modules: ['core'] });
  const io = ioFor(root);
  let address;
  io.openBrowser = async (url) => { address = url; throw new Error('test browser launcher failed'); };
  assert.equal(await main(['edit', '--web'], io), 1);
  assert.match(io.stderr.text(), /test browser launcher failed/);
  await assert.rejects(fetch(address));
});
