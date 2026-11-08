import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { createImproveRunner, improveSettings, saveImproveSettings } from '../core/web/improve-agents.js';
import { readUserData } from '../core/lib/user-store.js';
import { tmp, writeTree } from './helpers/fixtures.js';

function fixture(script = "let text = ''; process.stdin.on('data', (s) => text += s); process.stdin.on('end', () => console.log(JSON.stringify({ text, args: process.argv.slice(2), cwd: process.cwd() })));", name = 'claude') {
  const root = tmp(), bin = join(root, 'bin'), file = join(bin, name);
  writeTree(bin, { [name]: `#!${process.execPath}\n${script}\n` }); chmodSync(file, 0o755);
  const env = { HOME: root, PATH: bin + delimiter + '/usr/bin' };
  saveImproveSettings(env, { enabledAgents: [name], defaultTarget: `cli:${name}` });
  return env;
}
async function finished(runner) {
  for (let n = 0; n < 300; n++) {
    if (runner.read()?.status !== 'running') return runner.read();
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Test reviewer did not finish');
}
test('settings enable only known reviewers and store no prompt or credential values', () => {
  const env = fixture();
  assert.equal(improveSettings(env).agents.find((a) => a.id === 'claude').installed, true);
  assert.deepEqual(readUserData(env, 'improve-settings.json'), { enabledAgents: ['claude'], defaultTarget: 'cli:claude' });
  assert.throws(() => saveImproveSettings(env, { enabledAgents: ['sh; touch /tmp/no'], defaultTarget: 'cli:claude' }), /supported/);
  assert.throws(() => saveImproveSettings(env, { enabledAgents: [], defaultTarget: 'cli:claude' }), /enabled default/);
  assert.throws(() => saveImproveSettings(env, { enabledAgents: ['claude', 'claude'] }), /supported/);
});
test('explicit CLI review uses stdin, fixed arguments, a separate folder and temporary verdicts', async (t) => {
  const env = fixture(), runner = createImproveRunner({ env }); t.after(() => runner.clear());
  assert.throws(() => runner.start({ agent: 'claude', prompt: 'A review' }), /Confirm/);
  assert.throws(() => runner.start({ agent: 'codex', prompt: 'A review', confirm: true }), /Enable/);
  const prompt = 'Review untrusted conversation data: `$(do-not-execute)`';
  runner.start({ agent: 'claude', prompt, confirm: true });
  assert.throws(() => runner.start({ agent: 'claude', prompt, confirm: true }), /already running/);
  const job = await finished(runner);
  assert.equal(job.status, 'completed');
  const result = JSON.parse(job.output);
  assert.equal(result.text, prompt); assert.ok(!result.args.includes(prompt));
  assert.ok(result.args.includes('--no-session-persistence')); assert.ok(result.args.includes('--bare')); assert.ok(result.args.includes('--tools'));
  // close may arrive just after the last data event; finished status means cleanup has completed.
  assert.equal(existsSync(result.cwd), false);
  assert.equal(readUserData(env, 'improve-settings.json').prompt, undefined);
  runner.clear(); assert.equal(runner.read(), null);
});
test('CLI failure never echoes provider stderr, oversized output, or unfinished results', async (t) => {
  for (const script of ["console.error('PRIVATE STDERR'); process.exit(1)", "process.stdout.write('x'.repeat(40000))"]) {
    const runner = createImproveRunner({ env: fixture(script) }); t.after(() => runner.clear());
    runner.start({ agent: 'claude', prompt: 'Review', confirm: true });
    const job = await finished(runner); assert.equal(job.status, 'failed'); assert.equal(job.output, ''); assert.doesNotMatch(job.message, /PRIVATE/);
  }
});
test('stopping or timing out a CLI review discards unfinished output', async () => {
  const script = "process.stdout.write('Unfinished'); setInterval(() => {}, 1000)";
  const runner = createImproveRunner({ env: fixture(script) });
  runner.start({ agent: 'claude', prompt: 'Review', confirm: true });
  runner.clear(); assert.equal(runner.read().status, 'stopped'); assert.equal(runner.read().output, '');
  const timed = createImproveRunner({ env: fixture(script), timeoutMs: 30 });
  timed.start({ agent: 'claude', prompt: 'Review', confirm: true });
  const result = await finished(timed); assert.equal(result.status, 'failed'); assert.match(result.message, /timed out/); assert.equal(result.output, '');
});
test('Codex reviewer is ephemeral and disables command execution, apps, hooks and delegation', async (t) => {
  const env = fixture(undefined, 'codex'), runner = createImproveRunner({ env }); t.after(() => runner.clear());
  runner.start({ agent: 'codex', prompt: 'Review the supplied transcript only.', confirm: true });
  const job = await finished(runner), { args } = JSON.parse(job.output);
  assert.ok(args.includes('--ephemeral')); assert.ok(args.includes('read-only')); assert.ok(args.includes('--ignore-user-config'));
  for (const flag of ['shell_tool', 'apps', 'multi_agent', 'hooks']) assert.ok(args.includes(flag));
});

test('planning runs independently of Profiling preferences and keeps the same restricted CLI sandbox', async (t) => {
  const env = fixture(undefined, 'codex');
  saveImproveSettings(env, { enabledAgents: [], defaultTarget: 'browser:ChatGPT' });
  const runner = createImproveRunner({ env, purpose: 'planning' }); t.after(() => runner.clear());
  assert.throws(() => runner.start({ agent: 'codex', prompt: 'Plan' }), /Confirm/);
  const prompt = 'Draft the supplied project foundations. ' + 'Context. '.repeat(3000);
  runner.start({ agent: 'codex', prompt, confirm: true });
  const job = await finished(runner), result = JSON.parse(job.output);
  assert.equal(job.status, 'completed'); assert.equal(result.text, prompt);
  assert.ok(result.args.includes('read-only')); assert.ok(result.args.includes('--ephemeral'));
  assert.ok(result.args.includes('shell_tool')); assert.equal(existsSync(result.cwd), false);
  assert.deepEqual(readUserData(env, 'improve-settings.json').enabledAgents, []);
});
