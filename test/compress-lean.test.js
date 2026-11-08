// Lean compress entry and shim size gate (T-053, kickoff/16-compact-output.md §5 latency plan, steps 2 and 3).
// The checks do not compare milliseconds: they count what the prototype's speed came from. The lean entry loads
// neither the kit nor the schemas (module-load instrumentation); the shim starts no Node below the payload
// threshold (a fake `node` on PATH records every start).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { hookCommand, hookParts } from '../core/render/agents.js';
import { fixture, makeProject } from './helpers/hooks.js';
import { KIT_ROOT, makeKit, tmp, writeTree } from './helpers/fixtures.js';

const SHORTEN = "export default function (ev, { toolResponse: r }) { return { updatedToolOutput: { ...r, stdout: 'hi' }, method: 'cap' }; }\n";

async function squeeze(hooks = ['{ name: shorten, event: PostToolUse, matcher: Bash, kind: compress }']) {
  const kitRoot = makeKit(tmp('yaw-leankit-'), { modules: { core: { templates: { 'AGENTS.md.tmpl': '# Agents\n' } } } });
  writeTree(kitRoot, {
    'modules/squeeze/module.yaml': [
      'name: squeeze', 'description: Fixture module with an output compression hook.', 'depends: [core]',
      'default: { quick: false, standard: false, full: false }', 'outputs:', '  hooks:', ...hooks.map((h) => `    - ${h}`),
      'agents:', '  claude: { support: native }', '  codex: { support: native }', '  copilot: { support: native }',
      'tokenCost: none', 'lastVerified: 2026-11-08', '',
    ].join('\n'),
  });
  for (const h of hooks) {
    const file = join(kitRoot, 'modules', 'squeeze', 'hooks', `${/name: ([\w-]+)/.exec(h)[1]}.js`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, SHORTEN);
  }
  return { kitRoot, root: await makeProject({ kitRoot, modules: ['core', 'squeeze'] }) };
}

const bigBash = () => {
  const p = fixture('claude', 'PostToolUse-Bash');
  p.tool_response.stdout = 'line\n'.repeat(400);
  return p;
};

test('lean entry: compresses without loading the kit, the schemas or the CLI', async () => {
  const { kitRoot, root } = await squeeze();
  const dir = tmp('yaw-leanrun-');
  const log = join(dir, 'loaded.txt');
  // A loader that records every module URL Node resolves, then runs the entry the way the shim does.
  writeFileSync(join(dir, 'trace.mjs'), `import { appendFileSync } from 'node:fs';\nexport async function resolve(spec, ctx, next) { const r = await next(spec, ctx); appendFileSync(${JSON.stringify(log)}, r.url + '\\n'); return r; }\n`);
  writeFileSync(join(dir, 'register.mjs'), `import { register } from 'node:module';\nregister(${JSON.stringify(pathToFileURL(join(dir, 'trace.mjs')).href)});\n`);
  writeFileSync(join(dir, 'run.mjs'), `import { runCompress } from ${JSON.stringify(pathToFileURL(join(KIT_ROOT, 'core', 'hooks', 'compress.js')).href)};\nprocess.exitCode = await runCompress(['PostToolUse', '--agent', 'claude', '--module', 'squeeze', '--compress'], { kitRoot: ${JSON.stringify(kitRoot)} });\n`);
  const home = tmp('yaw-home-');
  const r = spawnSync(process.execPath, ['--no-warnings', '--import', pathToFileURL(join(dir, 'register.mjs')).href, join(dir, 'run.mjs')], {
    input: JSON.stringify(bigBash()), encoding: 'utf8', cwd: root, env: { ...process.env, HOME: home },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.updatedToolOutput.stdout, 'hi');
  const loaded = readFileSync(log, 'utf8').split('\n').filter((u) => u.startsWith('file:')).map((u) => u.replace(`file://${KIT_ROOT}/`, ''));
  assert.ok(loaded.includes('core/hooks/compress.js'));
  for (const heavy of [/^core\/render\/kit\.js$/, /^core\/render\/manifest\.js$/, /^core\/schema\//, /^core\/cli\//, /^core\/hooks\/dispatch\.js$/, /node_modules/]) {
    assert.deepEqual(loaded.filter((f) => heavy.test(f)), [], String(heavy));
  }
  // the event record is still written, with sizes and method and no output
  const rec = JSON.parse(readFileSync(join(home, '.yaw', 'logs', 'hooks.jsonl'), 'utf8').trim());
  assert.deepEqual([rec.event, rec.result, rec.method], ['PostToolUse', 'ok', 'cap']);
});

test('lean entry: a disabled or missing module and a payload that is not JSON end silently', async () => {
  const { root } = await squeeze();
  const dir = tmp('yaw-leanrun-');
  const run = (args, input) => spawnSync(process.execPath, [join(KIT_ROOT, 'core', 'hooks', 'compress.js'), ...args], { input, encoding: 'utf8', cwd: root, env: { ...process.env, HOME: dir } });
  for (const [args, input] of [
    [['PostToolUse', '--agent', 'claude', '--module', 'nope', '--compress'], JSON.stringify(bigBash())],
    [['PostToolUse', '--agent', 'claude', '--module', 'squeeze', '--compress'], '{not json'],
    [['--agent', 'claude'], '{}'],
  ]) {
    const r = run(args, input);
    assert.deepEqual([r.status, r.stdout, r.stderr], [0, '', '']);
  }
});

// A project shim run with a fake `node` that records each start.
function shimRun(root, args, payload) {
  const bin = tmp('yaw-fakenode-');
  const log = join(bin, 'starts.txt');
  writeFileSync(join(bin, 'node'), `#!/bin/sh\necho "$@" >> ${JSON.stringify(log)}\ncat >/dev/null\n`);
  chmodSync(join(bin, 'node'), 0o755);
  const r = spawnSync('/bin/sh', [join(root, '.yaw', 'bin', 'yaw-hook'), ...args], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload), encoding: 'utf8', cwd: tmp('yaw-elsewhere-'),
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: tmp('yaw-home-'), YAW_KIT: KIT_ROOT },
  });
  return { code: r.status, stdout: r.stdout, starts: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [] };
}

test('shim: a compress entry starts no Node below the payload threshold, and counts the whole payload', async () => {
  const { root } = await squeeze();
  const args = ['PostToolUse', '--agent', 'claude', '--module', 'squeeze', '--compress'];
  const small = fixture('claude', 'PostToolUse-Bash');
  small.tool_response = { stdout: 'ok\n', stderr: '', interrupted: false };
  small.tool_input = { command: 'true' };
  assert.ok(JSON.stringify(small).length < 1024);
  assert.deepEqual(shimRun(root, args, small), { code: 0, stdout: '', starts: [] });

  // small output, large tool input: the payload is over the threshold, so Node starts
  const wide = structuredClone(small);
  wide.tool_input = { command: `echo ${'x'.repeat(1100)}` };
  const started = shimRun(root, args, wide);
  assert.equal(started.starts.length, 1);
  assert.match(started.starts[0], /core\/hooks\/compress\.js PostToolUse --agent claude --module squeeze --compress$/);

  // multi-byte text is counted in bytes: 400 characters of 3 bytes each pass the gate
  const bytes = structuredClone(small);
  bytes.tool_response.stdout = '€'.repeat(400);
  assert.equal(shimRun(root, args, bytes).starts.length, 1);

  // without the flag the shim starts `yaw hook` whatever the size
  const plain = shimRun(root, ['PostToolUse', '--agent', 'claude', '--module', 'squeeze'], small);
  assert.equal(plain.starts.length, 1);
  assert.match(plain.starts[0], /bin\/yaw hook PostToolUse/);
});

test('registration: only a module whose hooks on the event are all compress gets the compress entry', () => {
  assert.match(hookCommand('claude', 'PostToolUse', 'squeeze', true), /--module squeeze --compress$/);
  assert.doesNotMatch(hookCommand('claude', 'PostToolUse', 'squeeze'), /--compress/);
  const def = (hooks) => ({ name: 'm', agents: { claude: { support: 'native' } }, outputs: { hooks } });
  const command = (hooks) => JSON.parse(hookParts({ definitions: new Map([['m', def(hooks)]]), modules: ['m'], agents: ['claude'] })[0].content).hooks.PostToolUse[0].hooks[0].command;
  const compress = { name: 'a', event: 'PostToolUse', matcher: 'Bash', kind: 'compress' };
  assert.match(command([compress, { ...compress, name: 'b', matcher: 'Grep' }]), /--compress$/);
  assert.doesNotMatch(command([compress, { name: 'c', event: 'PostToolUse', kind: 'evaluation' }]), /--compress/);
});
