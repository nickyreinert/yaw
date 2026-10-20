// yaw doctor (Y-2.9): tools, kit vs. manifest pin, manifest consistency, just --list.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runChecks } from '../core/cli/doctor.js';
import { initProject } from '../core/render/project.js';
import { makeKit, tmp, writeAnswers } from './helpers/fixtures.js';

const kit = (version) => makeKit(tmp('yaw-kit-'), { version, modules: { core: { templates: { 'AGENTS.md': '# A\n', 'notes.md': 'n\n' } } } });

function fakeBin(tools) {
  const bin = tmp('yaw-bin-');
  for (const [name, script] of Object.entries(tools)) writeFileSync(join(bin, name), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  return bin;
}

const find = (checks, re) => checks.find((c) => re.test(c.message));

test('doctor outside a project checks the tools only', () => {
  const k = kit('1.0.0');
  const checks = runChecks({ cwd: tmp(), kitRoot: k, env: { PATH: '' }, nodeVersion: '22.12.0' });
  assert.equal(find(checks, /^node 22\.12\.0/).level, 'fail');
  assert.equal(find(checks, /^git not found/).level, 'fail');
  assert.equal(find(checks, /^just not found/).level, 'warn');
  assert.equal(find(checks, /^yaw is not on PATH/).level, 'warn');
  assert.equal(find(checks, /no project here/).level, 'ok');
  const ok = runChecks({ cwd: tmp(), kitRoot: k, nodeVersion: '22.13.0', env: { PATH: process.env.PATH } });
  assert.equal(find(ok, /^node 22\.13\.0/).level, 'ok');
});

test('doctor checks the kit pin, missing files and base copies', async () => {
  const root = tmp('yaw-proj-');
  await initProject({ root, kitRoot: kit('1.0.0'), answersFile: writeAnswers(tmp('yaw-ans-')) });
  const env = { PATH: process.env.PATH };
  assert.equal(find(runChecks({ cwd: root, kitRoot: kit('1.0.0'), env }), /= installed kit/).level, 'ok');
  assert.equal(find(runChecks({ cwd: root, kitRoot: kit('1.1.0'), env }), /run yaw update/).level, 'warn');
  assert.equal(find(runChecks({ cwd: root, kitRoot: kit('0.9.0'), env }), /is older: run yaw self-update --tag v1\.0\.0/).level, 'fail');

  rmSync(join(root, 'notes.md'));
  rmSync(join(root, '.yaw/base/AGENTS.md'));
  const checks = runChecks({ cwd: root, kitRoot: kit('1.0.0'), env });
  assert.equal(find(checks, /^notes\.md is missing/).level, 'warn');
  assert.equal(find(checks, /^\.yaw\/base\/AGENTS\.md is missing/).level, 'warn');

  writeFileSync(join(root, '.yaw/manifest.json'), '{"kit": "1.0.0"}');
  assert.equal(find(runChecks({ cwd: root, kitRoot: kit('1.0.0'), env }), /manifest\.json/).level, 'fail');
});

test('doctor runs just --list when the project has a justfile', async () => {
  const root = tmp('yaw-proj-');
  await initProject({ root, kitRoot: kit('1.0.0'), answersFile: writeAnswers(tmp('yaw-ans-')) });
  writeFileSync(join(root, 'justfile'), 'check:\n  true\n');
  const good = fakeBin({ just: 'exit 0' });
  assert.equal(find(runChecks({ cwd: root, kitRoot: kit('1.0.0'), env: { PATH: `${good}:${process.env.PATH}` } }), /just --list works/).level, 'ok');
  const bad = fakeBin({ just: 'echo "error: recipe check defined twice" >&2; exit 1' });
  assert.equal(find(runChecks({ cwd: root, kitRoot: kit('1.0.0'), env: { PATH: `${bad}:${process.env.PATH}` } }), /just --list failed: error: recipe check defined twice/).level, 'fail');
});

test('doctor recognises the yaw link of this kit', () => {
  const k = kit('1.0.0');
  mkdirSync(join(k, 'bin'));
  writeFileSync(join(k, 'bin', 'yaw'), '#!/bin/sh\n', { mode: 0o755 });
  const bin = tmp('yaw-bin-');
  symlinkSync(join(k, 'bin', 'yaw'), join(bin, 'yaw'));
  assert.equal(find(runChecks({ cwd: tmp(), kitRoot: k, env: { PATH: bin } }), /^yaw on PATH -> /).level, 'ok');
  const other = fakeBin({ yaw: 'exit 0' });
  assert.equal(find(runChecks({ cwd: tmp(), kitRoot: k, env: { PATH: other } }), /is a different kit/).level, 'warn');
});
