// yaw add <module>: only the module's questions, dependency violations reported (not fixed),
// correct manifest entries, removable with zero residue.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashContent } from '../core/render/files.js';
import { readManifest } from '../core/render/manifest.js';
import { initProject, readAnswers } from '../core/render/project.js';
import { main } from '../core/cli/main.js';
import { capture, makeKit, read, readTree, scripted, tmp, writeAnswers } from './helpers/fixtures.js';

const question = { id: 'quality.level', mode: 'Q', type: 'choice', label: 'Level?', choices: ['low', 'high'], default: 'low' };
const hidden = { id: 'quality.detail', mode: 'Q', type: 'text', label: 'Detail?', default: 'none', when: { 'quality.level': 'high' } };

function fixtureKit() {
  return makeKit(tmp('yaw-kit-'), {
    version: '1.0.0',
    modules: {
      core: { agentsMd: '- Core rule.\n', templates: { 'AGENTS.md.tmpl': '# Agents (<%= mode %>)\n' } },
      extra: {
        depends: ['core'],
        questions: [question, hidden],
        agentsMd: '- Extra rule.\n',
        templates: { 'extra/notes.md.tmpl': 'Level: <%= answers.quality.level %>\n' },
      },
      plain: { templates: { 'plain.txt': 'plain\n' } },
      leaf: { depends: ['extra'], templates: { 'leaf.txt': 'leaf\n' } },
    },
  });
}

async function setup(kitRoot) {
  const root = tmp('yaw-proj-');
  await initProject({ root, kitRoot, answersFile: writeAnswers(tmp('yaw-ans-')) });
  return root;
}

const yaw = (args, root, kitRoot, prompter = scripted([])) => {
  const stdout = capture();
  const stderr = capture();
  return main(args, { cwd: root, kitRoot, stdout, stderr, prompter }).then((code) => ({ code, stdout: stdout.text(), stderr: stderr.text(), prompter }));
};

test('asks only the new module questions, writes answers, files and manifest entries', async () => {
  const kitRoot = fixtureKit();
  const root = await setup(kitRoot);
  const r = await yaw(['add', 'extra'], root, kitRoot, scripted(['high', 'deep', 'y']));
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.prompter.asked.length, 3); // two questions + confirm; no base questions
  assert.deepEqual(readAnswers(root).answers['quality.level'], 'high');
  assert.equal(readAnswers(root).answers['quality.detail'], 'deep');
  assert.equal(read(root, 'extra/notes.md'), 'Level: high\n');
  assert.match(read(root, 'AGENTS.md'), /<!-- yaw:extra -->/);
  const m = readManifest(root);
  assert.equal(m.modules.extra.enabled, true);
  assert.equal(m.files.find((f) => f.path === 'extra/notes.md').module, 'extra');
  assert.equal(m.files.find((f) => f.path === '.yaw/answers.yaml').hash, hashContent(read(root, '.yaw/answers.yaml')));
  assert.equal(read(root, '.yaw/base/extra/notes.md'), 'Level: high\n');
});

test('--yes asks nothing and takes the defaults (listed as default)', async () => {
  const kitRoot = fixtureKit();
  const root = await setup(kitRoot);
  const r = await yaw(['add', 'extra', '--yes'], root, kitRoot);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.prompter.asked.length, 0);
  assert.match(r.stdout, /answer quality\.level: low {2}\(default\)/);
  assert.doesNotMatch(r.stdout, /quality\.detail/); // its `when` does not hold
  assert.equal(read(root, 'extra/notes.md'), 'Level: low\n');
});

test('a missing dependency is reported and nothing is changed', async () => {
  const kitRoot = fixtureKit();
  const root = await setup(kitRoot);
  const before = readTree(root);
  const r = await yaw(['add', 'leaf', '--yes'], root, kitRoot);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /leaf depends on extra, which is not installed; run: yaw add extra/);
  assert.deepEqual(readTree(root), before);
});

test('unknown module, already installed, no manifest, no terminal without --yes', async () => {
  const kitRoot = fixtureKit();
  const root = await setup(kitRoot);
  assert.match((await yaw(['add', 'nope', '--yes'], root, kitRoot)).stderr, /does not exist in this kit/);
  await yaw(['add', 'extra', '--yes'], root, kitRoot);
  assert.match((await yaw(['add', 'extra', '--yes'], root, kitRoot)).stderr, /already installed/);
  assert.match((await yaw(['add', 'extra', '--yes'], tmp('yaw-empty-'), kitRoot)).stderr, /run yaw init first/);
  const noTty = scripted([]);
  noTty.interactive = false;
  assert.match((await yaw(['add', 'leaf'], root, kitRoot, noTty)).stderr, /run again with --yes/);
  assert.match((await yaw(['add'], root, kitRoot)).stderr, /usage: yaw add/);
});

test('declining the confirmation writes nothing', async () => {
  const kitRoot = fixtureKit();
  const root = await setup(kitRoot);
  const before = readTree(root);
  const r = await yaw(['add', 'extra'], root, kitRoot, scripted(['', '', 'n']));
  assert.equal(r.code, 1);
  assert.deepEqual(readTree(root), before);
});

test('add then remove leaves only the (kept) answers behind; re-adding does not ask again', async () => {
  const kitRoot = fixtureKit();
  const root = await setup(kitRoot);
  const before = readTree(root);
  await yaw(['add', 'extra', '--yes'], root, kitRoot);
  assert.equal((await yaw(['remove', 'extra', '--yes'], root, kitRoot)).code, 0);
  const after = readTree(root);
  delete after['.yaw/manifest.json'];
  delete before['.yaw/manifest.json'];
  const answers = after['.yaw/answers.yaml'];
  assert.match(answers, /quality\.level/);
  delete after['.yaw/answers.yaml'];
  delete before['.yaw/answers.yaml'];
  assert.deepEqual(after, before);
  const again = await yaw(['add', 'extra'], root, kitRoot, scripted(['y']));
  assert.equal(again.prompter.asked.length, 1); // only the confirmation
});

test('no new answers: answers.yaml is left byte for byte (comments survive)', async () => {
  const kitRoot = fixtureKit();
  const root = tmp('yaw-proj-');
  const text = `# my notes\nmode: quick\nanswers:\n  user.agents: [claude] # keep me\n  idea.text: A tiny command-line tool.\nproposal:\n  status: confirmed\n  summary: Node CLI, local tasks.\n  profiles: [node-cli]\n  modules: [core]\n`;
  await initProject({ root, kitRoot, answersFile: writeAnswers(tmp('yaw-ans-'), text) });
  const before = read(root, '.yaw/answers.yaml');
  const r = await yaw(['add', 'plain', '--yes'], root, kitRoot);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(read(root, '.yaw/answers.yaml'), before);
  assert.match(before, /# keep me/);
  assert.equal(read(root, 'plain.txt'), 'plain\n');
});
