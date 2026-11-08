// devenv (Y-5.2, ADR-0025): .env.example, git-ignored .env files, setup creating .env, removal with zero residue.
// Docker is not part of devenv (T-030).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readManifest } from '../../../core/render/manifest.js';
import { initProject, readAnswers, removeModule, addModule } from '../../../core/render/project.js';
import { KIT_ROOT, cleanEnv, hasTool, read, readTree, run, tmp, writeAnswers } from '../../../test/helpers/fixtures.js';

const MODULES = ['core', 'devenv'];

function answers(profile = 'node-cli') {
  return `mode: quick\nanswers:\n  user.agents: [claude, codex, copilot]\n  idea.text: A tiny command-line tool.\nproposal:\n  status: confirmed\n  summary: test project\n  profiles: [${profile}]\n  modules: [${MODULES.join(', ')}]\n`;
}

async function project({ kitRoot = KIT_ROOT, profile } = {}) {
  const root = tmp('yaw-devenv-');
  await initProject({ root, kitRoot, answersFile: writeAnswers(tmp('yaw-ans-'), answers(profile)), modules: MODULES });
  return root;
}

// A kit copy with a profile "env-demo" that ships env.example.
function kitWithEnvProfile() {
  const kit = tmp('yaw-kit-');
  for (const dir of ['core', 'modules', 'profiles', 'interview', 'adapters']) if (existsSync(join(KIT_ROOT, dir))) cpSync(join(KIT_ROOT, dir), join(kit, dir), { recursive: true });
  cpSync(join(KIT_ROOT, 'package.json'), join(kit, 'package.json'));
  const from = join(kit, 'profiles', 'node-cli');
  const dir = join(kit, 'profiles', 'env-demo');
  cpSync(from, dir, { recursive: true });
  writeFileSync(join(dir, 'profile.yaml'), 'name: env-demo\ntitle: Env demo\nsummary: Env demo.\nstack:\n  language: [html]\n  runsOn: [local]\n');
  writeFileSync(join(dir, 'env.example'), '# Database\nDATABASE_URL=postgres://app@db/app\nAPI_KEY=\n');
  return kit;
}

test('.env.example and .gitignore entries, no container files', async () => {
  const root = await project();
  const tree = readTree(root);
  assert.match(tree['.env.example'], /Copy to \.env/);
  assert.doesNotMatch(tree['.env.example'], /=/); // header only, no variables
  const ignore = tree['.gitignore'];
  assert.match(ignore, /# yaw:devenv\n\.env\n\.env\.\*\n!\.env\.example\n# \/yaw:devenv/);
  for (const f of ['Dockerfile', 'compose.yaml', '.devcontainer/devcontainer.json']) assert.equal(Object.hasOwn(tree, f), false, f);
  assert.match(tree['AGENTS.md'], /<!-- yaw:devenv -->\n- Set up with `just setup`/);
});

test('profile with env.example: variables are rendered', async () => {
  const root = await project({ kitRoot: kitWithEnvProfile(), profile: 'env-demo' });
  assert.match(read(root, '.env.example'), /DATABASE_URL=postgres:\/\/app@db\/app\nAPI_KEY=\n/);
  const byPath = Object.fromEntries(readManifest(root).files.map((f) => [f.path, f]));
  assert.equal(byPath['.env.example'].module, 'devenv');
  assert.deepEqual(byPath['.gitignore'].fragments.map((f) => f.module), ['devenv', 'env-demo']);
});

test('git ignores .env and .env.local but not .env.example', { skip: !hasTool('git') && 'git is not installed' }, async () => {
  const root = await project();
  const env = cleanEnv(tmp('yaw-home-'));
  const git = (...args) => run('git', args, { cwd: root, env });
  git('init', '-q');
  for (const f of ['.env', '.env.local', '.env.production']) writeFileSync(join(root, f), 'X=1\n');
  assert.equal(git('check-ignore', '.env').status, 0);
  assert.equal(git('check-ignore', '.env.local').status, 0);
  assert.equal(git('check-ignore', '.env.production').status, 0);
  assert.equal(git('check-ignore', '.env.example').status, 1);
});

test('just setup creates .env from .env.example once and never overwrites it', { skip: !hasTool('just') && 'just is not installed' }, async () => {
  const root = await project();
  writeFileSync(join(root, 'package.json'), '{ "name": "x", "version": "0.0.0", "private": true }\n');
  const env = cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH });
  const r = run('just', ['setup'], { cwd: root, env });
  assert.equal(r.status, 0, String(r.stderr));
  assert.equal(read(root, '.env'), read(root, '.env.example'));
  writeFileSync(join(root, '.env'), 'MINE=1\n');
  assert.equal(run('just', ['setup'], { cwd: root, env }).status, 0);
  assert.equal(read(root, '.env'), 'MINE=1\n');
});

test('remove leaves zero residue; answers stay; re-add restores the same files', async () => {
  const kitRoot = kitWithEnvProfile();
  for (const profile of ['node-cli', 'env-demo']) {
    const root = await project({ kitRoot, profile });
    const before = readTree(root);
    await removeModule({ root, kitRoot, module: 'devenv' });
    const left = readTree(root);
    assert.equal(Object.hasOwn(left, '.env.example'), false);
    assert.doesNotMatch(left['.gitignore'] ?? '', /yaw:devenv|\.env/);
    assert.doesNotMatch(left['AGENTS.md'], /yaw:devenv/);
    assert.equal(readAnswers(root).proposal.profiles[0], profile); // answers.yaml kept
    assert.equal(readManifest(root).modules.devenv, undefined);
    await addModule({ root, kitRoot, module: 'devenv' });
    assert.deepEqual(readTree(root), before);
  }
});
