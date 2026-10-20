// Dogfooding (Y-3.8, BUILD.md rule 9, BD7): this repo is set up with YAW itself, profile node-cli.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readManifest } from '../core/render/manifest.js';
import { fileStates } from '../core/render/project.js';
import { KIT_ROOT, hasTool, run } from './helpers/fixtures.js';

test('this repo has a valid YAW manifest for node-cli with core', () => {
  const m = readManifest(KIT_ROOT);
  assert.ok(m, '.yaw/manifest.json exists');
  assert.deepEqual(m.profiles, ['node-cli']);
  assert.deepEqual(Object.keys(m.modules), ['core']);
  for (const f of ['AGENTS.md', 'CLAUDE.md', 'justfile', 'just/node-cli.just', '.yaw/answers.yaml']) {
    assert.ok(m.files.some((x) => x.path === f), f);
  }
});

test('no managed file of this repo is missing or in conflict', () => {
  const states = fileStates(KIT_ROOT, readManifest(KIT_ROOT));
  assert.deepEqual(states.filter((s) => s.state === 'missing' || s.state === 'conflict').map((s) => s.path), []);
});

test('the repo keeps its own package.json and its ADRs in docs/adr/ (BD7)', () => {
  assert.ok(!readManifest(KIT_ROOT).files.some((f) => f.path === 'package.json'), 'no scaffold in a repo with code');
  assert.ok(existsSync(join(KIT_ROOT, 'docs', 'adr', '0009-terminology-and-preset-contents.md')));
  assert.ok(!existsSync(join(KIT_ROOT, '.decisions')));
});

test('just check runs the kit tests (npm test)', () => {
  assert.match(readFileSync(join(KIT_ROOT, 'just', 'node-cli.just'), 'utf8'), /^test:\n {4}npm test$/m);
  assert.match(JSON.parse(readFileSync(join(KIT_ROOT, 'package.json'), 'utf8')).scripts.test, /^node --test /);
});

test('just --list works in the repo', { skip: !hasTool('just') && 'just is not installed' }, () => {
  const r = run('just', ['--list'], { cwd: KIT_ROOT });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^ {4}check\b/m);
});
