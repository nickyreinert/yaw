// Silent-hook harness (Y-4.8, ADR-0007, BUILD.md rule 5): every recorded fixture of every agent runs
// through `yaw hook` against handlers of every kind that try to return everything. The dispatcher must
// let through only what the kind allows: evaluation -> empty stdout + exit 0; comfort -> never
// additionalContext; context -> only on SessionStart; guard -> only a PreToolUse deny.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { hasModule, loadModule } from '../core/render/kit.js';
import { EVENTS, declaredAgent, hook, listFixtures, makeProject, probeKit, shim } from './helpers/hooks.js';
import { KIT_ROOT, tmp } from './helpers/fixtures.js';

const kitRoot = probeKit();
const root = await makeProject({ kitRoot, modules: ['core', 'probe'] });
const fixtures = listFixtures();

async function kindProject(kind) {
  const k = probeKit({ kinds: [kind] });
  return { kitRoot: k, root: await makeProject({ kitRoot: k, modules: ['core', 'probe'] }) };
}

const run = (p, f) => hook({ root: p.root, kitRoot: p.kitRoot, agent: declaredAgent(f.agent), event: f.event, module: 'probe', payload: f.payload });

test('harness covers every agent and the five phase-1 events', () => {
  assert.deepEqual([...new Set(fixtures.map((f) => f.agent))], ['claude', 'codex', 'copilot']);
  for (const e of EVENTS) assert.ok(fixtures.some((f) => f.event === e), e);
});

test('evaluation hooks: empty stdout and exit 0 for every fixture of every agent', async () => {
  const p = await kindProject('evaluation');
  for (const f of fixtures) {
    const r = await run(p, f);
    assert.deepEqual([r.code, r.stdout, r.stderr], [0, '', ''], `${f.agent}/${f.name}`);
  }
});

test('comfort hooks: never additionalContext; only systemMessage / terminalSequence for Claude and Codex', async () => {
  const p = await kindProject('comfort');
  for (const f of fixtures) {
    const r = await run(p, f);
    assert.equal(r.code, 0);
    assert.doesNotMatch(r.stdout, /additionalContext|permissionDecision|leak|probe context/, `${f.agent}/${f.name}`);
    if (f.agent === 'copilot') assert.equal(r.stdout, '', `copilot/${f.name}: no user messages for Copilot`);
    else {
      const out = JSON.parse(r.stdout);
      assert.deepEqual(Object.keys(out).sort(), f.agent === 'claude' ? ['systemMessage', 'terminalSequence'] : ['systemMessage'], `${f.agent}/${f.name}`);
    }
  }
});

test('context hooks: model-visible output only on SessionStart, a few lines', async () => {
  const p = await kindProject('context');
  for (const f of fixtures) {
    const r = await run(p, f);
    assert.equal(r.code, 0);
    if (f.event !== 'SessionStart') {
      assert.equal(r.stdout, '', `${f.agent}/${f.name}`);
      continue;
    }
    const out = JSON.parse(r.stdout);
    const context = f.agent === 'copilot' ? out.additionalContext : out.hookSpecificOutput.additionalContext;
    assert.equal(context, 'probe context', `${f.agent}/${f.name}`);
    assert.doesNotMatch(r.stdout, /leak|systemMessage|permissionDecision/);
  }
});

test('guard hooks: output only for a PreToolUse deny', async () => {
  const p = await kindProject('guard');
  for (const f of fixtures) {
    const r = await run(p, f);
    assert.equal(r.code, 0);
    if (f.event !== 'PreToolUse') assert.equal(r.stdout, '', `${f.agent}/${f.name}`);
    else assert.match(r.stdout, /"permissionDecision":"deny","permissionDecisionReason":"probe says no"/, `${f.agent}/${f.name}`);
    assert.doesNotMatch(r.stdout, /additionalContext|systemMessage|leak/);
  }
});

test('all kinds at once: comfort and evaluation add nothing model-visible', async () => {
  for (const f of fixtures) {
    const r = await run({ root, kitRoot }, f);
    assert.equal(r.code, 0);
    if (r.stdout === '') continue;
    const out = JSON.parse(r.stdout);
    const ctx = out.additionalContext ?? out.hookSpecificOutput?.additionalContext;
    if (ctx !== undefined) assert.equal(f.event, 'SessionStart', `${f.agent}/${f.name}`);
    assert.doesNotMatch(r.stdout, /leak/);
  }
});

test('every hook of every kit module is token-free by kind (real modules)', async () => {
  const modules = readdirSync(join(KIT_ROOT, 'modules')).filter((m) => hasModule(KIT_ROOT, m));
  const project = await makeProject({ modules: ['core', 'security'] });
  for (const m of modules) {
    for (const h of loadModule(KIT_ROOT, m).outputs?.hooks ?? []) {
      assert.ok(['guard', 'context', 'comfort', 'evaluation'].includes(h.kind), `${m}/${h.name}`);
      if (h.kind === 'context') assert.equal(h.event, 'SessionStart', `${m}/${h.name}: context only on SessionStart (ADR-0007)`);
    }
  }
  // the recorded fixtures are harmless calls: the security guards print nothing for them
  for (const f of fixtures) {
    const r = await hook({ root: project, agent: declaredAgent(f.agent), event: f.event, module: 'security', payload: f.payload });
    assert.deepEqual([r.code, r.stdout], [0, ''], `${f.agent}/${f.name}`);
  }
});

test('through the real shim in a child process: silent for harmless calls', async () => {
  const project = await makeProject({ modules: ['core', 'security'] });
  const env = { HOME: tmp('yaw-home-'), PATH: [dirname(process.execPath), '/usr/bin', '/bin'].join(':'), YAW_KIT: KIT_ROOT };
  for (const f of fixtures) {
    const r = shim({ root: project, agent: declaredAgent(f.agent), event: f.event, payload: f.payload, env });
    assert.deepEqual([r.code, r.stdout, r.stderr], [0, '', ''], `${f.agent}/${f.name}`);
  }
});
