// Profiles (android-kotlin: Y-6.7) python-cli (Y-3.4), node-cli (Y-3.5) and static-site (Y-6.1) and python-web (Y-6.2): parts, uniform verbs, and the smoke test per
// examples/<profile>/ (init in a temp dir, then just setup && just check).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { printProfileTools } from '../core/cli/tool-hints.js';
import { parse, parseDocument } from '../core/lib/yaml.js';
import { formatError } from '../core/lib/schema.js';
import { listProfiles, loadProfile, profileTools, schemas } from '../core/render/kit.js';
import { profileForStack } from '../core/interview/suggest.js';
import { KIT_ROOT, cleanEnv, gradleJdkProblem, hasTool, run, tmp } from './helpers/fixtures.js';

const PROFILES = ['android-kotlin', 'browser-extension', 'cloudflare-workers', 'go-basic', 'go-cli', 'go-serverless', 'go-web', 'java-basic', 'java-cli', 'java-serverless', 'java-web', 'kotlin-cli', 'kotlin-serverless', 'kotlin-web', 'node-app', 'node-cli', 'node-static', 'node-ts-vercel', 'node-web', 'php-cli', 'php-serverless', 'php-web', 'python-basic', 'python-cli', 'python-vercel', 'python-web', 'rust-basic', 'rust-cli', 'rust-serverless', 'rust-web', 'static-site', 'swift-app', 'swift-cli', 'swift-web', 'wordpress-plugin'];
const YAW = join(KIT_ROOT, 'bin', 'yaw');
const VERBS = ['setup', 'dev', 'fmt', 'lint', 'typecheck', 'test', 'check', 'build', 'audit'];
const OPTIONAL_VERBS = ['screenshot', 'preview', 'preview-share', 'db-migrate', 'db-reset', 'backup', 'restore', 'deploy'];
const haveJust = hasTool('just');
const skipJust = !haveJust && 'just is not installed';
const dir = (p, ...rest) => join(KIT_ROOT, 'profiles', p, ...rest);

test('the kit has exactly the tailored and basic profiles, and profile.yaml validates', () => {
  assert.deepEqual(listProfiles(KIT_ROOT).map((p) => p.name), PROFILES);
  for (const name of PROFILES) {
    const profile = loadProfile(KIT_ROOT, name);
    assert.ok(profile.summary.length > 0);
    assert.ok(profile.requires.includes('just'));
  }
  assert.deepEqual(loadProfile(KIT_ROOT, 'node-cli').requires, ['node>=22.13', 'just']);
});

test('examples/<profile>/answers.yaml validates and names its profile (tailored profiles)', () => {
  for (const name of PROFILES.filter((n) => !loadProfile(KIT_ROOT, n).stack.basic)) {
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

test('the just fragment defines every core verb (ADR-0120) and optional verbs only as real recipes', () => {
  for (const name of PROFILES) {
    const text = readFileSync(dir(name, 'just', `${name}.just`), 'utf8');
    const recipes = [...text.matchAll(/^([a-z][a-z-]*)(?: [^:\n]*)?:(?!=)/gm)].map((m) => m[1]);
    assert.deepEqual(recipes.filter((r) => !OPTIONAL_VERBS.includes(r)).sort(), [...VERBS].sort(), name);
    for (const verb of OPTIONAL_VERBS.filter((v) => recipes.includes(v))) {
      assert.doesNotMatch(text, new RegExp(`^${verb}\\b[^\\n]*:[^\\n]*\\n\\s+@echo "${verb}: not applicable`, 'm'), `${name}: ${verb} is a stub`);
    }
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
  for (const verb of ['fmt', 'typecheck', 'build']) {
    const r = run('just', [verb], { cwd, env });
    assert.equal(r.status, 0, verb);
    assert.match(r.stdout, new RegExp(`^${verb}: not applicable`, 'm'));
  }
  assert.notEqual(run('just', ['deploy', 'prod'], { cwd, env }).status, 0, 'deploy is not defined');
});

test('python-cli: verbs that do not apply print a note and exit 0', { skip: skipJust }, () => {
  const env = cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH });
  const { cwd } = initExample('python-cli', env, ['--skip-verify']);
  for (const verb of ['build']) {
    const r = run('just', [verb], { cwd, env });
    assert.equal(r.status, 0, verb);
    assert.match(r.stdout, new RegExp(`^${verb}: not applicable`, 'm'));
  }
  assert.notEqual(run('just', ['deploy', 'prod'], { cwd, env }).status, 0, 'deploy is not defined');
});

const pythonSkip = (!haveJust && 'just is not installed') || (!hasTool('uv') && 'uv is not installed') || (process.env.YAW_TEST_OFFLINE && 'YAW_TEST_OFFLINE is set (uv needs the network)');

test('smoke python-cli: yaw init, just setup && just check pass (needs uv and network)', { skip: pythonSkip, timeout: 300000 }, () => {
  const { r } = initExample('python-cli', { ...process.env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /1 passed/);
  assert.match(r.stdout, /verified: just setup and just check passed/);
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

  // public/ itself a symlink to an outside directory
  const real = join(cwd, 'outside-public');
  mkdirSync(real);
  writeFileSync(join(real, 'index.html'), page('<a href="SECRET-MARKER-missing.html">m</a>'));
  const other = join(cwd, 'site2');
  mkdirSync(other);
  symlinkSync(real, join(other, 'public'));
  const top = run(process.execPath, [script], { cwd: other });
  assert.notEqual(top.status, 0);
  assert.match(top.stderr, /public: symlinks in public\/ are not followed/);
  assert.doesNotMatch(top.stdout + top.stderr, /SECRET-MARKER/);

  writeFileSync(join(root, 'public', 'a b.html'), page('<h1 id="top">t</h1>'));
  writeFileSync(join(root, 'public', 'index.html'), page('<a href="a%20b.html?x=1#top">ok</a>'));
  const ok = check();
  assert.equal(ok.status, 0, ok.stderr);
});

test('static-site: verbs that do not apply print a note and exit 0', { skip: skipJust }, () => {
  const env = cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH });
  const { cwd } = initExample('static-site', env, ['--skip-verify']);
  for (const verb of ['fmt', 'typecheck', 'build']) {
    const r = run('just', [verb], { cwd, env });
    assert.equal(r.status, 0, verb);
    assert.match(r.stdout, new RegExp(`^${verb}: not applicable`, 'm'));
  }
  assert.notEqual(run('just', ['deploy', 'prod'], { cwd, env }).status, 0, 'deploy is not defined');
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

test('browser-extension check-manifest: Manifest V3, named files inside extension/, no remote or inline scripts', () => {
  const root = tmp('yaw-extension-');
  const script = join(KIT_ROOT, 'profiles', 'browser-extension', 'scaffold', 'scripts', 'check-manifest.mjs');
  const check = () => run(process.execPath, [script], { cwd: root });
  const write = (manifest, popup = '<!DOCTYPE html><html lang="en"><head><title>p</title><script src="popup.js"></script></head><body></body></html>') => {
    writeFileSync(join(root, 'extension', 'manifest.json'), JSON.stringify({ manifest_version: 3, name: 'x', version: '1.0', description: 'd', action: { default_popup: 'popup.html' }, ...manifest }));
    writeFileSync(join(root, 'extension', 'popup.html'), popup);
  };
  mkdirSync(join(root, 'extension'));
  writeFileSync(join(root, 'extension', 'popup.js'), '');
  write({});
  const ok = check();
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Manifest V3, 1 file\(s\) and 1 page\(s\) resolve/);
  write({ manifest_version: 2, version: '01.2' });
  assert.match(check().stderr, /manifest_version must be 3[\s\S]*version "01.2"/);
  write({ background: { service_worker: 'missing.js' }, content_scripts: [{ matches: ['<all_urls>'], js: ['../outside.js'] }] });
  writeFileSync(join(root, 'outside.js'), '');
  const files = check().stderr;
  assert.match(files, /"missing.js" does not exist/);
  assert.match(files, /"..\/outside.js" points outside extension\//);
  write({ background: { service_worker: 'https://cdn.example/x.js' } }, '<!DOCTYPE html><html lang="en"><head><title>p</title><script src="https://cdn.example/y.js"></script><script>alert(1)</script></head></html>');
  const remote = check().stderr;
  assert.match(remote, /must be a file inside extension\/ \(no remote code\)/);
  assert.match(remote, /popup.html: inline scripts are refused/);
  assert.match(remote, /popup.html: remote script "https:\/\/cdn.example\/y.js" is refused/);
});

test('browser-extension: verbs that do not apply print a note and exit 0', { skip: skipJust }, () => {
  const env = cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH });
  const { cwd } = initExample('browser-extension', env, ['--skip-verify']);
  for (const verb of ['fmt', 'typecheck']) {
    const r = run('just', [verb], { cwd, env });
    assert.equal(r.status, 0, verb);
    assert.match(r.stdout, new RegExp(`^${verb}: not applicable`, 'm'));
  }
  assert.notEqual(run('just', ['deploy', 'prod'], { cwd, env }).status, 0, 'deploy is not defined');
});

test('smoke browser-extension: yaw init, just setup && just check pass, just build packs dist/; broken files fail the gate (needs npm and network)', { skip: staticSkip, timeout: 300000 }, () => {
  const { cwd, r } = initExample('browser-extension', { ...process.env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /check-manifest: Manifest V3/);
  assert.match(r.stdout, /verified: just setup and just check passed/);
  assert.equal(run('just', ['build'], { cwd }).status, 0, 'just build packs the extension');
  assert.ok(readdirSync(join(cwd, 'dist')).some((f) => f.endsWith('.zip')), 'dist/ holds the store package');

  const fixtures = join(KIT_ROOT, 'test', 'profiles', 'browser-extension');
  copyFileSync(join(fixtures, 'invalid.html'), join(cwd, 'extension', 'popup.html'));
  assert.notEqual(run('just', ['lint'], { cwd }).status, 0, 'invalid HTML fails just lint');
  const manifest = JSON.parse(readFileSync(join(cwd, 'extension', 'manifest.json'), 'utf8'));
  writeFileSync(join(cwd, 'extension', 'manifest.json'), JSON.stringify({ ...manifest, background: { service_worker: 'missing.js' } }));
  const test = run('just', ['test'], { cwd });
  assert.notEqual(test.status, 0, 'a missing file fails just test');
  assert.match(test.stderr, /"missing.js" does not exist/);
});

test('browser-extension guards block store submissions and publishing, not local work', () => {
  const guards = parse(readFileSync(dir('browser-extension', 'guards.yaml'), 'utf8')).guards.map((g) => new RegExp(g.pattern));
  const blocked = (cmd) => guards.some((re) => re.test(cmd));
  for (const cmd of ['npx web-ext sign --channel listed', 'web-ext sign --api-key x', 'npx chrome-webstore-upload upload --source dist/x.zip', 'npm publish']) assert.ok(blocked(cmd), cmd);
  for (const cmd of ['npx web-ext lint --source-dir extension', 'npx web-ext build --source-dir extension', 'npx web-ext run --target chromium', 'just check', 'git push origin main']) assert.ok(!blocked(cmd), cmd);
});

test('python-web: verbs that do not apply print a note and exit 0', { skip: skipJust }, () => {
  const env = cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH });
  const { cwd } = initExample('python-web', env, ['--skip-verify']);
  assert.notEqual(run('just', ['backup'], { cwd, env }).status, 0, 'backup is not defined');
  assert.notEqual(run('just', ['deploy', 'prod'], { cwd, env }).status, 0, 'deploy is not defined');
});

test('smoke python-web: yaw init, just setup && just check pass; bad code fails the gate (needs uv and network)', { skip: pythonSkip, timeout: 300000 }, () => {
  const { cwd, r } = initExample('python-web', { ...process.env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /3 passed/);
  assert.match(r.stdout, /verified: just setup and just check passed/);

  const fixtures = join(KIT_ROOT, 'test', 'profiles', 'python-web');
  const bad = join(cwd, 'src', 'app', 'bad.py');
  copyFileSync(join(fixtures, 'lint_error.py'), bad);
  assert.notEqual(run('just', ['lint'], { cwd }).status, 0, 'an unused import fails just lint');
  copyFileSync(join(fixtures, 'insecure.py'), bad);
  const bandit = run('just', ['lint'], { cwd });
  assert.notEqual(bandit.status, 0, 'shell=True fails bandit');
  assert.match(bandit.stdout + bandit.stderr, /B602|shell=True/);
  copyFileSync(join(fixtures, 'type_error.py'), bad);
  assert.notEqual(run('just', ['typecheck'], { cwd }).status, 0, 'a type error fails just typecheck');
});

test('python-web guards block publishing and remote forms, not local work', () => {
  const guards = parse(readFileSync(dir('python-web', 'guards.yaml'), 'utf8')).guards.map((g) => new RegExp(g.pattern));
  const blocked = (cmd) => guards.some((re) => re.test(cmd));
  for (const cmd of ['docker push me/app', 'docker image push me/app', 'docker buildx build --push -t me/app .', 'docker build --push -t me/app .', 'docker compose push', 'docker-compose push', 'DOCKER_HOST=ssh://me@host docker ps', 'docker -Hssh://me@host ps', 'docker -H ssh://me@host ps', 'docker --host=ssh://me@host ps', 'docker --context prod ps', 'alembic -x env=prod upgrade head', 'alembic -c production.ini upgrade head', 'alembic upgrade head --prod', 'ssh me@host', 'scp a me@host:/srv', 'sftp me@host', 'rsync -av dist/ me@host:/srv/app', 'rsync -av dist/ host:/srv/app', 'twine upload dist/*', 'uv publish']) {
    assert.ok(blocked(cmd), cmd);
  }
  for (const cmd of ['docker build -t app .', 'docker compose up', 'alembic upgrade head', 'rsync -av a/ b/', 'rsync -av a/ ./b:c/', 'uv run pytest']) assert.ok(!blocked(cmd), cmd);
});

test('python-vercel: verbs that do not apply print a note and exit 0; deploy refuses without the production guard and in CI', { skip: skipJust }, () => {
  const env = cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH });
  const { cwd } = initExample('python-vercel', env, ['--skip-verify']);
  for (const verb of ['dev', 'build']) {
    const r = run('just', [verb], { cwd, env });
    assert.equal(r.status, 0, verb);
    assert.match(r.stdout, new RegExp(`^${verb}: not applicable`, 'm'));
  }
  // deploy refuses before it reaches the Vercel CLI (a PATH without npx proves nothing is run)
  const only = tmp('yaw-bin-');
  for (const t of ['sh', 'just']) symlinkSync(execFileSync('which', [t], { encoding: 'utf8' }).trim(), join(only, t));
  for (const [args, extra] of [[[], {}], [['prod'], {}], [['preview'], { YAW_CONFIRM_PROD: 'yes' }], [['prod'], { YAW_CONFIRM_PROD: 'no' }], [['prod'], { YAW_CONFIRM_PROD: 'yes', CI: 'true' }]]) {
    const r = run('just', ['deploy', ...args], { cwd, env: cleanEnv(tmp('yaw-home-'), { PATH: only, ...extra }) });
    assert.notEqual(r.status, 0, `deploy ${args} ${JSON.stringify(extra)}`);
    assert.match(r.stderr, /deploy: refused/);
    assert.doesNotMatch(r.stdout + r.stderr, /vercel@/);
  }
});

test('smoke python-vercel: yaw init, just setup && just check pass; bad code fails the gate (needs uv and network)', { skip: pythonSkip, timeout: 300000 }, () => {
  const { cwd, r } = initExample('python-vercel', { ...process.env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /3 passed/);
  assert.match(r.stdout, /verified: just setup and just check passed/);

  const fixtures = join(KIT_ROOT, 'test', 'profiles', 'python-vercel');
  const bad = join(cwd, 'api', '_bad.py');
  copyFileSync(join(fixtures, 'lint_error.py'), bad);
  assert.notEqual(run('just', ['lint'], { cwd }).status, 0, 'an unused import fails just lint');
  copyFileSync(join(fixtures, 'insecure.py'), bad);
  const bandit = run('just', ['lint'], { cwd });
  assert.notEqual(bandit.status, 0, 'shell=True fails bandit');
  assert.match(bandit.stdout + bandit.stderr, /B602|shell=True/);
  copyFileSync(join(fixtures, 'type_error.py'), bad);
  assert.notEqual(run('just', ['typecheck'], { cwd }).status, 0, 'a type error fails just typecheck');
});

test('python-vercel guards block every Vercel CLI form, the deploy recipe and publishing, not local work', () => {
  const guards = parse(readFileSync(dir('python-vercel', 'guards.yaml'), 'utf8')).guards.map((g) => new RegExp(g.pattern));
  const blocked = (cmd) => guards.some((re) => re.test(cmd));
  for (const cmd of ['vercel', 'vercel --prod', 'vercel deploy', 'vercel --token abc deploy', 'vercel env add KEY', 'vercel pull', 'vercel link', 'vercel dev', 'vc --prod', 'npx vc deploy', 'VERCEL_TOKEN=abc vercel --prod', 'env -i vercel deploy', 'npx -y vercel@latest deploy', 'pnpm dlx vercel deploy', 'bunx vercel deploy', 'cd app && vercel --prod', 'true;vercel deploy', '(vercel deploy)', 'just deploy prod', 'YAW_CONFIRM_PROD=yes just deploy prod', 'twine upload dist/*', 'uv publish', 'ssh me@host']) {
    assert.ok(blocked(cmd), cmd);
  }
  for (const cmd of ['vercel --version', 'vercel --help', 'cat vercel.json', 'uv run pytest', 'uv run ruff check .', 'just check', 'just test', 'git add vercel.json']) assert.ok(!blocked(cmd), cmd);
});

test('node-ts-vercel: verbs that do not apply print a note and exit 0; deploy refuses without the production guard and in CI', { skip: skipJust }, () => {
  const env = cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH });
  const { cwd } = initExample('node-ts-vercel', env, ['--skip-verify']);
  for (const verb of ['dev', 'fmt', 'build']) {
    const r = run('just', [verb], { cwd, env });
    assert.equal(r.status, 0, verb);
    assert.match(r.stdout, new RegExp(`^${verb}: not applicable`, 'm'));
  }
  // deploy refuses before it reaches the Vercel CLI (a PATH without npx proves nothing is run)
  const only = tmp('yaw-bin-');
  for (const t of ['sh', 'just']) symlinkSync(execFileSync('which', [t], { encoding: 'utf8' }).trim(), join(only, t));
  const bare = { PATH: only };
  for (const [args, extra] of [[[], {}], [['prod'], {}], [['preview'], { YAW_CONFIRM_PROD: 'yes' }], [['prod'], { YAW_CONFIRM_PROD: 'no' }], [['prod'], { YAW_CONFIRM_PROD: 'yes', CI: 'true' }]]) {
    const r = run('just', ['deploy', ...args], { cwd, env: cleanEnv(tmp('yaw-home-'), { ...bare, ...extra }) });
    assert.notEqual(r.status, 0, `deploy ${args} ${JSON.stringify(extra)}`);
    assert.match(r.stderr, /deploy: refused/);
    assert.doesNotMatch(r.stdout + r.stderr, /vercel@/);
  }
});

const nodeTsSkip = (!haveJust && 'just is not installed') || (!hasTool('npm') && 'npm is not installed') || (process.env.YAW_TEST_OFFLINE && 'YAW_TEST_OFFLINE is set (npm install needs the network)');

test('smoke node-ts-vercel: yaw init, just setup && just check pass; bad code fails the gate (needs npm and network)', { skip: nodeTsSkip, timeout: 300000 }, () => {
  const { cwd, r } = initExample('node-ts-vercel', { ...process.env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /3 passed/);
  assert.match(r.stdout, /verified: just setup and just check passed/);

  const fixtures = join(KIT_ROOT, 'test', 'profiles', 'node-ts-vercel');
  const bad = join(cwd, 'src', 'bad.ts');
  copyFileSync(join(fixtures, 'lint_error.ts'), bad);
  assert.notEqual(run('just', ['lint'], { cwd }).status, 0, 'an unused variable fails just lint');
  copyFileSync(join(fixtures, 'type_error.ts'), bad);
  assert.notEqual(run('just', ['typecheck'], { cwd }).status, 0, 'a type error fails just typecheck');
});

test('node-ts-vercel guards block every Vercel CLI form and the deploy recipe, not local work', () => {
  const guards = parse(readFileSync(dir('node-ts-vercel', 'guards.yaml'), 'utf8')).guards.map((g) => new RegExp(g.pattern));
  const blocked = (cmd) => guards.some((re) => re.test(cmd));
  for (const cmd of ['vercel', 'vercel --prod', 'vercel deploy', 'vercel deploy --prod', 'vercel --token abc deploy', 'vercel -y', 'vercel env add KEY', 'vercel env pull', 'vercel pull', 'vercel promote x', 'vercel rollback', 'vercel link', 'vercel remove app', 'vercel dev', 'vercel --version --prod', 'vc --prod', 'vc', 'npx vc deploy', 'VERCEL_TOKEN=abc vercel --prod', 'CI=1 vercel deploy', 'env -i vercel deploy', 'npx vercel --prod', 'npx -y vercel@latest deploy', 'npx --yes vercel@65.0.0 deploy --prod', 'pnpm dlx vercel deploy', 'pnpm exec vercel deploy', 'npm exec vercel -- deploy', 'bunx vercel deploy', 'yarn dlx vercel deploy', 'npx --package=vercel -- vercel deploy', 'cd app && vercel --prod', 'true;vercel deploy', 'echo x|vercel deploy', '(vercel deploy)', 'sudo vercel deploy', './node_modules/.bin/vercel --prod', 'just deploy prod', 'YAW_CONFIRM_PROD=yes just deploy prod', 'just --justfile justfile deploy prod', 'just -f x deploy', 'YAW_CONFIRM_PROD=yes npx vercel', 'npm publish', 'pnpm publish', 'ssh me@host']) {
    assert.ok(blocked(cmd), cmd);
  }
  for (const cmd of ['vercel --version', 'vercel -v', 'vercel --help', 'npx vercel@65.0.0 --version', 'cat vercel.json', 'npx vitest run', 'just check', 'just test', 'npm test', 'npx tsc --noEmit', 'npx eslint .', 'git add vercel.json']) assert.ok(!blocked(cmd), cmd);
});

test('node-web: verbs that do not apply print a note and exit 0', { skip: skipJust }, () => {
  const env = cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH });
  const { cwd } = initExample('node-web', env, ['--skip-verify']);
  for (const verb of ['fmt']) {
    const r = run('just', [verb], { cwd, env });
    assert.equal(r.status, 0, verb);
    assert.match(r.stdout, new RegExp(`^${verb}: not applicable`, 'm'));
  }
  assert.notEqual(run('just', ['deploy', 'prod'], { cwd, env }).status, 0, 'deploy is not defined');
});

const nodeWebSkip = (!haveJust && 'just is not installed') || (!hasTool('npm') && 'npm is not installed') || (process.env.YAW_TEST_OFFLINE && 'YAW_TEST_OFFLINE is set (npm install needs the network)');

test('smoke node-web: yaw init, just setup && just check pass and build the app; bad code fails the gate (needs npm and network)', { skip: nodeWebSkip, timeout: 300000 }, () => {
  const { cwd, r } = initExample('node-web', { ...process.env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /3 passed/);
  assert.match(r.stdout, /verified: just setup and just check passed/);
  assert.ok(existsSync(join(cwd, 'dist', 'server.js')), 'just check builds dist/server.js');

  const fixtures = join(KIT_ROOT, 'test', 'profiles', 'node-web');
  const bad = join(cwd, 'src', 'bad.ts');
  copyFileSync(join(fixtures, 'lint_error.ts'), bad);
  assert.notEqual(run('just', ['lint'], { cwd }).status, 0, 'an unused variable fails just lint');
  copyFileSync(join(fixtures, 'type_error.ts'), bad);
  assert.notEqual(run('just', ['typecheck'], { cwd }).status, 0, 'a type error fails just typecheck');
});

test('smoke node-static: yaw init, just setup && just check pass and build dist/; bad code fails the gate (needs npm and network)', { skip: nodeWebSkip, timeout: 300000 }, () => {
  const { cwd, r } = initExample('node-static', { ...process.env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /1 passed/);
  assert.match(r.stdout, /verified: just setup and just check passed/);
  assert.ok(existsSync(join(cwd, 'dist', 'index.html')), 'just check builds dist/index.html');

  const fixtures = join(KIT_ROOT, 'test', 'profiles', 'node-static');
  const bad = join(cwd, 'src', 'bad.ts');
  copyFileSync(join(fixtures, 'lint_error.ts'), bad);
  assert.notEqual(run('just', ['lint'], { cwd }).status, 0, 'an unused variable fails just lint');
  copyFileSync(join(fixtures, 'type_error.ts'), bad);
  assert.notEqual(run('just', ['typecheck'], { cwd }).status, 0, 'a type error fails just typecheck');
});

test('node-static guards block remote deploys, remote hosts and publishing, not local work', () => {
  const guards = parse(readFileSync(dir('node-static', 'guards.yaml'), 'utf8')).guards.map((g) => new RegExp(g.pattern));
  const blocked = (cmd) => guards.some((re) => re.test(cmd));
  for (const cmd of ['wrangler pages deploy dist', 'netlify deploy --prod', 'vercel deploy', 'rsync -av dist/ me@host:/srv', 'ssh me@host', 'npm publish']) assert.ok(blocked(cmd), cmd);
  for (const cmd of ['npm run build', 'npx vite build', 'npx vitest run', 'vite preview', 'git push origin main', 'just check']) assert.ok(!blocked(cmd), cmd);
});

test('node-web guards block image pushes, remote hosts and publishing, not local work', () => {
  const guards = parse(readFileSync(dir('node-web', 'guards.yaml'), 'utf8')).guards.map((g) => new RegExp(g.pattern));
  const blocked = (cmd) => guards.some((re) => re.test(cmd));
  for (const cmd of ['docker push me/app', 'docker image push me/app', 'docker buildx build --push -t me/app .', 'docker build --push -t me/app .', 'docker compose push', 'docker-compose push', 'DOCKER_HOST=ssh://me@host docker ps', 'docker -Hssh://me@host ps', 'docker -H ssh://me@host ps', 'docker --host=ssh://me@host ps', 'docker --context prod ps', 'ssh me@host', 'scp a me@host:/srv', 'sftp me@host', 'rsync -av dist/ me@host:/srv/app', 'rsync -av dist/ host:/srv/app', 'npm publish', 'pnpm publish', 'yarn publish']) {
    assert.ok(blocked(cmd), cmd);
  }
  for (const cmd of ['docker build -t app .', 'docker compose up', 'rsync -av a/ b/', 'rsync -av a/ ./b:c/', 'npx vitest run', 'npm run build', 'just check']) assert.ok(!blocked(cmd), cmd);
});

test('php-cli: verbs that do not apply print a note and exit 0', { skip: skipJust }, () => {
  const env = cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH });
  const { cwd } = initExample('php-cli', env, ['--skip-verify']);
  for (const verb of ['build']) {
    const r = run('just', [verb], { cwd, env });
    assert.equal(r.status, 0, verb);
    assert.match(r.stdout, new RegExp(`^${verb}: not applicable`, 'm'));
  }
  assert.notEqual(run('just', ['deploy', 'prod'], { cwd, env }).status, 0, 'deploy is not defined');
});

test('smoke php-cli: yaw init, just setup && just check pass; the tool runs; bad code fails the gate (needs php, composer and network)', { skip: (!haveJust && 'just is not installed') || (!hasTool('php') && 'php is not installed') || (!hasTool('composer') && 'composer is not installed') || (process.env.YAW_TEST_OFFLINE && 'YAW_TEST_OFFLINE is set (composer install needs the network)'), timeout: 300000 }, () => {
  const { cwd, r } = initExample('php-cli', { ...process.env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /OK \(3 tests/);
  assert.match(r.stdout, /verified: just setup and just check passed/);
  assert.equal(run('php', ['bin/app', 'Ada'], { cwd }).stdout, 'Hello, Ada!\n');
  const tooMany = run('php', ['bin/app', 'a', 'b'], { cwd });
  assert.equal(tooMany.status, 1);
  assert.match(tooMany.stderr, /usage: app \[name\]/);

  const fixtures = join(KIT_ROOT, 'test', 'profiles', 'php-cli');
  const bad = join(cwd, 'src', 'Bad.php');
  copyFileSync(join(fixtures, 'lint_error.php'), bad);
  assert.notEqual(run('just', ['lint'], { cwd }).status, 0, 'unformatted code fails just lint');
  copyFileSync(join(fixtures, 'type_error.php'), bad);
  assert.notEqual(run('just', ['typecheck'], { cwd }).status, 0, 'a type error fails just typecheck');
});

test('php-cli guards block machine-wide Composer changes and remote hosts, not local work', () => {
  const guards = parse(readFileSync(dir('php-cli', 'guards.yaml'), 'utf8')).guards.map((g) => new RegExp(g.pattern));
  const blocked = (cmd) => guards.some((re) => re.test(cmd));
  for (const cmd of ['composer global require x/y', 'composer global update', 'composer --no-interaction global require x/y', 'composer self-update', 'composer selfupdate', 'cd x && composer global show', 'ssh me@host', 'scp a me@host:/srv', 'sftp me@host', 'ftp host', 'lftp host', 'rsync -av out/ me@host:/srv', 'rsync -av out/ host:/srv']) {
    assert.ok(blocked(cmd), cmd);
  }
  for (const cmd of ['composer install', 'composer require x/y', 'composer audit --locked', 'composer dump-autoload', 'rsync -av a/ b/', 'rsync -av a/ ./b:c/', 'php bin/app', 'vendor/bin/phpunit', 'just check']) assert.ok(!blocked(cmd), cmd);
});

// node-app (ADR-0106): one smoke test per framework variant (ADR-0105); none needs Xcode, the Android SDK or signing.
const NODE_APP_EXAMPLES = { capacitor: 'node-app', electron: 'node-app-electron', tauri: 'node-app-tauri' };

test('node-app: verbs that do not apply print a note and exit 0', { skip: skipJust }, () => {
  const env = cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH });
  const { cwd } = initExample('node-app', env, ['--skip-verify']);
  for (const verb of ['fmt']) {
    const r = run('just', [verb], { cwd, env });
    assert.equal(r.status, 0, verb);
    assert.match(r.stdout, new RegExp(`^${verb}: not applicable`, 'm'));
  }
  assert.notEqual(run('just', ['deploy', 'prod'], { cwd, env }).status, 0, 'deploy is not defined');
});

for (const [variant, example] of Object.entries(NODE_APP_EXAMPLES)) {
  test(`smoke node-app (${variant}): yaw init writes the variant, just setup && just check pass; bad code fails the gate (needs npm and network)`, { skip: nodeTsSkip, timeout: 600000 }, () => {
    const { cwd, r } = initExample(example, { ...process.env });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /2 passed/);
    assert.match(r.stdout, /verified: just setup and just check passed/);
    const marker = { capacitor: 'capacitor.config.ts', electron: 'electron/main.ts', tauri: 'src/main.ts' }[variant];
    assert.ok(existsSync(join(cwd, marker)), marker);
    assert.match(readFileSync(join(cwd, 'package.json'), 'utf8'), new RegExp({ capacitor: '@capacitor/core', electron: '"electron"', tauri: '@tauri-apps/api' }[variant]));
    const fixtures = join(KIT_ROOT, 'test', 'profiles', 'node-app');
    const bad = join(cwd, 'src', 'bad.ts');
    copyFileSync(join(fixtures, 'lint_error.ts'), bad);
    assert.notEqual(run('just', ['lint'], { cwd }).status, 0, 'an unused variable fails just lint');
    copyFileSync(join(fixtures, 'type_error.ts'), bad);
    assert.notEqual(run('just', ['typecheck'], { cwd }).status, 0, 'a type error fails just typecheck');
  });
}

test('node-app guards block store uploads, signing, publishing and remote hosts, not local work', () => {
  const guards = parse(readFileSync(dir('node-app', 'guards.yaml'), 'utf8')).guards.map((g) => new RegExp(g.pattern));
  const blocked = (cmd) => guards.some((re) => re.test(cmd));
  for (const cmd of ['fastlane deliver', 'xcrun altool --upload-app -f a.ipa', 'xcrun notarytool submit a.zip', 'codesign -s X App.app', 'apksigner sign a.apk', 'jarsigner a.aab key', 'keytool -genkey', 'security import cert.p12', 'npx tauri signer generate', 'npx electron-builder --publish always', 'electron-forge publish', 'gh release create v1', 'npm publish', 'just deploy', 'ssh me@host']) assert.ok(blocked(cmd), cmd);
  for (const cmd of ['npm install', 'npx eslint .', 'npx tsc --noEmit', 'npx vitest run', 'npm run build', 'npx cap sync', 'npx tauri dev', 'npm start', 'just check']) assert.ok(!blocked(cmd), cmd);
});


// php-serverless (ADR-0107): one smoke test per hosting variant (ADR-0105); none needs Docker, AWS credentials or the SAM CLI.
const PHP_SERVERLESS_EXAMPLES = { container: 'php-serverless', bref: 'php-serverless-bref' };
const phpSkip = (!haveJust && 'just is not installed') || (!hasTool('php') && 'php is not installed') || (!hasTool('composer') && 'composer is not installed') || (process.env.YAW_TEST_OFFLINE && 'YAW_TEST_OFFLINE is set (composer install needs the network)');

test('php-serverless: verbs that do not apply print a note and exit 0', { skip: skipJust }, () => {
  const env = cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH });
  const { cwd } = initExample('php-serverless', env, ['--skip-verify']);
  for (const verb of ['build']) {
    const r = run('just', [verb], { cwd, env });
    assert.equal(r.status, 0, verb);
    assert.match(r.stdout, new RegExp(`^${verb}: not applicable`, 'm'));
  }
  assert.notEqual(run('just', ['deploy', 'prod'], { cwd, env }).status, 0, 'deploy is not defined');
});

test('php-serverless: the uniform verbs exist and the hosting option has the two variants, container by default', () => {
  const just = readFileSync(dir('php-serverless', 'just', 'php-serverless.just'), 'utf8');
  for (const verb of VERBS) assert.match(just, new RegExp(`^${verb}\\b`, 'm'), verb);
  const { hosting } = loadProfile(KIT_ROOT, 'php-serverless').options;
  assert.deepEqual(hosting.choices.map((c) => c.value), ['container', 'bref']);
  assert.equal(hosting.default, 'container');
  assert.match(hosting.label, /container.*Bref/i);
});

for (const [variant, example] of Object.entries(PHP_SERVERLESS_EXAMPLES)) {
  test(`smoke php-serverless (${variant}): yaw init writes the variant, just setup && just check pass; bad code fails the gate (needs php, composer and network)`, { skip: phpSkip, timeout: 300000 }, () => {
    const { cwd, r } = initExample(example, { ...process.env });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /OK \(\d+ tests/);
    assert.match(r.stdout, /verified: just setup and just check passed/);
    assert.ok(existsSync(join(cwd, variant === 'bref' ? 'template.yaml' : 'Dockerfile')));
    assert.ok(!existsSync(join(cwd, variant === 'bref' ? 'public/index.php' : 'handler.php')));
    const fixtures = join(KIT_ROOT, 'test', 'profiles', 'php-serverless');
    const bad = join(cwd, 'src', 'Bad.php');
    copyFileSync(join(fixtures, 'lint_error.php'), bad);
    assert.notEqual(run('just', ['lint'], { cwd }).status, 0, 'unformatted code fails just lint');
    copyFileSync(join(fixtures, 'type_error.php'), bad);
    assert.notEqual(run('just', ['typecheck'], { cwd }).status, 0, 'a type error fails just typecheck');
    if (variant === 'bref') {
      unlinkSync(bad);
      writeFileSync(join(cwd, 'template.yaml'), 'Resources: [unclosed\n');
      assert.notEqual(run('just', ['test'], { cwd }).status, 0, 'a broken template.yaml fails just test');
    }
  });
}

test('php-serverless guards block registry pushes, cloud CLIs, remote hosts and composer global, not local work', () => {
  const guards = parse(readFileSync(dir('php-serverless', 'guards.yaml'), 'utf8')).guards.map((g) => new RegExp(g.pattern));
  const blocked = (cmd) => guards.some((re) => re.test(cmd));
  for (const cmd of ['docker push me/app', 'docker image push me/app', 'docker buildx build --push -t me/app .', 'docker compose push', 'podman push me/app', 'gcloud builds submit --tag gcr.io/p/app', 'gcloud run deploy app --source .', 'aws lambda update-function-code --function-name x', 'aws s3 cp a s3://b', 'aws --profile p lambda update-function-code --function-name x', 'aws cloudformation delete-stack --stack-name x', 'aws ssm put-parameter --name a --value b', 'sam deploy --guided', 'sam delete', 'cd x && sam deploy', 'AWS_PROFILE=p aws s3 rm s3://b/k', 'gcloud functions deploy f', 'gcloud projects create p', 'ssh me@host', 'scp a me@host:/srv', 'rsync -av out/ me@host:/srv', 'DOCKER_HOST=ssh://me@host docker ps', 'docker --context prod ps', 'composer global require x/y', 'composer --no-interaction global require x/y', 'composer self-update']) {
    assert.ok(blocked(cmd), cmd);
  }
  for (const cmd of ['composer install', 'composer require x/y', 'composer audit --locked', 'docker build -t app .', 'php -S 127.0.0.1:8080 -t public', 'vendor/bin/phpunit', 'vendor/bin/phpstan analyse', 'just check', 'rsync -av a/ b/', 'sam build', 'sam validate', 'sam local invoke', 'AWS_PROFILE=p aws sts get-caller-identity', 'aws s3 ls', 'aws lambda list-functions', 'aws lambda get-function --function-name x', 'gcloud config list', 'gcloud run services list', 'gcloud --version']) assert.ok(!blocked(cmd), cmd);
});

const swiftSkip = (!haveJust && 'just is not installed') || (!hasTool('swift') && 'swift is not installed');

test('swift-cli: verbs that do not apply print a note and exit 0', { skip: skipJust }, () => {
  const env = cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH });
  const { cwd } = initExample('swift-cli', env, ['--skip-verify']);
  for (const verb of ['audit']) {
    const r = run('just', [verb], { cwd, env });
    assert.equal(r.status, 0, verb);
    assert.match(r.stdout, new RegExp(`^${verb}: not applicable`, 'm'));
  }
  assert.notEqual(run('just', ['deploy', 'prod'], { cwd, env }).status, 0, 'deploy is not defined');
});

test('smoke swift-cli: yaw init, just setup && just check pass; the tool runs; bad code fails the gate (needs swift 6)', { skip: swiftSkip, timeout: 600000 }, () => {
  const { cwd, r } = initExample('swift-cli', { ...process.env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /verified: just setup and just check passed/);
  const hello = run('swift', ['run', 'app', 'Ada'], { cwd });
  assert.equal(hello.stdout, 'Hello, Ada!\n');
  const tooMany = run('swift', ['run', 'app', 'a', 'b'], { cwd });
  assert.equal(tooMany.status, 1);
  assert.match(tooMany.stderr, /usage: app \[name\]/);

  const fixtures = join(KIT_ROOT, 'test', 'profiles', 'swift-cli');
  const bad = join(cwd, 'Sources', 'AppCore', 'Bad.swift');
  copyFileSync(join(fixtures, 'lint_error.swift'), bad);
  assert.notEqual(run('just', ['lint'], { cwd }).status, 0, 'unformatted code fails just lint');
  copyFileSync(join(fixtures, 'type_error.swift'), bad);
  assert.notEqual(run('just', ['typecheck'], { cwd }).status, 0, 'a type error fails just typecheck');
});

test('swift-cli guards block release tags, package registry publishing and remote hosts, not local work', () => {
  const guards = parse(readFileSync(dir('swift-cli', 'guards.yaml'), 'utf8')).guards.map((g) => new RegExp(g.pattern));
  const blocked = (cmd) => guards.some((re) => re.test(cmd));
  for (const cmd of ['git push --tags', 'git push origin v1.0.0', 'swift package-registry publish me.app 1.0.0', 'swift package-registry publish --url https://r.example me.app 1.0.0', 'cd x && swift package-registry publish a 1.0.0', 'pod trunk push App.podspec', 'ssh me@host', 'scp a me@host:/srv', 'sftp me@host', 'rsync -av out/ me@host:/srv', 'rsync -av out/ host:/srv']) {
    assert.ok(blocked(cmd), cmd);
  }
  for (const cmd of ['swift build', 'swift test', 'swift run app Ada', 'swift format lint --strict -r Sources', 'swift package resolve', 'git push origin main', 'rsync -av a/ b/', 'rsync -av a/ ./b:c/', 'just check']) assert.ok(!blocked(cmd), cmd);
});

test('swift-web: verbs that do not apply print a note and exit 0', { skip: skipJust }, () => {
  const env = cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH });
  const { cwd } = initExample('swift-web', env, ['--skip-verify']);
  for (const verb of ['audit']) {
    const r = run('just', [verb], { cwd, env });
    assert.equal(r.status, 0, verb);
    assert.match(r.stdout, new RegExp(`^${verb}: not applicable`, 'm'));
  }
  assert.notEqual(run('just', ['deploy', 'prod'], { cwd, env }).status, 0, 'deploy is not defined');
});

test('swift-web pins Hummingbird exactly', () => {
  const pkg = readFileSync(dir('swift-web', 'scaffold', 'Package.swift'), 'utf8');
  assert.match(pkg, /hummingbird\.git", exact: "\d+\.\d+\.\d+"/);
  assert.doesNotMatch(pkg, /from:|upToNextMajor|branch:/);
  assert.deepEqual(loadProfile(KIT_ROOT, 'swift-web').dependencyEcosystems, ['swift']);
});

test('smoke swift-web: yaw init, just setup && just check pass (builds Hummingbird, needs swift 6.1 and network); bad code fails the gate', { skip: swiftSkip || (process.env.YAW_TEST_OFFLINE && 'YAW_TEST_OFFLINE is set (SwiftPM fetches packages)'), timeout: 1200000 }, () => {
  const { cwd, r } = initExample('swift-web', { ...process.env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /verified: just setup and just check passed/);
  assert.ok(existsSync(join(cwd, 'Dockerfile')));
  assert.ok(existsSync(join(cwd, 'Package.resolved')));

  const fixtures = join(KIT_ROOT, 'test', 'profiles', 'swift-web');
  const bad = join(cwd, 'Sources', 'AppCore', 'Bad.swift');
  copyFileSync(join(fixtures, 'lint_error.swift'), bad);
  assert.notEqual(run('just', ['lint'], { cwd }).status, 0, 'unformatted code fails just lint');
  copyFileSync(join(fixtures, 'type_error.swift'), bad);
  assert.notEqual(run('just', ['typecheck'], { cwd }).status, 0, 'a type error fails just typecheck');
});

test('swift-web guards block image pushes, remote hosts, release tags and registry publishing, not local work', () => {
  const guards = parse(readFileSync(dir('swift-web', 'guards.yaml'), 'utf8')).guards.map((g) => new RegExp(g.pattern));
  const blocked = (cmd) => guards.some((re) => re.test(cmd));
  for (const cmd of ['git push --tags', 'git push origin v1.0.0', 'docker push me/app', 'docker image push me/app', 'docker buildx build --push -t me/app .', 'docker compose push', 'podman push me/app', 'ssh me@host', 'scp a me@host:/srv', 'sftp me@host', 'rsync -av out/ me@host:/srv', 'DOCKER_HOST=ssh://me@host docker ps', 'docker --context prod ps', 'docker -H ssh://me@host ps', 'swift package-registry publish me.app 1.0.0', 'pod trunk push App.podspec']) {
    assert.ok(blocked(cmd), cmd);
  }
  for (const cmd of ['docker build -t app .', 'docker compose up', 'swift build', 'swift test', 'swift run app', 'swift package resolve', 'git push origin main', 'rsync -av a/ b/', 'rsync -av a/ ./b:c/', 'just check']) assert.ok(!blocked(cmd), cmd);
});

test('swift-app: verbs that do not apply print a note and exit 0', { skip: skipJust }, () => {
  const env = cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH });
  const { cwd } = initExample('swift-app', env, ['--skip-verify']);
  for (const verb of ['audit']) {
    const r = run('just', [verb], { cwd, env });
    assert.equal(r.status, 0, verb);
    assert.match(r.stdout, new RegExp(`^${verb}: not applicable`, 'm'));
  }
  assert.notEqual(run('just', ['deploy', 'prod'], { cwd, env }).status, 0, 'deploy is not defined');
});

test('swift-app keeps the SwiftUI views inside canImport(SwiftUI) and the logic UI-free', () => {
  const ui = readFileSync(dir('swift-app', 'scaffold', 'Sources', 'app', 'MainApp.swift'), 'utf8');
  assert.match(ui, /#if canImport\(SwiftUI\)/);
  assert.match(ui, /#else/);
  assert.doesNotMatch(readFileSync(dir('swift-app', 'scaffold', 'Sources', 'AppCore', 'Counter.swift'), 'utf8'), /SwiftUI|UIKit|AppKit/);
  assert.match(readFileSync(dir('swift-app', 'scaffold', 'Package.swift'), 'utf8'), /\.macOS\(\.v14\)/);
});

test('smoke swift-app: yaw init, just setup && just check pass without Xcode or signing; the app builds; bad code fails the gate (needs swift 6)', { skip: swiftSkip, timeout: 600000 }, () => {
  const { cwd, r } = initExample('swift-app', { ...process.env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /verified: just setup and just check passed/);
  const build = run('just', ['build'], { cwd });
  assert.equal(build.status, 0, build.stdout + build.stderr);
  assert.ok(existsSync(join(cwd, '.build', 'release', 'app')));

  const fixtures = join(KIT_ROOT, 'test', 'profiles', 'swift-app');
  const bad = join(cwd, 'Sources', 'AppCore', 'Bad.swift');
  copyFileSync(join(fixtures, 'lint_error.swift'), bad);
  assert.notEqual(run('just', ['lint'], { cwd }).status, 0, 'unformatted code fails just lint');
  copyFileSync(join(fixtures, 'type_error.swift'), bad);
  assert.notEqual(run('just', ['typecheck'], { cwd }).status, 0, 'a type error fails just typecheck');
});

test('swift-app guards block store upload, notarization, signing changes, release tags and remote hosts, not local work', () => {
  const guards = parse(readFileSync(dir('swift-app', 'guards.yaml'), 'utf8')).guards.map((g) => new RegExp(g.pattern));
  const blocked = (cmd) => guards.some((re) => re.test(cmd));
  for (const cmd of ['git push --tags', 'git push origin v1.0.0', 'xcrun altool --upload-app -f App.ipa', 'xcrun notarytool submit App.zip --wait', 'xcrun stapler staple App.app', 'cd x && xcrun notarytool submit a.zip', 'xcodebuild -exportArchive -archivePath a.xcarchive -exportPath out', 'xcodebuild -scheme App -allowProvisioningUpdates build', 'fastlane beta', 'bundle exec fastlane release', 'security import cert.pfx -k login.keychain', 'security unlock-keychain login.keychain', 'security add-trusted-cert -d cert.cer', 'codesign --sign "Developer ID" App.app', 'codesign -f -s - App.app', 'swift package-registry publish me.app 1.0.0', 'ssh me@host', 'scp a me@host:/srv', 'rsync -av out/ me@host:/srv']) {
    assert.ok(blocked(cmd), cmd);
  }
  for (const cmd of ['swift build', 'swift test', 'swift run app', 'swift package resolve', 'xcodebuild -list', 'codesign --verify App.app', 'security find-identity -v', 'git push origin main', 'rsync -av a/ b/', 'just check']) assert.ok(!blocked(cmd), cmd);
});

const rustSkip = (!haveJust && 'just is not installed') || (!hasTool('cargo') && 'cargo is not installed');

test('rust-cli: verbs that do not apply print a note and exit 0', { skip: skipJust }, () => {
  const env = cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH });
  const { cwd } = initExample('rust-cli', env, ['--skip-verify']);
  for (const verb of ['audit']) {
    const r = run('just', [verb], { cwd, env });
    assert.equal(r.status, 0, verb);
    assert.match(r.stdout, new RegExp(`^${verb}: not applicable`, 'm'));
  }
  assert.notEqual(run('just', ['deploy', 'prod'], { cwd, env }).status, 0, 'deploy is not defined');
});

test('smoke rust-cli: yaw init, just setup && just check pass; the tool runs; bad code fails the gate (needs cargo, rustfmt and clippy)', { skip: rustSkip, timeout: 600000 }, () => {
  const { cwd, r } = initExample('rust-cli', { ...process.env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /verified: just setup and just check passed/);
  const hello = run('cargo', ['run', '--quiet', '--', 'Ada'], { cwd });
  assert.equal(hello.stdout, 'Hello, Ada!\n');
  const tooMany = run('cargo', ['run', '--quiet', '--', 'a', 'b'], { cwd });
  assert.equal(tooMany.status, 1);
  assert.match(tooMany.stderr, /usage: app \[name\]/);

  const fixtures = join(KIT_ROOT, 'test', 'profiles', 'rust-cli');
  const bad = join(cwd, 'tests', 'bad.rs');
  copyFileSync(join(fixtures, 'lint_error.rs'), bad);
  assert.notEqual(run('just', ['lint'], { cwd }).status, 0, 'unformatted code fails just lint');
  copyFileSync(join(fixtures, 'type_error.rs'), bad);
  assert.notEqual(run('just', ['typecheck'], { cwd }).status, 0, 'a type error fails just typecheck');
});

test('rust-cli guards block crates.io changes, tool installs, release tags and remote hosts, not local work', () => {
  const guards = parse(readFileSync(dir('rust-cli', 'guards.yaml'), 'utf8')).guards.map((g) => new RegExp(g.pattern));
  const blocked = (cmd) => guards.some((re) => re.test(cmd));
  for (const cmd of ['cargo publish', 'cargo publish --dry-run', 'cargo --quiet publish', 'cd x && cargo publish', 'cargo owner --add me', 'cargo yank --version 1.0.0', 'cargo login', 'cargo install ripgrep', 'cargo install --path .', 'rustup self uninstall', 'rustup toolchain install nightly', 'rustup default nightly', 'rustup target add wasm32-unknown-unknown', 'git push --tags', 'git push origin v1.0.0', 'ssh me@host', 'scp a me@host:/srv', 'sftp me@host', 'rsync -av out/ me@host:/srv', 'rsync -av out/ host:/srv']) {
    assert.ok(blocked(cmd), cmd);
  }
  for (const cmd of ['cargo build', 'cargo test', 'cargo run -- Ada', 'cargo fmt --all', 'cargo clippy --all-targets -- -D warnings', 'cargo check', 'cargo fetch', 'rustup component list', 'git push origin main', 'rsync -av a/ b/', 'rsync -av a/ ./b:c/', 'just check']) assert.ok(!blocked(cmd), cmd);
});

test('rust-web: verbs that do not apply print a note and exit 0', { skip: skipJust }, () => {
  const env = cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH });
  const { cwd } = initExample('rust-web', env, ['--skip-verify']);
  assert.notEqual(run('just', ['deploy', 'prod'], { cwd, env }).status, 0, 'deploy is not defined');
});

test('rust-web pins its crates exactly and the profile watches cargo', () => {
  const toml = readFileSync(dir('rust-web', 'scaffold', 'Cargo.toml'), 'utf8');
  const deps = [...toml.matchAll(/^(?:axum|tokio|tower) = \{ version = "([^"]+)"/gm)].map((m) => m[1]);
  assert.equal(deps.length, 3);
  for (const v of deps) assert.match(v, /^=\d+\.\d+\.\d+$/);
  assert.deepEqual(loadProfile(KIT_ROOT, 'rust-web').dependencyEcosystems, ['cargo']);
});

test('smoke rust-web: yaw init, just setup && just check pass (fetches crates, needs cargo and network); bad code fails the gate', { skip: rustSkip || (process.env.YAW_TEST_OFFLINE && 'YAW_TEST_OFFLINE is set (cargo fetches crates)'), timeout: 900000 }, () => {
  const { cwd, r } = initExample('rust-web', { ...process.env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /verified: just setup and just check passed/);
  assert.ok(existsSync(join(cwd, 'Dockerfile')));
  assert.ok(existsSync(join(cwd, 'Cargo.lock')));

  const fixtures = join(KIT_ROOT, 'test', 'profiles', 'rust-web');
  const bad = join(cwd, 'tests', 'bad.rs');
  copyFileSync(join(fixtures, 'lint_error.rs'), bad);
  assert.notEqual(run('just', ['lint'], { cwd }).status, 0, 'unformatted code fails just lint');
  copyFileSync(join(fixtures, 'type_error.rs'), bad);
  assert.notEqual(run('just', ['typecheck'], { cwd }).status, 0, 'a type error fails just typecheck');
});

test('rust-web guards block crates.io changes, image pushes, remote hosts, tool installs and release tags, not local work', () => {
  const guards = parse(readFileSync(dir('rust-web', 'guards.yaml'), 'utf8')).guards.map((g) => new RegExp(g.pattern));
  const blocked = (cmd) => guards.some((re) => re.test(cmd));
  for (const cmd of ['cargo publish', 'cargo --quiet publish', 'cargo +nightly publish', 'cargo owner --add me', 'cargo yank --version 1.0.0', 'cargo login', 'cargo install ripgrep', 'rustup default nightly', 'git push --tags', 'git push origin v1.0.0', 'docker push me/app', 'docker image push me/app', 'docker buildx build --push -t me/app .', 'docker compose push', 'podman push me/app', 'ssh me@host', 'scp a me@host:/srv', 'sftp me@host', 'rsync -av out/ me@host:/srv', 'DOCKER_HOST=ssh://me@host docker ps', 'docker --context prod ps', 'docker -H ssh://me@host ps']) {
    assert.ok(blocked(cmd), cmd);
  }
  for (const cmd of ['cargo build --release --locked', 'cargo test', 'cargo run', 'cargo audit', 'cargo fetch', 'docker build -t app .', 'docker compose up', 'git push origin main', 'rsync -av a/ b/', 'rsync -av a/ ./b:c/', 'just check']) assert.ok(!blocked(cmd), cmd);
});

// rust-serverless (ADR-0115): one smoke test per hosting variant (ADR-0105); none needs Docker, AWS accounts or cargo-lambda.
const RUST_SERVERLESS_EXAMPLES = { container: 'rust-serverless', lambda: 'rust-serverless-lambda' };

test('rust-serverless: verbs that do not apply print a note and exit 0', { skip: skipJust }, () => {
  const env = cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH });
  const { cwd } = initExample('rust-serverless', env, ['--skip-verify']);
  assert.notEqual(run('just', ['deploy', 'prod'], { cwd, env }).status, 0, 'deploy is not defined');
});

test('rust-serverless: the uniform verbs exist and the hosting option has the two variants, container by default, with exact crate pins', () => {
  const just = readFileSync(dir('rust-serverless', 'just', 'rust-serverless.just'), 'utf8');
  for (const verb of VERBS) assert.match(just, new RegExp(`^${verb}\\b`, 'm'), verb);
  const profile = loadProfile(KIT_ROOT, 'rust-serverless');
  assert.deepEqual(profile.options.hosting.choices.map((c) => c.value), ['container', 'lambda']);
  assert.equal(profile.options.hosting.default, 'container');
  assert.match(profile.options.hosting.label, /container.*Lambda/i);
  assert.deepEqual(profile.dependencyEcosystems, ['cargo']);
  for (const variant of ['container', 'lambda']) {
    const toml = readFileSync(dir('rust-serverless', 'variants', variant, 'Cargo.toml'), 'utf8');
    const versions = [...toml.matchAll(/^[a-z_]+ = \{ version = "([^"]+)"/gm)].map((m) => m[1]);
    assert.ok(versions.length >= 2, variant);
    for (const v of versions) assert.match(v, /^=\d+\.\d+\.\d+$/, variant);
  }
});

for (const [variant, example] of Object.entries(RUST_SERVERLESS_EXAMPLES)) {
  test(`smoke rust-serverless (${variant}): yaw init writes the variant, just setup && just check pass; bad code fails the gate (needs cargo and network)`, { skip: rustSkip || (process.env.YAW_TEST_OFFLINE && 'YAW_TEST_OFFLINE is set (cargo fetches crates)'), timeout: 900000 }, () => {
    const { cwd, r } = initExample(example, { ...process.env });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /verified: just setup and just check passed/);
    assert.ok(existsSync(join(cwd, 'src', 'greeting.rs')));
    assert.equal(existsSync(join(cwd, 'Dockerfile')), variant === 'container');
    assert.match(readFileSync(join(cwd, 'Cargo.toml'), 'utf8'), variant === 'lambda' ? /lambda_http/ : /axum/);
    const fixtures = join(KIT_ROOT, 'test', 'profiles', 'rust-serverless');
    const bad = join(cwd, 'tests', 'bad.rs');
    copyFileSync(join(fixtures, 'lint_error.rs'), bad);
    assert.notEqual(run('just', ['lint'], { cwd }).status, 0, 'unformatted code fails just lint');
    copyFileSync(join(fixtures, 'type_error.rs'), bad);
    assert.notEqual(run('just', ['typecheck'], { cwd }).status, 0, 'a type error fails just typecheck');
  });
}

test('rust-serverless guards block registry pushes, cloud CLIs, cargo lambda deploy, remote hosts and publishing, not local work', () => {
  const guards = parse(readFileSync(dir('rust-serverless', 'guards.yaml'), 'utf8')).guards.map((g) => new RegExp(g.pattern));
  const blocked = (cmd) => guards.some((re) => re.test(cmd));
  for (const cmd of ['cargo publish', 'cargo --quiet publish', 'cargo install cargo-lambda', 'rustup target add aarch64-unknown-linux-gnu', 'cargo lambda deploy', 'cargo lambda deploy --iam-role x app', 'cargo lambda invoke app', 'cargo +stable lambda deploy', 'cd x && cargo lambda deploy', 'docker push me/app', 'docker image push me/app', 'docker buildx build --push -t me/app .', 'podman push me/app', 'gcloud builds submit --tag gcr.io/p/app', 'gcloud run deploy app --source .', 'aws lambda update-function-code --function-name x', 'AWS_PROFILE=p aws sts get-caller-identity', 'sam deploy --guided', 'git push --tags', 'ssh me@host', 'scp a me@host:/srv', 'rsync -av out/ me@host:/srv', 'DOCKER_HOST=ssh://me@host docker ps', 'docker --context prod ps']) {
    assert.ok(blocked(cmd), cmd);
  }
  for (const cmd of ['cargo build --release --locked', 'cargo lambda build --release --arm64', 'cargo lambda watch', 'cargo test', 'cargo audit', 'cargo fetch', 'docker build -t app .', 'git push origin main', 'rsync -av a/ b/', 'just check']) assert.ok(!blocked(cmd), cmd);
});

// go-cli, go-web, go-serverless (ADR-0121..0123): the Go toolchain; the gate needs no Docker or AWS account, only go-serverless (lambda) fetches aws-lambda-go once.
const goSkip = (!haveJust && 'just is not installed') || (!hasTool('go') && 'go is not installed');
const goOffline = goSkip || (process.env.YAW_TEST_OFFLINE && 'YAW_TEST_OFFLINE is set (the Lambda flavor fetches a module)');
const GO_SERVERLESS_EXAMPLES = { container: 'go-serverless', lambda: 'go-serverless-lambda' };

function badGo(cwd, name) {
  const fixtures = join(KIT_ROOT, 'test', 'profiles', name);
  const bad = join(cwd, 'bad.go');
  copyFileSync(join(fixtures, 'lint_error.go'), bad);
  assert.notEqual(run('just', ['lint'], { cwd }).status, 0, 'unformatted code fails just lint');
  copyFileSync(join(fixtures, 'type_error.go'), bad);
  assert.notEqual(run('just', ['typecheck'], { cwd }).status, 0, 'a type error fails just typecheck');
}

for (const name of ['go-cli', 'go-web', 'go-serverless']) {
  test(`${name}: the core verbs exist, no echo-only stubs, deploy is not defined`, { skip: skipJust }, () => {
    const just = readFileSync(dir(name, 'just', `${name}.just`), 'utf8');
    for (const verb of VERBS) assert.match(just, new RegExp(`^${verb}\\b`, 'm'), verb);
    for (const verb of OPTIONAL_VERBS) assert.doesNotMatch(just, new RegExp(`^${verb}\\b`, 'm'), verb);
    const env = cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH });
    const { cwd } = initExample(name, env, ['--skip-verify']);
    assert.notEqual(run('just', ['deploy', 'prod'], { cwd, env }).status, 0, 'deploy is not defined');
  });
}

test('go-serverless: hosting option has container (default) and lambda, aws-lambda-go is pinned exactly with go.sum, gomod is watched', () => {
  const profile = loadProfile(KIT_ROOT, 'go-serverless');
  assert.deepEqual(profile.options.hosting.choices.map((c) => c.value), ['container', 'lambda']);
  assert.equal(profile.options.hosting.default, 'container');
  assert.deepEqual(profile.dependencyEcosystems, ['gomod']);
  assert.match(readFileSync(dir('go-serverless', 'variants', 'lambda', 'go.mod'), 'utf8'), /^require github\.com\/aws\/aws-lambda-go v\d+\.\d+\.\d+$/m);
  assert.ok(existsSync(dir('go-serverless', 'variants', 'lambda', 'go.sum')));
  assert.doesNotMatch(readFileSync(dir('go-serverless', 'variants', 'container', 'go.mod'), 'utf8'), /require/);
  for (const name of ['go-cli', 'go-web']) assert.equal(loadProfile(KIT_ROOT, name).dependencyEcosystems, undefined, name);
});

test('go-basic only keeps app-store', () => {
  assert.deepEqual(loadProfile(KIT_ROOT, 'go-basic').stack.runsOn, ['app-store']);
});

test('smoke go-cli: yaw init, just setup && just check pass; the tool runs; bad code fails the gate (needs go)', { skip: goSkip, timeout: 600000 }, () => {
  const { cwd, r } = initExample('go-cli', { ...process.env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /verified: just setup and just check passed/);
  assert.equal(run('go', ['run', '.', 'Ada'], { cwd }).stdout, 'Hello, Ada!\n');
  const tooMany = run('go', ['run', '.', 'a', 'b'], { cwd });
  assert.notEqual(tooMany.status, 0);
  assert.match(tooMany.stderr, /usage: app \[name\]/);
  badGo(cwd, 'go-cli');
});

test('smoke go-web: yaw init, just setup && just check pass; the service answers; bad code fails the gate (needs go)', { skip: goSkip, timeout: 600000 }, () => {
  const { cwd, r } = initExample('go-web', { ...process.env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /verified: just setup and just check passed/);
  assert.ok(existsSync(join(cwd, 'Dockerfile')));
  assert.ok(existsSync(join(cwd, 'bin', 'app')), 'just check builds the binary');
  badGo(cwd, 'go-web');
});

for (const [variant, example] of Object.entries(GO_SERVERLESS_EXAMPLES)) {
  test(`smoke go-serverless (${variant}): yaw init writes the variant, just setup && just check pass; bad code fails the gate (needs go${variant === 'lambda' ? ' and network' : ''})`, { skip: variant === 'lambda' ? goOffline : goSkip, timeout: 600000 }, () => {
    const { cwd, r } = initExample(example, { ...process.env });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /verified: just setup and just check passed/);
    assert.ok(existsSync(join(cwd, 'greeting.go')));
    assert.equal(existsSync(join(cwd, 'Dockerfile')), variant === 'container');
    assert.equal(existsSync(join(cwd, 'go.sum')), variant === 'lambda');
    assert.ok(existsSync(join(cwd, variant === 'lambda' ? 'dist/bootstrap' : 'bin/app')));
    badGo(cwd, 'go-serverless');
  });
}

const goGuards = (name) => parse(readFileSync(dir(name, 'guards.yaml'), 'utf8')).guards.map((g) => new RegExp(g.pattern));
const GO_BLOCKED = ['go install golang.org/x/vuln/cmd/govulncheck@latest', 'go env -w GOFLAGS=-mod=mod', 'go clean -modcache', 'go run example.com/tool@v1.0.0', 'git push --tags', 'git push origin v1.0.0', 'ssh me@host', 'scp a me@host:/srv', 'rsync -av out/ me@host:/srv'];
const GO_ALLOWED = ['go build ./...', 'go test ./...', 'go vet ./...', 'go run . Ada', 'go mod tidy', 'go mod download', 'go env GOPATH', 'gofmt -l .', 'git push origin main', 'rsync -av a/ b/', 'just check'];

test('go guards block tool installs, remote modules, release tags and remote hosts, not local work', () => {
  for (const name of ['go-cli', 'go-web', 'go-serverless']) {
    const guards = goGuards(name);
    const blocked = (cmd) => guards.some((re) => re.test(cmd));
    for (const cmd of GO_BLOCKED) assert.ok(blocked(cmd), `${name}: ${cmd}`);
    for (const cmd of GO_ALLOWED) assert.ok(!blocked(cmd), `${name}: ${cmd}`);
  }
});

test('go-web and go-serverless guards also block image pushes and remote Docker; go-serverless blocks cloud CLIs', () => {
  for (const name of ['go-web', 'go-serverless']) {
    const guards = goGuards(name);
    const blocked = (cmd) => guards.some((re) => re.test(cmd));
    for (const cmd of ['docker push me/app', 'docker image push me/app', 'docker buildx build --push -t me/app .', 'podman push me/app', 'docker -H ssh://h ps', 'DOCKER_HOST=ssh://h docker ps']) assert.ok(blocked(cmd), `${name}: ${cmd}`);
    for (const cmd of ['docker build -t app .', 'docker compose up']) assert.ok(!blocked(cmd), `${name}: ${cmd}`);
  }
  const cloud = goGuards('go-serverless');
  for (const cmd of ['aws lambda create-function --function-name x', 'sam deploy', 'gcloud run deploy', 'gcloud builds submit']) assert.ok(cloud.some((re) => re.test(cmd)), cmd);
});

// The Java, Kotlin and Android smoke gates need a working JAVA_HOME, not just `java` on PATH (gradlew checks JAVA_HOME first).
// An invalid JAVA_HOME fails here with a message naming JAVA_HOME; it must not silently skip those smoke tests.
test('Java/Kotlin/Android gate: an invalid JAVA_HOME fails with a message naming JAVA_HOME', () => {
  if (!hasTool('java')) return; // no JDK at all: the smoke tests skip with "java is not installed"
  const msg = gradleJdkProblem({ ...process.env, JAVA_HOME: join(tmp(), 'no-such-jdk') });
  assert.match(msg || '', /JAVA_HOME/);
  assert.equal(gradleJdkProblem({ ...process.env, JAVA_HOME: undefined }), null);
});

test('Java/Kotlin/Android gate: the JAVA_HOME of this run is a usable JDK (gradlew exits on an invalid one)', () => {
  const msg = gradleJdkProblem();
  assert.equal(msg, null, msg || '');
});

// kotlin-cli, kotlin-web, kotlin-serverless (ADR-0117..0119): Gradle wrapper with JDK 17+; the gate needs no Docker, AWS account or Android SDK.
const kotlinSkip = (!haveJust && 'just is not installed') || (!hasTool('java') && 'java is not installed') || (process.env.YAW_TEST_OFFLINE && 'YAW_TEST_OFFLINE is set (Gradle needs the network)');
const KOTLIN_SERVERLESS_EXAMPLES = { container: 'kotlin-serverless', lambda: 'kotlin-serverless-lambda' };

function pinsAreExact(buildFile) {
  const text = readFileSync(buildFile, 'utf8');
  const coords = [...text.matchAll(/"([\w.-]+:[\w.-]+:)?([\w.-]+)"/g)].filter((m) => m[1]);
  const versions = [...text.matchAll(/(?:implementation|testImplementation|platform)\(\s*(?:platform\()?"[\w.-]+:[\w.-]+:([^"]+)"/g)].map((m) => m[1]);
  const plugins = [...text.matchAll(/version "([^"]+)"/g)].map((m) => m[1]);
  for (const v of [...versions, ...plugins]) assert.match(v, /^\d+\.\d+(\.\d+)?$/, `${buildFile}: ${v}`);
  assert.ok(coords.length && plugins.length >= 1, buildFile);
  assert.doesNotMatch(text, /jvmToolchain|[:"]latest|\+"/, 'no toolchain download, no floating versions');
}

for (const name of ['kotlin-cli', 'kotlin-web', 'kotlin-serverless']) {
  test(`${name}: the uniform verbs exist, the wrapper is pinned by checksum, versions are exact, Gradle is watched`, () => {
    const just = readFileSync(dir(name, 'just', `${name}.just`), 'utf8');
    for (const verb of VERBS) assert.match(just, new RegExp(`^${verb}\\b`, 'm'), verb);
    assert.deepEqual(loadProfile(KIT_ROOT, name).dependencyEcosystems, ['gradle']);
    const props = readFileSync(dir(name, 'scaffold', 'gradle', 'wrapper', 'gradle-wrapper.properties'), 'utf8');
    assert.match(props, /^distributionSha256Sum=[0-9a-f]{64}$/m);
    const builds = name === 'kotlin-serverless' ? ['container', 'lambda'].map((v) => dir(name, 'variants', v, 'build.gradle.kts')) : [dir(name, 'scaffold', 'build.gradle.kts')];
    for (const b of builds) pinsAreExact(b);
    const ci = readFileSync(dir(name, 'ci', 'check.yml'), 'utf8');
    assert.match(ci, /actions\/setup-java@[0-9a-f]{40}/);
    assert.match(ci, /java-version: "17"/);
  });

  test(`${name}: verbs that do not apply print a note and exit 0; deploy only prints a note`, { skip: skipJust }, () => {
    const env = cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH });
    const { cwd } = initExample(name, env, ['--skip-verify']);
    const r = run('just', ['audit'], { cwd, env });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^audit: not applicable/m);
    assert.notEqual(run('just', ['deploy', 'prod'], { cwd, env }).status, 0, 'deploy is not defined');
  });
}

function kotlinBadCode(cwd, name) {
  const fixtures = join(KIT_ROOT, 'test', 'profiles', name);
  const bad = join(cwd, 'src', 'main', 'kotlin', 'com', 'example', 'app', 'Bad.kt');
  copyFileSync(join(fixtures, 'lint_error.kt'), bad);
  assert.notEqual(run('just', ['lint'], { cwd }).status, 0, 'a style violation fails just lint');
  copyFileSync(join(fixtures, 'type_error.kt'), bad);
  assert.notEqual(run('just', ['typecheck'], { cwd }).status, 0, 'a type error fails just typecheck');
}

test('smoke kotlin-cli: yaw init, just setup && just check pass; the tool runs; bad code fails the gate (needs JDK 17+ and network)', { skip: kotlinSkip, timeout: 900000 }, () => {
  const { cwd, r } = initExample('kotlin-cli', { ...process.env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /BUILD SUCCESSFUL/);
  assert.match(r.stdout, /verified: just setup and just check passed/);
  const hello = run(join(cwd, 'build', 'install', 'app', 'bin', 'app'), ['Ada'], { cwd });
  assert.equal(hello.stdout, 'Hello, Ada!\n');
  const bad = run(join(cwd, 'build', 'install', 'app', 'bin', 'app'), ['a', 'b'], { cwd });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /usage: app/);
  kotlinBadCode(cwd, 'kotlin-cli');
});

test('smoke kotlin-web: yaw init, just setup && just check pass; bad code fails the gate (needs JDK 17+ and network)', { skip: kotlinSkip, timeout: 900000 }, () => {
  const { cwd, r } = initExample('kotlin-web', { ...process.env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /BUILD SUCCESSFUL/);
  assert.match(r.stdout, /verified: just setup and just check passed/);
  assert.ok(existsSync(join(cwd, 'Dockerfile')));
  assert.ok(existsSync(join(cwd, 'build', 'install', 'app', 'bin', 'app')));
  kotlinBadCode(cwd, 'kotlin-web');
});

test('kotlin-serverless: the hosting option has the two variants, container by default, and lists aws and sam only for lambda', () => {
  const profile = loadProfile(KIT_ROOT, 'kotlin-serverless');
  assert.deepEqual(profile.options.hosting.choices.map((c) => c.value), ['container', 'lambda']);
  assert.equal(profile.options.hosting.default, 'container');
  assert.match(profile.options.hosting.label, /container.*Lambda/i);
  assert.deepEqual(profile.tools.map((t) => [t.name, t.when.hosting]), [['aws', 'lambda'], ['sam', 'lambda']]);
});

for (const [variant, example] of Object.entries(KOTLIN_SERVERLESS_EXAMPLES)) {
  test(`smoke kotlin-serverless (${variant}): yaw init writes the variant, just setup && just check pass; bad code fails the gate (needs JDK 17+ and network)`, { skip: kotlinSkip, timeout: 900000 }, () => {
    const { cwd, r } = initExample(example, { ...process.env });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /verified: just setup and just check passed/);
    assert.ok(existsSync(join(cwd, 'src', 'main', 'kotlin', 'com', 'example', 'app', 'Greeting.kt')));
    assert.equal(existsSync(join(cwd, 'Dockerfile')), variant === 'container');
    assert.match(readFileSync(join(cwd, 'build.gradle.kts'), 'utf8'), variant === 'lambda' ? /aws-lambda-java-core/ : /ktor-server-netty/);
    if (variant === 'lambda') assert.ok(existsSync(join(cwd, 'build', 'distributions', 'app-0.0.0.zip')), 'the Lambda package was built');
    kotlinBadCode(cwd, 'kotlin-serverless');
  });
}

// java-cli, java-web, java-serverless (ADR-0125..0127): Gradle wrapper with JDK 17+; the gate needs no Docker, AWS account or Android SDK.
const JAVA_SERVERLESS_EXAMPLES = { container: 'java-serverless', lambda: 'java-serverless-lambda' };
const javaSkip = (!haveJust && 'just is not installed') || (!hasTool('java') && 'java is not installed') || (process.env.YAW_TEST_OFFLINE && 'YAW_TEST_OFFLINE is set (Gradle needs the network)');

function javaBadCode(cwd, name) {
  const fixtures = join(KIT_ROOT, 'test', 'profiles', name);
  const bad = join(cwd, 'src', 'main', 'java', 'com', 'example', 'app', 'Bad.java');
  copyFileSync(join(fixtures, 'lint_error.java'), bad);
  assert.notEqual(run('just', ['lint'], { cwd }).status, 0, 'a style violation fails just lint');
  copyFileSync(join(fixtures, 'type_error.java'), bad);
  assert.notEqual(run('just', ['typecheck'], { cwd }).status, 0, 'a type error fails just typecheck');
}

for (const name of ['java-cli', 'java-web', 'java-serverless']) {
  test(`${name}: the uniform verbs exist, the wrapper is pinned by checksum, versions are exact, Gradle is watched`, () => {
    const just = readFileSync(dir(name, 'just', `${name}.just`), 'utf8');
    for (const verb of VERBS) assert.match(just, new RegExp(`^${verb}\\b`, 'm'), verb);
    assert.deepEqual(loadProfile(KIT_ROOT, name).dependencyEcosystems, ['gradle']);
    const props = readFileSync(dir(name, 'scaffold', 'gradle', 'wrapper', 'gradle-wrapper.properties'), 'utf8');
    assert.match(props, /^distributionSha256Sum=[0-9a-f]{64}$/m);
    const builds = name === 'java-serverless' ? ['container', 'lambda'].map((v) => dir(name, 'variants', v, 'build.gradle.kts')) : [dir(name, 'scaffold', 'build.gradle.kts')];
    for (const b of builds) pinsAreExact(b);
    const ci = readFileSync(dir(name, 'ci', 'check.yml'), 'utf8');
    assert.match(ci, /actions\/setup-java@[0-9a-f]{40}/);
    assert.match(ci, /java-version: "17"/);
  });

  test(`${name}: audit prints a note and exits 0; deploy is not defined`, { skip: skipJust }, () => {
    const env = cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH });
    const { cwd } = initExample(name, env, ['--skip-verify']);
    const r = run('just', ['audit'], { cwd, env });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^audit: not applicable/m);
    assert.notEqual(run('just', ['deploy', 'prod'], { cwd, env }).status, 0, 'deploy is not defined');
  });
}

test('smoke java-cli: yaw init, just setup && just check pass; the tool runs; bad code fails the gate (needs JDK 17+ and network)', { skip: javaSkip, timeout: 900000 }, () => {
  const { cwd, r } = initExample('java-cli', { ...process.env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /BUILD SUCCESSFUL/);
  assert.match(r.stdout, /verified: just setup and just check passed/);
  const hello = run(join(cwd, 'build', 'install', 'app', 'bin', 'app'), ['Ada'], { cwd });
  assert.equal(hello.stdout, 'Hello, Ada!\n');
  const bad = run(join(cwd, 'build', 'install', 'app', 'bin', 'app'), ['a', 'b'], { cwd });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /usage: app/);
  javaBadCode(cwd, 'java-cli');
});

test('smoke java-web: yaw init, just setup && just check pass; the server answers; bad code fails the gate (needs JDK 17+ and network)', { skip: javaSkip, timeout: 900000 }, () => {
  const { cwd, r } = initExample('java-web', { ...process.env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /BUILD SUCCESSFUL/);
  assert.match(r.stdout, /verified: just setup and just check passed/);
  assert.ok(existsSync(join(cwd, 'Dockerfile')));
  assert.ok(existsSync(join(cwd, 'build', 'install', 'app', 'bin', 'app')));
  javaBadCode(cwd, 'java-web');
});

test('java-web guards block publishing, image pushes, remote hosts and release tags, not local work', () => {
  const guards = parse(readFileSync(dir('java-web', 'guards.yaml'), 'utf8')).guards.map((g) => new RegExp(g.pattern));
  const blocked = (cmd) => guards.some((re) => re.test(cmd));
  for (const cmd of ['./gradlew publish', 'git push --tags', 'docker push me/app', 'docker buildx build --push -t me/app .', 'ssh me@host', 'rsync -av out/ me@host:/srv', 'DOCKER_HOST=ssh://me@host docker ps', 'docker --context prod ps']) assert.ok(blocked(cmd), cmd);
  for (const cmd of ['./gradlew build installDist', './gradlew test', 'docker build -t app .', 'git push origin main', 'just check']) assert.ok(!blocked(cmd), cmd);
});

test('java-serverless: the hosting option has the two variants, container by default, and lists aws and sam only for lambda', () => {
  const profile = loadProfile(KIT_ROOT, 'java-serverless');
  assert.deepEqual(profile.options.hosting.choices.map((c) => c.value), ['container', 'lambda']);
  assert.equal(profile.options.hosting.default, 'container');
  assert.match(profile.options.hosting.label, /container.*Lambda/i);
  assert.deepEqual(profile.tools.map((t) => [t.name, t.when.hosting]), [['aws', 'lambda'], ['sam', 'lambda']]);
});

for (const [variant, example] of Object.entries(JAVA_SERVERLESS_EXAMPLES)) {
  test(`smoke java-serverless (${variant}): yaw init writes the variant, just setup && just check pass; bad code fails the gate (needs JDK 17+ and network)`, { skip: javaSkip, timeout: 900000 }, () => {
    const { cwd, r } = initExample(example, { ...process.env });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /verified: just setup and just check passed/);
    assert.ok(existsSync(join(cwd, 'src', 'main', 'java', 'com', 'example', 'app', 'Routes.java')));
    assert.equal(existsSync(join(cwd, 'Dockerfile')), variant === 'container');
    assert.equal(existsSync(join(cwd, 'src', 'main', 'java', 'com', 'example', 'app', variant === 'lambda' ? 'Handler.java' : 'Server.java')), true);
    if (variant === 'lambda') assert.ok(existsSync(join(cwd, 'build', 'distributions', 'app-0.0.0.zip')), 'the Lambda package was built');
    javaBadCode(cwd, 'java-serverless');
  });
}

test('java-serverless guards block publishing, registry pushes, cloud CLIs, remote hosts and release tags, not local work', () => {
  const guards = parse(readFileSync(dir('java-serverless', 'guards.yaml'), 'utf8')).guards.map((g) => new RegExp(g.pattern));
  const blocked = (cmd) => guards.some((re) => re.test(cmd));
  for (const cmd of ['./gradlew publish', 'docker push me/app', 'gcloud run deploy app --source .', 'aws lambda update-function-code --function-name x --zip-file fileb://app.zip', 'sam deploy --guided', 'git push --tags', 'ssh me@host', 'DOCKER_HOST=ssh://me@host docker ps']) assert.ok(blocked(cmd), cmd);
  for (const cmd of ['./gradlew build', './gradlew test', 'docker build -t app .', 'git push origin main', 'just check']) assert.ok(!blocked(cmd), cmd);
});

test('java-cli guards block publishing, release tags and remote hosts, not local work', () => {
  const guards = parse(readFileSync(dir('java-cli', 'guards.yaml'), 'utf8')).guards.map((g) => new RegExp(g.pattern));
  const blocked = (cmd) => guards.some((re) => re.test(cmd));
  for (const cmd of ['./gradlew publish', 'git push --tags', 'git push origin v1.0.0', 'ssh me@host', 'rsync -av out/ me@host:/srv']) assert.ok(blocked(cmd), cmd);
  for (const cmd of ['./gradlew build', './gradlew test', './gradlew run --args=Ada', './gradlew spotlessCheck', 'git push origin main', 'just check']) assert.ok(!blocked(cmd), cmd);
});

test('kotlin-cli guards block publishing, release tags and remote hosts, not local work', () => {
  const guards = parse(readFileSync(dir('kotlin-cli', 'guards.yaml'), 'utf8')).guards.map((g) => new RegExp(g.pattern));
  const blocked = (cmd) => guards.some((re) => re.test(cmd));
  for (const cmd of ['./gradlew publish', 'gradle publishToMavenLocal publish', 'cd x && ./gradlew publish', 'git push --tags', 'git push origin v1.0.0', 'ssh me@host', 'scp a me@host:/srv', 'rsync -av out/ me@host:/srv']) assert.ok(blocked(cmd), cmd);
  for (const cmd of ['./gradlew build', './gradlew test', './gradlew run --args=Ada', './gradlew ktlintCheck', 'git push origin main', 'rsync -av a/ b/', 'just check']) assert.ok(!blocked(cmd), cmd);
});

test('kotlin-web guards block publishing, image pushes, remote hosts and release tags, not local work', () => {
  const guards = parse(readFileSync(dir('kotlin-web', 'guards.yaml'), 'utf8')).guards.map((g) => new RegExp(g.pattern));
  const blocked = (cmd) => guards.some((re) => re.test(cmd));
  for (const cmd of ['./gradlew publish', 'git push --tags', 'docker push me/app', 'docker image push me/app', 'docker buildx build --push -t me/app .', 'podman push me/app', 'ssh me@host', 'rsync -av out/ me@host:/srv', 'DOCKER_HOST=ssh://me@host docker ps', 'docker --context prod ps', 'docker -H ssh://me@host ps']) assert.ok(blocked(cmd), cmd);
  for (const cmd of ['./gradlew build installDist', './gradlew test', 'docker build -t app .', 'docker compose up', 'git push origin main', 'rsync -av a/ b/', 'just check']) assert.ok(!blocked(cmd), cmd);
});

test('kotlin-serverless guards block publishing, registry pushes, cloud CLIs, remote hosts and release tags, not local work', () => {
  const guards = parse(readFileSync(dir('kotlin-serverless', 'guards.yaml'), 'utf8')).guards.map((g) => new RegExp(g.pattern));
  const blocked = (cmd) => guards.some((re) => re.test(cmd));
  for (const cmd of ['./gradlew publish', 'docker push me/app', 'docker buildx build --push -t me/app .', 'gcloud builds submit --tag gcr.io/p/app', 'gcloud run deploy app --source .', 'aws lambda update-function-code --function-name x --zip-file fileb://app.zip', 'AWS_PROFILE=p aws sts get-caller-identity', 'sam deploy --guided', 'git push --tags', 'ssh me@host', 'rsync -av out/ me@host:/srv', 'DOCKER_HOST=ssh://me@host docker ps', 'docker --context prod ps']) assert.ok(blocked(cmd), cmd);
  for (const cmd of ['./gradlew build', './gradlew test', 'docker build -t app .', 'git push origin main', 'rsync -av a/ b/', 'just check']) assert.ok(!blocked(cmd), cmd);
});

test('php-web: verbs that do not apply print a note and exit 0', { skip: skipJust }, () => {
  const env = cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH });
  const { cwd } = initExample('php-web', env, ['--skip-verify']);
  for (const verb of ['build']) {
    const r = run('just', [verb], { cwd, env });
    assert.equal(r.status, 0, verb);
    assert.match(r.stdout, new RegExp(`^${verb}: not applicable`, 'm'));
  }
  assert.notEqual(run('just', ['deploy', 'prod'], { cwd, env }).status, 0, 'deploy is not defined');
});


test('smoke php-web: yaw init, just setup && just check pass; bad code fails the gate (needs php, composer and network)', { skip: phpSkip, timeout: 300000 }, () => {
  const { cwd, r } = initExample('php-web', { ...process.env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /OK \(2 tests/);
  assert.match(r.stdout, /verified: just setup and just check passed/);

  const fixtures = join(KIT_ROOT, 'test', 'profiles', 'php-web');
  const bad = join(cwd, 'src', 'Bad.php');
  copyFileSync(join(fixtures, 'lint_error.php'), bad);
  assert.notEqual(run('just', ['lint'], { cwd }).status, 0, 'unformatted code fails just lint');
  copyFileSync(join(fixtures, 'type_error.php'), bad);
  assert.notEqual(run('just', ['typecheck'], { cwd }).status, 0, 'a type error fails just typecheck');
});

test('php-web guards block migrations, remote hosts and registry pushes in every bypass form, not local work', () => {
  const guards = parse(readFileSync(dir('php-web', 'guards.yaml'), 'utf8')).guards.map((g) => new RegExp(g.pattern));
  const blocked = (cmd) => guards.some((re) => re.test(cmd));
  const bad = [
    'php artisan migrate', 'php artisan migrate --force', 'php artisan migrate:fresh --seed', 'php artisan migrate:rollback', 'php artisan db:wipe', 'php artisan db:seed',
    'php artisan --env=production migrate', 'php artisan migrate --env=production', 'APP_ENV=production php artisan migrate --force', 'env APP_ENV=production php artisan migrate',
    'php8.3 artisan migrate', './artisan migrate', 'php ./artisan migrate', 'vendor/bin/sail artisan migrate', 'sail artisan migrate', 'sudo php artisan migrate',
    'docker compose exec app php artisan migrate', 'docker exec app php artisan migrate --force', 'bash -c "php artisan migrate"', "sh -c 'php artisan migrate --force'",
    'cd app && php artisan migrate', 'true;php artisan migrate', 'echo x|php artisan migrate', '(php artisan migrate)', '$(php artisan migrate)', 'nohup php artisan migrate', 'time php artisan migrate',
    'php artisan migrate --pretend && php artisan migrate', 'php artisan migrate --pretend; php artisan migrate --force', 'php artisan migrate:fresh', 'php artisan migrate --force # --pretend', 'php artisan migrate --pretend\nphp artisan migrate --force',
    'ssh me@host', 'ssh -p 22 host ls', 'sudo ssh host', 'env X=1 ssh host', 'scp a.zip me@host:/var/www', 'sftp me@host', 'ftp host', 'lftp -e "mirror -R" host', 'true;ssh host',
    'rsync -av ./ me@host:/var/www/', 'rsync -av --delete public/ host:/var/www/', 'rsync -e ssh -av a/ b', 'rsync -av a/ host::module', 'rsync -av a/ rsync://host/module/', 'sudo rsync -av a/ me@host:/x', 'bash -c "rsync -av a/ me@host:/x"',
    'DOCKER_HOST=ssh://me@host docker compose up', 'docker -H ssh://me@host ps', 'docker --host tcp://host:2375 ps', 'docker --context prod compose up', 'sudo docker -H x ps',
    'docker push me/app', 'docker compose push', 'docker build --push -t me/app .', 'docker buildx build --push .', 'docker-compose push', 'sudo docker push me/app', 'true && docker push me/app',
  ];
  for (const cmd of bad) assert.ok(blocked(cmd), cmd);
  const ok = [
    'php artisan migrate --pretend', 'php artisan migrate:fresh --pretend', 'php artisan --env=local migrate --pretend', 'php artisan route:list', 'php artisan test', 'php artisan make:migration create_x_table',
    'composer install', 'composer audit', 'composer require monolog/monolog', 'vendor/bin/phpunit', 'vendor/bin/phpstan analyse', 'vendor/bin/php-cs-fixer fix', 'php -S 127.0.0.1:8000 -t public',
    'rsync -av a/ b/', 'rsync -av a/ ./b:c/', 'docker build -t app .', 'docker compose up', 'docker compose exec app composer install', 'just check', 'just test', 'git add composer.lock', 'cat database/migrations/x.php',
  ];
  for (const cmd of ok) assert.ok(!blocked(cmd), cmd);
});

test('wordpress-plugin: verbs that do not apply print a note and exit 0', { skip: skipJust }, () => {
  const env = cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH });
  const { cwd } = initExample('wordpress-plugin', env, ['--skip-verify']);
  for (const verb of ['build']) {
    const r = run('just', [verb], { cwd, env });
    assert.equal(r.status, 0, verb);
    assert.match(r.stdout, new RegExp(`^${verb}: not applicable`, 'm'));
  }
  assert.notEqual(run('just', ['deploy', 'prod'], { cwd, env }).status, 0, 'deploy is not defined');
});

test('smoke wordpress-plugin: yaw init, just setup && just check pass; bad code fails the gate (needs php, composer and network)', { skip: phpSkip, timeout: 300000 }, () => {
  const { cwd, r } = initExample('wordpress-plugin', { ...process.env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /OK \(2 tests/);
  assert.match(r.stdout, /verified: just setup and just check passed/);

  const fixtures = join(KIT_ROOT, 'test', 'profiles', 'wordpress-plugin');
  const bad = join(cwd, 'src', 'Bad.php');
  copyFileSync(join(fixtures, 'lint_error.php'), bad);
  assert.notEqual(run('just', ['lint'], { cwd }).status, 0, 'code that breaks the WordPress standard fails just lint');
  copyFileSync(join(fixtures, 'type_error.php'), bad);
  assert.notEqual(run('just', ['typecheck'], { cwd }).status, 0, 'a type error fails just typecheck');
});

test('wordpress-plugin guards block SVN writes, deploy scripts, remote wp-cli and remote hosts in every bypass form, not local work', () => {
  const guards = parse(readFileSync(dir('wordpress-plugin', 'guards.yaml'), 'utf8')).guards.map((g) => new RegExp(g.pattern));
  const blocked = (cmd) => guards.some((re) => re.test(cmd));
  const bad = [
    // SVN writes
    'svn commit -m "Release 1.0"', 'svn ci -m x', 'svn import . https://plugins.svn.wordpress.org/my-plugin -m x', 'svn --username me --password x commit -m x', 'svn -m x ci', 'svn --non-interactive --trust-server-cert commit',
    'cd trunk && svn commit', 'svn add . && svn commit -m x', 'true;svn ci', 'echo x|svn commit', '(svn commit -m x)', '$(svn commit -m x)', 'sudo svn commit', 'env SVN_EDITOR=true svn ci', 'SVN_EDITOR=true svn commit',
    'bash -c "svn commit -m x"', "sh -c 'svn ci -m x'", 'nohup svn commit -m x', 'time svn commit', 'xargs svn commit', '/usr/bin/svn commit', 'command svn commit', 'svn lock trunk/a.php', 'svn propset svn:ignore x .', 'svn patch x.diff',
    'svn copy https://plugins.svn.wordpress.org/my-plugin/trunk https://plugins.svn.wordpress.org/my-plugin/tags/1.0 -m tag', 'svn cp trunk https://plugins.svn.wordpress.org/my-plugin/tags/1.0', 'svn rm https://plugins.svn.wordpress.org/my-plugin/tags/1.0 -m x', 'svn mkdir svn://host/repo/tags -m x', 'svn mv https://h/a https://h/b',
    'svn cp "^/a" "^/b"', "svn rm '^/x'", 'svn cp trunk "https://h/tags/1.0"', 'svn cp ^/trunk ^/tags/1.0 -m tag', 'svn rm ^/tags/1.0', 'svn mkdir ^/tags/x', 'svn move ^/a ^/b', 'svn mv ^/a ^/b', 'svn delete ^/tags/1.0 -m x', 'svnmucc -m x put a.php https://h/trunk/a.php', 'git svn dcommit', 'sudo git svn dcommit',
    // deploy / release scripts and task runner targets
    'deploy.sh', './deploy.sh', 'bash deploy.sh', 'sh deploy.sh', 'bash -x ./bin/deploy.sh', 'sudo ./scripts/deploy.sh', 'sudo bash scripts/deploy.sh', 'env X=1 ./deploy.sh', 'X=1 ./deploy.sh', 'bash -c "./deploy.sh"', "sh -c './bin/deploy.sh --prod'",
    'cd app && ./deploy.sh', 'true;./deploy.sh', 'echo x|bash deploy.sh', '(./deploy.sh)', '$(./deploy.sh)', 'nohup ./deploy.sh', 'time bash deploy.sh', 'source deploy.sh', '. ./deploy.sh', 'python3 deploy.py', 'node scripts/deploy.js', 'php deploy.php', 'bash release.sh', './publish.sh', 'bash deploy-prod.sh', 'bash scripts/deploy_to_svn.sh',
    'npm run deploy', 'npm run release', 'npm run publish', 'npm publish', 'pnpm deploy', 'yarn deploy', 'yarn run release', 'bun run deploy', 'npx deploy', 'composer deploy', 'composer run-script deploy', 'composer run release', 'make deploy', 'make release', 'just deploy', 'just deploy prod', 'just --justfile justfile deploy', 'sudo make deploy', 'true && make deploy', 'bash -c "npm run deploy"', 'CI=1 npm run deploy',
    // wp-cli against another site or destructive database commands
    'wp @prod plugin update --all', 'wp @staging db export', 'wp --ssh=me@host plugin list', 'wp plugin list --ssh=me@host', 'wp --ssh=docker:wp plugin list', 'wp --http=https://example.com plugin list', 'wp db reset --yes', 'wp db drop --yes', 'wp db import dump.sql', 'wp db clean --yes', 'wp db repair',
    'sudo -u www-data wp @prod cache flush', 'bash -c "wp @prod core update"', "sh -c 'wp db reset --yes'", 'env WP_CLI_PACKAGES_DIR=x wp @prod plugin list', 'cd site && wp @prod plugin list', 'true;wp db reset', 'echo x|wp db import', '(wp db reset --yes)', 'npx wp-env run cli wp db reset --yes', 'npx @wordpress/env run cli wp db import dump.sql', 'wp-env run cli wp @prod plugin list',
    // remote hosts
    'ssh me@host', 'ssh -p 22 host ls', 'sudo ssh host', 'env X=1 ssh host', 'scp my-plugin.zip me@host:/var/www', 'sftp me@host', 'ftp host', 'lftp -e "mirror -R" host', 'true;ssh host',
    'rsync -av ./ me@host:/var/www/wp-content/plugins/my-plugin/', 'rsync -av --delete src/ host:/var/www/', 'rsync -e ssh -av a/ b', 'rsync -av a/ host::module', 'rsync -av a/ rsync://host/module/', 'sudo rsync -av a/ me@host:/x', 'bash -c "rsync -av a/ me@host:/x"',
  ];
  for (const cmd of bad) assert.ok(blocked(cmd), cmd);
  const ok = [
    'svn status', 'svn st --no-ignore', 'svn update', 'svn up', 'svn checkout https://plugins.svn.wordpress.org/my-plugin', 'svn co https://plugins.svn.wordpress.org/my-plugin svn', 'svn diff', 'svn log -l 5', 'svn info', 'svn add .', 'svn add --force trunk/*', 'svn list https://plugins.svn.wordpress.org/my-plugin', 'svn export trunk /tmp/x', 'svn --version', 'svn copy trunk tags/1.0', 'svn status | grep commit', 'git svn info',
    'cat deploy.sh', 'git add deploy.sh', 'vim deploy.sh', 'shellcheck deploy.sh', 'node --test deploy.test.js', 'cat scripts/release.sh', 'ls bin/', 'npm test', 'npm run test', 'npm install', 'npm run build', 'composer install', 'composer audit', 'composer require monolog/monolog', 'composer run-script test', 'composer deployment-notes', 'npm install deploy-tools', 'make test', 'just check', 'just test', 'just lint', 'just dev',
    'wp plugin list', 'wp db export dump.sql', 'wp db check', 'wp db query "SELECT 1"', 'wp option get siteurl', 'wp user create bob bob@example.com', 'wp-env start', 'npx @wordpress/env@12.0.0 start', 'npx wp-env run cli wp plugin list', 'npx @wordpress/env run cli wp plugin check my-plugin', 'wp-env clean',
    'vendor/bin/phpcs', 'vendor/bin/phpcbf', 'vendor/bin/phpstan analyse', 'vendor/bin/phpunit', 'php -l my-plugin.php', 'rsync -av a/ b/', 'rsync -av a/ ./b:c/', 'docker compose up', 'git add composer.lock readme.txt', 'cat readme.txt',
  ];
  for (const cmd of ok) assert.ok(!blocked(cmd), cmd);
});

test('cloudflare-workers: the gate recipes make no remote call; scaffold dev dependencies are exact versions', () => {
  const just = readFileSync(dir('cloudflare-workers', 'just', 'cloudflare-workers.just'), 'utf8');
  const recipe = (name) => just.match(new RegExp(`^${name}[^\\n]*:[^\\n]*\\n((?:[ \\t]+[^\\n]*\\n?)*)`, 'm'))?.[1] ?? '';
  for (const name of ['setup', 'lint', 'typecheck', 'test', 'audit']) {
    const body = recipe(name);
    assert.ok(body.length > 0, name);
    assert.doesNotMatch(body, /wrangler\s+(deploy|publish|login|secret|pages|kv|r2|d1|tail)|--remote|--dry-run/, name);
  }
  assert.match(just, /^check: lint typecheck test audit sync-check$/m);
  assert.match(just, /^export WRANGLER_SEND_METRICS := "false"$/m);
  assert.match(recipe('dev'), /wrangler dev --local/);
  const pkg = JSON.parse(readFileSync(dir('cloudflare-workers', 'scaffold', 'package.json'), 'utf8'));
  for (const [name, version] of Object.entries(pkg.devDependencies)) assert.match(version, /^\d+\.\d+\.\d+$/, name);
  const ci = readFileSync(dir('cloudflare-workers', 'ci', 'check.yml'), 'utf8');
  assert.doesNotMatch(ci, /secrets\.|CLOUDFLARE_|wrangler/i);
  assert.deepEqual(ci.match(/uses: \S+/g).every((u) => /@[0-9a-f]{40}$/.test(u.slice(6))), true);
});

test('cloudflare-workers: verbs that do not apply print a note and exit 0; deploy refuses without the production guard and in CI', { skip: skipJust }, () => {
  const env = cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH });
  const { cwd } = initExample('cloudflare-workers', env, ['--skip-verify']);
  for (const verb of ['fmt', 'build']) {
    const r = run('just', [verb], { cwd, env });
    assert.equal(r.status, 0, verb);
    assert.match(r.stdout, new RegExp(`^${verb}: not applicable`, 'm'));
  }
  // deploy refuses before it reaches Wrangler (a PATH without npx proves nothing is run)
  const only = tmp('yaw-bin-');
  for (const t of ['sh', 'just']) symlinkSync(execFileSync('which', [t], { encoding: 'utf8' }).trim(), join(only, t));
  const bare = { PATH: only };
  for (const [args, extra] of [[[], {}], [['prod'], {}], [['preview'], { YAW_CONFIRM_PROD: 'yes' }], [['prod'], { YAW_CONFIRM_PROD: 'no' }], [['prod'], { YAW_CONFIRM_PROD: 'yes', CI: 'true' }]]) {
    const r = run('just', ['deploy', ...args], { cwd, env: cleanEnv(tmp('yaw-home-'), { ...bare, ...extra }) });
    assert.notEqual(r.status, 0, `deploy ${args} ${JSON.stringify(extra)}`);
    assert.match(r.stderr, /deploy: refused/);
    assert.doesNotMatch(r.stdout + r.stderr, /wrangler/);
  }
});

test('smoke cloudflare-workers: yaw init, just setup && just check pass without a Cloudflare account; bad code fails the gate (needs npm and network)', { skip: nodeTsSkip, timeout: 300000 }, () => {
  const { cwd, r } = initExample('cloudflare-workers', { ...process.env, CLOUDFLARE_API_TOKEN: '', CLOUDFLARE_ACCOUNT_ID: '' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /3 passed/);
  assert.match(r.stdout, /verified: just setup and just check passed/);

  const fixtures = join(KIT_ROOT, 'test', 'profiles', 'cloudflare-workers');
  const bad = join(cwd, 'src', 'bad.ts');
  copyFileSync(join(fixtures, 'lint_error.ts'), bad);
  assert.notEqual(run('just', ['lint'], { cwd }).status, 0, 'an unused variable fails just lint');
  copyFileSync(join(fixtures, 'type_error.ts'), bad);
  assert.notEqual(run('just', ['typecheck'], { cwd }).status, 0, 'a type error fails just typecheck');
});

test('cloudflare-workers guards block every remote or production Wrangler form, not local work', () => {
  const guards = parse(readFileSync(dir('cloudflare-workers', 'guards.yaml'), 'utf8')).guards.map((g) => new RegExp(g.pattern));
  const blocked = (cmd) => guards.some((re) => re.test(cmd));
  const bad = [
    'wrangler deploy', 'wrangler publish', 'wrangler deploy --dry-run', 'wrangler deploy --env production', 'wrangler --env production deploy', 'wrangler -c wrangler.jsonc deploy', 'wrangler  deploy', 'wrangler\tdeploy', 'wrangler "deploy"', 'wrangler rollback', 'wrangler delete', 'wrangler versions upload', 'wrangler versions deploy', 'wrangler triggers deploy',
    'wrangler secret put API_KEY', 'wrangler secret delete API_KEY', 'wrangler secret bulk .env', 'wrangler secret list', 'wrangler login', 'wrangler whoami', 'wrangler tail', 'wrangler init', 'wrangler pages deploy dist', 'wrangler pages publish dist', 'wrangler pages dev dist',
    'wrangler kv key put a b', 'wrangler kv key get a', 'wrangler kv namespace create X', 'wrangler kv key put a b --remote', 'wrangler r2 object put b/k --file x', 'wrangler r2 bucket create b', 'wrangler r2 object put b/k --file x --remote', 'wrangler d1 execute DB --command "SELECT 1"', 'wrangler d1 execute DB --remote --command "DROP TABLE x"', 'wrangler d1 execute DB --command x --remote', 'wrangler d1 migrations apply DB --remote', 'wrangler d1 migrations apply DB', 'wrangler d1 export DB --remote --output x.sql', 'wrangler d1 execute DB --local --remote', 'wrangler d1 execute DB --local=false',
    'wrangler dev --remote', 'wrangler dev --env production --remote', 'wrangler dev --local --remote', 'wrangler dev --x-remote-bindings', 'wrangler dev -r', 'npx wrangler dev -r', 'wrangler dev --local -r', 'wrangler dev -r --local', 'npx wrangler dev --remote',
    'npx wrangler deploy', 'npx -y wrangler deploy', 'npx --yes wrangler@latest deploy', 'npx wrangler@4.151.3 deploy', 'npx --no-install wrangler deploy', 'npx -p wrangler wrangler deploy', 'npm exec wrangler -- deploy', 'npm exec -- wrangler deploy', 'pnpm dlx wrangler deploy', 'pnpm exec wrangler deploy', 'pnpm wrangler deploy', 'yarn wrangler deploy', 'yarn dlx wrangler deploy', 'bunx wrangler deploy', 'bun x wrangler deploy', 'bun run wrangler deploy', 'bunx wrangler@latest secret put X',
    './node_modules/.bin/wrangler deploy', 'node_modules/.bin/wrangler deploy', 'node node_modules/wrangler/bin/wrangler.js deploy', 'node ./node_modules/wrangler/wrangler-dist/cli.js deploy; wrangler deploy',
    'CLOUDFLARE_API_TOKEN=abc wrangler deploy', 'CI=1 wrangler deploy', 'env CLOUDFLARE_ACCOUNT_ID=x wrangler deploy', 'env -i wrangler deploy', 'FOO=1 BAR=2 npx wrangler deploy', 'sudo wrangler deploy', 'sudo -u me npx wrangler deploy', 'nohup wrangler deploy', 'time wrangler deploy', 'xargs wrangler deploy', 'command wrangler deploy',
    'bash -c "wrangler deploy"', "sh -c 'npx wrangler deploy'", 'bash -c "cd app && wrangler deploy"', 'zsh -c "wrangler secret put X"', 'bash -lc "pnpm dlx wrangler deploy"',
    'cd app && wrangler deploy', 'true;wrangler deploy', 'echo x|wrangler deploy', 'npm test && wrangler deploy', 'wrangler types && wrangler deploy', 'wrangler dev; wrangler deploy', 'wrangler types || wrangler deploy', 'wrangler types\nwrangler deploy', 'wrangler types & wrangler deploy', '(wrangler deploy)', '$(wrangler deploy)', '`wrangler deploy`', 'echo $(npx wrangler secret put X)', 'wrangler types; npm install wrangler; wrangler deploy',
    'npm run deploy', 'npm deploy', 'pnpm run deploy', 'pnpm deploy', 'yarn deploy', 'yarn run deploy', 'bun run deploy', 'npm run publish', 'just deploy', 'just deploy prod', 'YAW_CONFIRM_PROD=yes just deploy prod', 'just --justfile justfile deploy prod', 'YAW_CONFIRM_PROD=yes npx wrangler deploy', 'sudo just deploy prod',
    'ssh me@host', 'scp a me@host:/x', 'sftp me@host',
  ];
  for (const cmd of bad) assert.ok(blocked(cmd), cmd);
  const ok = [
    'wrangler dev', 'wrangler dev --local', 'wrangler dev --port 8788', 'wrangler dev --env staging', 'wrangler types', 'wrangler types --check', 'wrangler check', 'wrangler check startup', 'wrangler docs', 'wrangler --version', 'wrangler -v', 'wrangler --help', 'wrangler -h', 'wrangler',
    'wrangler d1 execute DB --local --command "SELECT 1"', 'wrangler d1 migrations apply DB --local', 'wrangler d1 execute DB --file schema.sql --local', 'wrangler kv key put a b --local', 'wrangler r2 object put b/k --file x --local',
    'npx wrangler dev', 'npx wrangler types', 'npx wrangler check', 'npx wrangler@4.151.3 types', 'npx --no-install wrangler dev --local', 'pnpm exec wrangler types', 'pnpm dlx wrangler types', 'yarn wrangler types', 'bunx wrangler types', './node_modules/.bin/wrangler types', 'npx -y wrangler --version', 'CI=1 npx wrangler types', 'sudo wrangler types', 'bash -c "wrangler types"', 'cd app && wrangler dev', 'wrangler types && tsc --noEmit',
    'npm run build', 'npm run test', 'npm test', 'npm run lint', 'npx tsc --noEmit', 'npx vitest run', 'npx eslint .', 'just check', 'just test', 'just dev', 'just typecheck',
    'cat wrangler.jsonc', 'cat wrangler.toml', 'git add wrangler.jsonc', 'git diff wrangler.jsonc', 'vim wrangler.jsonc', 'ls node_modules/wrangler', 'cat node_modules/wrangler/package.json', 'cat node_modules/wrangler/bin/wrangler.js',
    'npm install -D wrangler@4.151.3', 'npm install wrangler --save-dev', 'npm i -D wrangler --save-exact', 'pnpm add -D wrangler', 'yarn add -D wrangler', 'npm ls wrangler', 'npm view wrangler version', 'npm info wrangler', 'npm update wrangler', 'npm uninstall wrangler',
    'ssh-keygen -l -f key.pub', 'git add package.json',
  ];
  for (const cmd of ok) assert.ok(!blocked(cmd), cmd);
});

test('cloudflare-workers secretFiles: .dev.vars is a secret file, its template is not', async () => {
  const { loadRules, secretRule } = await import('../modules/security/lib/guards.js');
  const rules = loadRules({ kitRoot: KIT_ROOT, profiles: ['cloudflare-workers'] });
  for (const f of ['.dev.vars', '.dev.vars.staging', 'sub/.dev.vars']) assert.ok(secretRule(rules, f), f);
  for (const f of ['.dev.vars.example', 'wrangler.jsonc', 'dev.vars.md']) assert.equal(secretRule(rules, f), null, f);
});

test('android-kotlin: gate recipes need no emulator, device, keystore or store; versions are exact; the wrapper is pinned by checksum', () => {
  const just = readFileSync(dir('android-kotlin', 'just', 'android-kotlin.just'), 'utf8');
  const recipe = (name) => just.match(new RegExp(`^${name}[^\\n]*:[^\\n]*\\n((?:[ \\t]+[^\\n]*\\n?)*)`, 'm'))?.[1] ?? '';
  for (const name of ['setup', 'fmt', 'lint', 'typecheck', 'test', 'build']) {
    const body = recipe(name);
    assert.ok(body.length > 0 || name === 'setup', name);
    assert.doesNotMatch(body, /publish|promote|bundle\w*Release|install\w*Release|assembleRelease|sign|keystore|keytool|fastlane|gcloud|\bbq\b|\badb\b|emulator|connectedAndroidTest|connected\w*Test/i, name);
  }
  assert.match(just, /^check: lint typecheck test sync-check$/m);
  assert.match(recipe('lint'), /ktlintCheck detekt lintDebug/);
  assert.match(recipe('test'), /testDebugUnitTest/);
  assert.match(recipe('build'), /assembleDebug/);
  const toml = readFileSync(dir('android-kotlin', 'scaffold', 'gradle', 'libs.versions.toml'), 'utf8');
  const versions = [...toml.matchAll(/^([\w-]+) = "([^"]*)"$/gm)];
  assert.ok(versions.length >= 8);
  for (const [, name, version] of versions) assert.match(version, /^\d+(\.\d+)+$/, name);
  const props = readFileSync(dir('android-kotlin', 'scaffold', 'gradle', 'wrapper', 'gradle-wrapper.properties'), 'utf8');
  assert.match(props, /^distributionSha256Sum=[0-9a-f]{64}$/m);
  assert.match(props, /^distributionUrl=https\\:\/\/services\.gradle\.org\/distributions\/gradle-\d+\.\d+(\.\d+)?-bin\.zip$/m);
  for (const f of readdirSync(dir('android-kotlin', 'scaffold'), { recursive: true, withFileTypes: true }).filter((e) => e.isFile() && /\.(kts?|xml|toml|properties|yml)$/.test(e.name))) {
    assert.doesNotMatch(readFileSync(join(f.parentPath, f.name), 'utf8'), /signingConfig|storeFile|storePassword|keyPassword|keyAlias|\.jks|\.keystore/, f.name);
  }
  const ci = readFileSync(dir('android-kotlin', 'ci', 'check.yml'), 'utf8').replace(/^\s*#.*$/gm, '');
  assert.doesNotMatch(ci, /secrets\.|keystore|KEYSTORE|signing|play|PLAY|fastlane/i);
  assert.deepEqual(ci.match(/uses: \S+/g).every((u) => /@[0-9a-f]{40}$/.test(u.slice(6))), true);
  assert.match(ci, /sdkmanager|setup-android/);
  assert.match(ci, /actions\/cache@/);
});

test('android-kotlin: verbs that do not apply print a note and exit 0', { skip: skipJust }, () => {
  const env = cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH });
  const { cwd } = initExample('android-kotlin', env, ['--skip-verify']);
  for (const verb of ['audit']) {
    const r = run('just', [verb], { cwd, env });
    assert.equal(r.status, 0, verb);
    assert.match(r.stdout, new RegExp(`^${verb}: not applicable`, 'm'));
  }
  assert.notEqual(run('just', ['deploy', 'prod'], { cwd, env }).status, 0, 'deploy is not defined');
});

test('android-kotlin: a symlinked or missing Gradle wrapper is refused before anything runs', { skip: skipJust }, () => {
  const env = cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH });
  const { cwd } = initExample('android-kotlin', env, ['--skip-verify']);
  // a fake gradlew would leave a marker if it ran
  const elsewhere = tmp('yaw-elsewhere-');
  writeFileSync(join(elsewhere, 'gradlew'), `#!/bin/sh\ntouch '${join(elsewhere, 'ran')}'\n`, { mode: 0o755 });
  for (const [rel, target] of [['gradlew', join(elsewhere, 'gradlew')], ['gradle/wrapper/gradle-wrapper.jar', join(elsewhere, 'gradlew')], ['gradle/wrapper/gradle-wrapper.properties', join(elsewhere, 'gradlew')]]) {
    const file = join(cwd, rel);
    const saved = readFileSync(file);
    unlinkSync(file);
    symlinkSync(target, file);
    for (const verb of ['setup', 'lint', 'test', 'build']) {
      const r = run('just', [verb], { cwd, env });
      assert.notEqual(r.status, 0, `${verb} with a symlinked ${rel}`);
      assert.match(r.stderr, /missing or a symbolic link/, rel);
    }
    unlinkSync(file);
    writeFileSync(file, saved);
  }
  assert.equal(existsSync(join(elsewhere, 'ran')), false, 'the linked script never ran');
  // a symlinked folder
  const folder = join(cwd, 'gradle');
  const moved = join(elsewhere, 'gradle');
  execFileSync('mv', [folder, moved]);
  symlinkSync(moved, folder);
  const r = run('just', ['lint'], { cwd, env });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /gradle: missing or a symbolic link/);
  unlinkSync(folder);
  execFileSync('mv', [moved, folder]);
  unlinkSync(join(cwd, 'gradlew'));
  assert.match(run('just', ['test'], { cwd, env }).stderr, /gradlew: missing or a symbolic link/);
});

const androidSdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
const androidSkip = (!haveJust && 'just is not installed') || (!hasTool('java') && 'java is not installed') || (!(androidSdk && existsSync(androidSdk)) && 'ANDROID_HOME (the Android SDK) is not set') || (process.env.YAW_TEST_OFFLINE && 'YAW_TEST_OFFLINE is set (Gradle needs the network)');

test('smoke android-kotlin: yaw init, just setup && just check pass without a keystore or store account; bad code fails the gate (needs JDK 17+, the Android SDK and network)', { skip: androidSkip, timeout: 900000 }, () => {
  const { cwd, r } = initExample('android-kotlin', { ...process.env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /BUILD SUCCESSFUL/);
  assert.match(r.stdout, /verified: just setup and just check passed/);
  assert.ok(existsSync(join(cwd, 'app', 'build', 'test-results', 'testDebugUnitTest')), 'the unit tests ran');

  const fixtures = join(KIT_ROOT, 'test', 'profiles', 'android-kotlin');
  const bad = join(cwd, 'app', 'src', 'main', 'kotlin', 'com', 'example', 'app', 'Bad.kt');
  copyFileSync(join(fixtures, 'lint_error.kt'), bad);
  assert.notEqual(run('just', ['lint'], { cwd }).status, 0, 'a style violation fails just lint');
  copyFileSync(join(fixtures, 'type_error.kt'), bad);
  assert.notEqual(run('just', ['typecheck'], { cwd }).status, 0, 'a type error fails just typecheck');
});

test('android-kotlin guards block publishing, signing, Fastlane, Google Cloud and release installs in every bypass form, not local work', () => {
  const guards = parse(readFileSync(dir('android-kotlin', 'guards.yaml'), 'utf8')).guards.map((g) => new RegExp(g.pattern));
  const blocked = (cmd) => guards.some((re) => re.test(cmd));
  const bad = [
    './gradlew publish', './gradlew publishToMavenLocal', './gradlew publishReleasePublication', './gradlew :app:publishReleaseBundle', './gradlew app:publishRelease', './gradlew :lib:publishAllPublicationsToMavenRepository', './gradlew test publish', './gradlew --no-daemon publish', './gradlew -p app publish', './gradlew promoteReleaseArtifact', './gradlew publish --info', './gradlew "publish"', "./gradlew 'publishToSonatype'",
    'gradlew publish', 'gradle publish', 'gradlew.bat publish', '../gradlew publish', '/abs/path/gradlew publish', 'sh gradlew publish', 'bash ./gradlew publish', 'sh ./gradlew :app:publishReleaseBundle', 'sudo ./gradlew publish', 'env ./gradlew publish', 'JAVA_HOME=/x ./gradlew publish', 'FOO=1 BAR=2 ./gradlew publish', 'nohup ./gradlew publish', 'time ./gradlew publish', 'xargs ./gradlew publish', 'command ./gradlew publish',
    'bash -c "./gradlew publish"', "sh -c './gradlew publish'", 'bash -c "cd app && ./gradlew publish"', 'bash -lc "./gradlew bundleRelease"', 'cd app && ./gradlew publish', 'true;./gradlew publish', 'echo x|./gradlew publish', './gradlew test && ./gradlew publish', './gradlew test; ./gradlew publish', './gradlew assembleDebug || ./gradlew publish', '(./gradlew publish)', '$(./gradlew publish)', '`./gradlew publish`', './gradlew test\n./gradlew publish', './gradlew test & ./gradlew publish',
    './gradlew BundleRelease', './gradlew -p app BUNDLERELEASE', './gradlew PublishRelease', './gradlew PUBLISH', './gradlew InstallRelease', './gradlew SigningReport', './gradlew publish>log', './gradlew bundleRelease>x', './gradlew publish<in', './gradlew bundle>x', './gradlew bundleRelease', './gradlew bundle', './gradlew :app:bundle', './gradlew :app:bundleRelease', './gradlew bundleStagingRelease', './gradlew app:bundleProdRelease', './gradlew clean bundleRelease', './gradlew bundleRelease -Pandroid.injected.signing.store.file=/x/release.jks', './gradlew assembleRelease -Pandroid.injected.signing.store.file=/x/release.jks', './gradlew assembleRelease -Pandroid.injected.signing.key.alias=k', './gradlew assembleRelease -PkeystorePassword=x', './gradlew assembleRelease -PstoreFile=/x', './gradlew assembleRelease -Pkeystore=/x/release.jks', './gradlew assembleRelease -PkeyAlias=a -PkeyPassword=b',
    './gradlew signingReport', './gradlew :app:signReleaseBundle', './gradlew signRelease', './gradlew installRelease', './gradlew :app:installRelease', './gradlew installStagingRelease', 'sh gradlew installRelease', 'bash -c "gradle bundleRelease"',
    'apksigner sign --ks release.jks app.apk', 'apksigner verify app.apk', '$ANDROID_HOME/build-tools/36.0.0/apksigner sign app.apk', '~/Library/Android/sdk/build-tools/36.0.0/apksigner sign --ks k.jks app.apk', 'java -jar apksigner.jar sign app.apk', 'sudo apksigner sign x.apk', 'env X=1 apksigner sign x.apk', 'bash -c "apksigner sign x.apk"', 'cd out && apksigner sign x.apk', 'true;apksigner sign x',
    'jarsigner -keystore release.jks app.aab alias', 'jarsigner -verify app.aab', '/usr/bin/jarsigner -keystore k.jks a.jar k', 'sudo jarsigner a.jar k', 'bash -c "jarsigner a.aab k"', 'cd out && jarsigner x',
    'keytool -genkey -v -keystore release.jks -alias upload', 'keytool -genkeypair -keystore release.jks', 'keytool -list -keystore release.jks', 'keytool -importkeystore -srckeystore a.jks -destkeystore b.jks', 'keytool -storepasswd -keystore release.jks', 'keytool -exportcert -keystore release.jks -alias upload', 'keytool -keystore release.jks -list', '/usr/bin/keytool -genkey -keystore x.jks', 'sudo keytool -genkey -keystore x', 'keytool -delete -alias upload -keystore release.jks', 'bash -c "keytool -genkey -keystore x.jks"', 'cd keys && keytool -genkeypair', '$JAVA_HOME/bin/keytool -genkey -keystore x.jks',
    'fastlane supply --aab app.aab', 'fastlane deliver', 'fastlane supply', 'fastlane upload_to_play_store', 'fastlane android deploy', 'fastlane android beta', 'fastlane beta', 'fastlane release', 'fastlane', 'bundle exec fastlane supply', 'bundle exec fastlane android deploy', 'bundle exec fastlane', 'bundle exec fastlane lanes', 'bundler exec fastlane beta', 'sudo fastlane beta', 'FASTLANE_SKIP_UPDATE_CHECK=1 fastlane beta', 'env X=1 fastlane beta', 'nohup fastlane beta', 'time bundle exec fastlane beta', './bin/fastlane beta', '~/.rbenv/shims/fastlane beta', 'rbenv exec fastlane beta', 'gem exec fastlane beta',
    'supply --aab app.aab', 'deliver', 'sudo supply --track production', 'cd app && supply --aab x', 'true;deliver', 'bash -c "fastlane beta"', "sh -c 'fastlane supply'", 'bash -lc "bundle exec fastlane x"', 'cd android && fastlane beta', 'true && fastlane beta', '(fastlane beta)', '$(fastlane beta)', 'echo x | fastlane beta', 'fastlane --verbose beta',
    'gcloud auth login', 'gcloud app deploy', 'gcloud storage cp a gs://b', 'gcloud firebase test android run', 'gcloud config list', 'sudo gcloud auth login', 'env X=1 gcloud projects list', 'bash -c "gcloud projects list"', 'cd x && gcloud auth login', 'true;gcloud auth login', '/usr/local/bin/gcloud auth login', '$HOME/google-cloud-sdk/bin/gcloud app deploy', 'gcloud   auth login',
    'bq query "SELECT 1"', 'bq ls', 'bq load ds.t file.csv', 'sudo bq ls', 'bash -c "bq ls"', 'cd x && bq ls', 'true;bq ls', 'gcloud --project p auth login', 'bq --project_id=p ls',
    'adb install app-release.apk', 'adb install -r app/build/outputs/apk/release/app-release.apk', 'adb -s emulator-5554 install app-release.apk', 'adb -s R5 install -r -d app/build/outputs/apk/release/app-release-unsigned.apk', 'adb install-multiple base-release.apk split-release.apk', 'adb -d install app-prodRelease.apk', 'adb install out/Release/app.apk', 'adb install-multi-package a-release.apk b-release.apk', 'sudo adb install app-release.apk', 'env ANDROID_SERIAL=x adb install app-release.apk', 'cd out && adb install app-release.apk', 'bash -c "adb install app-release.apk"', '$ANDROID_HOME/platform-tools/adb install app-release.apk', 'true;adb install app-release.apk', 'adb  install app-release.aab',
  ];
  for (const cmd of bad) assert.ok(blocked(cmd), cmd);
  const ok = [
    './gradlew test', './gradlew lint', './gradlew assembleDebug', './gradlew testDebugUnitTest', './gradlew lintDebug', './gradlew ktlintCheck detekt lintDebug', './gradlew ktlintFormat', './gradlew compileDebugKotlin', './gradlew installDebug', './gradlew clean', './gradlew build', './gradlew check', './gradlew tasks', './gradlew tasks --all', './gradlew dependencies', './gradlew :app:testDebugUnitTest', './gradlew --version', './gradlew --stop', './gradlew bundleDebug', './gradlew :app:bundleDebug', './gradlew assembleRelease', './gradlew :app:assembleRelease', './gradlew wrapper --gradle-version 9.8.2', './gradlew test --tests "com.example.*"', './gradlew -p app test', './gradlew --no-daemon test',
    'gradlew test', 'gradle test', 'sh gradlew assembleDebug', 'bash ./gradlew test', 'sudo ./gradlew test', 'JAVA_HOME=/x ./gradlew lint', 'bash -c "./gradlew test"', 'cd app && ./gradlew test', 'just check', 'just test', 'just build', 'just dev', 'just lint',
    'cat gradle.properties', 'cat gradle/libs.versions.toml', 'git add gradle/wrapper/gradle-wrapper.jar', 'ls gradle', 'cat app/build.gradle.kts', 'grep -rn publish app/src', 'echo publish', 'cat gradlew', 'git diff gradlew', 'vim build.gradle.kts', 'cat app/src/main/AndroidManifest.xml',
    'ls build-tools/36.0.0', 'cat apksigner.md', 'git add docs/jarsigner.md', 'ls build-tools/36.0.0/apksigner.md',
    'keytool -help', 'keytool -printcert -file x.crt', 'keytool -version', 'keytool', 'cat keytool.md',
    'fastlane --version', 'fastlane -v', 'fastlane --help', 'fastlane lanes', 'fastlane actions', 'fastlane action supply', 'fastlane env', 'cat fastlane/Fastfile', 'ls fastlane', 'git add fastlane/Fastfile', 'cd fastlane && ls', 'git commit -m "supply chain notes"', 'git commit -m "deliver the feature"', 'echo "fastlane beta"', 'echo deliver', 'grep -rn supply app', 'vim fastlane/Appfile', 'cat Gemfile', 'bundle install', 'bundle exec rake test', 'bundle exec rubocop',
    'gcloud --version', 'gcloud --help', 'gcloud help', 'gcloud version', 'gcloud', 'cat .gcloudignore', 'git add .gcloudignore', 'echo bq', 'ls bq', 'cat docs/gcloud.md', 'npm test',
    'adb install app-debug.apk', 'adb install -r app/build/outputs/apk/debug/app-debug.apk', 'adb -s emulator-5554 install -r app-debug.apk', 'adb devices', 'adb logcat', 'adb shell screencap -p /sdcard/s.png', 'adb pull /sdcard/s.png', 'adb exec-out screencap -p > s.png', 'adb uninstall com.example.app', 'adb push release-notes.txt /sdcard/', 'adb shell am start -n com.example.app/.MainActivity', 'adb --version', 'cat release-notes.md', 'git add app-release-notes.md', 'adb install app.apk',
  ];
  for (const cmd of ok) assert.ok(!blocked(cmd), cmd);
});

test('android-kotlin secretFiles: keystores and keystore.properties are secret files, other files are not', async () => {
  const { loadRules, secretRule } = await import('../modules/security/lib/guards.js');
  const rules = loadRules({ kitRoot: KIT_ROOT, profiles: ['android-kotlin'] });
  for (const f of ['release.jks', 'app/upload.keystore', 'debug.keystore', 'keys/my-key.jks', 'keystore.properties', 'app/keystore.properties']) assert.ok(secretRule(rules, f), f);
  for (const f of ['build.gradle.kts', 'gradle.properties', 'local.properties', 'keystore.properties.md', 'jks.md', 'app/src/main/AndroidManifest.xml', 'docs/keystore.md']) assert.equal(secretRule(rules, f), null, f);
});

test('every tailored profile is picked for exactly its language and host (ADR-0054)', () => {
  const profiles = listProfiles(KIT_ROOT);
  const pick = (language, runsOn) => profileForStack(profiles, language, runsOn)?.name ?? null;
  for (const [language, runsOn, name] of [
    ['typescript', 'local', 'node-cli'], ['typescript', 'serverless', 'node-ts-vercel'], ['typescript', 'self-hosted', 'node-web'], ['typescript', 'edge', 'cloudflare-workers'], ['typescript', 'app-store', 'node-app'], ['typescript', 'static', 'node-static'],
    ['python', 'local', 'python-cli'], ['python', 'self-hosted', 'python-web'], ['python', 'serverless', 'python-vercel'], ['php', 'self-hosted', 'php-web'], ['php', 'local', 'php-cli'], ['php', 'serverless', 'php-serverless'], ['swift', 'local', 'swift-cli'], ['rust', 'local', 'rust-cli'], ['go', 'local', 'go-cli'], ['go', 'self-hosted', 'go-web'], ['go', 'serverless', 'go-serverless'], ['rust', 'self-hosted', 'rust-web'], ['rust', 'serverless', 'rust-serverless'], ['kotlin', 'local', 'kotlin-cli'], ['java', 'local', 'java-cli'], ['java', 'self-hosted', 'java-web'], ['java', 'serverless', 'java-serverless'], ['kotlin', 'self-hosted', 'kotlin-web'], ['kotlin', 'serverless', 'kotlin-serverless'], ['swift', 'self-hosted', 'swift-web'], ['swift', 'app-store', 'swift-app'],
    ['html', 'static', 'static-site'], ['html', 'browser-extension', 'browser-extension'], ['kotlin', 'app-store', 'android-kotlin'], ['php', 'wordpress', 'wordpress-plugin'],
  ]) assert.equal(pick(language, runsOn), name, `${language} on ${runsOn}`);
  for (const p of profiles.filter((x) => !x.stack.basic)) assert.ok(p.stack.language.length && p.stack.runsOn.length, p.name);
});

test('profile tools: filtered by option, platform install command, only failing checks printed', () => {
  const php = loadProfile(KIT_ROOT, 'php-serverless');
  assert.deepEqual(profileTools(php, {}, 'darwin').map((t) => t.name), []);
  const bref = profileTools(php, { 'arch.php-serverless-hosting': 'bref' }, 'darwin');
  assert.deepEqual(bref.map((t) => [t.name, t.install]), [['aws', 'brew install awscli'], ['sam', 'brew install aws-sam-cli']]);
  assert.match(profileTools(php, { 'arch.php-serverless-hosting': 'bref' }, 'linux')[0].install, /awscli/);
  assert.equal(profileTools(php, null).length, 2);
  assert.deepEqual(profileTools(loadProfile(KIT_ROOT, 'go-serverless'), { 'arch.go-serverless-hosting': 'lambda' }).map((t) => t.name), ['aws']);
  assert.deepEqual(profileTools(loadProfile(KIT_ROOT, 'go-serverless'), {}), []);
  assert.deepEqual(profileTools(loadProfile(KIT_ROOT, 'rust-serverless'), { 'arch.rust-serverless-hosting': 'lambda' }).map((t) => t.name), ['cargo-lambda']);
  const tauri = loadProfile(KIT_ROOT, 'node-app');
  assert.deepEqual(profileTools(tauri, { 'arch.node-app-framework': 'tauri' }).map((t) => t.name), ['rustc']);
  assert.deepEqual(profileTools(tauri, {}), []);
  let out = '';
  printProfileTools({ write: (x) => { out += x; } }, [{ name: 'ok', check: 'true', install: 'i1' }, { name: 'gone', check: 'false', install: 'brew install gone' }]);
  assert.match(out, /gone: brew install gone/);
  assert.doesNotMatch(out, /ok:/);
});
