// compact L2 (T-054, kickoff/16-compact-output.md §4 L2): the Claude Code compress hook. Methods `ansi`,
// `progress`, `dedup`, `cap` (with the re-run hint; recall is T-055), grep grouping by file and the lockfile
// summary; guards: output under 512 bytes, detail flags, git diff|show, `yaw run` output, every Read except a
// whole lockfile, levers off, failures. Payloads: the recorded T-047 fixtures (test/fixtures/claude/).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { runCompress } from '../../../core/hooks/compress.js';
import { hookParts } from '../../../core/render/agents.js';
import { loadModule } from '../../../core/render/kit.js';
import { fixture, hook, makeProject } from '../../../test/helpers/hooks.js';
import { KIT_ROOT, capture, tmp } from '../../../test/helpers/fixtures.js';
import { ansi, cap, condense, dedup, groupGrep, lockfile, progress } from '../lib/methods.js';
import { writePersonal } from '../lib/settings.js';

const HINT = 're-run with YAW_VERBOSE=1 for the full output';
const lines = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1));

// A project with compact enabled; the personal setting turns the levers on (default: the hook lever only).
async function setup(levers = ['hook']) {
  const root = await makeProject({ modules: ['core', 'compact'] });
  const home = tmp('yaw-home-');
  if (levers) writePersonal({ HOME: home }, root, levers);
  return { root, home };
}

const run = (p, payload, env = {}) => hook({ root: p.root, agent: 'claude', event: payload.hook_event_name, module: 'compact', payload, env: { HOME: p.home, ...env } });
const replaced = (r) => (r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.updatedToolOutput : null);

function bash(stdout, command = 'npm test', stderr = '') {
  const f = fixture('claude', 'PostToolUse-Bash');
  f.tool_input.command = command;
  f.tool_response = { ...f.tool_response, stdout, stderr };
  return f;
}

function grep(content) {
  const f = fixture('claude', 'PostToolUse-Grep');
  f.tool_response = { ...f.tool_response, content, numLines: content.split('\n').length, totalLines: content.split('\n').length };
  return f;
}

function read(name, content, file = {}) {
  const f = fixture('claude', 'PostToolUse-Read');
  const n = content.split('\n').length;
  f.tool_input.file_path = `/work/proj/${name}`;
  f.tool_response.file = { ...f.tool_response.file, filePath: `/work/proj/${name}`, content, numLines: n, totalLines: n, ...file };
  return f;
}

const NOISY = `\x1b[32mPASS\x1b[0m test/a.test.js\nDownloading 10%\rDownloading 50%\rDownloading 100%\n${'warn: retry\n'.repeat(5)}${'x'.repeat(600)}\ndone`;
const NOISY_OUT = `PASS test/a.test.js\nDownloading 100%\nwarn: retry\n… 4 more identical lines\n${'x'.repeat(600)}\ndone`;

const PACKAGE_LOCK = JSON.stringify({
  name: 'app', version: '1.0.0', lockfileVersion: 3, requires: true,
  packages: Object.fromEntries([['', { name: 'app', version: '1.0.0' }], ...lines(30, (i) => [`node_modules/pkg-${i}`, { version: `1.${i}.0`, resolved: `https://registry.npmjs.org/pkg-${i}/-/pkg-${i}-1.${i}.0.tgz`, integrity: `sha512-${'a'.repeat(40)}` }]), ['node_modules/pkg-1/node_modules/@scope/inner', { version: '0.1.0' }]]),
}, null, 2);

test('methods: ansi, progress, dedup and cap, each on its own', () => {
  assert.equal(ansi('\x1b[1;31merror\x1b[0m: \x1b]8;;https://x\x07link\x1b]8;;\x07'), 'error: link');
  assert.equal(progress('a\n 10%\r 50%\r100%\nb\r\n'), 'a\n100%\nb\n');
  assert.equal(dedup('a\nb\nb\nc\nc\nc\nc\nd\n'), 'a\nb\nb\nc\n… 3 more identical lines\nd\n');
  const long = `${lines(400, (i) => `line ${i}`).join('\n')}\n`;
  assert.equal(cap(long), `${[...lines(50, (i) => `line ${i}`), '… 150 lines cut …', ...lines(200, (i) => `line ${i + 200}`), HINT].join('\n')}\n`);
  assert.equal(cap(lines(300, String).join('\n')), lines(300, String).join('\n'));
  assert.deepEqual(condense(NOISY), { text: NOISY_OUT, methods: ['ansi', 'progress', 'dedup'] });
  assert.deepEqual(condense('plain\ntext'), { text: 'plain\ntext', methods: [] });
});

test('Bash fixture: ANSI, progress frames and repeats go, in the tool\'s own shape', async () => {
  const p = await setup();
  const r = await run(p, bash(NOISY, 'npm test', `${'\x1b[33mwarn\x1b[0m\n'.repeat(3)}`));
  assert.equal(r.code, 0);
  const original = fixture('claude', 'PostToolUse-Bash').tool_response;
  const out = replaced(r);
  assert.deepEqual(Object.keys(out).sort(), Object.keys(original).sort());
  assert.deepEqual(out, { ...original, stdout: NOISY_OUT, stderr: 'warn\n… 2 more identical lines\n' });
  const rec = JSON.parse(readFileSync(join(p.home, '.yaw', 'logs', 'hooks.jsonl'), 'utf8').trim());
  assert.equal(rec.method, 'ansi+progress+dedup');
});

test('Bash fixture: over 300 lines keeps the first 50 and the last 200, and says how to get the rest', async () => {
  const p = await setup();
  const out = replaced(await run(p, bash(lines(1000, (i) => `ok ${i} - test number ${i}`).join('\n'))));
  const rows = out.stdout.split('\n');
  assert.equal(rows.length, 252);
  assert.deepEqual([rows[0], rows[49], rows[50], rows[51], rows[250], rows[251]], ['ok 1 - test number 1', 'ok 50 - test number 50', '… 750 lines cut …', 'ok 801 - test number 801', 'ok 1000 - test number 1000', HINT]);
});

test('Grep fixture: content lines are grouped by file', async () => {
  const p = await setup();
  const content = [...lines(12, (i) => `src/lib/very/long/path/to/module-a.js:${i}:const value${i} = foo(${i});`), ...lines(12, (i) => `src/lib/very/long/path/to/module-b.js:${i * 2}:foo(${i})`)].join('\n');
  const f = grep(content);
  const out = replaced(await run(p, f));
  assert.deepEqual(out, {
    ...f.tool_response,
    content: ['src/lib/very/long/path/to/module-a.js', ...lines(12, (i) => `  ${i}:const value${i} = foo(${i});`), 'src/lib/very/long/path/to/module-b.js', ...lines(12, (i) => `  ${i * 2}:foo(${i})`)].join('\n'),
  });
  assert.equal(groupGrep('a.js:1:x\nnot a match line'), null);
});

test('Read fixture: a whole lockfile becomes a name@version list with a note', async () => {
  const p = await setup();
  const f = read('package-lock.json', PACKAGE_LOCK);
  const r = await run(p, f);
  const out = replaced(r);
  const names = [...lines(30, (i) => `pkg-${i}@1.${i}.0`), '@scope/inner@0.1.0'];
  assert.equal(out.file.content, [`[lockfile summary: ${names.length} packages as name@version; an Edit old_string will not match; Read with offset and limit for the raw lines]`, ...names].join('\n'));
  assert.deepEqual(out, { ...f.tool_response, file: { ...f.tool_response.file, content: out.file.content, numLines: names.length + 1 } });
  assert.equal(JSON.parse(readFileSync(join(p.home, '.yaw', 'logs', 'hooks.jsonl'), 'utf8').trim()).method, 'lockfile');
});

test('lockfile summary: the lockfiles of the kit profiles', () => {
  const list = (name, text) => lockfile(name, text)?.split('\n').slice(1);
  assert.deepEqual(list('package-lock.json', JSON.stringify({ lockfileVersion: 1, dependencies: { a: { version: '1.0.0', dependencies: { b: { version: '2.0.0' } } } } })), ['a@1.0.0', 'b@2.0.0']);
  assert.deepEqual(list('yarn.lock', '# yarn lockfile v1\n\n\n"@babel/core@^7.0.0", "@babel/core@^7.1.0":\n  version "7.2.0"\n  resolved "https://x"\n\nlodash@^4.17.21:\n  version "4.17.21"\n'), ['@babel/core@7.2.0', 'lodash@4.17.21']);
  assert.deepEqual(list('yarn.lock', '__metadata:\n  version: 6\n\n"lodash@npm:^4.17.21":\n  version: 4.17.21\n  resolution: "lodash@npm:4.17.21"\n'), ['lodash@4.17.21']);
  assert.deepEqual(list('pnpm-lock.yaml', "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      foo:\n        specifier: ^1.0.0\n        version: 1.0.0\npackages:\n  foo@1.0.0:\n    resolution: {integrity: sha512-x}\n  '@scope/bar@2.0.0':\n    resolution: {integrity: sha512-y}\nsnapshots:\n  foo@1.0.0: {}\n"), ['foo@1.0.0', '@scope/bar@2.0.0']);
  assert.deepEqual(list('pnpm-lock.yaml', "lockfileVersion: '6.0'\npackages:\n  /foo@1.0.0(react@18.0.0):\n    dev: false\n"), ['foo@1.0.0']);
  assert.deepEqual(list('Cargo.lock', 'version = 3\n\n[[package]]\nname = "anyhow"\nversion = "1.0.75"\nsource = "registry"\n\n[[package]]\nname = "serde"\nversion = "1.0.190"\ndependencies = [\n "serde_derive",\n]\n'), ['anyhow@1.0.75', 'serde@1.0.190']);
  assert.deepEqual(list('poetry.lock', '[[package]]\nname = "requests"\nversion = "2.31.0"\n\n[package.dependencies]\nidna = ">=2.5"\n\n[[package]]\nname = "idna"\nversion = "3.4"\n'), ['requests@2.31.0', 'idna@3.4']);
  assert.deepEqual(list('uv.lock', 'version = 1\n\n[[package]]\nname = "click"\nversion = "8.1.7"\nsource = { registry = "https://pypi.org/simple" }\n'), ['click@8.1.7']);
  assert.deepEqual(list('go.sum', 'github.com/a/b v1.2.0 h1:abc=\ngithub.com/a/b v1.2.0/go.mod h1:def=\ngolang.org/x/mod v0.14.0/go.mod h1:ghi=\n'), ['github.com/a/b@v1.2.0', 'golang.org/x/mod@v0.14.0']);
  assert.deepEqual(list('composer.lock', JSON.stringify({ packages: [{ name: 'monolog/monolog', version: '3.5.0' }], 'packages-dev': [{ name: 'phpunit/phpunit', version: '10.4.2' }] })), ['monolog/monolog@3.5.0', 'phpunit/phpunit@10.4.2']);
  assert.equal(lockfile('package.json', PACKAGE_LOCK), null);
  assert.equal(lockfile('package-lock.json', '{not json'), null);
  assert.equal(lockfile('Cargo.lock', 'version = 3\n'), null);
});

test('guards: these calls keep their output', async () => {
  const p = await setup(['recipes', 'hook']);
  const big = `${'\x1b[31mFAIL\x1b[0m\n'.repeat(400)}`;
  const cases = {
    'recorded Bash fixture (under 512 bytes)': fixture('claude', 'PostToolUse-Bash'),
    'recorded Grep fixture (under 512 bytes)': fixture('claude', 'PostToolUse-Grep'),
    'recorded Read fixture': fixture('claude', 'PostToolUse-Read'),
    'compressible but under 512 bytes': bash(`${'\x1b[31mx\x1b[0m\n'.repeat(40)}`),
    '-v': bash(big, 'npm test -- -v'),
    '--verbose': bash(big, 'cargo build --verbose'),
    '--nocapture': bash(big, 'cargo test -- --nocapture'),
    'YAW_VERBOSE=1 re-run': bash(big, 'YAW_VERBOSE=1 npm test'),
    'git diff': bash(big, 'git diff HEAD~1'),
    'git show': bash(big, 'cd sub && git --no-pager show abc123'),
    'yaw run': bash(big, 'yaw run --compact --step test -- npm test'),
    'just with the recipes lever': bash(big, 'just test'),
    'an image': { ...bash(big), tool_response: { ...bash(big).tool_response, isImage: true } },
    'Read of a source file': read('src/main.js', big),
    'partial Read of a lockfile': read('package-lock.json', PACKAGE_LOCK, { numLines: 20, totalLines: 400 }),
    'Read of a lockfile from line 10': read('package-lock.json', PACKAGE_LOCK, { startLine: 10 }),
    'failing Bash (PostToolUseFailure)': fixture('claude', 'PostToolUseFailure-Bash-exit3'),
    'failing WebFetch (PostToolUseFailure)': fixture('claude', 'PostToolUseFailure-WebFetch'),
  };
  for (const [name, payload] of Object.entries(cases)) {
    const r = await run(p, payload);
    assert.deepEqual([r.code, r.stdout], [0, ''], name);
  }
  // YAW_VERBOSE=1 in the hook's environment
  assert.equal((await run(p, bash(big), { YAW_VERBOSE: '1' })).stdout, '');
});

test('levers: no hook lever, no compression; YAW_COMPACT=0 wins over the personal setting', async () => {
  const big = bash(`${'\x1b[31mFAIL\x1b[0m\n'.repeat(400)}`);
  const none = await setup(null);
  assert.equal((await run(none, big)).stdout, '');
  const recipes = await setup(['recipes']);
  assert.equal((await run(recipes, big)).stdout, '');
  const on = await setup(['hook']);
  assert.ok(replaced(await run(on, big)));
  assert.equal((await run(on, big, { YAW_COMPACT: '0' })).stdout, '');
  // `just` is compressed when the recipes lever is off (no wrapper ran)
  assert.ok(replaced(await run(on, bash(big.tool_response.stdout, 'just test'))));
});

test('never worse: a grouping that would grow the output is dropped', async () => {
  const p = await setup();
  const content = lines(40, (i) => `f${i}.js:${i}:foo`).join('\n');
  assert.ok(Buffer.byteLength(content) >= 512);
  assert.equal((await run(p, grep(content))).stdout, '');
});

test('fails open: an unreadable personal setting leaves the output alone', async () => {
  const p = await setup(null);
  mkdirSync(join(p.home, '.yaw'), { recursive: true });
  writeFileSync(join(p.home, 'elsewhere.json'), '{}');
  symlinkSync(join(p.home, 'elsewhere.json'), join(p.home, '.yaw', 'compact.json'));
  const r = await run(p, bash(`${'\x1b[31mFAIL\x1b[0m\n'.repeat(400)}`));
  assert.deepEqual([r.code, r.stdout], [0, '']);
  assert.match(readFileSync(join(p.home, '.yaw', 'logs', 'hook-errors.log'), 'utf8'), /compact\/compress: /);
});

test('registration: Claude Code PostToolUse on Bash, Grep and Read, through the lean entry', () => {
  const def = loadModule(KIT_ROOT, 'compact');
  const parts = hookParts({ definitions: new Map([['compact', def]]), modules: ['compact'], agents: ['claude', 'codex', 'copilot'] });
  assert.deepEqual(parts.map((x) => x.path), ['.claude/settings.json']);
  const { hooks } = JSON.parse(parts[0].content);
  assert.deepEqual(Object.keys(hooks), ['PostToolUse']);
  assert.equal(hooks.PostToolUse[0].matcher, 'Bash|Grep|Read');
  assert.match(hooks.PostToolUse[0].hooks[0].command, /--module compact --compress$/);
});

test('lean entry: the same result without loading the kit, the schemas or the CLI', async () => {
  const p = await setup();
  const stdout = capture();
  const code = await runCompress(['PostToolUse', '--agent', 'claude', '--module', 'compact', '--compress'], { stdin: Readable.from([JSON.stringify(bash(NOISY))]), stdout, cwd: p.root, env: { HOME: p.home } });
  assert.equal(code, 0);
  assert.equal(JSON.parse(stdout.text()).hookSpecificOutput.updatedToolOutput.stdout, NOISY_OUT);

  // module loads of the handler in a fresh process
  const dir = tmp('yaw-leanrun-');
  const log = join(dir, 'loaded.txt');
  writeFileSync(join(dir, 'trace.mjs'), `import { appendFileSync } from 'node:fs';\nexport async function resolve(spec, ctx, next) { const r = await next(spec, ctx); appendFileSync(${JSON.stringify(log)}, r.url + '\\n'); return r; }\n`);
  writeFileSync(join(dir, 'register.mjs'), `import { register } from 'node:module';\nregister(${JSON.stringify(pathToFileURL(join(dir, 'trace.mjs')).href)});\n`);
  const r = spawnSync(process.execPath, ['--no-warnings', '--import', pathToFileURL(join(dir, 'register.mjs')).href, '--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(join(KIT_ROOT, 'modules', 'compact', 'hooks', 'compress.js')).href)})`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const loaded = readFileSync(log, 'utf8').split('\n').filter((u) => u.startsWith('file:')).map((u) => u.replace(`file://${KIT_ROOT}/`, ''));
  assert.ok(loaded.includes('modules/compact/hooks/compress.js'));
  for (const heavy of [/^core\/render\//, /^core\/schema\//, /^core\/cli\//, /^core\/lib\/user-store\.js$/, /node_modules/]) {
    assert.deepEqual(loaded.filter((f) => heavy.test(f)), [], String(heavy));
  }
});
