// yaw hook (Y-4.2): one entry point, per-agent normalisation of recorded payloads (Y-4.3 - Y-4.5),
// dispatch to module handlers, fail open, timing recorded without content (ADR-0018, ADR-0021).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { normalise, patchPaths, record } from '../core/hooks/adapters.js';
import { schemas } from '../core/render/kit.js';
import { AGENTS, declaredAgent, fixture, hook, listFixtures, makeProject, probeKit, shim, toolCall } from './helpers/hooks.js';
import { KIT_ROOT, tmp, writeTree } from './helpers/fixtures.js';

const NOW = new Date('2026-10-20T12:00:00.000Z');
const NODE_PATH = [dirname(process.execPath), '/usr/bin', '/bin'].join(':');

test('every agent has recorded fixtures for its phase-1 events (Y-4.3 - Y-4.5)', () => {
  const have = (agent) => listFixtures().filter((f) => f.agent === agent).map((f) => f.name);
  for (const e of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Stop', 'Notification']) assert.ok(have('claude').includes(e), `claude ${e}`);
  // Codex has no Notification event (doc 09 §2); apply_patch is covered for the guards (Y-4.4)
  for (const e of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PreToolUse-apply_patch', 'Stop']) assert.ok(have('codex').includes(e), `codex ${e}`);
  for (const e of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Stop', 'Notification']) assert.ok(have('copilot').includes(e), `copilot ${e}`);
});

test('every fixture normalises to a valid event record that holds no content', () => {
  for (const f of listFixtures()) {
    const ev = normalise({ agent: declaredAgent(f.agent), event: f.event, payload: f.payload, now: NOW });
    assert.equal(ev.agent, f.agent, `${f.agent}/${f.name}: agent detected`);
    assert.equal(ev.event, f.event);
    assert.equal(ev.sessionId, f.payload.session_id);
    assert.equal(ev.cwd, '/home/user/projects/photo-renamer');
    const rec = record(ev, { result: null, hookMs: 3 });
    assert.deepEqual(schemas().validate('hook-event.schema.json', rec), [], `${f.agent}/${f.name}`);
    const text = JSON.stringify(rec);
    for (const secretish of [f.payload.prompt, f.payload.tool_input?.command, f.payload.last_assistant_message, f.payload.message, f.payload.transcript_path].filter(Boolean)) {
      assert.ok(!text.includes(secretish), `${f.agent}/${f.name}: record contains payload content`);
    }
  }
});

test('field mapping per agent: model id, prompt length, tool name, timestamp', () => {
  const n = (agent, name) => normalise({ agent: declaredAgent(agent), event: undefined, payload: fixture(agent, name), now: NOW });
  // Claude: model only on SessionStart (optional per the docs)
  assert.deepEqual([n('claude', 'SessionStart').modelId, n('claude', 'SessionStart').modelIdSource], ['claude-sonnet-4-6', 'payload']);
  assert.equal(n('claude', 'PreToolUse').modelId, null);
  // Codex: model on every event
  assert.deepEqual([n('codex', 'PreToolUse').modelId, n('codex', 'PreToolUse').modelIdSource], ['gpt-5-codex', 'payload']);
  // Copilot: no model in the payload
  assert.deepEqual([n('copilot', 'SessionStart').modelId, n('copilot', 'SessionStart').modelIdSource], [null, null]);
  // prompt length in code points, only on UserPromptSubmit
  const prompt = fixture('claude', 'UserPromptSubmit').prompt;
  for (const a of AGENTS) assert.equal(n(a, 'UserPromptSubmit').promptLength, [...prompt].length, a);
  assert.equal(normalise({ agent: 'claude', payload: { ...fixture('claude', 'UserPromptSubmit'), prompt: 'Grüße 👋' } }).promptLength, 7);
  assert.equal(n('claude', 'Stop').promptLength, null);
  // tools
  assert.deepEqual(n('claude', 'PreToolUse').tool, { name: 'Bash' });
  assert.deepEqual(n('codex', 'PreToolUse-apply_patch').tool, { name: 'apply_patch' });
  assert.deepEqual(n('codex', 'PreToolUse-apply_patch').input.paths, ['src/index.js']);
  assert.equal(n('copilot', 'PreToolUse').input.command, 'npm test');
  // timestamps: Copilot's own, else receipt time
  assert.equal(n('copilot', 'PreToolUse').ts, '2026-10-20T11:30:00.000Z');
  assert.equal(n('claude', 'PreToolUse').ts, NOW.toISOString());
});

test('Copilot payload under a .claude/settings.json command is told apart from Claude by its timestamp', () => {
  assert.equal(normalise({ agent: 'claude', payload: fixture('copilot', 'PreToolUse') }).agent, 'copilot');
  assert.equal(normalise({ agent: 'claude', payload: fixture('claude', 'PreToolUse') }).agent, 'claude');
  assert.equal(normalise({ agent: 'codex', payload: fixture('codex', 'PreToolUse') }).agent, 'codex');
  // Copilot may pass tool_input as a JSON string
  const p = { ...fixture('copilot', 'PreToolUse'), tool_input: JSON.stringify({ command: 'ls' }) };
  assert.equal(normalise({ agent: 'claude', payload: p }).input.command, 'ls');
});

test('apply_patch paths: add, update, delete and move', () => {
  const patch = '*** Begin Patch\n*** Add File: a.txt\n+x\n*** Update File: src/b.js\n*** Move to: src/c.js\n@@\n*** Delete File: old/d.md\n*** End Patch\n';
  assert.deepEqual(patchPaths(patch), ['a.txt', 'src/b.js', 'src/c.js', 'old/d.md']);
});

test('dispatch records the normalised event with timing in ~/.yaw/logs/hooks.jsonl, no content', async () => {
  const root = await makeProject();
  for (const agent of AGENTS) {
    const r = await hook({ root, agent: declaredAgent(agent), event: 'PreToolUse', payload: fixture(agent, 'PreToolUse') });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, '');
    const lines = readFileSync(join(r.home, '.yaw', 'logs', 'hooks.jsonl'), 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    const rec = JSON.parse(lines[0]);
    assert.deepEqual(schemas().validate('hook-event.schema.json', rec), []);
    assert.equal(rec.agent, agent);
    assert.equal(rec.result, 'allow');
    assert.equal(typeof rec.timing.hookMs, 'number');
    assert.ok(!lines[0].includes('npm test'), 'no tool input in the log');
  }
});

test('fails open: bad payload, unknown module, no manifest, handler that throws -> exit 0, no output', async () => {
  const root = await makeProject();
  const cases = [
    { payload: 'not json' },
    { payload: '' },
    { payload: fixture('claude', 'PreToolUse'), module: 'nope' },
    { payload: toolCall('claude', { command: 'rm -rf /' }), root: tmp('yaw-noproj-') },
  ];
  for (const c of cases) {
    const r = await hook({ root: c.root ?? root, agent: 'claude', event: 'PreToolUse', module: c.module ?? 'security', payload: c.payload });
    assert.deepEqual([r.code, r.stdout, r.stderr], [0, '', ''], JSON.stringify(c).slice(0, 80));
  }
  // bad arguments
  for (const args of [['hook'], ['hook', 'PreToolUse'], ['hook', 'PreToolUse', '--agent', 'gemini', '--module', 'security'], ['hook', '--frob']]) {
    const { main } = await import('../core/cli/main.js');
    const { capture } = await import('./helpers/fixtures.js');
    const { Readable } = await import('node:stream');
    const out = capture();
    const err = capture();
    const code = await main(args, { stdout: out, stderr: err, cwd: root, env: { HOME: tmp('yaw-home-') }, stdin: Readable.from(['{}']) });
    assert.deepEqual([code, out.text(), err.text()], [0, '', ''], args.join(' '));
  }
  // a throwing handler is logged (message only) and allows
  const kitRoot = probeKit({ throws: true });
  const proj = await makeProject({ kitRoot, modules: ['core', 'probe'] });
  const r = await hook({ root: proj, kitRoot, agent: 'claude', event: 'PreToolUse', module: 'probe', payload: toolCall('claude', { command: 'rm -rf /' }) });
  assert.deepEqual([r.code, r.stdout, r.stderr], [0, '', '']);
  const log = readFileSync(join(r.home, '.yaw', 'logs', 'hook-errors.log'), 'utf8');
  assert.match(log, /probe\/guard-pretooluse: handler failed/);
  assert.ok(!log.includes('rm -rf'), 'no payload content in the error log');
});

test('shim: runs the kit from YAW_KIT and blocks through it; fails open without the kit or without node', async () => {
  const root = await makeProject();
  const deny = toolCall('claude', { command: 'git push --force origin main' });
  const home = tmp('yaw-home-');
  const ok = shim({ root, agent: 'claude', event: 'PreToolUse', payload: deny, env: { HOME: home, PATH: NODE_PATH, YAW_KIT: KIT_ROOT } });
  assert.equal(ok.code, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(ok.stderr, '');
  // kit missing (default ~/.yaw/kit in an empty HOME)
  const noKit = shim({ root, agent: 'claude', event: 'PreToolUse', payload: deny, env: { HOME: home, PATH: NODE_PATH } });
  assert.deepEqual([noKit.code, noKit.stdout, noKit.stderr], [0, '', '']);
  // node missing
  const noNode = shim({ root, agent: 'claude', event: 'PreToolUse', payload: deny, env: { HOME: home, PATH: '/nonexistent', YAW_KIT: KIT_ROOT } });
  assert.deepEqual([noNode.code, noNode.stdout, noNode.stderr], [0, '', '']);
  // a vendored kit in .yaw/lib wins over YAW_KIT (ADR-0006)
  writeTree(root, { '.yaw/lib/bin/yaw': 'process.stdout.write("vendored " + process.argv.slice(2).join(" ") + "\\n");\n' });
  const vendored = shim({ root, agent: 'codex', event: 'Stop', payload: {}, env: { HOME: home, PATH: NODE_PATH, YAW_KIT: KIT_ROOT } });
  assert.equal(vendored.stdout, 'vendored hook Stop --agent codex --module security\n');
});
