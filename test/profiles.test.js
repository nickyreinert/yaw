// Profiles python-cli (Y-3.4), node-cli (Y-3.5) and static-site (Y-6.1): parts, uniform verbs, and the smoke test per
// examples/<profile>/ (init in a temp dir, then just setup && just check).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, parseDocument } from '../core/lib/yaml.js';
import { formatError } from '../core/lib/schema.js';
import { listProfiles, loadProfile, schemas } from '../core/render/kit.js';
import { suggestProfiles } from '../core/interview/suggest.js';
import { KIT_ROOT, cleanEnv, hasTool, run, tmp } from './helpers/fixtures.js';

const PROFILES = ['node-cli', 'python-cli', 'static-site'];
const YAW = join(KIT_ROOT, 'bin', 'yaw');
const VERBS = ['setup', 'dev', 'fmt', 'lint', 'typecheck', 'test', 'check', 'build', 'screenshot', 'preview', 'preview-share', 'audit', 'db-migrate', 'db-reset', 'backup', 'restore', 'deploy'];
const NOT_APPLICABLE = ['screenshot', 'preview', 'preview-share', 'db-migrate', 'db-reset', 'backup', 'restore'];
const haveJust = hasTool('just');
const skipJust = !haveJust && 'just is not installed';
const dir = (p, ...rest) => join(KIT_ROOT, 'profiles', p, ...rest);

test('the kit has exactly the profiles node-cli, python-cli and static-site, and profile.yaml validates', () => {
  assert.deepEqual(listProfiles(KIT_ROOT).map((p) => p.name), PROFILES);
  for (const name of PROFILES) {
    const profile = loadProfile(KIT_ROOT, name);
    assert.ok(profile.summary.length > 0);
    assert.ok(profile.requires.includes('just'));
  }
  assert.deepEqual(loadProfile(KIT_ROOT, 'node-cli').requires, ['node>=22.13', 'just']);
});

test('examples/<profile>/answers.yaml validates and names its profile', () => {
  for (const name of PROFILES) {
    const file = join(KIT_ROOT, 'examples', name, 'answers.yaml');
    const { value, lines } = parseDocument(readFileSync(file, 'utf8'), { file });
    assert.deepEqual(schemas().validate('answers.schema.json', value, { lines }).map((e) => formatError(e, file)), []);
    assert.deepEqual(value.proposal.profiles, [name]);
  }
});

test('each profile has the doc 05 parts', () => {
  for (const name of PROFILES) {
    for (const part of ['profile.yaml', 'standards.md', 'guards.yaml', 'gitignore', `just/${name}.just`, 'ci/check.yml', 'scaffold']) assert.ok(existsSync(dir(name, part)), `${name}/${part}`);
    const standards = readFileSync(dir(name, 'standards.md'), 'utf8').trimEnd().split('\n');
    assert.ok(standards.length <= 20, `${name}/standards.md has ${standards.length} lines (limit 20)`);
  }
});

test('guards.yaml: id, pattern (a valid regex) and reason per guard', () => {
  for (const name of PROFILES) {
    const { guards } = parse(readFileSync(dir(name, 'guards.yaml'), 'utf8'), { file: `${name}/guards.yaml` });
    assert.ok(guards.length >= 1);
    for (const g of guards) {
      assert.deepEqual(Object.keys(g).sort(), ['id', 'pattern', 'reason']);
      assert.match(g.id, /^[a-z][a-z0-9-]*$/);
      assert.doesNotThrow(() => new RegExp(g.pattern), g.id);
    }
  }
  const node = parse(readFileSync(dir('node-cli', 'guards.yaml'), 'utf8')).guards;
  assert.ok(new RegExp(node[0].pattern).test('npm publish --access public'));
  assert.ok(!new RegExp(node[0].pattern).test('npm test'));
});

test('ci/check.yml is a steps fragment that ends with just setup and just check', () => {
  for (const name of PROFILES) {
    const { steps } = parse(readFileSync(dir(name, 'ci', 'check.yml'), 'utf8'), { file: `${name}/ci/check.yml` });
    assert.equal(steps[0].uses.startsWith('actions/checkout@'), true);
    assert.deepEqual(steps.slice(-2).map((s) => s.run), ['just setup', 'just check']);
  }
  const setup = parse(readFileSync(dir('node-cli', 'ci', 'check.yml'), 'utf8')).steps.find((s) => s.uses?.startsWith('actions/setup-node'));
  assert.equal(setup.with['node-version'], '22.13');
});

test('the just fragment defines every uniform verb (doc 01 §6) and nothing else', () => {
  for (const name of PROFILES) {
    const text = readFileSync(dir(name, 'just', `${name}.just`), 'utf8');
    const recipes = [...text.matchAll(/^([a-z][a-z-]*)(?: [^:\n]*)?:(?!=)/gm)].map((m) => m[1]);
    assert.deepEqual(recipes.sort(), [...VERBS].sort(), name);
    assert.doesNotMatch(text, /^(task|gh|default)\b/m);
  }
});

test('profiles are plain files: no secrets, zero-dependency scaffold for node-cli', () => {
  const pkg = JSON.parse(readFileSync(dir('node-cli', 'scaffold', 'package.json'), 'utf8'));
  assert.equal(pkg.engines.node, '>=22.13');
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.equal(pkg.scripts.test, 'node --test');
  for (const name of PROFILES) {
    for (const file of readdirSync(dir(name), { recursive: true, withFileTypes: true }).filter((e) => e.isFile())) {
      assert.doesNotMatch(readFileSync(join(file.parentPath, file.name), 'utf8'), /(api[_-]?key|secret|password|token)\s*[:=]\s*\S+/i, file.name);
    }
  }
});

function initExample(profile, env, extra = []) {
  const cwd = tmp('yaw-smoke-');
  const r = run(process.execPath, [YAW, 'init', '--answers', join(KIT_ROOT, 'examples', profile, 'answers.yaml'), '--yes', ...extra], { cwd, env });
  return { cwd, r };
}

test('smoke node-cli: yaw init in an empty folder, just setup && just check pass', { skip: skipJust }, () => {
  const env = cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH });
  const { cwd, r } = initExample('node-cli', env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /\$ just setup\n/);
  assert.match(r.stdout, /\$ just check\n/);
  assert.match(r.stdout, /(# |ℹ )pass 1\n/, 'the scaffold test ran');
  assert.match(r.stdout, /verified: just setup and just check passed/);

  // the gate fails when it should
  writeFileSync(join(cwd, 'src', 'bad.js'), 'const = ;\n');
  const lint = run('just', ['check'], { cwd, env });
  assert.notEqual(lint.status, 0, 'a syntax error fails just check');
  assert.match(lint.stderr, /SyntaxError/);
  run('rm', ['-f', join(cwd, 'src', 'bad.js')]);
  writeFileSync(join(cwd, 'test', 'index.test.js'), "import { test } from 'node:test';\ntest('fails', () => { throw new Error('x'); });\n");
  assert.notEqual(run('just', ['check'], { cwd, env }).status, 0, 'a failing test fails just check');
});

test('node-cli: verbs that do not apply print a note and exit 0; deploy takes an environment', { skip: skipJust }, () => {
  const env = cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH });
  const { cwd } = initExample('node-cli', env, ['--skip-verify']);
  for (const verb of [...NOT_APPLICABLE, 'fmt', 'typecheck', 'build']) {
    const r = run('just', [verb], { cwd, env });
    assert.equal(r.status, 0, verb);
    assert.match(r.stdout, new RegExp(`^${verb}: not applicable`, 'm'));
  }
  const deploy = run('just', ['deploy', 'prod'], { cwd, env });
  assert.equal(deploy.status, 0);
  assert.match(deploy.stdout, /deploy: not applicable/);
});

test('python-cli: verbs that do not apply print a note and exit 0', { skip: skipJust }, () => {
  const env = cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH });
  const { cwd } = initExample('python-cli', env, ['--skip-verify']);
  for (const verb of [...NOT_APPLICABLE, 'build']) {
    const r = run('just', [verb], { cwd, env });
    assert.equal(r.status, 0, verb);
    assert.match(r.stdout, new RegExp(`^${verb}: not applicable`, 'm'));
  }
  assert.equal(run('just', ['deploy', 'prod'], { cwd, env }).status, 0);
});

const pythonSkip = (!haveJust && 'just is not installed') || (!hasTool('uv') && 'uv is not installed') || (process.env.YAW_TEST_OFFLINE && 'YAW_TEST_OFFLINE is set (uv needs the network)');

test('smoke python-cli: yaw init, just setup && just check pass (needs uv and network)', { skip: pythonSkip, timeout: 300000 }, () => {
  const { r } = initExample('python-cli', { ...process.env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /1 passed/);
  assert.match(r.stdout, /verified: just setup and just check passed/);
});

test('static-site is never auto-suggested (empty suggestWhen); other profiles keep their suggestion', () => {
  const profiles = listProfiles(KIT_ROOT);
  for (const facts of [{ runsOn: 'serverless', hosted: true }, { language: 'python', runsOn: 'self-hosted', hosted: true }, { public: true, runsOn: 'edge' }]) {
    assert.ok(!suggestProfiles(profiles, facts).candidates.some((c) => c.name === 'static-site'), JSON.stringify(facts));
  }
  assert.equal(suggestProfiles(profiles, { language: 'javascript', runsOn: 'local' }).suggestion, 'node-cli');
  assert.equal(suggestProfiles(profiles, { language: 'python', runsOn: 'local' }).suggestion, 'python-cli');
});

test('static-site check-links: refuses targets outside public/ without reading them, strips queries, decodes paths', () => {
  const cwd = tmp('yaw-links-');
  const script = join(KIT_ROOT, 'profiles', 'static-site', 'scaffold', 'scripts', 'check-links.mjs');
  const page = (body) => `<!DOCTYPE html><html lang="en"><head><title>t</title></head><body>${body}</body></html>`;
  mkdirSync(join(cwd, 'site', 'public'), { recursive: true });
  mkdirSync(join(cwd, 'outside'));
  writeFileSync(join(cwd, 'outside', 'o.html'), page('<p id="nope">x</p>'));
  const root = join(cwd, 'site');
  const check = () => run(process.execPath, [script], { cwd: root });

  writeFileSync(join(root, 'public', 'index.html'), page('<a href="../../outside/o.html#nope">o</a>'));
  const out = check();
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /points outside public\//);

  symlinkSync(join(cwd, 'outside', 'o.html'), join(root, 'public', 'link.html'));
  writeFileSync(join(root, 'public', 'index.html'), page('<a href="link.html">l</a>'));
  assert.match(check().stderr, /link\.html: symlinks in public\/ are not followed/);
  assert.match(check().stderr, /index\.html: link "link\.html" points outside public\//);
  unlinkSync(join(root, 'public', 'link.html'));

  // a symlinked directory pointing outside: reported, and its pages are never read (the outside page links to a missing file)
  writeFileSync(join(cwd, 'outside', 'o.html'), page('<a href="SECRET-MARKER-missing.html">m</a>'));
  symlinkSync(join(cwd, 'outside'), join(root, 'public', 'out_link'));
  writeFileSync(join(root, 'public', 'index.html'), page('<p>ok</p>'));
  const dirLink = check();
  assert.notEqual(dirLink.status, 0);
  assert.match(dirLink.stderr, /out_link: symlinks in public\/ are not followed/);
  assert.doesNotMatch(dirLink.stderr, /SECRET-MARKER/, 'the outside page was not read');
  unlinkSync(join(root, 'public', 'out_link'));

  writeFileSync(join(root, 'public', 'a b.html'), page('<h1 id="top">t</h1>'));
  writeFileSync(join(root, 'public', 'index.html'), page('<a href="a%20b.html?x=1#top">ok</a>'));
  const ok = check();
  assert.equal(ok.status, 0, ok.stderr);
});

test('static-site: verbs that do not apply print a note and exit 0', { skip: skipJust }, () => {
  const env = cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH });
  const { cwd } = initExample('static-site', env, ['--skip-verify']);
  for (const verb of ['screenshot', 'preview-share', 'db-migrate', 'db-reset', 'backup', 'restore', 'fmt', 'typecheck', 'build']) {
    const r = run('just', [verb], { cwd, env });
    assert.equal(r.status, 0, verb);
    assert.match(r.stdout, new RegExp(`^${verb}: not applicable`, 'm'));
  }
  const deploy = run('just', ['deploy', 'prod'], { cwd, env });
  assert.equal(deploy.status, 0);
  assert.match(deploy.stdout, /deploy: not applicable/);
});

const staticSkip = (!haveJust && 'just is not installed') || (!hasTool('npm') && 'npm is not installed') || (process.env.YAW_TEST_OFFLINE && 'YAW_TEST_OFFLINE is set (npm install needs the network)');

test('smoke static-site: yaw init, just setup && just check pass; broken pages fail the gate (needs npm and network)', { skip: staticSkip, timeout: 300000 }, () => {
  const { cwd, r } = initExample('static-site', { ...process.env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /check-links: 1 page\(s\)/);
  assert.match(r.stdout, /verified: just setup and just check passed/);

  const fixtures = join(KIT_ROOT, 'test', 'profiles', 'static-site');
  const page = join(cwd, 'public', 'bad.html');
  copyFileSync(join(fixtures, 'invalid.html'), page);
  assert.notEqual(run('just', ['lint'], { cwd }).status, 0, 'invalid HTML fails just lint');
  copyFileSync(join(fixtures, 'broken-link.html'), page);
  const links = run('just', ['test'], { cwd });
  assert.notEqual(links.status, 0, 'a broken link fails just test');
  assert.match(links.stderr, /bad\.html: broken link "missing\.html"/);
});
