// Render engine (Y-2.5): template renderer (ADR-0002), path guard, atomic writes, hashes,
// shared-file composition (ADR-0004) and the manifest/base records (ADR-0003).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '../core/render/template.js';
import { PathError, checkRelPath, hashContent, resolveInside, writeAtomic } from '../core/render/files.js';
import { compose, SHARED_FILES } from '../core/render/compose.js';
import { compareVersions, loadModule, renderModules, templateContext } from '../core/render/kit.js';
import { readManifest } from '../core/render/manifest.js';
import { initProject } from '../core/render/project.js';
import { KIT_ROOT, makeKit, read, tmp, writeAnswers, writeTree } from './helpers/fixtures.js';

// ---------------------------------------------------------------- template renderer

test('template: values, if/else, each, literal <%%', () => {
  const t = '# <%= idea.text %>\n<% if items %>\n<% each items as item %>\n- <%= item.name %>\n<% end %>\n<% else %>\nnone\n<% end %>\nliteral <%% here\n';
  assert.equal(render(t, { idea: { text: 'Hi' }, items: [{ name: 'a' }, { name: 'b' }] }), '# Hi\n- a\n- b\nliteral <% here\n');
  assert.equal(render(t, { idea: { text: 'Hi' }, items: [] }), '# Hi\nnone\nliteral <% here\n');
});

test('template: lines holding only a block tag disappear; inline tags keep the line', () => {
  assert.equal(render('a\n  <% if x %>  \nb\n<% end %>\nc\n', { x: true }), 'a\nb\nc\n');
  assert.equal(render('x=<% if x %>yes<% else %>no<% end %>\n', { x: false }), 'x=no\n');
});

test('template: just, GitHub Actions, Jinja and shell syntax pass through untouched', () => {
  const t = 'build:\n  echo {{version}}\nrun: ${{ github.sha }}\n{% if a %}{{ b }}{% endif %}\n[[ -f x ]] && cat <<EOF\n`code`\nEOF\n';
  assert.equal(render(t, {}), t);
});

test('template: truthiness follows ADR-0002; null renders as empty text', () => {
  const t = '<% if v %>T<% else %>F<% end %>';
  for (const [v, out] of [[true, 'T'], [false, 'F'], ['', 'F'], ['x', 'T'], [0, 'F'], [2, 'T'], [[], 'F'], [[1], 'T'], [null, 'F']]) {
    assert.equal(render(t, { v }), out, JSON.stringify(v));
  }
  assert.equal(render('[<%= v %>]', { v: null }), '[]');
  assert.equal(render('<%= n %>', { n: 3 }), '3');
});

test('template: errors name the file and line', () => {
  const cases = [
    ['a\n<%= missing.path %>\n', /t\.tmpl:2: missing value "missing\.path"$/],
    ['<% if a %>\nx\n', /t\.tmpl:1: "if" is not closed with "end"$/],
    ['x\n<% end %>\n', /t\.tmpl:2: "end" without "if" or "each"$/],
    ['<% else %>\n', /t\.tmpl:1: "else" without "if"$/],
    ['<% each a as %>\n', /t\.tmpl:1: unknown tag/],
    ['<% include x %>\n', /t\.tmpl:1: unknown tag/],
    ['<%= a + b %>\n', /t\.tmpl:1: invalid path "a \+ b"$/],
    ['<%= a\n%>\n', /t\.tmpl:1: unclosed tag/],
    ['<%= list %>\n', /t\.tmpl:1: "list" is not a scalar$/],
    ['<% each s as x %>\n<% end %>\n', /t\.tmpl:1: "s" is not a list$/],
  ];
  for (const [t, re] of cases) assert.throws(() => render(t, { a: 1, list: [1], s: 'x' }, { file: 't.tmpl' }), re, t);
});

// ---------------------------------------------------------------- path guard, writes, hashes

test('paths escaping the project or touching kit bookkeeping are rejected', () => {
  for (const p of ['../x', 'a/../../x', 'a/..', '/etc/passwd', 'a\\b', '', 'a//b', './a', '.git/config', 'x\0y']) {
    assert.throws(() => checkRelPath(p), PathError, JSON.stringify(p));
  }
  for (const p of ['.yaw/manifest.json', '.yaw/base', '.yaw/base/AGENTS.md']) {
    assert.throws(() => checkRelPath(p), /reserved for the kit/, p);
    assert.equal(checkRelPath(p, { kitOwned: true }), p);
  }
  for (const p of ['AGENTS.md', '.claude/settings.json', '.yaw/answers.yaml', 'a/b/c.txt', '.github/workflows/x.yml']) {
    assert.equal(checkRelPath(p), p);
  }
});

test('writes through a symlink that leaves the project are rejected', () => {
  const root = tmp();
  const outside = tmp('yaw-outside-');
  symlinkSync(outside, join(root, 'link'));
  assert.throws(() => writeAtomic(root, 'link/evil.txt', 'x'), /escapes the project/);
  assert.throws(() => writeAtomic(root, 'link/deeper/evil.txt', 'x'), /escapes the project/);
  symlinkSync(join(outside, 'target.txt'), join(root, 'file-link'));
  writeFileSync(join(outside, 'target.txt'), 'outside');
  assert.throws(() => writeAtomic(root, 'file-link', 'x'), /escapes the project/);
  assert.deepEqual(readdirSync(outside), ['target.txt']);
  mkdirSync(join(root, 'real'));
  symlinkSync(join(root, 'real'), join(root, 'inner-link'));
  writeAtomic(root, 'inner-link/ok.txt', 'ok');
  assert.equal(read(root, 'real/ok.txt'), 'ok');
});

test('atomic write creates folders and leaves no temp files', () => {
  const root = tmp();
  writeAtomic(root, 'a/b/c.txt', 'one');
  writeAtomic(root, 'a/b/c.txt', 'two');
  assert.equal(read(root, 'a/b/c.txt'), 'two');
  assert.deepEqual(readdirSync(join(root, 'a/b')), ['c.txt']);
  assert.equal(resolveInside(root, 'a/b/c.txt').endsWith('/a/b/c.txt'), true);
});

test('hash is sha256 over LF-normalised content', () => {
  assert.equal(hashContent(''), 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(hashContent('a\r\nb\r\n'), hashContent('a\nb\n'));
  assert.notEqual(hashContent('a\rb'), hashContent('a\nb'));
  assert.equal(hashContent(Buffer.from([0xff, 0x0d, 0x0a])), hashContent(Buffer.from([0xff, 0x0a])));
});

test('versions compare numerically; a pre-release sorts before its release', () => {
  assert.equal(compareVersions('0.10.0', '0.9.0'), 1);
  assert.equal(compareVersions('v1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('1.0.0-dev', '1.0.0'), -1);
  assert.equal(compareVersions('22.13.0', '22.13.0'), 0);
  assert.equal(compareVersions('22.12.9', '22.13.0'), -1);
});

// ---------------------------------------------------------------- composition (ADR-0004)

test('markdown and line composition: owner frame first, other modules in marked blocks', () => {
  const md = compose('AGENTS.md', SHARED_FILES['AGENTS.md'], [
    { module: 'tasks', kind: 'agentsMd', content: '- Tasks rule.' },
    { module: 'core', kind: 'agentsMd', content: '- Core rule.\n' },
    { module: 'core', kind: 'template', content: '# Agents\n\n' },
    { module: 'communication', kind: 'agentsMd', content: '- Talk.\n' },
  ]);
  assert.equal(md.content, '# Agents\n\n<!-- yaw:core -->\n- Core rule.\n<!-- /yaw:core -->\n\n<!-- yaw:communication -->\n- Talk.\n<!-- /yaw:communication -->\n\n<!-- yaw:tasks -->\n- Tasks rule.\n<!-- /yaw:tasks -->\n');
  assert.deepEqual(md.fragments.map((f) => f.module), ['communication', 'tasks']);
  assert.equal(md.fragments[1].hash, hashContent('- Tasks rule.\n'));

  const just = compose('justfile', SHARED_FILES.justfile, [
    { module: 'core', kind: 'template', content: 'default:\n  just --list\n' },
    { module: 'devenv', kind: 'template', content: "import 'just/devenv.just'\n" },
  ]);
  assert.equal(just.content, "default:\n  just --list\n\n# yaw:devenv\nimport 'just/devenv.just'\n# /yaw:devenv\n");
  assert.equal(compose('.gitignore', SHARED_FILES['.gitignore'], []).content, null);
});

test('JSON composition merges objects, concatenates lists and rejects conflicting values', () => {
  const spec = SHARED_FILES['.claude/settings.json'];
  const out = compose('.claude/settings.json', spec, [
    { module: 'security', kind: 'template', content: '{"hooks":{"PreToolUse":[{"matcher":"Read"}]},"permissions":{"deny":["Read(./.env)"]}}' },
    { module: 'core', kind: 'template', content: '{"hooks":{"PreToolUse":[{"matcher":"Bash"}]}}' },
  ]);
  assert.deepEqual(JSON.parse(out.content), { hooks: { PreToolUse: [{ matcher: 'Bash' }, { matcher: 'Read' }] }, permissions: { deny: ['Read(./.env)'] } });
  assert.ok(out.content.endsWith('}\n'));
  assert.deepEqual(out.fragments.map((f) => f.module), ['security']);
  assert.throws(() => compose('x.json', spec, [
    { module: 'core', kind: 'template', content: '{"a":1}' },
    { module: 'b', kind: 'template', content: '{"a":2}' },
  ]), /module "b" sets \/a to a different value/);
  assert.throws(() => compose('x.json', spec, [{ module: 'b', kind: 'template', content: '{' }]), /not valid JSON/);
});

// ---------------------------------------------------------------- module rendering

test('module outputs: .tmpl rendered, other files copied byte for byte, conflicts rejected', () => {
  const kitRoot = makeKit(tmp('yaw-kit-'), {
    modules: {
      core: { templates: { 'a.txt.tmpl': 'mode=<%= mode %> idea=<%= answers.idea.text %>\n', 'raw.bin': Buffer.from([0, 1, 2, 0xff]) } },
      other: { templates: { 'a.txt': 'clash\n' } },
    },
  });
  const ctx = templateContext({ kitRoot, answersDoc: { mode: 'quick', answers: { 'idea.text': 'x' } }, modules: ['core'] });
  const out = renderModules({ kitRoot, modules: ['core'], context: ctx });
  assert.equal(out.get('a.txt').content.toString(), 'mode=quick idea=x\n');
  assert.deepEqual([...out.get('raw.bin').content], [0, 1, 2, 0xff]);
  assert.throws(() => renderModules({ kitRoot, modules: ['core', 'other'], context: ctx }), /a\.txt is written by modules "core" and "other" but is not a shared file/);

  writeTree(kitRoot, { 'modules/other/templates/a.txt.tmpl': 'both\n' });
  assert.throws(() => renderModules({ kitRoot, modules: ['other'], context: ctx }), /both a\.txt and a\.txt\.tmpl exist/);
});

test('a module.yaml whose template path escapes the project does not load', () => {
  const kitRoot = makeKit(tmp('yaw-kit-'), { modules: { core: { templates: {} } } });
  writeTree(kitRoot, { 'modules/evil/module.yaml': 'name: evil\ndescription: x\ndefault: { quick: true, standard: true, full: true }\noutputs:\n  templates: ["../../outside.txt"]\nagents: {}\ntokenCost: none\nlastVerified: 2026-10-20\n' });
  assert.throws(() => loadModule(kitRoot, 'evil'), /outputs\/templates\/0/);
});

test('the kit core module validates and renders the step-2 stub', () => {
  assert.equal(loadModule(KIT_ROOT, 'core').name, 'core');
});

test('init records every written file with its SHA-256 and a pristine base copy', async () => {
  const root = tmp('yaw-proj-');
  await initProject({ root, kitRoot: KIT_ROOT, answersFile: writeAnswers(tmp('yaw-ans-')) });
  const manifest = readManifest(root);
  assert.deepEqual(manifest.files.map((f) => f.path), ['.gitignore', '.yaw/answers.yaml', 'AGENTS.md', 'CLAUDE.md', 'just/node-cli.just', 'justfile', 'package.json', 'src/index.js', 'test/index.test.js']);
  for (const f of manifest.files) {
    assert.equal(hashContent(read(root, f.path)), f.hash, f.path);
    if (f.managed) assert.equal(read(root, `.yaw/base/${f.path}`), read(root, f.path));
    else assert.ok(!existsSync(join(root, `.yaw/base/${f.path}`)), `${f.path} is user code, no base copy`);
  }
  assert.equal(manifest.files.find((f) => f.path === '.yaw/answers.yaml').managed, false);
  assert.deepEqual(manifest.files.filter((f) => !f.managed).map((f) => f.path), ['.yaw/answers.yaml', 'package.json', 'src/index.js', 'test/index.test.js']);
  assert.match(read(root, 'AGENTS.md'), /^# AGENTS\.md\n\nRules for coding agents in this project, written by YAW \(quick setup\)/);
  assert.match(read(root, 'AGENTS.md'), /<!-- yaw:core -->\n- Start every task/);
  assert.equal(read(root, 'CLAUDE.md'), '@AGENTS.md\n');
  assert.ok(!existsSync(join(root, '.yaw/base/.yaw')));
});
