// comfort (Y-5.8, ADR-0030, ADR-0013): session hygiene, status line, notifications. Token-free per hook,
// cooldown, `yaw hygiene off`, notifications only after N minutes, payload without code / diff / secrets,
// personal configuration never committed, path safety, removal with zero residue.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { main } from '../../../core/cli/main.js';
import { loadModule } from '../../../core/render/kit.js';
import { readManifest } from '../../../core/render/manifest.js';
import { addModule, initProject, moduleQuestions, readAnswers, removeModule } from '../../../core/render/project.js';
import { declaredAgent, fixture, hook, listFixtures } from '../../../test/helpers/hooks.js';
import { KIT_ROOT, capture, cleanEnv, readTree, tmp, writeAnswers } from '../../../test/helpers/fixtures.js';
import { readPersonal, resolveFeatures } from '../lib/config.js';
import { foldTopic, onPrompt, transcriptBytes } from '../lib/hygiene.js';
import { buildPayload, line, notifyTurn, ntfyRequest, redact, sendDetached, terminalSequence } from '../lib/notify.js';
import { JUST_CHECK } from '../lib/check.js';
import { readCheck, readSession, sessionFile, writeSession } from '../lib/state.js';
import { statusLine } from '../lib/statusline.js';

const MODULES = ['core', 'tasks', 'sessions', 'comfort'];
const LEDGER = `# Tasks

## Active
### T-012 Online invite flow — in progress (60 %)
- **Brief:** Host creates a token, guest joins with it.
- **Resume point:** Signaling server done; next: guest join screen.

## Backlog
- T-013 Prop mode — small / cheap

## Done → TASKS.archive.md
`;
const ID = '5f2c1a7e-0d3b-4c1e-9a62-1b7f00000001';
const SAME_TOPIC = [
  'Add a --dry-run flag to the rename command and list what would change.',
  'Make the dry-run output show the new file names too.',
  'Now write a test for the rename command with the dry-run flag.',
];
const OTHER_TOPIC = [
  'How do I deploy the landing page to Cloudflare with a custom domain?',
  'Please translate the README into German and polish the tone.',
];
// built at run time so no secret-looking literal sits in the repository
const FAKE_KEY = `sk-${'a1b2c3d4'.repeat(5)}`;

function answersText({ agents = 'claude, codex, copilot', modules = MODULES, team = 'solo', comfort = '[hygiene, status-line, notifications]' } = {}) {
  return `mode: standard\nanswers:\n  user.agents: [${agents}]\n  idea.text: A tiny command-line tool.\n  idea.team: ${team}\n  tasks.mode: local\n  user.comfort: ${comfort}\nproposal:\n  status: confirmed\n  summary: test project\n  profiles: [node-cli]\n  modules: [${modules.join(', ')}]\n`;
}

async function project(options = {}) {
  const root = tmp('yaw-comfort-');
  await initProject({ root, answersFile: writeAnswers(tmp('yaw-ans-'), answersText(options)), modules: options.modules ?? MODULES });
  if (options.ledger !== false && (options.modules ?? MODULES).includes('tasks')) writeFileSync(join(root, 'TASKS.md'), LEDGER);
  return root;
}

const ENV = () => cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH });
const at = (minutes, base = '2026-10-21T10:00:00.000Z') => new Date(Date.parse(base) + minutes * 60000);
const ev = (agent, ts, id = ID) => ({ agent, sessionId: id, ts: new Date(ts).toISOString(), event: 'UserPromptSubmit' });
const personalFile = (env, text) => {
  mkdirSync(join(env.HOME, '.yaw'), { recursive: true });
  writeFileSync(join(env.HOME, '.yaw', 'comfort.yaml'), text);
};
const manifestOf = (root) => readManifest(root);

async function yaw(root, args, env, extra = {}) {
  const stdout = capture();
  const stderr = capture();
  const code = await main(args, { stdout, stderr, cwd: root, env, ...extra });
  return { code, out: stdout.text(), err: stderr.text() };
}

// the five prompts of a session: a topic, then something else
async function runPrompts(root, env, prompts, { agent = 'claude', start = '2026-10-21T10:00:00.000Z', stepMinutes = 1 } = {}) {
  const manifest = manifestOf(root);
  const out = [];
  for (const [i, prompt] of prompts.entries()) {
    const ts = at(i * stepMinutes, start);
    out.push(onPrompt({ event: ev(agent, ts), root, env, manifest, prompt, now: ts }));
  }
  return out;
}

// ------------------------------------------------------------------------------------------ module and install

test('module: comfort and evaluation hooks only, tokenCost none, one question', () => {
  const def = loadModule(KIT_ROOT, 'comfort');
  assert.deepEqual(def.outputs.hooks.map((h) => [h.name, h.event, h.kind, h.tokenCost]), [
    ['prompt', 'UserPromptSubmit', 'comfort', 'none'],
    ['stop', 'Stop', 'comfort', 'none'],
    ['notification', 'Notification', 'comfort', 'none'],
    ['failure', 'StopFailure', 'comfort', 'none'],
    ['check-ok', 'PostToolUse', 'evaluation', 'none'],
    ['check-fail', 'PostToolUseFailure', 'evaluation', 'none'],
  ]);
  assert.equal(def.tokenCost, 'none');
  assert.deepEqual(def.questions.map((q) => q.id), ['user.comfort']);
  assert.deepEqual(def.questions[0].default, ['hygiene', 'status-line']);
  assert.equal(def.agents.claude.support, 'native');
  assert.equal(def.agents.copilot.support, 'fallback');
});

test('install: hooks for Claude and Codex, status line for a solo Claude project, manifest entries', async () => {
  const root = await project();
  const claude = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8'));
  const codex = JSON.parse(readFileSync(join(root, '.codex/hooks.json'), 'utf8'));
  for (const event of ['UserPromptSubmit', 'Stop', 'Notification', 'StopFailure', 'PostToolUse', 'PostToolUseFailure']) {
    assert.ok(JSON.stringify(claude.hooks[event]).includes('--module comfort'), `claude ${event}`);
  }
  assert.equal(claude.hooks.Notification.find((h) => h.hooks[0].command.includes('--module comfort')).matcher, 'permission_prompt|idle_prompt');
  for (const event of ['UserPromptSubmit', 'Stop']) assert.ok(JSON.stringify(codex.hooks[event]).includes('--module comfort'), `codex ${event}`);
  for (const event of ['Notification', 'StopFailure', 'PostToolUse', 'PostToolUseFailure']) {
    assert.ok(!JSON.stringify(codex.hooks[event] ?? []).includes('--module comfort'), `codex has no ${event}`);
  }
  assert.equal(claude.statusLine.type, 'command');
  assert.match(claude.statusLine.command, /bin\/yaw" statusline/);
  const manifest = readManifest(root);
  assert.equal(manifest.modules.comfort.enabled, true);
  const fragment = manifest.files.find((f) => f.path === '.claude/settings.json').fragments.find((f) => f.module === 'comfort');
  assert.match(fragment.hash, /^sha256:/);
  assert.match(readFileSync(join(root, 'AGENTS.md'), 'utf8'), /yaw hygiene/);
});

test('install: no status line without Claude or without the choice', async () => {
  const codexOnly = await project({ agents: 'codex' });
  assert.equal(existsSync(join(codexOnly, '.claude/settings.json')), false);
  const noLine = await project({ comfort: '[hygiene]' });
  assert.equal(JSON.parse(readFileSync(join(noLine, '.claude/settings.json'), 'utf8')).statusLine, undefined);
});

test('personal configuration is not committed: a team repository gets hooks but no status line (ADR-0013)', async () => {
  const team = await project({ team: 'team' });
  const settings = JSON.parse(readFileSync(join(team, '.claude/settings.json'), 'utf8'));
  assert.equal(settings.statusLine, undefined);
  assert.ok(JSON.stringify(settings.hooks).includes('--module comfort'));
  // nothing the module writes names a person's choices, and no personal file is rendered into the repository
  const tree = readTree(team);
  assert.deepEqual(Object.keys(tree).filter((p) => /comfort/.test(p) || /ntfy|statusLine|statusline/.test(tree[p])), []);
  assert.equal(existsSync(join(team, '.yaw', 'comfort.yaml')), false);
  const snippet = await yaw(team, ['statusline', '--snippet'], ENV());
  assert.equal(snippet.code, 0);
  assert.match(snippet.out, /"statusLine"/);
  assert.match(snippet.out, /settings\.local\.json/);
});

test('remove: zero residue, answers kept, a re-add asks again with the previous answer as the default', async () => {
  const root = await project();
  const before = readTree(root);
  await removeModule({ root, module: 'comfort' });
  const left = readTree(root);
  for (const file of ['.claude/settings.json', '.codex/hooks.json']) assert.doesNotMatch(left[file] ?? '', /--module comfort/, file);
  assert.equal(JSON.parse(left['.claude/settings.json']).statusLine, undefined);
  assert.doesNotMatch(left['AGENTS.md'], /yaw:comfort|yaw hygiene/);
  assert.equal(readManifest(root).modules.comfort, undefined);
  assert.ok(!readManifest(root).files.some((f) => f.module === 'comfort' || (f.fragments ?? []).some((x) => x.module === 'comfort')));
  assert.deepEqual(readAnswers(root).answers['user.comfort'], ['hygiene', 'status-line', 'notifications']);

  const asked = moduleQuestions({ root, definition: loadModule(KIT_ROOT, 'comfort') });
  assert.deepEqual(asked.map((q) => [q.id, q.default]), [['user.comfort', ['hygiene', 'status-line', 'notifications']]]);
  await addModule({ root, module: 'comfort' });
  assert.deepEqual(readTree(root), before);
});

test('after removal the hooks do nothing and no state is written', async () => {
  const root = await project();
  const env = ENV();
  await removeModule({ root, module: 'comfort' });
  const r = await hook({ root, agent: 'claude', event: 'UserPromptSubmit', module: 'comfort', payload: { ...fixture('claude', 'UserPromptSubmit'), cwd: root }, env });
  assert.deepEqual([r.code, r.stdout], [0, '']);
  assert.equal(existsSync(join(env.HOME, '.yaw', 'state')), false);
});

// ------------------------------------------------------------------------------------------ token-free per hook

test('every comfort hook, every recorded fixture of every agent: never additionalContext, only systemMessage / terminalSequence, evaluation prints nothing', async () => {
  const root = await project();
  const def = loadModule(KIT_ROOT, 'comfort');
  const env = ENV();
  personalFile(env, 'features: [hygiene, status-line, notifications]\nnotify:\n  minutes: 0\nhygiene:\n  maxPrompts: 1\n  cooldownPrompts: 1\n');
  const fixtures = [...listFixtures(), { agent: 'claude', name: 'StopFailure', event: 'StopFailure', payload: { ...fixture('claude', 'Stop'), hook_event_name: 'StopFailure' } },
    { agent: 'claude', name: 'PostToolUse', event: 'PostToolUse', payload: { ...fixture('claude', 'PreToolUse'), hook_event_name: 'PostToolUse', tool_input: { command: 'just check' } } },
    { agent: 'claude', name: 'PostToolUseFailure', event: 'PostToolUseFailure', payload: { ...fixture('claude', 'PreToolUse'), hook_event_name: 'PostToolUseFailure', tool_input: { command: 'just check' } } }];
  let sawMessage = 0;
  for (const h of def.outputs.hooks) {
    for (const f of fixtures.filter((x) => x.event === h.event)) {
      // two runs: the first creates the state, the second can notify
      for (let i = 0; i < 2; i += 1) {
        const r = await hook({ root, agent: declaredAgent(f.agent), event: f.event, module: 'comfort', payload: { ...f.payload, cwd: root }, env });
        assert.equal(r.code, 0, `${h.name} ${f.agent}`);
        assert.equal(r.stderr, '', `${h.name} ${f.agent}`);
        assert.doesNotMatch(r.stdout, /additionalContext|permissionDecision|hookSpecificOutput/, `${h.name} ${f.agent}`);
        if (h.kind === 'evaluation' || f.agent === 'copilot') assert.equal(r.stdout, '', `${h.name} ${f.agent}: silent`);
        else if (r.stdout !== '') {
          sawMessage += 1;
          const out = JSON.parse(r.stdout);
          assert.deepEqual(Object.keys(out).filter((k) => !['systemMessage', 'terminalSequence'].includes(k)), [], `${h.name} ${f.agent}`);
          if (f.agent === 'codex') assert.equal(out.terminalSequence, undefined);
        }
      }
    }
  }
  assert.ok(sawMessage >= 4, 'the comfort hooks did talk to the user in this run');
});

test('the dispatcher drops anything a comfort handler might add: plain stdout never reaches the agent', async () => {
  const root = await project();
  const env = ENV();
  const r = await hook({ root, agent: 'claude', event: 'UserPromptSubmit', module: 'comfort', payload: { ...fixture('claude', 'UserPromptSubmit'), cwd: root }, env });
  assert.deepEqual([r.code, r.stdout, r.stderr], [0, '', '']);
});

// ------------------------------------------------------------------------------------------ hygiene

test('hygiene: no hint on one topic; a hint when the topic changes (smoothed over two prompts), with /handoff when sessions is installed', async () => {
  const root = await project();
  const env = ENV();
  const same = await runPrompts(root, env, SAME_TOPIC);
  assert.deepEqual(same, [null, null, null]);
  const manifest = manifestOf(root);
  const first = onPrompt({ event: ev('claude', at(3)), root, env, manifest, prompt: OTHER_TOPIC[0], now: at(3) });
  assert.equal(first, null, 'one off-topic question is not enough');
  const second = onPrompt({ event: ev('claude', at(4)), root, env, manifest, prompt: OTHER_TOPIC[1], now: at(4) });
  assert.match(second.systemMessage, /^YAW hygiene: new topic, drift 0\.\d\d \(5 prompts, 4 min\)\. Suggest: \/handoff, then \/clear\. Silence: yaw hygiene off$/);
  assert.deepEqual(Object.keys(second), ['systemMessage']);
});

test('hygiene: without the sessions module the hint does not name /handoff', async () => {
  const root = await project({ modules: ['core', 'tasks', 'comfort'] });
  const env = ENV();
  personalFile(env, 'hygiene:\n  maxPrompts: 2\n');
  const out = await runPrompts(root, env, SAME_TOPIC);
  assert.match(out[1].systemMessage, /Suggest: \/clear and start fresh\./);
  assert.doesNotMatch(out[1].systemMessage, /handoff/);
});

test('hygiene: cooldown, at most one hint per 20 prompts', async () => {
  const root = await project();
  const env = ENV();
  personalFile(env, 'hygiene:\n  maxPrompts: 2\n');
  const prompts = Array.from({ length: 24 }, () => SAME_TOPIC[0]);
  const out = await runPrompts(root, env, prompts);
  const shown = out.map((m, i) => (m ? i + 1 : null)).filter(Boolean);
  assert.deepEqual(shown, [2, 22]);
});

test('hygiene: age, prompt count, size per prompt and a task switch are reasons too', async () => {
  const root = await project();
  const env = ENV();
  const manifest = manifestOf(root);
  personalFile(env, 'hygiene:\n  maxAgeMinutes: 30\n');
  await runPrompts(root, env, [SAME_TOPIC[0]]);
  const aged = onPrompt({ event: ev('claude', at(45)), root, env, manifest, prompt: SAME_TOPIC[1], now: at(45) });
  assert.match(aged.systemMessage, /a long session \(2 prompts, 45 min\)/);

  // task switch: the prompt names another task than the session started with
  const env2 = ENV();
  await runPrompts(root, env2, [SAME_TOPIC[0]]);
  const switched = onPrompt({ event: ev('claude', at(1)), root, env: env2, manifest, prompt: 'Start on T-013 now please.', now: at(1) });
  assert.match(switched.systemMessage, /a different task or branch/);

  // size: a transcript of 10 KB per prompt against a 1 KB limit
  const env3 = ENV();
  personalFile(env3, 'hygiene:\n  maxKbPerPrompt: 1\n');
  const transcript = join(env3.HOME, 'transcript.jsonl');
  writeFileSync(transcript, 'x'.repeat(60 * 1024));
  let message = null;
  for (let i = 0; i < 6; i += 1) message = onPrompt({ event: ev('claude', at(i)), root, env: env3, manifest, prompt: SAME_TOPIC[i % 3], transcript, now: at(i) }) ?? message;
  assert.match(message.systemMessage, /\d+ KB per prompt/);
});

test('hygiene: the topic vector is kept, never the prompt text', async () => {
  const root = await project();
  const env = ENV();
  await runPrompts(root, env, SAME_TOPIC);
  const text = readFileSync(sessionFile(env, 'claude', ID), 'utf8');
  for (const prompt of SAME_TOPIC) assert.ok(!text.includes(prompt.slice(0, 20)));
  const state = JSON.parse(text);
  assert.equal(state.prompts, 3);
  assert.equal(state.topic.length, 384);
  assert.equal(foldTopic([], []).length, 0);
});

test('yaw hygiene off silences the hints for this project; on brings them back; --all covers every project', async () => {
  const root = await project();
  const other = await project();
  const env = ENV();
  personalFile(env, 'hygiene:\n  maxPrompts: 1\n  cooldownPrompts: 1\n');
  const manifest = manifestOf(root);
  const prompt = (r, i) => onPrompt({ event: ev('claude', at(i)), root: r, env, manifest, prompt: SAME_TOPIC[0], now: at(i) });
  assert.ok(prompt(root, 0));

  const off = await yaw(root, ['hygiene', 'off'], env);
  assert.match(off.out, /off for this project/);
  assert.equal(prompt(root, 1), null);
  assert.ok(prompt(other, 2), 'another project still gets hints');
  assert.match((await yaw(root, ['hygiene'], env)).out, /hygiene: off \(yaw hygiene off\)/);

  assert.match((await yaw(root, ['hygiene', 'on'], env)).out, /on for this project/);
  assert.ok(prompt(root, 3));
  await yaw(root, ['hygiene', 'off', '--all'], env);
  assert.equal(prompt(other, 4), null);
  assert.equal(prompt(root, 5), null);
  await yaw(root, ['hygiene', 'on', '--all'], env);
  assert.ok(prompt(root, 6));
});

test('yaw hygiene status shows thresholds and where the features come from; unknown verbs are usage errors', async () => {
  const root = await project();
  const env = ENV();
  const status = await yaw(root, ['hygiene', 'status'], env);
  assert.equal(status.code, 0);
  assert.match(status.out, /hygiene: on/);
  assert.match(status.out, /features: hygiene, status-line, notifications \(from project\)/);
  assert.match(status.out, /thresholds: drift 0\.9, 60 prompts, 180 min, 100 KB per prompt; at most one hint per 20 prompts/);
  const bad = await yaw(root, ['hygiene', 'maybe'], env);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /usage: yaw hygiene/);
  const elsewhere = await yaw(tmp('yaw-bare-'), ['hygiene'], env);
  assert.equal(elsewhere.code, 1);
});

test('hygiene off by choice: not in user.comfort, or not in the personal features; a team project ignores project answers', async () => {
  const env = ENV();
  const noHygiene = await project({ comfort: '[status-line]' });
  assert.deepEqual(await runPrompts(noHygiene, env, SAME_TOPIC), [null, null, null]);
  assert.equal(readSession(env, 'claude', ID), null, 'no feature needs state, none is kept');
  assert.match((await yaw(noHygiene, ['hygiene'], env)).out, /hygiene: off \(not selected/);

  const personal = ENV();
  personalFile(personal, 'features: [hygiene]\nhygiene:\n  maxPrompts: 1\n');
  const root = await project({ comfort: '[status-line]' });
  assert.ok((await runPrompts(root, personal, [SAME_TOPIC[0]]))[0], 'the personal file wins over the project answer');

  const team = await project({ team: 'team', comfort: '[status-line]' });
  const teamEnv = ENV();
  assert.deepEqual(resolveFeatures({ root: team, personal: {} }), { features: ['hygiene', 'status-line'], source: 'default', team: true });
  assert.equal(resolveFeatures({ root, personal: {} }).source, 'project');
  assert.equal(readPersonal(teamEnv).error, null);
});

test('hygiene does nothing for Copilot (no user message) but Claude and Codex both get the same hint', async () => {
  const root = await project();
  const env = ENV();
  personalFile(env, 'hygiene:\n  maxPrompts: 1\n');
  for (const agent of ['claude', 'codex', 'copilot']) {
    const r = await hook({ root, agent: declaredAgent(agent), event: 'UserPromptSubmit', module: 'comfort', payload: { ...fixture(agent, 'UserPromptSubmit'), cwd: root }, env });
    if (agent === 'copilot') assert.equal(r.stdout, '', 'copilot: nothing');
    else assert.match(JSON.parse(r.stdout).systemMessage, /^YAW hygiene: many prompts \(1 prompts, /);
  }
});

// ------------------------------------------------------------------------------------------ notifications

test('notifications: only after N minutes, once per turn, terminal sequence for Claude and message for Codex', async () => {
  const root = await project();
  const env = ENV();
  const start = '2026-10-21T10:00:00.000Z';
  for (const agent of ['claude', 'codex']) {
    const id = `${agent}-session-1`;
    onPrompt({ event: ev(agent, start, id), root, env, manifest: manifestOf(root), prompt: SAME_TOPIC[0], now: new Date(start) });
    const stop = (minutes) => notifyTurn({ event: { ...ev(agent, at(minutes, start), id), event: 'Stop' }, root, env, status: 'done', now: at(minutes, start) });
    assert.equal(stop(2), null, `${agent}: 2 min is below the default of 3`);
    const sent = stop(5);
    if (agent === 'claude') {
      assert.deepEqual(Object.keys(sent), ['terminalSequence']);
      assert.equal(sent.terminalSequence, `\u001b]9;YAW ${line(buildPayload({ project: root, task: 'T-012', status: 'done', minutes: 5, summary: 'Online invite flow' }))}\u0007`);
    } else {
      assert.deepEqual(Object.keys(sent), ['systemMessage']);
      assert.match(sent.systemMessage, /^YAW: .*T-012: done after 5 min - Online invite flow$/);
    }
    assert.equal(stop(6), null, `${agent}: once per turn`);
  }
});

test('notifications: the minutes are configurable; off unless selected; terminal can be switched off', async () => {
  const root = await project();
  const env = ENV();
  const start = '2026-10-21T10:00:00.000Z';
  const prompt = () => onPrompt({ event: ev('claude', start), root, env, manifest: manifestOf(root), prompt: SAME_TOPIC[0], now: new Date(start) });
  const stop = (m, status = 'done') => notifyTurn({ event: ev('claude', at(m, start)), root, env, status, now: at(m, start) });
  personalFile(env, 'notify:\n  minutes: 10\n');
  prompt();
  assert.equal(stop(9), null);
  assert.ok(stop(10));
  personalFile(env, 'notify:\n  minutes: 0\n  terminal: off\n');
  assert.equal(stop(11, 'failed'), null, 'terminal off and no ntfy: nothing to return');

  const hygieneOnly = await project({ comfort: '[hygiene]' });
  const env2 = ENV();
  onPrompt({ event: ev('claude', start), root: hygieneOnly, env: env2, manifest: manifestOf(hygieneOnly), prompt: SAME_TOPIC[0], now: new Date(start) });
  assert.equal(notifyTurn({ event: ev('claude', at(30, start)), root: hygieneOnly, env: env2, status: 'done', now: at(30, start) }), null);
});

test('notifications: the Notification hook reports permission and idle prompts, StopFailure reports failures; each once per turn', async () => {
  const root = await project();
  const env = ENV();
  personalFile(env, 'notify:\n  minutes: 0\n');
  const call = (event, payload) => hook({ root, agent: 'claude', event, module: 'comfort', payload: { ...payload, cwd: root }, env });
  await call('UserPromptSubmit', fixture('claude', 'UserPromptSubmit'));
  const permission = await call('Notification', fixture('claude', 'Notification'));
  assert.match(JSON.parse(permission.stdout).terminalSequence, /needs your input/);
  assert.equal((await call('Notification', fixture('claude', 'Notification'))).stdout, '', 'a second prompt in the same turn is not announced again');
  const other = await call('Notification', { ...fixture('claude', 'Notification'), notification_type: 'auth_success' });
  assert.equal(other.stdout, '');
  const failed = await call('StopFailure', { ...fixture('claude', 'Stop'), hook_event_name: 'StopFailure' });
  assert.match(JSON.parse(failed.stdout).terminalSequence, /failed/);
});

test('payload: project, task, status, duration and a short title only; no code, diff, secret, last message or control characters', () => {
  const evil = `Fix \`rm -rf /\` handling ${FAKE_KEY} \u001b]9;boom\u0007 ${'x'.repeat(200)}`;
  const payload = buildPayload({ project: '/home/me/work/photo-renamer', task: 'T-012', status: 'done', minutes: 7.6, summary: evil });
  assert.deepEqual(Object.keys(payload), ['project', 'task', 'status', 'minutes', 'summary']);
  assert.equal(payload.project, 'photo-renamer');
  assert.equal(payload.minutes, 8);
  assert.ok(payload.summary.length <= 80);
  const text = JSON.stringify(payload) + line(payload) + terminalSequence('osc9', payload) + terminalSequence('osc777', payload);
  assert.doesNotMatch(text, /rm -rf/);
  assert.doesNotMatch(text, new RegExp(FAKE_KEY));
  assert.doesNotMatch(text, /\u0007[^\u001b]*\u0007/, 'no bell inside the text');
  assert.equal(text.match(/\u001b/g).length, 2, 'only the two sequences we added carry an escape character');
  assert.equal(terminalSequence('osc777', buildPayload({ project: 'p', status: 'done', summary: 'a;b' })).split(';').length, 4, 'the title cannot add OSC fields');
  assert.throws(() => buildPayload({ project: 'p', status: 'maybe' }));
  assert.equal(buildPayload({ project: 'p', task: 'T-1;rm', status: 'input' }).task, null);
  assert.equal(redact(`token ${FAKE_KEY} and ghp_${'Z9'.repeat(10)}`), 'token [redacted] and [redacted]');
});

test('payload end to end: the agent\'s last message, code and secrets in the hook payload never reach the notification', async () => {
  const root = await project();
  const env = ENV();
  personalFile(env, 'notify:\n  minutes: 0\n  terminal: osc777\n');
  await hook({ root, agent: 'claude', event: 'UserPromptSubmit', module: 'comfort', payload: { ...fixture('claude', 'UserPromptSubmit'), cwd: root, prompt: `use ${FAKE_KEY} in the code` }, env });
  const stop = { ...fixture('claude', 'Stop'), cwd: root, last_assistant_message: `diff --git a/x b/x\n+const key = "${FAKE_KEY}";\n` };
  const r = await hook({ root, agent: 'claude', event: 'Stop', module: 'comfort', payload: stop, env });
  const out = JSON.parse(r.stdout);
  assert.match(out.terminalSequence, /^\u001b\]777;notify;YAW;.*T-012: done/);
  for (const bad of [FAKE_KEY, 'diff --git', 'const key']) assert.ok(!r.stdout.includes(bad), bad);
});

test('ntfy: request only for a valid topic and a safe server; the topic never appears in status output', async () => {
  const p = buildPayload({ project: 'p', status: 'done', minutes: 4 });
  const ok = ntfyRequest(p, { topic: 'long-random-topic_123' });
  assert.equal(ok.url, 'https://ntfy.sh/long-random-topic_123');
  assert.equal(ok.body, 'p: done after 4 min');
  assert.equal(ntfyRequest(buildPayload({ project: 'p', status: 'failed' }), { topic: 'abc' }).headers.Priority, 'high');
  assert.equal(ntfyRequest(p, { topic: 'a/b' }), null);
  assert.equal(ntfyRequest(p, { topic: 'abc', server: 'http://ntfy.example.org' }), null, 'plain http only for localhost');
  assert.equal(ntfyRequest(p, { topic: 'abc', server: 'https://user:pw@ntfy.example.org' }), null);
  assert.equal(ntfyRequest(p, { topic: 'abc', server: 'https://ntfy.example.org/sub' }), null);
  assert.equal(ntfyRequest(p, { topic: 'abc', server: 'not a url' }), null);
  assert.ok(ntfyRequest(p, { topic: 'abc', server: 'http://127.0.0.1:8080' }));
  assert.equal(ntfyRequest(p, undefined), null);

  const root = await project();
  const env = ENV();
  personalFile(env, 'notify:\n  ntfy:\n    topic: super-secret-topic-9\n');
  const status = await yaw(root, ['notify', 'status'], env);
  assert.match(status.out, /ntfy: configured \(ntfy\.sh\)/);
  assert.doesNotMatch(status.out + status.err, /super-secret-topic-9/);
});

test('ntfy: a hook starts a detached silent child with no secret in its arguments', async () => {
  const root = await project();
  const env = { ...ENV(), YAW_HOME: join(tmp('yaw-yh-'), '.yaw'), AWS_SECRET_ACCESS_KEY: 'must-not-be-passed' };
  mkdirSync(env.YAW_HOME, { recursive: true });
  writeFileSync(join(env.YAW_HOME, 'comfort.yaml'), 'notify:\n  minutes: 0\n  terminal: off\n  ntfy:\n    topic: super-secret-topic-9\n');
  const calls = [];
  const spawnFn = (cmd, args, options) => {
    calls.push({ cmd, args, options });
    return { unref() { calls.at(-1).unref = true; } };
  };
  onPrompt({ event: ev('claude', at(0)), root, env, manifest: manifestOf(root), prompt: SAME_TOPIC[0], now: at(0) });
  assert.equal(notifyTurn({ event: ev('claude', at(5)), root, env, status: 'done', now: at(5), spawnFn }), null, 'terminal is off');
  assert.equal(calls.length, 1);
  const [{ cmd, args, options, unref }] = calls;
  assert.equal(cmd, process.execPath);
  assert.match(args[1], /send\.js$/);
  assert.deepEqual(JSON.parse(args[2]), { project: root.split('/').at(-1), task: 'T-012', status: 'done', minutes: 5, summary: 'Online invite flow' });
  assert.doesNotMatch(JSON.stringify(calls), /super-secret-topic-9|must-not-be-passed/);
  assert.deepEqual([options.detached, options.stdio, unref, options.cwd], [true, 'ignore', true, env.HOME]);
  assert.equal(sendDetached({}, {}, spawnFn), false, 'no home, nothing started');
});

test('ntfy: send.js and `yaw notify send` post one plain-text message to a local server', async () => {
  const seen = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, title: req.headers.title, body });
      res.end('{}');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const root = await project();
    const env = ENV();
    personalFile(env, `notify:\n  ntfy:\n    server: http://127.0.0.1:${server.address().port}\n    topic: local-topic-1\n`);

    const send = await yaw(root, ['notify', 'send', '--status', 'input', '--minutes', '12', '--summary', `see ${FAKE_KEY}`], env);
    assert.equal(send.code, 0, send.err);
    assert.match(send.out, /ntfy: sent/);
    assert.deepEqual(seen.map((s) => [s.method, s.url, s.title]), [['POST', '/local-topic-1', 'YAW']]);
    assert.match(seen[0].body, /: needs your input after 12 min - see \[redacted\]$/);

    await new Promise((resolve) => {
      const child = spawn(process.execPath, [join(import.meta.dirname, '..', 'lib', 'send.js'), JSON.stringify({ project: 'p', task: null, status: 'done', minutes: 3, summary: null })], { env: { HOME: env.HOME, PATH: env.PATH }, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.on('data', (c) => { output += c; });
      child.stderr.on('data', (c) => { output += c; });
      child.on('exit', (code) => {
        assert.deepEqual([code, output], [0, '']);
        resolve();
      });
    });
    assert.equal(seen.length, 2);
    assert.equal(seen[1].body, 'p: done after 3 min');

    const test = await yaw(root, ['notify', 'test'], env);
    assert.match(test.out, /test notification/);
    assert.equal(seen.length, 3);
    assert.equal((await yaw(root, ['notify', 'send', '--status', 'weird'], env)).code, 1);
    assert.equal((await yaw(root, ['notify', 'send', '--status', 'done', '--minutes', 'x'], env)).code, 1);
  } finally {
    server.close();
  }
});

test('ntfy: an unreachable server is reported by `yaw notify`, never raised in a hook', async () => {
  const root = await project();
  const env = ENV();
  personalFile(env, 'notify:\n  ntfy:\n    server: http://127.0.0.1:9\n    topic: local-topic-1\n');
  const r = await yaw(root, ['notify', 'test'], env);
  assert.equal(r.code, 1);
  assert.match(r.out, /ntfy: failed, ntfy not reachable/);
});

// ------------------------------------------------------------------------------------------ last `just check` (M8) and the status line

test('last `just check`: recorded from the agent\'s own plain `just check` calls only', async () => {
  const root = await project();
  const env = ENV();
  const call = (event, command, tool = 'Bash') => hook({ root, agent: 'claude', event, module: 'comfort', payload: { ...fixture('claude', 'PreToolUse'), hook_event_name: event, cwd: root, tool_name: tool, tool_input: { command } }, env });
  const key = () => readCheck(env, root.startsWith('/var') ? `/private${root}` : root);

  assert.equal((await call('PostToolUse', 'just test')).stdout, '');
  assert.equal(key(), null);
  assert.equal((await call('PostToolUse', 'just check; echo done')).stdout, '');
  assert.equal(key(), null, 'a chained command says nothing about the exit code of check');
  await hook({ root, agent: 'claude', event: 'PostToolUse', module: 'comfort', payload: { ...fixture('claude', 'PreToolUse'), hook_event_name: 'PostToolUse', cwd: root, tool_input: { command: 'just check', run_in_background: true } }, env });
  assert.equal(key(), null, 'a background run has not finished');
  assert.deepEqual([await call('PostToolUse', 'just check'), key().status].map((x) => x.stdout ?? x), ['', 'pass']);
  assert.deepEqual([await call('PostToolUseFailure', 'just check'), key().status].map((x) => x.stdout ?? x), ['', 'fail']);
  assert.ok(JUST_CHECK.test('just check') && JUST_CHECK.test('  just check  ') && !JUST_CHECK.test('just check && rm x') && !JUST_CHECK.test('just checks'));
  // Codex cannot tell the two apart: its hook is not registered and the dispatcher skips it
  const codex = await hook({ root, agent: 'codex', event: 'PostToolUse', module: 'comfort', payload: { ...fixture('codex', 'PreToolUse'), hook_event_name: 'PostToolUse', cwd: root }, env });
  assert.equal(codex.stdout, '');
});

test('status line: task, context, cache, hygiene badge and the last check, in one line; nothing when there is nothing', async () => {
  const root = await project();
  const env = ENV();
  const payload = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'statusline.json'), 'utf8').replaceAll('@ROOT@', root));
  assert.equal(statusLine(payload, { env, now: at(0) }), 'T-012 | ctx 42% | cache warm 4m');

  // hygiene badge once a hint was shown in this session; check result with its age
  personalFile(env, 'hygiene:\n  maxPrompts: 1\n');
  await runPrompts(root, env, [SAME_TOPIC[0]]);
  await hook({ root, agent: 'claude', event: 'PostToolUseFailure', module: 'comfort', payload: { ...fixture('claude', 'PreToolUse'), hook_event_name: 'PostToolUseFailure', cwd: root, tool_input: { command: 'just check' } }, env });
  const line1 = statusLine(payload, { env, now: new Date(Date.now() + 5 * 60000) });
  assert.match(line1, /^T-012 \| ctx 42% \| cache warm 4m \| hygiene: \/clear\? \| check FAILED [45]m$/);

  assert.equal(statusLine({ ...payload, prompt_cache: { state: 'cold' } }, { env }).includes('cache cold'), true);
  assert.equal(statusLine({ context_window: { total_input_tokens: 50000, context_window_size: 200000 } }, { env }), 'ctx 25%');
  assert.equal(statusLine({}, { env }), '');
  assert.equal(statusLine(null, { env }), '');
  assert.equal(statusLine({ cwd: 'relative/dir', prompt_cache: { state: 'weird' } }, { env }), '');
  assert.doesNotMatch(statusLine({ ...payload, session_id: '../../etc' }, { env }), /hygiene/);
});

test('yaw statusline: reads the agent JSON on stdin, prints one line, never fails', async () => {
  const root = await project();
  const env = ENV();
  const text = readFileSync(join(import.meta.dirname, 'fixtures', 'statusline.json'), 'utf8').replaceAll('@ROOT@', root);
  const ok = await yaw(root, ['statusline'], env, { stdin: Readable.from([text]) });
  assert.deepEqual([ok.code, ok.out], [0, 'T-012 | ctx 42% | cache warm 4m\n']);
  for (const junk of ['', 'not json', '[1,2]', 'null', '{"cwd": 5}']) {
    const r = await yaw(root, ['statusline'], env, { stdin: Readable.from([junk]) });
    assert.deepEqual([r.code, r.out, r.err], [0, '', ''], junk);
  }
  const extra = await yaw(root, ['statusline', 'extra'], env, { stdin: Readable.from([text]) });
  assert.deepEqual([extra.code, extra.out], [0, '']);
});

// ------------------------------------------------------------------------------------------ path safety

test('path safety: bad session ids and non-absolute homes get no state; links are never followed', async () => {
  const env = ENV();
  for (const bad of ['../../etc/passwd', 'a/b', '', '-x', 'x'.repeat(200), 'a b']) assert.equal(sessionFile(env, 'claude', bad), null, bad);
  assert.equal(sessionFile(env, 'gemini', 'ok'), null);
  assert.equal(sessionFile({ YAW_HOME: 'relative/dir', HOME: '/nonexistent' }, 'claude', 'ok'), null);
  assert.equal(writeSession({ YAW_HOME: 'relative/dir' }, 'claude', 'ok', { v: 1 }), false);
  assert.equal(readPersonal({ YAW_HOME: 'relative/dir' }).error, 'no absolute YAW_HOME / HOME');

  // a linked state directory is refused, nothing is written through it
  const victim = tmp('yaw-victim-');
  const linked = ENV();
  mkdirSync(join(linked.HOME, '.yaw'), { recursive: true });
  symlinkSync(victim, join(linked.HOME, '.yaw', 'state'));
  assert.equal(writeSession(linked, 'claude', 'ok', { v: 1 }), false);
  assert.deepEqual(Object.keys(readTree(victim)), []);

  // a linked session file is refused too
  const env2 = ENV();
  assert.equal(writeSession(env2, 'claude', 'ok', { v: 1 }), true);
  const file = sessionFile(env2, 'claude', 'ok');
  const target = join(tmp('yaw-target-'), 't.json');
  writeFileSync(target, '{"v":1,"prompts":99}');
  const { rmSync } = await import('node:fs');
  rmSync(file);
  symlinkSync(target, file);
  assert.equal(readSession(env2, 'claude', 'ok'), null);
  assert.equal(writeSession(env2, 'claude', 'ok', { v: 2 }), false);
  assert.equal(readFileSync(target, 'utf8'), '{"v":1,"prompts":99}');
});

test('path safety: a linked or oversized comfort.yaml is ignored; an invalid one is reported and defaults apply', async () => {
  const env = ENV();
  mkdirSync(join(env.HOME, '.yaw'), { recursive: true });
  const real = join(tmp('yaw-real-'), 'comfort.yaml');
  writeFileSync(real, 'features: [hygiene]\n');
  symlinkSync(real, join(env.HOME, '.yaw', 'comfort.yaml'));
  assert.match(readPersonal(env).error, /must be a regular file/);

  const env2 = ENV();
  personalFile(env2, `# ${'x'.repeat(70000)}\n`);
  assert.match(readPersonal(env2).error, /regular file of at most/);

  const env3 = ENV();
  personalFile(env3, 'hygiene:\n  drift: 7\n');
  assert.match(readPersonal(env3).error, /drift must be <= 1/);
  const root = await project();
  assert.match((await yaw(root, ['hygiene'], env3)).out, /personal file: .*unusable/);
  assert.deepEqual(readPersonal(env3).config, {});
});

test('path safety: the transcript path from the payload is only stat-ed inside the home, as a regular .jsonl file', () => {
  const env = ENV();
  const inside = join(env.HOME, 't.jsonl');
  writeFileSync(inside, 'x'.repeat(10));
  assert.equal(transcriptBytes(inside, env), 10);
  const outside = join(tmp('yaw-out-'), 't.jsonl');
  writeFileSync(outside, 'secret');
  assert.equal(transcriptBytes(outside, env), null, 'outside the home');
  const link = join(env.HOME, 'link.jsonl');
  symlinkSync(outside, link);
  assert.equal(transcriptBytes(link, env), null, 'a link');
  writeFileSync(join(env.HOME, 't.txt'), 'x');
  for (const bad of [join(env.HOME, 't.txt'), `${env.HOME}/../x.jsonl`, 'relative.jsonl', `${inside}\u0000`, null, 5, join(env.HOME, 'missing.jsonl')]) assert.equal(transcriptBytes(bad, env), null, String(bad));
  assert.equal(transcriptBytes(inside, { HOME: 'relative' }), null);
});

test('a hand-edited session state file cannot break the hook or write elsewhere', async () => {
  const root = await project();
  const env = ENV();
  await runPrompts(root, env, [SAME_TOPIC[0]]);
  const file = sessionFile(env, 'claude', ID);
  writeFileSync(file, '{"v":1,"prompts":"many","topic":"abc","drifts":null}');
  const r = await hook({ root, agent: 'claude', event: 'UserPromptSubmit', module: 'comfort', payload: { ...fixture('claude', 'UserPromptSubmit'), cwd: root }, env });
  assert.deepEqual([r.code, r.stderr], [0, '']);
  assert.equal(readSession(env, 'claude', ID).prompts, 1, 'a state with wrong types starts over');
  writeFileSync(file, 'not json');
  assert.deepEqual((await hook({ root, agent: 'claude', event: 'UserPromptSubmit', module: 'comfort', payload: { ...fixture('claude', 'UserPromptSubmit'), cwd: root }, env })).code, 0);
});
