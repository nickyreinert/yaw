// Profiles python-cli (Y-3.4), node-cli (Y-3.5) and static-site (Y-6.1) and python-web (Y-6.2): parts, uniform verbs, and the smoke test per
// examples/<profile>/ (init in a temp dir, then just setup && just check).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse, parseDocument } from '../core/lib/yaml.js';
import { formatError } from '../core/lib/schema.js';
import { listProfiles, loadProfile, schemas } from '../core/render/kit.js';
import { suggestProfiles } from '../core/interview/suggest.js';
import { KIT_ROOT, cleanEnv, hasTool, run, tmp } from './helpers/fixtures.js';

const PROFILES = ['node-cli', 'node-ts-vercel', 'php-web', 'python-cli', 'python-web', 'static-site'];
const YAW = join(KIT_ROOT, 'bin', 'yaw');
const VERBS = ['setup', 'dev', 'fmt', 'lint', 'typecheck', 'test', 'check', 'build', 'screenshot', 'preview', 'preview-share', 'audit', 'db-migrate', 'db-reset', 'backup', 'restore', 'deploy'];
const NOT_APPLICABLE = ['screenshot', 'preview', 'preview-share', 'db-migrate', 'db-reset', 'backup', 'restore'];
const haveJust = hasTool('just');
const skipJust = !haveJust && 'just is not installed';
const dir = (p, ...rest) => join(KIT_ROOT, 'profiles', p, ...rest);

test('the kit has exactly the profiles node-cli, node-ts-vercel, php-web, python-cli, python-web and static-site, and profile.yaml validates', () => {
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

test('python-web is suggested only for a Python project (python-cli wins when local), never for other languages or unknown ones; python-cli keeps its suggestion', () => {
  const profiles = listProfiles(KIT_ROOT);
  const names = (facts) => suggestProfiles(profiles, facts).candidates.map((c) => c.name);
  for (const facts of [{ runsOn: 'serverless', hosted: true }, { language: 'javascript', runsOn: 'self-hosted', hosted: true }, { public: true }, { runsOn: 'edge', hosted: true }, { language: 'javascript', runsOn: 'local', hosted: false }]) {
    assert.ok(!names(facts).includes('python-web'), JSON.stringify(facts));
  }
  assert.equal(suggestProfiles(profiles, { language: 'python', runsOn: 'self-hosted', hosted: true }).suggestion, 'python-web');
  assert.equal(suggestProfiles(profiles, { language: 'python', runsOn: 'local', hosted: false }).suggestion, 'python-cli');
});

test('python-web: verbs that do not apply print a note and exit 0', { skip: skipJust }, () => {
  const env = cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH });
  const { cwd } = initExample('python-web', env, ['--skip-verify']);
  for (const verb of [...NOT_APPLICABLE, 'backup']) {
    const r = run('just', [verb], { cwd, env });
    assert.equal(r.status, 0, verb);
    assert.match(r.stdout, new RegExp(`^${verb}: not applicable`, 'm'));
  }
  const deploy = run('just', ['deploy', 'prod'], { cwd, env });
  assert.equal(deploy.status, 0);
  assert.match(deploy.stdout, /deploy: not applicable/);
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

test('node-ts-vercel is never suggested automatically (the user picks it); node-cli keeps its suggestion', () => {
  const profiles = listProfiles(KIT_ROOT);
  for (const facts of [{}, { runsOn: 'serverless', hosted: true }, { language: 'typescript' }, { language: 'typescript', runsOn: 'serverless', hosted: true }, { language: 'typescript', runsOn: 'self-hosted', hosted: true }, { public: true }]) {
    assert.ok(!suggestProfiles(profiles, facts).candidates.some((c) => c.name === 'node-ts-vercel'), JSON.stringify(facts));
  }
  assert.equal(suggestProfiles(profiles, { language: 'typescript', runsOn: 'local', hosted: false }).suggestion, 'node-cli');
});

test('node-ts-vercel: verbs that do not apply print a note and exit 0; deploy refuses without the production guard and in CI', { skip: skipJust }, () => {
  const env = cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH });
  const { cwd } = initExample('node-ts-vercel', env, ['--skip-verify']);
  for (const verb of [...NOT_APPLICABLE, 'dev', 'fmt', 'build']) {
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

test('php-web is never suggested automatically (the user picks it)', () => {
  const profiles = listProfiles(KIT_ROOT);
  for (const facts of [{}, { runsOn: 'self-hosted', hosted: true }, { language: 'python' }, { runsOn: 'self-hosted', hosted: true, public: true }, { runsOn: 'local', hosted: false }]) {
    assert.ok(!suggestProfiles(profiles, facts).candidates.some((c) => c.name === 'php-web'), JSON.stringify(facts));
  }
});

test('php-web: verbs that do not apply print a note and exit 0; deploy only prints a note', { skip: skipJust }, () => {
  const env = cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH });
  const { cwd } = initExample('php-web', env, ['--skip-verify']);
  for (const verb of [...NOT_APPLICABLE, 'build', 'deploy']) {
    const r = run('just', verb === 'deploy' ? [verb, 'prod'] : [verb], { cwd, env });
    assert.equal(r.status, 0, verb);
    assert.match(r.stdout, new RegExp(`^${verb}: not applicable`, 'm'));
  }
});

const phpSkip = (!haveJust && 'just is not installed') || (!hasTool('php') && 'php is not installed') || (!hasTool('composer') && 'composer is not installed') || (process.env.YAW_TEST_OFFLINE && 'YAW_TEST_OFFLINE is set (composer install needs the network)');

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
