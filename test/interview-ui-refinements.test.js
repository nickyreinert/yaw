import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createFormModel } from '../core/web/form-model.js';
import { initProject } from '../core/render/project.js';
import { parseReply, validAnswer } from '../core/interview/engine.js';
import { treeRows, matchesTarget } from '../core/web/assets/project-tree.js';
import { saveSetup } from '../core/lib/user-store.js';
import { setupPrompt } from '../core/lib/setup-prompts.js';
import { planningFacts } from '../core/lib/kickoff.js';
import { KIT_ROOT, tmp, cleanEnv } from './helpers/fixtures.js';

const base = { 'idea.text': 'A reading tracker for small book clubs.', 'arch.language': 'javascript', 'arch.runs-on': 'local' };
const fixture = () => ({ root: tmp('yaw-ui-texts-'), kitRoot: KIT_ROOT, env: cleanEnv(tmp('yaw-ui-texts-home-')) });

test('wrapper selection changes generated entry points, engineering rules and planning facts', async () => {
  for (const wrapper of ['off', 'shell', 'just', 'make']) {
    const f = fixture(), model = createFormModel(f);
    const input = { mode: 'basic', answers: { ...base, 'arch.wrapper': wrapper }, modules: ['core'] };
    const prepared = model.normalize(input), preview = model.preview(input);
    assert.equal(prepared.doc.answers['arch.wrapper'], wrapper);
    assert.equal(preview.files.some((file) => file.path === 'project.sh'), wrapper === 'shell');
    assert.equal(preview.files.some((file) => file.path === 'Makefile'), wrapper === 'make');
    assert.ok(preview.files.some((file) => file.path === 'justfile'), 'YAW checks stay available');
    const catalogue = model.bootstrap();
    const prompt = setupPrompt({ kind: 'kickoff', answers: prepared.doc.answers, modules: prepared.modules, questions: catalogue.questions, definitions: catalogue.modules });
    assert.match(prompt, { off: /Do not add an application command wrapper/, shell: /Use project.sh/, just: /Use just as the command wrapper/, make: /Use Make as the command wrapper/ }[wrapper]);
    await initProject({ ...f, answers: { doc: prepared.doc, text: prepared.text }, modules: prepared.modules });
    if (wrapper === 'shell') {
      const bin = tmp('yaw-wrapper-bin-');
      writeFileSync(join(bin, 'just'), '#!/bin/sh\nprintf \'%s\\n\' "$PWD" "$@"\n');
      chmodSync(join(bin, 'just'), 0o755);
      const result = spawnSync('sh', [join(f.root, 'project.sh'), 'check', 'two words', 'semi;colon'], { cwd: tmp(), env: { ...f.env, PATH: `${bin}:${f.env.PATH}` }, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(result.stdout.trim().split('\n'), [f.root, 'check', 'two words', 'semi;colon']);
    }
    if (wrapper === 'make') assert.match(readFileSync(join(f.root, 'Makefile'), 'utf8'), /setup dev check test build fmt lint typecheck:\n\t@just \$@/);
  }
  assert.notDeepEqual(planningFacts(base), planningFacts({ ...base, 'arch.wrapper': 'shell' }));
});

test('an existing application Makefile is preserved in initialization previews and apply', async () => {
  const f = fixture(), model = createFormModel(f);
  const input = { mode: 'basic', modules: ['core'], answers: { ...base, 'arch.wrapper': 'make' } };
  const mine = 'all:\n\t@echo keep existing project commands\n';
  writeFileSync(join(f.root, 'Makefile'), mine);
  assert.equal(model.preview(input).files.find((file) => file.path === 'Makefile').action, 'kept');
  const prepared = model.normalize(input);
  await initProject({ ...f, answers: { doc: prepared.doc, text: prepared.text }, modules: prepared.modules });
  assert.equal(readFileSync(join(f.root, 'Makefile'), 'utf8'), mine);
});

test('Purpose/Idea accepts 500 words and rejects longer answers in CLI and web normalization', () => {
  const model = createFormModel(fixture()), question = model.bootstrap().questions.find((q) => q.id === 'idea.text');
  const accepted = Array(500).fill('word').join(' '), rejected = `${accepted} extra`;
  assert.equal(validAnswer(question, accepted), true);
  assert.equal(validAnswer(question, rejected), false);
  assert.match(parseReply(question, rejected).error, /500 words/);
  assert.throws(() => model.normalize({ mode: 'quick', modules: ['core'], answers: { ...base, 'idea.text': rejected } }), /500 words/);
});

test('preset cards expose bounded metadata without returning secret-bearing answers', () => {
  const f = fixture();
  saveSetup({ env: f.env, kitRoot: KIT_ROOT, answers: { ...base, 'arch.framework': 'Existing framework' }, mode: 'basic', projectRoot: f.root, kit: '0.1.0', now: new Date('2026-10-30T12:00:00Z'), profile: false });
  const preset = createFormModel(f).bootstrap().presets[0];
  assert.equal(preset.created, '2026-10-30');
  assert.equal(preset.language, 'javascript');
  assert.equal(preset.architecture, 'local');
  assert.equal(preset.framework, 'Existing framework');
  assert.equal(preset.purpose, base['idea.text']);
  assert.equal(Object.hasOwn(preset, 'answers'), false);
  const secrets = join(f.env.HOME, '.yaw', 'presets');
  mkdirSync(secrets, { recursive: true });
  const marker = 'ghp_' + 'c'.repeat(36);
  writeFileSync(join(secrets, 'unsafe.yaml'), `name: unsafe\nanswers:\n  idea.text: ${marker}\n`);
  assert.ok(!JSON.stringify(createFormModel(f).bootstrap().presets).includes(marker));
});

test('project tree groups common folders and identifies files affected by current choices', () => {
  const files = [{ path: 'docs/engineering.md', module: 'core' }, { path: 'docs/code-map.md', module: 'code-map' }, { path: 'AGENTS.md', module: 'core', contributors: ['review'] }];
  const rows = treeRows(files);
  assert.equal(rows.find((row) => row.name === 'docs').children.size, 2);
  assert.equal(matchesTarget(files[0], { question: 'arch.wrapper' }), true);
  assert.equal(matchesTarget(files[1], { question: 'arch.wrapper' }), false);
  assert.equal(matchesTarget(files[2], { module: 'review' }), true);
  assert.equal(matchesTarget(files[1], { module: 'code-map' }), true);
  assert.equal(matchesTarget(files[0], { question: 'quality.unit-tests' }), true);
  assert.equal(matchesTarget(files[1], { question: 'quality.unit-tests' }), false);
});

test('planned file preview returns complete generated text and preserves existing user content', async () => {
  const f = fixture(), model = createFormModel(f);
  const input = { mode: 'basic', answers: base, modules: ['core'] };
  const planned = model.filePreview(input, 'just/node-cli.just');
  assert.equal(planned.source, 'Planned content');
  const prepared = model.normalize(input);
  await initProject({ ...f, answers: { doc: prepared.doc, text: prepared.text }, modules: prepared.modules });
  assert.equal(planned.content, readFileSync(join(f.root, 'just/node-cli.just'), 'utf8'));
  const mine = Array.from({ length: 90 }, (_, index) => `Custom line ${index + 1}`).join('\n');
  writeFileSync(join(f.root, 'AGENTS.md'), mine);
  const existing = model.filePreview(input, 'AGENTS.md');
  assert.equal(existing.source, 'Existing content');
  assert.equal(existing.content, mine);
  assert.throws(() => model.filePreview(input, '../outside'), /not in the project plan/);
  assert.throws(() => model.filePreview(input, '.env.example'), /protected/);
  writeFileSync(join(f.root, 'AGENTS.md'), 'ghp_' + 'c'.repeat(36));
  assert.throws(() => model.filePreview(input, 'AGENTS.md'), /protected/);
});

test('step navigation focuses the heading then explicitly returns to the start of the form', async () => {
  const { focusStepStart, interviewDetailText } = await import('../core/web/assets/ui-state.js');
  const calls = [];
  const heading = { focus: (options) => calls.push(['focus', options]) };
  const form = { scrollIntoView: (options) => calls.push(['scroll', options]) };
  focusStepStart(form, heading);
  assert.equal(heading.tabIndex, -1);
  assert.deepEqual(calls, [['focus', { preventScroll: true }], ['scroll', { block: 'start', behavior: 'instant' }]]);
  const experience = interviewDetailText('user.expertise').join(' ');
  for (const value of ['Layperson', 'Intermediate', 'Expert', 'permissions']) assert.ok(experience.includes(value));
  const team = interviewDetailText('idea.team').join(' ');
  for (const value of ['Solo', 'Team', 'External reviewers', 'separate choices']) assert.ok(team.includes(value));
});


test('console can preview provisional instructions before required project answers are complete', () => {
  const model = createFormModel(fixture());
  const preview = model.filePreview({ mode: 'quick', answers: {}, modules: ['core'] }, 'AGENTS.md');
  assert.equal(preview.source, 'Provisional content');
  assert.match(preview.content, /# AGENTS.md/);
  assert.doesNotMatch(preview.content, /Purpose:/);
});

test('console refuses symlinks and bounds large existing file previews', () => {
  const f = fixture(), model = createFormModel(f);
  const input = { mode: 'quick', answers: base, modules: ['core'] };
  const outside = join(tmp(), 'outside.md'); writeFileSync(outside, 'not part of the project');
  symlinkSync(outside, join(f.root, 'AGENTS.md'));
  assert.throws(() => model.filePreview(input, 'AGENTS.md'), /unavailable/);
  unlinkSync(join(f.root, 'AGENTS.md'));
  writeFileSync(join(f.root, 'AGENTS.md'), 'large '.repeat(25000));
  assert.throws(() => model.filePreview(input, 'AGENTS.md'), /too large/);
});
