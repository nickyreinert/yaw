// code-map (Y-5.11, ADR-0033): the generated map, the freshness check, the index, safety, hooks, removal.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { readManifest } from '../../../core/render/manifest.js';
import { initProject } from '../../../core/render/project.js';
import { loadModule } from '../../../core/render/kit.js';
import { main } from '../../../core/cli/main.js';
import { cacheFile, diffIndex, gitInfo, hashFile, listFiles, refresh } from '../lib/index.js';
import { MapFormatError, parseMap, updateText } from '../lib/map.js';
import { runMap } from '../lib/cli.js';
import { KIT_ROOT, capture, cleanEnv, hasTool, read, readTree, run, scripted, tmp, writeAnswers, writeTree } from '../../../test/helpers/fixtures.js';

const answers = (modules) => `mode: full\nanswers:\n  user.agents: [claude, codex, copilot]\n  idea.text: A tiny command-line tool.\nproposal:\n  status: confirmed\n  summary: test project\n  profiles: [node-cli]\n  modules: [${modules.join(', ')}]\n`;
const SOURCES = { 'src/index.js': 'export const a = 1;\n', 'src/lib/util.js': 'export const b = 2;\n', 'test/a.test.js': '// test\n', 'README.md': '# demo\n' };

const gitIn = (root, home, ...args) => {
  const r = run('git', args, { cwd: root, env: cleanEnv(home) });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};

// A git repo with some sources and the code-map module installed; `home` holds the cache (YAW_HOME).
async function project({ modules = ['core', 'code-map'], files = SOURCES, git = true } = {}) {
  const root = tmp('yaw-map-');
  const home = tmp('yaw-maphome-');
  if (git) gitIn(root, home, 'init', '-q', '-b', 'main');
  writeTree(root, files);
  await initProject({ root, kitRoot: KIT_ROOT, answersFile: writeAnswers(tmp('yaw-ans-'), answers(modules)), modules });
  const env = { ...cleanEnv(home), PATH: process.env.PATH, YAW_HOME: join(home, '.yaw') };
  const yaw = async (...args) => {
    const stdout = capture();
    const stderr = capture();
    const code = await main(args, { cwd: root, kitRoot: KIT_ROOT, stdout, stderr, env, prompter: { ...scripted(), interactive: false } });
    return { code, out: stdout.text(), err: stderr.text() };
  };
  return { root, home, env, yaw, git: (...a) => gitIn(root, home, ...a) };
}

const mapText = (root) => read(root, 'docs/code-map.md');
const cacheDir = (env) => join(env.YAW_HOME, 'cache', 'code-map');
const cacheFiles = (env) => (existsSync(cacheDir(env)) ? readdirSync(cacheDir(env)).filter((f) => f.endsWith('.json')) : []);

test('the module renders its files, the gate, one AGENTS.md line and the user-owned starter map', async () => {
  const { root } = await project();
  const tree = readTree(root);
  assert.match(tree.justfile, /# yaw:code-map\nimport 'just\/code-map.just'\n# \/yaw:code-map/);
  assert.match(tree.justfile, /^sync-check: map-check$/m);
  assert.match(tree['just/code-map.just'], /^map-check:/m);
  assert.match(tree['AGENTS.md'], /<!-- yaw:code-map -->\n- Code map: read `docs\/code-map.md`/);
  const byPath = Object.fromEntries(readManifest(root).files.map((f) => [f.path, f]));
  assert.equal(byPath['docs/code-map.md'].module, 'code-map');
  assert.equal(byPath['docs/code-map.md'].managed, false);
  assert.equal(byPath['just/code-map.just'].managed, true);
  assert.deepEqual(loadModule(KIT_ROOT, 'code-map').outputs.gates, ['map-check']);
  assert.deepEqual(loadModule(KIT_ROOT, 'code-map').default, { quick: false, standard: true, full: true });
});

test('no agent hook is registered (the map costs only the AGENTS.md line)', async () => {
  const { root } = await project();
  assert.equal(loadModule(KIT_ROOT, 'code-map').outputs.hooks, undefined);
  for (const f of ['.claude/settings.json', '.codex/hooks.json']) if (existsSync(join(root, f))) assert.doesNotMatch(read(root, f), /code-map|yaw map/);
});

test('a fresh project passes check, with the areas of its top-level directories', async () => {
  const { root, yaw } = await project();
  const r = await yaw('map', 'check');
  assert.equal(r.code, 0, r.err);
  assert.match(mapText(root), /^\| `src` \| src \| `src\/\*\*` \|/m);
  assert.match(mapText(root), /^\| `root` \| Top-level files \| `\*` \|/m);
  assert.match(r.err, /warning: \d+ area descriptions are still the placeholder/);
});

test('stale maps: a new directory, a removed directory, a changed declaration and a hand edit fail check with the repair command; update fixes them', async () => {
  const { root, yaw } = await project();
  const fails = async (what) => {
    const r = await yaw('map', 'check');
    assert.equal(r.code, 1, `${what}: ${r.err}`);
    assert.match(r.err, /just map update|docs\/code-map\.md/, what);
    return r;
  };
  // new directory: stale directory list and an uncovered area
  writeTree(root, { 'src/newdir/x.js': 'x\n' });
  assert.match((await fails('new directory')).err, /generated section "area-src" is stale: run `just map update`/);
  assert.equal((await yaw('map', 'update')).code, 0);
  assert.equal((await yaw('map', 'check')).code, 0);
  // removed directory
  rmSync(join(root, 'src/newdir'), { recursive: true });
  await fails('removed directory');
  await yaw('map', 'update');
  // edited front-matter declaration
  writeFileSync(join(root, 'docs/code-map.md'), mapText(root).replace('title: src', 'title: Source'));
  assert.match((await fails('declaration')).err, /"overview" is stale/);
  await yaw('map', 'update');
  // hand edit inside a generated block
  writeFileSync(join(root, 'docs/code-map.md'), mapText(root).replace('- Tests: -', '- Tests: `made-up`'));
  assert.match((await fails('hand edit')).err, /is stale/);
  assert.equal((await yaw('map', 'update')).code, 0);
  assert.equal((await yaw('map', 'check')).code, 0);
});

test('adding a file to an existing directory does not make the map stale', async () => {
  const { root, yaw } = await project();
  writeTree(root, { 'src/lib/more.js': 'export {};\n', 'src/index2.js': 'export {};\n' });
  assert.equal((await yaw('map', 'check')).code, 0);
});

test('broken references: missing entry and tests, a glob matching nothing, an unknown relates, a missing ADR, a broken link', async () => {
  const { root, yaw } = await project({ files: { ...SOURCES, '.decisions/ADR-0001.md': '# x\n' } });
  await yaw('map', 'update');
  const text = mapText(root);
  const broken = text.replace('  - id: src\n', '  - id: src\n    entry: [src/nope.js]\n    tests: ["test/**/*.spec.js"]\n    relates: [ghost]\n    adrs: [ADR-0001, ADR-9999]\n')
    .replace('# Code map\n', '# Code map\n\nSee [the guide](docs/guide.md) and [ok](../README.md).\n');
  assert.notEqual(broken, text);
  writeFileSync(join(root, 'docs/code-map.md'), broken);
  const r = await yaw('map', 'check');
  assert.equal(r.code, 1);
  assert.match(r.err, /area "src" entry "src\/nope.js" matches no file/);
  assert.match(r.err, /area "src" tests "test\/\*\*\/\*.spec.js" matches no file/);
  assert.match(r.err, /relates to unknown area "ghost"/);
  assert.match(r.err, /names ADR-9999, but .decisions\/ADR-9999.md does not exist/);
  assert.doesNotMatch(r.err, /ADR-0001, but/);
  assert.match(r.err, /link "docs\/guide.md" .* points to a missing path/);
  assert.doesNotMatch(r.err, /link "\.\.\/README.md"/);
});

test('an uncovered new top-level file fails check; declaring or excluding it fixes it', async () => {
  const { root, yaw } = await project({ files: { ...SOURCES } });
  writeTree(root, { 'tools/gen.js': 'x\n' });
  const r = await yaw('map', 'check');
  assert.equal(r.code, 1);
  assert.match(r.err, /uncovered: 1 file in no area \(tools\/ \(1\)\)/);
  assert.match(r.err, /just map update/);
  writeFileSync(join(root, 'docs/code-map.md'), mapText(root).replace('exclude', 'exclude').replace('areas:\n', 'exclude: ["tools/**"]\nareas:\n'));
  await yaw('map', 'update');
  assert.equal((await yaw('map', 'check')).code, 0);
});

test('the index sees new, edited, renamed and deleted files, with a rename hint when the hash matches', async () => {
  const { root, home, env } = await project();
  const info = gitInfo(root);
  const { files } = listFiles(root, { kitRoot: KIT_ROOT });
  const before = refresh(root, files);
  writeTree(root, { 'src/added.js': 'new\n', 'src/index.js': 'export const a = 99;\n' });
  rmSync(join(root, 'test/a.test.js'));
  writeFileSync(join(root, 'moved.md'), read(root, 'README.md'));
  rmSync(join(root, 'README.md'));
  const after = refresh(root, listFiles(root, { kitRoot: KIT_ROOT }).files);
  const d = diffIndex(before, after);
  assert.deepEqual(d.added, ['src/added.js']);
  assert.deepEqual(d.deleted, ['test/a.test.js']);
  assert.deepEqual(d.edited, ['src/index.js']);
  assert.deepEqual(d.renamed, [{ from: 'README.md', to: 'moved.md' }]);
  assert.ok(info.top && home && env);
});

test('update reports renames from the cache; check never writes (tree and cache unchanged)', async () => {
  const { root, env, yaw } = await project();
  await yaw('map', 'update');
  writeFileSync(join(root, 'moved.md'), read(root, 'README.md'));
  rmSync(join(root, 'README.md'));
  const u = await yaw('map', 'update');
  assert.match(u.out, /index: renamed README.md -> moved.md/);
  const snapshot = () => ({ tree: readTree(root), cache: cacheFiles(env).map((f) => [f, readFileSync(join(cacheDir(env), f), 'utf8'), statSync(join(cacheDir(env), f)).mtimeMs]) });
  const before = snapshot();
  writeTree(root, { 'newdir/x.js': 'x\n' });
  const c = await yaw('map', 'check');
  assert.equal(c.code, 1);
  rmSync(join(root, 'newdir'), { recursive: true });
  assert.deepEqual({ ...snapshot(), tree: before.tree }, before);
});

test('dirty trees: uncommitted edits, untracked non-ignored files and deleted tracked files are seen; ignored files are not', async () => {
  const { root, git } = await project();
  writeFileSync(join(root, '.gitignore'), `${read(root, '.gitignore')}\nscratch/\n`);
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  writeTree(root, { 'src/edited.js': 'a\n', 'scratch/ignored.js': 'x\n' });
  rmSync(join(root, 'src/lib/util.js'));
  const files = listFiles(root, { kitRoot: KIT_ROOT }).files;
  assert.ok(files.includes('src/edited.js'), 'untracked, not ignored');
  assert.ok(!files.includes('scratch/ignored.js'), 'ignored');
  assert.ok(!files.includes('src/lib/util.js'), 'deleted tracked file');
  assert.ok(files.includes('src/index.js'));
});

test('branch changes need no hook: after git switch, check and show match the branch; two worktrees have two caches', async () => {
  const { root, home, env, yaw, git } = await project();
  await yaw('map', 'update');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  git('switch', '-q', '-c', 'other');
  writeTree(root, { 'extra/e.js': 'x\n' });
  git('add', '-A');
  git('commit', '-q', '-m', 'extra');
  assert.equal((await yaw('map', 'check')).code, 1, 'the new directory is not in the map');
  writeFileSync(join(root, 'docs/code-map.md'), mapText(root).replace('areas:\n', 'areas:\n  - id: extra\n    title: Extra\n    paths: ["extra/**"]\n'));
  await yaw('map', 'update');
  assert.equal((await yaw('map', 'check')).code, 0);
  git('add', '-A');
  git('commit', '-q', '-m', 'map');
  git('switch', '-q', 'main');
  assert.equal((await yaw('map', 'check')).code, 0, 'main has its own map and tree');
  assert.ok(!(await yaw('map', 'show')).out.includes('extra'));

  // a second worktree of the same repository
  const wt = join(tmp('yaw-wt-'), 'wt');
  git('worktree', 'add', '-q', '-b', 'wtb', wt, 'other');
  const first = cacheFile(env, gitInfo(root));
  const second = cacheFile(env, gitInfo(wt));
  assert.notEqual(first, second);
  const out = capture();
  const err = capture();
  assert.equal(runMap({ verb: 'update', io: { root: wt, kitRoot: KIT_ROOT, env, stdout: out, stderr: err } }), 0, err.text());
  assert.ok(existsSync(second) && existsSync(first));
  assert.equal(runMap({ verb: 'check', io: { root: wt, kitRoot: KIT_ROOT, env, stdout: out, stderr: err } }), 0, err.text());
  assert.equal(JSON.parse(readFileSync(second, 'utf8')).root, gitInfo(wt).top);
  assert.ok(home);
});

test('exclusions: secrets, dependencies, outputs and links are never listed or opened', async () => {
  const outside = tmp('yaw-outside-');
  writeFileSync(join(outside, 'secret.txt'), 'outside\n');
  mkdirSync(join(outside, 'dir'));
  writeFileSync(join(outside, 'dir', 'x.txt'), 'x\n');
  const { root, yaw } = await project({
    files: {
      ...SOURCES, '.env': 'TOKEN=abc\n', '.env.example': 'TOKEN=\n', 'keys/server.pem': 'k\n', 'credentials.json': '{}\n',
      'node_modules/dep/i.js': 'x\n', 'dist/out.js': 'x\n', 'src/vendor/keep.js': 'x\n', 'coverage/c.json': '{}\n',
    },
  });
  symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt'));
  symlinkSync(join(outside, 'dir'), join(root, 'linkdir'));
  const opened = [];
  const { files } = listFiles(root, { kitRoot: KIT_ROOT });
  refresh(root, files, { open: (p, flags) => { opened.push(p); return openSync(p, flags); } });
  const names = (list) => list.map((p) => p.replace(`${root}/`, '').replace(/^.*yaw-map-[^/]*\//, ''));
  for (const bad of ['.env', 'keys/server.pem', 'credentials.json', 'node_modules/dep/i.js', 'dist/out.js', 'coverage/c.json', 'link.txt', 'linkdir/x.txt']) {
    assert.ok(!files.includes(bad), `${bad} is listed`);
    assert.ok(!names(opened).some((o) => o.endsWith(bad)), `${bad} was opened`);
  }
  assert.ok(files.includes('.env.example'));
  assert.ok(files.includes('src/vendor/keep.js'), 'vendor is excluded only at the top level');
  assert.ok(!opened.some((p) => p.includes('yaw-outside-')));
  assert.equal((await yaw('map', 'check')).code, 0);
  assert.doesNotMatch(mapText(root), /secret|TOKEN|node_modules|linkdir/);
});

test('hashFile refuses a symlink (O_NOFOLLOW)', () => {
  const dir = tmp('yaw-nf-');
  writeFileSync(join(dir, 'real'), 'x');
  symlinkSync(join(dir, 'real'), join(dir, 'link'));
  assert.equal(typeof hashFile(dir, 'real'), 'string');
  assert.throws(() => hashFile(dir, 'link'));
});

test('docs/code-map.md as a symlink is refused by every command (exit 2)', async () => {
  const { root, yaw } = await project();
  const real = join(tmp('yaw-real-'), 'map.md');
  writeFileSync(real, mapText(root));
  rmSync(join(root, 'docs/code-map.md'));
  symlinkSync(real, join(root, 'docs/code-map.md'));
  for (const verb of ['update', 'check', 'show']) {
    const r = await yaw('map', verb);
    assert.equal(r.code, 2, verb);
    assert.match(r.err, /symbolic link/);
  }
  assert.equal(read(root, 'docs/code-map.md'), readFileSync(real, 'utf8'));
});

test('determinism: the same tree gives identical bytes in different folders; update twice changes nothing', async () => {
  const a = await project();
  const b = await project();
  await a.yaw('map', 'update');
  await b.yaw('map', 'update');
  assert.equal(mapText(a.root), mapText(b.root));
  assert.doesNotMatch(mapText(a.root), new RegExp(a.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  const once = mapText(a.root);
  const u = await a.yaw('map', 'update');
  assert.match(u.out, /up to date/);
  assert.equal(mapText(a.root), once);
});

test('preservation: maintained text, unknown headings and front matter stay byte for byte after update', async () => {
  const { root, yaw } = await project();
  const text = mapText(root)
    .replace('Describe this area\'s responsibility.', 'The real source code lives here.\n\nSecond paragraph.')
    .concat('\n## Hand-written notes\n\nCross-cutting remark with `code` and [a link](../README.md).\n');
  writeFileSync(join(root, 'docs/code-map.md'), text);
  writeTree(root, { 'src/more/x.js': 'x\n' });
  assert.equal((await yaw('map', 'update')).code, 0);
  const after = mapText(root);
  const strip = (t) => t.replace(/<!-- yaw:map:begin ([a-z0-9-]+) -->\n[\s\S]*?<!-- yaw:map:end \1 -->/g, '');
  assert.equal(strip(after), strip(text));
  assert.match(after, /The real source code lives here\.\n\nSecond paragraph\./);
  assert.match(after, /`src\/more\/`/);
  assert.equal(after.split('\n---\n')[0], text.split('\n---\n')[0]);
});

test('a removed area loses its generated block, its text stays and is reported', async () => {
  const { root, yaw } = await project();
  const text = mapText(root).replace(/  - id: test\n    title: test\n    paths:\n      - test\/\*\*\n/, '');
  assert.notEqual(text, mapText(root));
  writeFileSync(join(root, 'docs/code-map.md'), text);
  writeTree(root, { 'test/more.js': 'x\n' });
  const r = await yaw('map', 'update');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /removed the generated block of "test"/);
  assert.doesNotMatch(mapText(root), /yaw:map:begin area-test/);
  assert.match(mapText(root), /^## test$/m);
});

test('malformed markers abort update without writing, with file:line', async () => {
  const { root, yaw } = await project();
  const good = mapText(root);
  const cases = {
    unclosed: good.replace(/<!-- yaw:map:end area-src -->\n/, ''),
    duplicate: `${good}\n<!-- yaw:map:begin overview -->\n<!-- yaw:map:end overview -->\n`,
    unknown: `${good}\n<!-- yaw:map:begin bogus_name -->\n`,
    orphanEnd: `${good}\n<!-- yaw:map:end area-zzz -->\n`,
  };
  for (const [name, text] of Object.entries(cases)) {
    writeFileSync(join(root, 'docs/code-map.md'), text);
    writeTree(root, { 'src/zz/x.js': 'x\n' });
    const r = await yaw('map', 'update');
    assert.equal(r.code, 1, name);
    assert.match(r.err, /docs\/code-map\.md:\d+: /, name);
    assert.equal(mapText(root), text, `${name}: nothing written`);
    rmSync(join(root, 'src/zz'), { recursive: true });
  }
  assert.throws(() => parseMap('no front matter\n'), MapFormatError);
});

test('a change to docs/code-map.md while update runs aborts the update and loses nothing', async () => {
  const { root, env } = await project();
  const io = () => ({ root, kitRoot: KIT_ROOT, env, stdout: capture(), stderr: capture() });
  writeTree(root, { 'src/zz/x.js': 'x\n' });
  const edited = `${mapText(root)}\nA concurrent edit.\n`;
  const i = io();
  const code = runMap({ verb: 'update', io: i, hooks: { beforeCommit: () => writeFileSync(join(root, 'docs/code-map.md'), edited) } });
  assert.equal(code, 1);
  assert.match(i.stderr.text(), /changed during update/);
  assert.equal(mapText(root), edited);
  assert.equal(readdirSync(join(root, 'docs')).filter((f) => f !== 'code-map.md').length, 0, 'no temp file left');
});

test('parallel update and show runs leave a valid cache and an intact map', async () => {
  const { root, env } = await project();
  writeTree(root, { 'src/par/x.js': 'x\n' });
  const bin = join(KIT_ROOT, 'bin', 'yaw');
  const jobs = ['update', 'show', 'update', 'show', 'update', 'check'].map((verb) => new Promise((resolve) => {
    const p = spawn(process.execPath, [bin, 'map', verb], { cwd: root, env: { ...env, YAW_KIT: KIT_ROOT } });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ verb, code, err }));
  }));
  const results = await Promise.all(jobs);
  for (const r of results.filter((x) => x.verb === 'show')) assert.equal(r.code, 0, r.err);
  for (const f of cacheFiles(env)) assert.ok(JSON.parse(readFileSync(join(cacheDir(env), f), 'utf8')).files);
  assert.equal(readdirSync(cacheDir(env)).filter((f) => f.endsWith('.tmp')).length, 0);
  const again = run(process.execPath, [bin, 'map', 'update'], { cwd: root, env });
  assert.equal(again.status, 0, again.stderr);
  const check = run(process.execPath, [bin, 'map', 'check'], { cwd: root, env });
  assert.equal(check.status, 0, check.stderr);
});

test('show: a bounded overview, an area, a path prefix; it notes a stale map and exits 0', async () => {
  const many = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`src/d${String(i).padStart(2, '0')}/f.js`, 'x\n']));
  const { root, yaw } = await project({ files: { ...SOURCES, ...many } });
  const all = await yaw('map', 'show');
  assert.equal(all.code, 0, all.err);
  assert.match(all.out, /^src: src, 82 files/m);
  const area = await yaw('map', 'show', 'src');
  assert.ok(area.out.trimEnd().split('\n').length <= 40, 'at most 40 lines');
  assert.match(area.out, /… \d+ more/);
  const prefix = await yaw('map', 'show', 'src/lib');
  assert.match(prefix.out, /^src\/lib: 1 file/);
  assert.match(prefix.out, /src\/lib\/ \(1\): util.js/);
  const bad = await yaw('map', 'show', 'nope');
  assert.equal(bad.code, 2);
  writeTree(root, { 'newdir/a.js': 'x\n' });
  const stale = await yaw('map', 'show');
  assert.equal(stale.code, 0);
  assert.match(stale.out, /^note: the code map is stale; run `just map update`/);
});

test('outside a git work tree the commands exit 2 with a message', async () => {
  const { yaw } = await project({ git: false });
  const r = await yaw('map', 'check');
  assert.equal(r.code, 2);
  assert.match(r.err, /not inside a git work tree/);
  assert.equal((await yaw('map', 'frob')).code, 2);
});

test('Quick plus yaw add code-map works without github, ci, git-hooks and any watcher', async () => {
  const root = tmp('yaw-quick-');
  const home = tmp('yaw-maphome-');
  gitIn(root, home, 'init', '-q', '-b', 'main');
  writeTree(root, SOURCES);
  const quick = `mode: quick\nanswers:\n  user.agents: [claude]\n  idea.text: A tiny command-line tool.\nproposal:\n  status: confirmed\n  summary: test project\n  profiles: [node-cli]\n  modules: [core]\n`;
  await initProject({ root, kitRoot: KIT_ROOT, answersFile: writeAnswers(tmp('yaw-ans-'), quick), modules: ['core'] });
  const env = { ...cleanEnv(home), PATH: process.env.PATH, YAW_HOME: join(home, '.yaw') };
  const yaw = async (...args) => {
    const stdout = capture();
    const stderr = capture();
    const code = await main(args, { cwd: root, kitRoot: KIT_ROOT, stdout, stderr, env, prompter: { ...scripted(), interactive: false } });
    return { code, out: stdout.text(), err: stderr.text() };
  };
  assert.equal((await yaw('map', 'check')).code, 1, 'not installed yet');
  assert.equal((await yaw('add', 'code-map', '--yes')).code, 0);
  const modules = Object.keys(readManifest(root).modules);
  for (const m of ['github', 'ci', 'git-hooks']) assert.ok(!modules.includes(m), m);
  assert.ok(!existsSync(join(root, 'lefthook.yml')));
  assert.equal(readManifest(root).preset, 'quick');
  assert.equal((await yaw('map', 'check')).code, 0);
  assert.equal((await yaw('map', 'update')).code, 0);
  assert.equal((await yaw('map', 'show')).code, 0);
});

test('git-hooks gets a code-map pre-commit job exactly when both modules are installed', async () => {
  const both = await project({ modules: ['core', 'git-hooks', 'code-map'] });
  assert.match(read(both.root, 'lefthook.yml'), /pre-commit:[\s\S]*- name: lint\n\s+run: just lint\n\s*# Cheap check[^\n]*\n\s+- name: code-map\n\s+run: just map-check/);
  const only = await project({ modules: ['core', 'git-hooks'] });
  assert.doesNotMatch(read(only.root, 'lefthook.yml'), /code-map|map-check/);
  assert.equal((await only.yaw('add', 'code-map', '--yes')).code, 0);
  assert.match(read(only.root, 'lefthook.yml'), /name: code-map\n\s+run: just map-check/);
  assert.equal((await only.yaw('remove', 'code-map', '--yes')).code, 0);
  assert.doesNotMatch(read(only.root, 'lefthook.yml'), /code-map|map-check/);
});

test('just check runs map-check through sync-check: red when stale, green after update, a note without the kit', { skip: !hasTool('just') && 'just is not installed' }, async () => {
  const { root, env, yaw } = await project();
  const withKit = { ...env, YAW_KIT: KIT_ROOT };
  assert.equal(run('just', ['sync-check'], { cwd: root, env: withKit }).status, 0);
  writeTree(root, { 'src/newdir/x.js': 'x\n' });
  const red = run('just', ['sync-check'], { cwd: root, env: withKit });
  assert.notEqual(red.status, 0);
  assert.match(red.stderr, /just map update/);
  await yaw('map', 'update');
  assert.equal(run('just', ['sync-check'], { cwd: root, env: withKit }).status, 0);
  const none = run('just', ['map-check'], { cwd: root, env: { ...env, HOME: tmp('yaw-nokit-') } });
  assert.equal(none.status, 0);
  assert.match(none.stdout, /the YAW kit is not installed, the code map was not checked/);
});

test('removal: files, fragments, gate, job and cache are gone; docs/code-map.md is kept; re-adding asks nothing and keeps the map', async () => {
  const { root, env, yaw } = await project({ modules: ['core', 'git-hooks', 'code-map'] });
  await yaw('map', 'update');
  assert.equal(cacheFiles(env).length, 1);
  const mine = `${mapText(root)}\n## My notes\n\nKeep me.\n`;
  writeFileSync(join(root, 'docs/code-map.md'), mine);
  const r = await yaw('remove', 'code-map', '--yes');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /keep \(owned by you\): docs\/code-map\.md/);
  assert.ok(!existsSync(join(root, 'just/code-map.just')));
  assert.doesNotMatch(read(root, 'justfile'), /code-map|map-check/);
  assert.doesNotMatch(read(root, 'AGENTS.md'), /Code map/);
  assert.doesNotMatch(read(root, 'lefthook.yml'), /code-map/);
  assert.equal(mapText(root), mine);
  assert.equal(cacheFiles(env).length, 0, 'the cache file of this worktree is deleted');
  assert.ok(!readManifest(root).files.some((f) => f.module === 'code-map'));
  const again = await yaw('add', 'code-map', '--yes');
  assert.equal(again.code, 0, again.err);
  assert.equal(mapText(root), mine);
  assert.equal((await yaw('map', 'check')).code, 0);
});

test('removal: an edited lefthook.yml goes through keep / take / merge', async () => {
  const edit = async () => {
    const p = await project({ modules: ['core', 'git-hooks', 'code-map'] });
    writeFileSync(join(p.root, 'lefthook.yml'), `# my own comment\n${read(p.root, 'lefthook.yml')}`);
    return p;
  };
  const kept = await edit();
  assert.equal((await kept.yaw('remove', 'code-map', '--yes')).code, 0);
  assert.match(read(kept.root, 'lefthook.yml'), /# my own comment/);
  assert.match(read(kept.root, 'lefthook.yml'), /name: code-map/, 'keep: your file is untouched');
  const taken = await edit();
  assert.equal((await taken.yaw('remove', 'code-map', '--yes', '--strategy', 'take')).code, 0);
  assert.doesNotMatch(read(taken.root, 'lefthook.yml'), /code-map|my own comment/);
  const merged = await edit();
  const m = await merged.yaw('remove', 'code-map', '--yes', '--strategy', 'merge');
  assert.equal(m.code, 0, m.err);
  assert.match(read(merged.root, 'lefthook.yml'), /# my own comment/);
  assert.doesNotMatch(read(merged.root, 'lefthook.yml'), /name: code-map/);
});

test('updateText is a pure function of text, model and files', () => {
  const text = '---\nareas:\n  - id: a\n    title: A\n    paths: ["a/**"]\n---\n# Map\n';
  const model = parseMap(text);
  const one = updateText(text, model, ['a/x.js']);
  const two = updateText(one.text, parseMap(one.text), ['a/x.js']);
  assert.equal(two.text, one.text);
  assert.deepEqual(two.changed, []);
});
