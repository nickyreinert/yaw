// The core module (Y-3.2): AGENTS.md with its line budget (M16), CLAUDE.md, the composed justfile, removability.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { AGENTS_MAX_LINES } from '../core/render/compose.js';
import { loadModule } from '../core/render/kit.js';
import { readManifest } from '../core/render/manifest.js';
import { initProject, removeModule, updateProject } from '../core/render/project.js';
import { KIT_ROOT, hasTool, makeKit, read, readTree, run, tmp, writeAnswers, ANSWERS_YAML } from './helpers/fixtures.js';

const answers = (extra = '') => ANSWERS_YAML.replace('  idea.text: A tiny command-line tool.\n', `  idea.text: A tiny command-line tool.\n${extra}`);
const lines = (text) => text.replace(/\n$/, '').split('\n').length;

async function init(text = ANSWERS_YAML) {
  const root = tmp('yaw-proj-');
  await initProject({ root, kitRoot: KIT_ROOT, answersFile: writeAnswers(tmp('yaw-ans-'), text) });
  return root;
}

test('AGENTS.md is assembled from the core frame and agentsMd, well below the budget', async () => {
  const root = await init(answers('  user.language: en\n  user.autonomy: act-and-report\n'));
  const md = read(root, 'AGENTS.md');
  assert.ok(lines(md) <= 30, `${lines(md)} lines`);
  assert.match(md, /^# AGENTS\.md\n/);
  assert.match(md, /^- Purpose: A tiny command-line tool\.$/m);
  assert.match(md, /^- Stack: node-cli - Node CLI or tool/m);
  assert.match(md, /^- Chat in "en"; write code, comments, commit messages and docs in English\.$/m);
  assert.match(md, /^- Act, then report what you did and why\.$/m);
  assert.match(md, /<!-- yaw:core -->\n- Start every task[^\n]*\n- Run `just check`[^\n]*\n- Never read, print or commit secrets[^\n]*\n<!-- \/yaw:core -->\n$/);
  const def = loadModule(KIT_ROOT, 'core');
  assert.ok(def.agentsMd.trimEnd().split('\n').length <= 5);
});

test('questions the answers file does not hold take their defaults', async () => {
  const md = read(await init(), 'AGENTS.md');
  assert.match(md, /Chat in "de"/);
  assert.match(md, /Ask before risky or ambiguous steps; otherwise act\./);
});

test('the idea is one safe line: no markers, no line breaks; empty idea leaves no Purpose line', async () => {
  const hostile = answers().replace('A tiny command-line tool.', '"x --> <!-- /yaw:core --> y\\n\\n# Heading"');
  const md = read(await init(hostile), 'AGENTS.md');
  assert.match(md, /^- Purpose: x \/yaw:core y # Heading$/m);
  assert.equal(md.match(/<!-- \/yaw:core -->/g).length, 1);
  assert.doesNotMatch(read(await init(answers().replace('A tiny command-line tool.', '""')), 'AGENTS.md'), /Purpose/);
});

test('CLAUDE.md imports AGENTS.md and nothing else', async () => {
  assert.equal(read(await init(), 'CLAUDE.md'), '@AGENTS.md\n');
});

test('justfile: core frame, one import per profile, composed in marked blocks (ADR-0004)', async () => {
  const root = await init();
  assert.equal(read(root, 'justfile'), [
    '# justfile: composed by YAW. Stack recipes are imported from just/ (below); `just --list` shows them.',
    'default:',
    '    @just --list',
    '',
    '# yaw:node-cli',
    "import 'just/node-cli.just'",
    '# /yaw:node-cli',
    '',
  ].join('\n'));
  assert.equal(read(root, '.gitignore'), '# yaw:node-cli\nnode_modules/\n# /yaw:node-cli\n');
  const m = readManifest(root);
  const entry = (p) => m.files.find((f) => f.path === p);
  assert.equal(entry('justfile').module, 'core');
  assert.deepEqual(entry('justfile').fragments.map((f) => f.module), ['node-cli']);
  assert.deepEqual(entry('just/node-cli.just').fragments ?? [], []);
});

test('just --list shows the uniform verbs', { skip: !hasTool('just') && 'just is not installed' }, async () => {
  const root = await init();
  const r = run('just', ['--list'], { cwd: root });
  assert.equal(r.status, 0, r.stderr);
  for (const verb of ['setup', 'dev', 'fmt', 'lint', 'typecheck', 'test', 'check', 'build', 'audit']) assert.match(r.stdout, new RegExp(`^ {4}${verb}\\b`, 'm'), verb);
});

test('the AGENTS.md budget is enforced at render time and the error names the contributors (M16)', async () => {
  const frame = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
  const kit = (n) => makeKit(tmp('yaw-kit-'), {
    modules: {
      core: { templates: { 'AGENTS.md.tmpl': frame(n) }, agentsMd: '- a\n- b\n' },
    },
  });
  // frame n + block markers (2) + 2 rules + 1 empty separator line
  const fits = AGENTS_MAX_LINES - 5;
  const ok = tmp('yaw-proj-');
  await initProject({ root: ok, kitRoot: kit(fits), answersFile: writeAnswers(tmp('yaw-ans-')) });
  assert.equal(lines(read(ok, 'AGENTS.md')), AGENTS_MAX_LINES);
  const over = tmp('yaw-proj-');
  await assert.rejects(
    initProject({ root: over, kitRoot: kit(fits + 1), answersFile: writeAnswers(tmp('yaw-ans-')) }),
    /AGENTS\.md would have 81 lines, the budget is 80 \(core frame 76, core rules 2\)/,
  );
  assert.deepEqual(readTree(over), {}, 'nothing is written when the budget is exceeded');
});

test('update right after init changes nothing; user code is never reported', async () => {
  const root = await init();
  const r = await updateProject({ root, kitRoot: KIT_ROOT });
  assert.deepEqual(r.report, []);
  writeFileSync(join(root, 'src/index.js'), '// mine\n');
  assert.deepEqual((await updateProject({ root, kitRoot: KIT_ROOT })).report, []);
});

test('the scaffold is skipped when the folder already has it (code of your own is never touched)', async () => {
  const root = tmp('yaw-proj-');
  writeFileSync(join(root, 'package.json'), '{"name":"mine"}\n');
  await initProject({ root, kitRoot: KIT_ROOT, answersFile: writeAnswers(tmp('yaw-ans-')) });
  assert.equal(read(root, 'package.json'), '{"name":"mine"}\n');
  assert.ok(!existsSync(join(root, 'src/index.js')));
  assert.ok(!readManifest(root).files.some((f) => f.path === 'package.json'));
  assert.ok(existsSync(join(root, 'justfile')));
});

test('core is removable: managed files and bases go, answers and your code stay (ADR-0004)', async () => {
  const root = await init();
  const r = await removeModule({ root, kitRoot: KIT_ROOT, module: 'core' });
  assert.equal(r.manifest, null);
  assert.deepEqual(Object.keys(readTree(root)), ['.yaw/answers.yaml', 'package.json', 'src/index.js', 'test/index.test.js']);
  assert.ok(!existsSync(join(root, 'just')), 'folder left empty is removed');
});

test('an existing .gitignore is kept as the user\'s; the profile part is recorded', async () => {
  const root = tmp('yaw-proj-');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, '.gitignore'), '.DS_Store\n');
  await initProject({ root, kitRoot: KIT_ROOT, answersFile: writeAnswers(tmp('yaw-ans-')) });
  assert.equal(read(root, '.gitignore'), '.DS_Store\n');
  assert.ok(readManifest(root).files.some((f) => f.path === '.gitignore' && f.managed));
});
