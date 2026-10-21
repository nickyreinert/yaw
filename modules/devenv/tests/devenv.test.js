// devenv (Y-5.2, ADR-0025): .env.example, git-ignored .env files, setup creating .env, container files only
// when the profile ships them, removal with zero residue.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { profileDevenv } from '../../../core/render/kit.js';
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

// A kit copy with a profile "container-demo" that ships env.example and a devenv/ folder (no existing profile does yet).
function kitWithContainerProfile({ twice = false } = {}) {
  const kit = tmp('yaw-kit-');
  for (const dir of ['core', 'modules', 'profiles', 'interview', 'adapters']) if (existsSync(join(KIT_ROOT, dir))) cpSync(join(KIT_ROOT, dir), join(kit, dir), { recursive: true });
  cpSync(join(KIT_ROOT, 'package.json'), join(kit, 'package.json'));
  const from = join(kit, 'profiles', 'node-cli');
  const dir = join(kit, 'profiles', 'container-demo');
  cpSync(from, dir, { recursive: true });
  writeFileSync(join(dir, 'profile.yaml'), 'name: container-demo\nsummary: Container demo.\nsuggestWhen:\n  language: [javascript]\n');
  writeFileSync(join(dir, 'env.example'), '# Database\nDATABASE_URL=postgres://app@db/app\nAPI_KEY=\n');
  mkdirSync(join(dir, 'devenv'));
  writeFileSync(join(dir, 'devenv', 'Dockerfile'), 'FROM node:22-slim\nWORKDIR /app\n');
  writeFileSync(join(dir, 'devenv', 'compose.yaml'), 'services:\n  app:\n    build: .\n    env_file: .env\n');
  writeFileSync(join(dir, 'devenv', 'devcontainer.json'), '{ "name": "demo", "dockerComposeFile": "../compose.yaml" }\n');
  if (twice) {
    const other = join(kit, 'profiles', 'other-demo');
    cpSync(dir, other, { recursive: true });
    writeFileSync(join(other, 'profile.yaml'), 'name: other-demo\nsummary: Other.\nsuggestWhen:\n  language: [javascript]\n');
  }
  return kit;
}

test('profile without devenv/: .env.example and .gitignore entries, no container files', async () => {
  const root = await project();
  const tree = readTree(root);
  assert.match(tree['.env.example'], /Copy to \.env/);
  assert.doesNotMatch(tree['.env.example'], /=/); // header only, no variables
  const ignore = tree['.gitignore'];
  assert.match(ignore, /# yaw:devenv\n\.env\n\.env\.\*\n!\.env\.example\n# \/yaw:devenv/);
  for (const f of ['Dockerfile', 'compose.yaml', '.devcontainer/devcontainer.json']) assert.equal(Object.hasOwn(tree, f), false, f);
  assert.match(tree['AGENTS.md'], /<!-- yaw:devenv -->\n- Set up with `just setup`/);
});

test('profile with env.example and devenv/: container files and variables are rendered', async () => {
  const root = await project({ kitRoot: kitWithContainerProfile(), profile: 'container-demo' });
  assert.match(read(root, '.env.example'), /DATABASE_URL=postgres:\/\/app@db\/app\nAPI_KEY=\n/);
  assert.match(read(root, 'Dockerfile'), /^FROM node:22-slim/);
  assert.match(read(root, 'compose.yaml'), /env_file: \.env/);
  assert.match(read(root, '.devcontainer/devcontainer.json'), /"dockerComposeFile"/);
  const byPath = Object.fromEntries(readManifest(root).files.map((f) => [f.path, f]));
  for (const f of ['.env.example', 'Dockerfile', 'compose.yaml', '.devcontainer/devcontainer.json']) assert.equal(byPath[f].module, 'devenv', f);
  assert.deepEqual(byPath['.gitignore'].fragments.map((f) => f.module), ['container-demo', 'devenv']);
});

test('two profiles shipping the same container file are an error', async () => {
  const kit = kitWithContainerProfile({ twice: true });
  assert.throws(() => profileDevenv(kit, ['container-demo', 'other-demo']), /both ship devenv\/Dockerfile/);
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
  const kitRoot = kitWithContainerProfile();
  for (const profile of ['node-cli', 'container-demo']) {
    const root = await project({ kitRoot, profile });
    const before = readTree(root);
    await removeModule({ root, kitRoot, module: 'devenv' });
    const left = readTree(root);
    for (const gone of ['.env.example', 'Dockerfile', 'compose.yaml', '.devcontainer/devcontainer.json']) assert.equal(Object.hasOwn(left, gone), false, gone);
    assert.doesNotMatch(left['.gitignore'] ?? '', /yaw:devenv|\.env/);
    assert.doesNotMatch(left['AGENTS.md'], /yaw:devenv/);
    assert.equal(existsSync(join(root, '.devcontainer')), false);
    assert.equal(readAnswers(root).proposal.profiles[0], profile); // answers.yaml kept
    assert.equal(readManifest(root).modules.devenv, undefined);
    await addModule({ root, kitRoot, module: 'devenv' });
    assert.deepEqual(readTree(root), before);
  }
});
