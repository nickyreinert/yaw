// Hook kind `compress` (T-052, ADR-0007 amendment, BUILD.md rule 5, kickoff/16-compact-output.md §5): on
// PostToolUse only, a handler may return a shorter `updatedToolOutput` in the tool's own shape. The dispatcher
// drops any result that is not smaller than the original ("never worse"), hands `tool_response` to compress
// handlers only, and never writes tool output to a log. Payloads: the recorded T-047 fixtures.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { allowed } from '../core/hooks/policy.js';
import { schemas } from '../core/render/kit.js';
import { fixture, hook, makeProject } from './helpers/hooks.js';
import { makeKit, tmp, writeTree } from './helpers/fixtures.js';

const MARK = 'SECRET-OUTPUT-MARK';

// A kit with `core` and a module `squeeze` whose hooks all run the same handler body.
async function squeeze(body, hooks = ['{ name: shorten, event: PostToolUse, matcher: "Bash|Grep|Read", kind: compress }']) {
  const kitRoot = makeKit(tmp('yaw-squeezekit-'), { modules: { core: { templates: { 'AGENTS.md.tmpl': '# Agents\n' } } } });
  writeTree(kitRoot, {
    'modules/squeeze/module.yaml': [
      'name: squeeze',
      'description: Fixture module with output compression hooks.',
      'depends: [core]',
      'default: { quick: false, standard: false, full: false }',
      'outputs:',
      '  hooks:',
      ...hooks.map((h) => `    - ${h}`),
      'agents:',
      '  claude: { support: native }',
      '  codex: { support: native }',
      '  copilot: { support: native }',
      'tokenCost: none',
      'lastVerified: 2026-11-08',
      '',
    ].join('\n'),
  });
  for (const h of hooks) {
    const name = /name: ([\w-]+)/.exec(h)[1];
    const file = join(kitRoot, 'modules', 'squeeze', 'hooks', `${name}.js`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, body);
  }
  return { kitRoot, root: await makeProject({ kitRoot, modules: ['core', 'squeeze'] }) };
}

// Shortens each recorded tool shape; `grow: true` makes the result larger, `same: true` returns it unchanged.
const SHORTEN = `export default function (ev, { toolResponse }) {
  const r = toolResponse;
  if (ev.tool.name === 'Bash') return { updatedToolOutput: { ...r, stdout: 'hi' }, method: 'cap' };
  if (ev.tool.name === 'Grep') return { updatedToolOutput: { ...r, content: 'b.txt:1:foo here', numLines: 1 }, method: 'grep-group' };
  if (ev.tool.name === 'Read') return { updatedToolOutput: { ...r, file: { ...r.file, content: 'line one\\n', numLines: 1 } }, method: 'lockfile' };
  return null;
}
`;

const run = (p, name, { agent = 'claude', env, payload } = {}) => {
  const f = payload ?? fixture('claude', name);
  return hook({ root: p.root, kitRoot: p.kitRoot, agent, event: f.hook_event_name, module: 'squeeze', payload: f, env });
};

test('policy: compress returns only a smaller updatedToolOutput, on PostToolUse, for Claude Code', () => {
  const original = { stdout: 'x'.repeat(100), stderr: '' };
  const smaller = { stdout: 'x', stderr: '' };
  const ok = allowed({ kind: 'compress', event: 'PostToolUse', agent: 'claude', original, result: { updatedToolOutput: smaller, method: 'cap', context: 'leak', systemMessage: 'leak' } });
  assert.deepEqual(ok.updatedToolOutput, smaller);
  assert.deepEqual(ok.compressed, { rawBytes: JSON.stringify(original).length, outBytes: JSON.stringify(smaller).length, method: 'cap' });
  assert.deepEqual(Object.keys(ok).sort(), ['compressed', 'updatedToolOutput']);
  // never worse: equal or larger is dropped
  assert.deepEqual(allowed({ kind: 'compress', event: 'PostToolUse', agent: 'claude', original, result: { updatedToolOutput: original } }), {});
  assert.deepEqual(allowed({ kind: 'compress', event: 'PostToolUse', agent: 'claude', original, result: { updatedToolOutput: { ...original, stdout: `${original.stdout}!` } } }), {});
  // PostToolUse only, Claude Code only, an original is required, the shape's JSON type is kept
  for (const event of ['PreToolUse', 'PostToolUseFailure', 'SessionStart', 'Stop']) {
    assert.deepEqual(allowed({ kind: 'compress', event, agent: 'claude', original, result: { updatedToolOutput: smaller } }), {}, event);
  }
  for (const agent of ['codex', 'copilot']) assert.deepEqual(allowed({ kind: 'compress', event: 'PostToolUse', agent, original, result: { updatedToolOutput: smaller } }), {}, agent);
  assert.deepEqual(allowed({ kind: 'compress', event: 'PostToolUse', agent: 'claude', original: undefined, result: { updatedToolOutput: smaller } }), {});
  assert.deepEqual(allowed({ kind: 'compress', event: 'PostToolUse', agent: 'claude', original, result: { updatedToolOutput: 'x' } }), {});
  assert.deepEqual(allowed({ kind: 'compress', event: 'PostToolUse', agent: 'claude', original, result: { updatedToolOutput: null } }), {});
  // the method is a short identifier or left out: it goes to the log, so it can carry no output
  assert.equal(allowed({ kind: 'compress', event: 'PostToolUse', agent: 'claude', original, result: { updatedToolOutput: smaller, method: `cap ${MARK}\n` } }).compressed.method, null);
  // other kinds never replace output
  for (const kind of ['guard', 'context', 'comfort', 'evaluation']) {
    assert.equal(allowed({ kind, event: 'PostToolUse', agent: 'claude', original, result: { updatedToolOutput: smaller } }).updatedToolOutput, undefined, kind);
  }
});

test('Bash, Grep and Read fixtures: the shorter output goes back as hookSpecificOutput.updatedToolOutput', async () => {
  const p = await squeeze(SHORTEN);
  for (const name of ['PostToolUse-Bash', 'PostToolUse-Grep', 'PostToolUse-Read']) {
    const r = await run(p, name);
    assert.equal(r.code, 0);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(Object.keys(out), ['hookSpecificOutput'], name);
    assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUse');
    const original = fixture('claude', name).tool_response;
    // the tool's own shape: same keys as the recorded tool_response
    assert.deepEqual(Object.keys(out.hookSpecificOutput.updatedToolOutput).sort(), Object.keys(original).sort(), name);
    assert.ok(JSON.stringify(out.hookSpecificOutput.updatedToolOutput).length < JSON.stringify(original).length, name);
  }
});

test('never worse: a result that is not smaller is dropped', async () => {
  const grow = await squeeze('export default (ev, { toolResponse: r }) => ({ updatedToolOutput: { ...r, stdout: r.stdout + "\\n[full output: yaw recall 0123456789abcdef]" } });\n');
  const same = await squeeze('export default (ev, { toolResponse: r }) => ({ updatedToolOutput: { ...r } });\n');
  for (const p of [grow, same]) assert.deepEqual([(await run(p, 'PostToolUse-Bash')).stdout], ['']);
});

test('failures and other agents: no replacement on PostToolUseFailure, nothing for Codex or Copilot', async () => {
  const p = await squeeze(SHORTEN, ['{ name: shorten, event: PostToolUse, kind: compress }', '{ name: onfail, event: PostToolUseFailure, kind: compress }']);
  assert.equal((await run(p, 'PostToolUseFailure-Bash-exit3')).stdout, '');
  const copilot = { ...fixture('claude', 'PostToolUse-Bash'), timestamp: 1762600000000 };
  assert.equal((await run(p, null, { payload: copilot })).stdout, '');
  const codex = { ...fixture('codex', 'PreToolUse'), hook_event_name: 'PostToolUse', tool_response: fixture('claude', 'PostToolUse-Bash').tool_response };
  assert.equal((await run(p, null, { agent: 'codex', payload: codex })).stdout, '');
});

test('tool output reaches compress handlers only, and never a log', async () => {
  const home = tmp('yaw-home-');
  const peek = `import { appendFileSync } from 'node:fs';
export default function (ev, ctx) {
  appendFileSync(ctx.env.HOME + '/seen.jsonl', JSON.stringify({ kind: ctx.item.kind, hasOutput: Object.hasOwn(ctx, 'toolResponse'), ev }) + '\\n');
  if (ctx.item.kind !== 'compress') return { updatedToolOutput: { stdout: '' } };
  if (ctx.item.name === 'boom') throw new Error('failed on ' + ctx.toolResponse.stdout);
  return { updatedToolOutput: { ...ctx.toolResponse, stdout: 'hi' }, method: 'cap' };
}
`;
  const p = await squeeze(peek, [
    '{ name: watch, event: PostToolUse, kind: evaluation }',
    '{ name: talk, event: PostToolUse, kind: comfort }',
    '{ name: boom, event: PostToolUse, kind: compress }',
    '{ name: shorten, event: PostToolUse, kind: compress }',
  ]);
  const payload = fixture('claude', 'PostToolUse-Bash');
  payload.tool_response.stdout = `${MARK}\n${'line\n'.repeat(200)}`;
  const r = await run(p, null, { payload, env: { HOME: home } });
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.updatedToolOutput.stdout, 'hi');
  const seen = readFileSync(join(home, 'seen.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(seen.map((s) => [s.kind, s.hasOutput]), [['evaluation', false], ['comfort', false], ['compress', true], ['compress', true]]);
  for (const s of seen) assert.doesNotMatch(JSON.stringify(s.ev), new RegExp(MARK));
  // logs: the record carries sizes and the method, the error log the error's name only
  const logs = join(home, '.yaw', 'logs');
  for (const f of readdirSync(logs)) assert.doesNotMatch(readFileSync(join(logs, f), 'utf8'), new RegExp(MARK), f);
  const rec = JSON.parse(readFileSync(join(logs, 'hooks.jsonl'), 'utf8').trim());
  assert.deepEqual(schemas().validate('hook-event.schema.json', rec), []);
  assert.deepEqual([rec.result, rec.method, rec.rawBytes, rec.outBytes], ['ok', 'cap', Buffer.byteLength(JSON.stringify(payload.tool_response)), Buffer.byteLength(JSON.stringify({ ...payload.tool_response, stdout: 'hi' }))]);
  assert.match(readFileSync(join(logs, 'hook-errors.log'), 'utf8'), /squeeze\/boom: Error \(message not logged\)/);
});

test('hook-event schema: sizes and method are optional; method is a short identifier', () => {
  const base = JSON.parse(readFileSync(new URL('../core/schema/examples/hook-event/claude-pre-tool-use.json', import.meta.url), 'utf8'));
  const v = (rec) => schemas().validate('hook-event.schema.json', rec).length;
  assert.equal(v(base), 0);
  assert.equal(v({ ...base, event: 'PostToolUse', nativeEvent: 'PostToolUse', result: 'ok', rawBytes: 445000, outBytes: 5600, method: 'cap' }), 0);
  assert.ok(v({ ...base, method: 'output text here' }) > 0);
  assert.ok(v({ ...base, rawBytes: -1 }) > 0);
});

test('module schema: compress is a hook kind', () => {
  const def = { name: 'x', description: 'd', default: { quick: false, standard: false, full: false }, agents: {}, tokenCost: 'none', lastVerified: '2026-11-08', outputs: { hooks: [{ name: 'shorten', event: 'PostToolUse', matcher: 'Bash', kind: 'compress' }] } };
  assert.deepEqual(schemas().validate('module.schema.json', def), []);
});
