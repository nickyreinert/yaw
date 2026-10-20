// yaw remove <module>: exactly the module's files and fragments, hooks unregistered, zero residue.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readManifest } from '../core/render/manifest.js';
import { applyModules, initProject, planRemove, removeModule } from '../core/render/project.js';
import { main } from '../core/cli/main.js';
import { makeKit, read, readJson, readTree, scripted, tmp, writeAnswers } from './helpers/fixtures.js';

const coreSettings = `${JSON.stringify({ permissions: { deny: ['Read(./.env)'] } })}\n`;
const extraSettings = `${JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'sh .yaw/bin/yaw-hook PreToolUse' }] }] } })}\n`;

function fixtureKit() {
  return makeKit(tmp('yaw-kit-'), {
    version: '1.0.0',
    modules: {
      core: {
        agentsMd: '- Core rule.\n',
        templates: { 'AGENTS.md.tmpl': '# Agents (<%= mode %>)\n', '.claude/settings.json': coreSettings },
      },
      extra: {
        depends: ['core'],
        agentsMd: '- Extra rule.\n',
        templates: {
          'extra/notes.md.tmpl': 'Idea: <%= answers.idea.text %>\n',
          '.gitignore': '.extra-cache/\n',
          '.claude/settings.json': extraSettings,
        },
      },
      leaf: { depends: ['extra'], templates: { 'leaf.txt': 'leaf\n' } },
    },
  });
}

async function setup(kitRoot) {
  const root = tmp('yaw-proj-');
  await initProject({ root, kitRoot, answersFile: writeAnswers(tmp('yaw-ans-')) });
  return root;
}

test('add then remove a module leaves the project byte-identical (zero residue, hooks unregistered)', async () => {
  const kitRoot = fixtureKit();
  const root = await setup(kitRoot);
  const before = readTree(root);

  await applyModules({ root, kitRoot, modules: ['core', 'extra'] });
  assert.equal(read(root, 'extra/notes.md'), 'Idea: A tiny command-line tool.\n');
  assert.match(read(root, 'AGENTS.md'), /<!-- yaw:extra -->\n- Extra rule\.\n<!-- \/yaw:extra -->/);
  assert.match(read(root, '.gitignore'), /# yaw:extra\n\.extra-cache\/\n# \/yaw:extra/);
  const settings = readJson(root, '.claude/settings.json');
  assert.equal(settings.hooks.PreToolUse[0].hooks[0].command, 'sh .yaw/bin/yaw-hook PreToolUse');
  assert.deepEqual(settings.permissions, { deny: ['Read(./.env)'] });
  const m = readManifest(root);
  assert.deepEqual(m.files.find((f) => f.path === 'AGENTS.md').fragments.map((f) => f.module), ['extra']);
  assert.deepEqual(m.files.find((f) => f.path === '.claude/settings.json').fragments.map((f) => f.module), ['extra']);

  const plan = planRemove({ root, kitRoot, module: 'extra' });
  assert.deepEqual(plan.files.map((f) => f.path), ['extra/notes.md']);
  assert.deepEqual(plan.fragments.map((f) => f.path).sort(), ['.claude/settings.json', '.gitignore', 'AGENTS.md']);

  const result = await removeModule({ root, kitRoot, module: 'extra' });
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(readTree(root), before);
  assert.equal(readJson(root, '.claude/settings.json').hooks, undefined);
  assert.ok(!existsSync(join(root, 'extra')));
  assert.ok(!existsSync(join(root, '.gitignore')));
});

test('remove refuses while other modules depend on the module; core goes last', async () => {
  const kitRoot = fixtureKit();
  const root = await setup(kitRoot);
  await applyModules({ root, kitRoot, modules: ['core', 'extra', 'leaf'] });
  assert.throws(() => planRemove({ root, kitRoot, module: 'extra' }), /leaf depends on extra; remove it first/);
  assert.throws(() => planRemove({ root, kitRoot, module: 'core' }), /core is removed last; remove extra, leaf first/);
  assert.throws(() => planRemove({ root, kitRoot, module: 'nope' }), /module "nope" is not installed/);
  await removeModule({ root, kitRoot, module: 'leaf' });
  await removeModule({ root, kitRoot, module: 'extra' });
  assert.deepEqual(Object.keys(readManifest(root).modules), ['core']);
});

test('remove keeps an edited file under --yes and lists it as yours; --strategy take deletes it', async () => {
  const kitRoot = fixtureKit();
  const root = await setup(kitRoot);
  await applyModules({ root, kitRoot, modules: ['core', 'extra'] });
  writeFileSync(join(root, 'extra/notes.md'), 'my notes\n');
  const kept = await removeModule({ root, kitRoot, module: 'extra', interactive: false });
  assert.ok(kept.report.some((r) => r.action === 'released' && r.path === 'extra/notes.md'));
  assert.equal(read(root, 'extra/notes.md'), 'my notes\n');
  assert.equal(readManifest(root).files.find((f) => f.path === 'extra/notes.md'), undefined);
  assert.ok(!existsSync(join(root, '.yaw/base/extra')));

  const root2 = await setup(kitRoot);
  await applyModules({ root: root2, kitRoot, modules: ['core', 'extra'] });
  writeFileSync(join(root2, 'extra/notes.md'), 'my notes\n');
  await removeModule({ root: root2, kitRoot, module: 'extra', strategy: 'take' });
  assert.ok(!existsSync(join(root2, 'extra')));
});

test('remove asks before deleting an edited file when interactive', async () => {
  const kitRoot = fixtureKit();
  const root = await setup(kitRoot);
  await applyModules({ root, kitRoot, modules: ['core', 'extra'] });
  writeFileSync(join(root, 'extra/notes.md'), 'my notes\n');
  const prompter = scripted(['y']);
  await removeModule({ root, kitRoot, module: 'extra', interactive: true, prompter });
  assert.match(prompter.asked[0], /extra\/notes\.md was edited\. Delete it anyway\?/);
  assert.ok(!existsSync(join(root, 'extra/notes.md')));
});

test('removing core (last module) removes YAW from the project except files owned by the user', async () => {
  const kitRoot = fixtureKit();
  const root = await setup(kitRoot);
  const result = await removeModule({ root, kitRoot, module: 'core' });
  assert.equal(result.manifest, null);
  assert.deepEqual(Object.keys(readTree(root)), ['.yaw/answers.yaml']);
  assert.ok(result.report.some((r) => r.action === 'owned-kept' && r.path === '.yaw/answers.yaml'));
});

test('yaw remove needs --yes without a terminal and prints the plan', async () => {
  const kitRoot = fixtureKit();
  const root = await setup(kitRoot);
  await applyModules({ root, kitRoot, modules: ['core', 'extra'] });
  const out = [];
  const io = { cwd: root, kitRoot, stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => out.push(s) }, prompter: { interactive: false } };
  assert.equal(await main(['remove', 'extra'], io), 1);
  assert.match(out.join(''), /delete: extra\/notes\.md/);
  assert.match(out.join(''), /remove its part from: AGENTS\.md/);
  assert.match(out.join(''), /confirmation needed: run again with --yes/);
  assert.ok(existsSync(join(root, 'extra/notes.md')));
  assert.equal(await main(['remove', 'extra', '--yes'], io), 0);
  assert.ok(!existsSync(join(root, 'extra/notes.md')));
});
