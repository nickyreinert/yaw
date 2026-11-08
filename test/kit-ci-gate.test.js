// T-021: kit-ci.yml has a cheap automatic PR gate; the full suite runs nightly, on dispatch, milestones and epics;
// the profile matrix and macOS stay manual (ADR-0008).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '../core/lib/yaml.js';
import { KIT_ROOT } from './helpers/fixtures.js';

const text = readFileSync(join(KIT_ROOT, '.github', 'workflows', 'kit-ci.yml'), 'utf8');
const doc = parse(text, { file: 'kit-ci.yml' });
const runs = (job) => (doc.jobs[job]?.steps ?? []).map((s) => s.run).filter(Boolean).join('\n');

test('triggers: pull_request, nightly schedule, dispatch, milestone and epic events', () => {
  const on = doc.on;
  assert.ok(Object.hasOwn(on, 'pull_request'));
  assert.ok(Object.hasOwn(on, 'workflow_dispatch'));
  assert.ok(Array.isArray(on.schedule) && on.schedule.length === 1);
  assert.match(on.schedule[0].cron, /^\d+ \d+ \* \* \*$/, 'nightly');
  assert.ok(on.milestone.types.includes('closed'));
  assert.deepEqual(on.issues.types, ['labeled']);
  assert.ok(!Object.hasOwn(on, 'push'));
});

test('gate job: Ubuntu, Node 22, validate, shellcheck and core tests without server-mode and profile tests', () => {
  const gate = doc.jobs.gate;
  assert.ok(gate, 'gate job');
  assert.match(gate['runs-on'], /^ubuntu-/);
  assert.match(gate.if, /pull_request/);
  const node = gate.steps.find((s) => s.uses?.startsWith('actions/setup-node@'));
  assert.match(String(node.with['node-version']), /^22(\.|$)/);
  const script = runs('gate');
  assert.match(script, /npm run validate/);
  assert.match(script, /shellcheck/);
  assert.match(script, /node --test/);
  assert.doesNotMatch(script, /npm test/);
  for (const excluded of ['server-mode', 'profiles', 'basic-profiles', 'profile-options']) assert.ok(script.includes(excluded), `${excluded} excluded`);
});

test('pull_request runs only the gate: no profile matrix, no macOS, no full suite', () => {
  for (const [name, job] of Object.entries(doc.jobs)) {
    if (name === 'gate') continue;
    assert.ok(job.if, `${name} has a condition`);
    assert.match(job.if, /!= 'pull_request'|== 'workflow_dispatch'|== 'schedule'/, `${name} skips pull_request`);
  }
  assert.match(doc.jobs.profile.if, /== 'workflow_dispatch'/);
  assert.doesNotMatch(doc.jobs.profile.if, /schedule|milestone|issues/);
  const osList = doc.jobs.test.strategy.matrix.os;
  assert.match(String(osList), /workflow_dispatch/, 'macOS only on manual dispatch');
  assert.equal(doc.jobs.profile['runs-on'].includes('macos-latest'), true, 'macOS profile stays, behind the manual condition');
});

test('full suite runs npm test; issues events run only for the epic label; nightly writes a dated summary', () => {
  assert.match(runs('test'), /npm test/);
  assert.match(doc.jobs.test.if, /issues/);
  assert.match(doc.jobs.test.if, /label\.name == 'epic'/);
  const summary = doc.jobs['nightly-summary'];
  assert.ok(summary);
  assert.match(summary.if, /schedule/);
  assert.match(summary.if, /always\(\)/);
  assert.match(runs('nightly-summary'), /GITHUB_STEP_SUMMARY/);
  assert.match(runs('nightly-summary'), /date/);
});
