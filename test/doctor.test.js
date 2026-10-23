// yaw doctor (Y-2.9): tools, kit vs. manifest pin, manifest consistency, just --list.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { doctor, runChecks } from '../core/cli/doctor.js';
import { hashContent } from '../core/render/files.js';
import { CODEX_HOOKS, HOOK_SHIM } from '../core/render/agents.js';
import { readManifest } from '../core/render/manifest.js';
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

test('doctor reports missing modules, conflicts, stale bases and an unavailable hook kit', async () => {
  const root = tmp('yaw-proj-');
  const k = kit('1.0.0');
  await initProject({ root, kitRoot: k, answersFile: writeAnswers(tmp('yaw-ans-')) });
  writeFileSync(join(root, 'notes.md'), '<<<<<<< ours\nours\n=======\ntheirs\n>>>>>>> theirs\n');
  writeFileSync(join(root, '.yaw/base/notes.md'), 'stale base\n');
  const manifest = readManifest(root);
  manifest.modules.removed = { enabled: true };
  manifest.files.push({ path: HOOK_SHIM, module: 'core', hash: hashContent('shim\n'), managed: false });
  writeFileSync(join(root, '.yaw/manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const home = tmp('yaw-home-');
  const checks = runChecks({ cwd: root, kitRoot: k, env: { PATH: process.env.PATH, HOME: home, YAW_KIT: join(home, '.yaw/kit') } });
  assert.equal(find(checks, /module "removed" is not in the installed kit/).level, 'warn');
  assert.equal(find(checks, /notes\.md has unresolved merge conflict markers/).level, 'fail');
  assert.equal(find(checks, /\.yaw\/base\/notes\.md does not match the manifest hash/).level, 'warn');
  assert.equal(find(checks, /agent hooks \(incl\. the security guards\) do nothing until the kit is installed/).level, 'warn');
});

test('doctor recognises vendored and global hook kits and prints the Codex trust note', async () => {
  const root = tmp('yaw-proj-');
  const k = kit('1.0.0');
  await initProject({ root, kitRoot: k, answersFile: writeAnswers(tmp('yaw-ans-')) });
  const manifest = readManifest(root);
  mkdirSync(join(root, '.yaw/bin'), { recursive: true });
  mkdirSync(join(root, '.codex'), { recursive: true });
  const shim = 'hook shim\n';
  const hooks = '{}\n';
  writeFileSync(join(root, HOOK_SHIM), shim);
  writeFileSync(join(root, CODEX_HOOKS), hooks);
  manifest.files.push(
    { path: HOOK_SHIM, module: 'core', hash: hashContent(shim), managed: false },
    { path: CODEX_HOOKS, module: 'core', hash: hashContent(hooks), managed: false },
  );
  writeFileSync(join(root, '.yaw/manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const home = tmp('yaw-home-');
  const globalKit = join(home, '.yaw/kit');
  mkdirSync(join(globalKit, 'bin'), { recursive: true });
  writeFileSync(join(globalKit, 'bin/yaw'), '#!/bin/sh\n', { mode: 0o755 });
  const global = runChecks({ cwd: root, kitRoot: k, env: { PATH: process.env.PATH, HOME: home } });
  assert.equal(find(global, new RegExp(`${HOOK_SHIM} finds the kit at`)).level, 'ok');
  assert.equal(find(global, /Codex runs \.codex\/hooks\.json only after you trust it/).level, 'note');

  mkdirSync(join(root, '.yaw/lib/bin'), { recursive: true });
  writeFileSync(join(root, '.yaw/lib/bin/yaw'), '#!/bin/sh\n', { mode: 0o755 });
  const vendored = runChecks({ cwd: root, kitRoot: k, env: { PATH: process.env.PATH, HOME: home } });
  assert.equal(find(vendored, /runs the vendored kit in \.yaw\/lib/).level, 'ok');
});

test('doctor warns when just is missing and maps errors to its exit status', async () => {
  const root = tmp('yaw-proj-');
  const k = kit('1.0.0');
  await initProject({ root, kitRoot: k, answersFile: writeAnswers(tmp('yaw-ans-')) });
  writeFileSync(join(root, 'justfile'), 'check:\n  true\n');
  const bin = fakeBin({ git: 'case "$1" in --version) echo "git version 2.40.0";; esac' });
  const env = { PATH: bin, HOME: tmp('yaw-home-') };
  const output = [];
  const io = { cwd: root, kitRoot: k, env, stdout: { write: (text) => output.push(text) } };
  const warningExit = await doctor({ positionals: [], io });
  assert.equal(warningExit, 0);
  assert.ok(output.join('').includes('justfile present but just is not installed'));

  writeFileSync(join(root, '.yaw/manifest.json'), 'not json\n');
  assert.equal(await doctor({ positionals: [], io }), 1);
  await assert.rejects(doctor({ positionals: ['extra'], io }), /unexpected argument/);
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
