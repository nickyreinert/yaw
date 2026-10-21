// git-hooks (Y-5.4, ADR-0026): lefthook.yml, hooks-install, a planted canary secret is blocked on commit,
// removal with zero residue. The canary is built at test time so no secret-looking string is committed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readManifest } from '../../../core/render/manifest.js';
import { initProject, readAnswers, removeModule, addModule } from '../../../core/render/project.js';
import { KIT_ROOT, cleanEnv, hasTool, read, readTree, run, tmp, writeAnswers } from '../../../test/helpers/fixtures.js';

const MODULES = ['core', 'git-hooks'];
const answers = `mode: standard\nanswers:\n  user.agents: [claude, codex, copilot]\n  idea.text: A tiny command-line tool.\nproposal:\n  status: confirmed\n  summary: test project\n  profiles: [node-cli]\n  modules: [${MODULES.join(', ')}]\n`;

async function project() {
  const root = tmp('yaw-githooks-');
  await initProject({ root, kitRoot: KIT_ROOT, answersFile: writeAnswers(tmp('yaw-ans-'), answers), modules: MODULES });
  return root;
}

// A GitHub-token-shaped canary (ghp_ + 36 random alphanumerics), built now; never written to a tracked file of this repo.
function canary() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = randomBytes(36);
  return `ghp_${Array.from(bytes, (b) => chars[b % chars.length]).join('')}`;
}

// In CI the tools are installed, so a missing one fails instead of skipping.
const tools = hasTool('lefthook') && hasTool('gitleaks') && hasTool('just') && hasTool('git');
const skip = !tools && !process.env.CI && 'lefthook, gitleaks, just and git are needed';
if (!tools && process.env.CI) test('lefthook, gitleaks, just and git are installed in CI', () => assert.fail('install them in the CI workflow'));

test('renders lefthook.yml, the recipes and one AGENTS.md block', async () => {
  const root = await project();
  const tree = readTree(root);
  assert.match(tree['lefthook.yml'], /gitleaks git --pre-commit --staged/);
  assert.match(tree['lefthook.yml'], /run: just fmt\n\s+stage_fixed: true/);
  assert.match(tree['lefthook.yml'], /run: just lint/);
  assert.match(tree['just/git-hooks.just'], /^hooks-install:/m);
  assert.match(tree.justfile, /# yaw:git-hooks\nimport 'just\/git-hooks.just'\n# \/yaw:git-hooks/);
  assert.match(tree['AGENTS.md'], /<!-- yaw:git-hooks -->\n- Git hooks \(lefthook/);
  const byPath = Object.fromEntries(readManifest(root).files.map((f) => [f.path, f]));
  assert.equal(byPath['lefthook.yml'].module, 'git-hooks');
  assert.equal(byPath['just/git-hooks.just'].module, 'git-hooks');
  assert.deepEqual(byPath.justfile.fragments.map((f) => f.module).includes('git-hooks'), true);
});

// A project in a git repo with the hook installed; PATH carries the tools found on this machine.
async function installed() {
  const root = await project();
  writeFileSync(join(root, 'package.json'), '{ "name": "x", "version": "0.0.0", "private": true }\n');
  const env = cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH });
  const git = (...args) => run('git', args, { cwd: root, env });
  assert.equal(git('init', '-q').status, 0);
  const r = run('just', ['hooks-install'], { cwd: root, env });
  assert.equal(r.status, 0, String(r.stderr));
  assert.ok(existsSync(join(root, '.git', 'hooks', 'pre-commit')));
  return { root, env, git };
}

test('a planted canary secret blocks the commit; without it the commit passes', { skip }, async () => {
  const { root, env, git } = await installed();
  writeFileSync(join(root, 'notes.txt'), 'hello\n');
  git('add', '-A');
  const ok = git('commit', '-q', '-m', 'clean');
  assert.equal(ok.status, 0, String(ok.stdout) + String(ok.stderr));

  const secret = canary();
  writeFileSync(join(root, 'config.js'), `export const token = "${secret}";\n`);
  git('add', 'config.js');
  const blocked = git('commit', '-q', '-m', 'leak');
  assert.notEqual(blocked.status, 0);
  const out = String(blocked.stdout) + String(blocked.stderr);
  assert.match(out, /leaks found|secrets/i);
  assert.equal(out.includes(secret), false, 'the secret is redacted in the output');
  assert.equal(git('rev-list', '--count', 'HEAD').stdout.trim(), '1'); // no second commit
});

test('a missing gitleaks warns loudly but does not block', { skip: !hasTool('lefthook') && !process.env.CI && 'lefthook is needed' }, async () => {
  const { root, env, git } = await installed();
  // PATH without gitleaks: only node, system tools, lefthook and just.
  const bin = tmp('yaw-bin-');
  for (const tool of ['lefthook', 'just']) {
    const p = run('sh', ['-c', `command -v ${tool}`], { env }).stdout.trim();
    run('ln', ['-s', p, join(bin, tool)]);
  }
  const clean = { ...env, PATH: [bin, cleanEnv('/x').PATH].join(':') };
  writeFileSync(join(root, 'a.txt'), 'x\n');
  run('git', ['add', '-A'], { cwd: root, env: clean });
  const r = run('git', ['commit', '-q', '-m', 'no scanner'], { cwd: root, env: clean });
  assert.equal(r.status, 0, String(r.stdout) + String(r.stderr));
  assert.match(String(r.stdout) + String(r.stderr), /gitleaks is not installed/);
});

test('remove leaves zero residue; answers stay; re-add restores the same files', async () => {
  const root = await project();
  const before = readTree(root);
  await removeModule({ root, kitRoot: KIT_ROOT, module: 'git-hooks' });
  const left = readTree(root);
  for (const gone of ['lefthook.yml', 'just/git-hooks.just']) assert.equal(Object.hasOwn(left, gone), false, gone);
  assert.doesNotMatch(left.justfile, /git-hooks/);
  assert.doesNotMatch(left['AGENTS.md'], /yaw:git-hooks|lefthook/);
  assert.equal(readManifest(root).modules['git-hooks'], undefined);
  assert.equal(readManifest(root).files.some((f) => f.module === 'git-hooks'), false);
  assert.deepEqual(readAnswers(root).proposal.profiles, ['node-cli']); // answers.yaml kept
  await addModule({ root, kitRoot: KIT_ROOT, module: 'git-hooks' });
  assert.deepEqual(readTree(root), before);
});

test('after removal a commit still works with the stale git hook (lefthook without config is a no-op)', { skip }, async () => {
  const { root, env, git } = await installed();
  await removeModule({ root, kitRoot: KIT_ROOT, module: 'git-hooks' });
  writeFileSync(join(root, 'b.txt'), 'x\n');
  git('add', '-A');
  const r = git('commit', '-q', '-m', 'after removal');
  assert.equal(r.status, 0, String(r.stdout) + String(r.stderr));
  const u = run('lefthook', ['uninstall'], { cwd: root, env });
  assert.equal(u.status, 0);
  assert.equal(existsSync(join(root, '.git', 'hooks', 'pre-commit')), false);
});
