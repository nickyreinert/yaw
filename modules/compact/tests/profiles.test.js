// compact L1 for every profile (T-051, kickoff/16-compact-output.md §4 L1): a warning pattern and the quieter
// reporter flags per profile (`pytest -q`, `cargo test -q`, ...), and a smoke test per toolchain that runs the
// profile's own wrapped recipe line on a passing and a failing project: the compact output is shorter than
// what the recipe printed before, the exit code is kept. A toolchain that is not installed skips with the reason.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compactJust, listProfiles, loadProfile } from '../../../core/render/kit.js';
import { KIT_ROOT, hasTool, tmp, writeTree } from '../../../test/helpers/fixtures.js';

const NODE = process.execPath;
// `go --version` is an error; Go answers `go version`.
const haveGo = (() => { const r = spawnSync('go', ['version']); return !r.error && r.status === 0; })();
const offline = process.env.YAW_TEST_OFFLINE && 'YAW_TEST_OFFLINE is set (the tool is installed from the network)';
const CHECKS = ['lint', 'typecheck', 'test', 'build', 'audit'];
const justSource = (profile) => readFileSync(join(KIT_ROOT, 'profiles', profile, 'just', `${profile}.just`), 'utf8');

// The body lines (without the indent) of `recipe` in a just file.
function recipeLines(text, recipe) {
  const rows = text.split('\n');
  const out = [];
  for (const l of rows.slice(rows.findIndex((r) => r.startsWith(`${recipe}:`)) + 1)) {
    if (!l.startsWith('    ')) break;
    out.push(l.slice(4));
  }
  return out;
}

// Sample lines per toolchain: a warning the profile pattern has to find, and lines it has to leave alone.
const NOT_INSTALLED = 'lint: staticcheck is not installed; optional check skipped';
const FAMILIES = {
  node: {
    profiles: ['browser-extension', 'cloudflare-workers', 'node-app', 'node-static', 'node-ts-vercel', 'node-web', 'static-site'],
    warn: ['npm warn deprecated glob@7.2.3: no longer supported', '  3:5  warning  \'x\' is assigned a value but never used  no-unused-vars', '  1:1  ⚠  Unexpected empty source  no-empty-source'],
    quiet: { 'cloudflare-workers': { test: /npx vitest run --reporter=dot$/ }, 'node-app': { test: /npx vitest run --reporter=dot$/ }, 'node-static': { test: /npx vitest run --reporter=dot$/ }, 'node-ts-vercel': { test: /npx vitest run --reporter=dot$/ }, 'node-web': { test: /npx vitest run --reporter=dot$/ } },
  },
  python: {
    profiles: ['python-basic', 'python-cli', 'python-vercel', 'python-web'],
    warn: ['tests/test_main.py:5: DeprecationWarning: old api', 'warning: `VIRTUAL_ENV=.venv` does not match the project environment', '  src/app/main.py:3:5 - warning: Import "os" is not accessed'],
    quiet: Object.fromEntries(['python-basic', 'python-cli', 'python-vercel', 'python-web'].map((p) => [p, { test: /uv run pytest -q$/ }])),
  },
  rust: {
    profiles: ['rust-basic', 'rust-cli', 'rust-serverless', 'rust-web'],
    warn: ['warning: unused variable: `x`', 'warning: unused import: `std::fmt`'],
    ok: ['warning: `app` (lib) generated 1 warning', 'warning: `app` (bin "app") generated 2 warnings'],
    quiet: Object.fromEntries(['rust-basic', 'rust-cli', 'rust-serverless', 'rust-web'].map((p) => [p, { lint: /cargo clippy -q --all-targets/, typecheck: /cargo check -q --all-targets/, test: /cargo test -q$/, build: /cargo build -q/ }])),
  },
  go: {
    profiles: ['go-basic', 'go-cli', 'go-serverless', 'go-web'],
    warn: ['go: warning: "./..." matched no packages', NOT_INSTALLED],
    quiet: {},
  },
  php: {
    profiles: ['php-cli', 'php-serverless', 'php-web', 'wordpress-plugin'],
    warn: ['PHP Deprecated:  Return type of Foo::bar() should be compatible', 'Warning: Undefined variable $x in /app/src/Cli.php on line 3', 'OK, but there were issues!', 'WARNINGS!', ' 12 | WARNING | Line exceeds 120 characters; contains 130 characters'],
    quiet: Object.fromEntries(['php-cli', 'php-serverless', 'php-web', 'wordpress-plugin'].map((p) => [p, { test: /vendor\/bin\/phpunit --no-progress$/ }])),
  },
  gradle: {
    profiles: ['android-kotlin', 'java-basic', 'java-cli', 'java-serverless', 'java-web', 'kotlin-cli', 'kotlin-serverless', 'kotlin-web'],
    warn: ['w: file:///src/Main.kt:3:5 Parameter \'x\' is never used', 'src/Main.java:3: warning: [deprecation] foo() in Bar has been deprecated', 'Deprecated Gradle features were used in this build, making it incompatible with Gradle 10.0.'],
    quiet: {},
  },
  swift: {
    profiles: ['swift-app', 'swift-cli', 'swift-web'],
    warn: ["/src/main.swift:3:5: warning: variable 'x' was never mutated; consider changing to 'let'"],
    quiet: {},
  },
};
// Lines no pattern may take for a warning.
const PLAIN = ['ok  \tapp\t0.002s', '1 passed in 0.01s', 'All checks passed!', 'BUILD SUCCESSFUL in 2s', 'Build complete! (1.2s)', 'Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.5s', 'OK (1 test, 1 assertion)', '  Tests  2 passed (2)', 'audit: no dependencies, nothing to audit'];

const FAMILY_OF = Object.fromEntries(Object.entries(FAMILIES).flatMap(([name, f]) => f.profiles.map((p) => [p, name])));

test('every profile has a compact warning pattern and the family test covers it', () => {
  const profiles = listProfiles(KIT_ROOT).map((p) => p.name).filter((p) => p !== 'node-cli');
  assert.deepEqual(Object.keys(FAMILY_OF).sort(), profiles, 'a profile is missing from (or extra in) FAMILIES');
  assert.ok(loadProfile(KIT_ROOT, 'node-cli').compact.warnings);
});

for (const [name, family] of Object.entries(FAMILIES)) {
  for (const profile of family.profiles) {
    test(`${profile}: the warning pattern finds ${name} warnings and leaves normal output alone`, () => {
      const { warnings } = loadProfile(KIT_ROOT, profile).compact ?? {};
      assert.ok(warnings, `${profile}/profile.yaml has no compact.warnings`);
      const pattern = new RegExp(warnings);
      for (const line of family.warn) assert.match(line, pattern);
      for (const line of [...PLAIN, ...(family.ok ?? [])]) assert.doesNotMatch(line, pattern);
    });

    test(`${profile}: the check recipes run through the wrapper with the pattern; the quiet flags are in the recipe`, () => {
      const source = justSource(profile);
      const wrapped = compactJust(source, loadProfile(KIT_ROOT, profile).compact);
      for (const verb of CHECKS) {
        for (const line of recipeLines(wrapped, verb)) {
          if (/^@?echo\b/.test(line)) continue;
          assert.match(line, new RegExp(`yaw run --compact --step ${verb} --warn "\\$w"`), `${verb}: ${line}`);
        }
      }
      for (const [verb, flag] of Object.entries(family.quiet[profile] ?? {})) {
        assert.ok(recipeLines(source, verb).some((l) => flag.test(l)), `${profile} ${verb} has no ${flag}`);
      }
      if (name === 'gradle') {
        for (const verb of ['lint', 'typecheck', 'test', 'build']) {
          for (const line of recipeLines(source, verb).filter((l) => l.includes('./gradlew'))) assert.match(line, /\.\/gradlew --console=plain /, `${verb}: ${line}`);
        }
      }
    });
  }
}

// ---- Smoke: the profile's own wrapped recipe line on a passing and a failing project -------------------------------

// A `yaw` on the PATH that runs this working tree, the way `just` finds the installed one.
function yawPath() {
  const bin = tmp('yaw-bin-');
  const shim = join(bin, 'yaw');
  writeFileSync(shim, `#!/bin/sh\nexec '${NODE}' '${join(KIT_ROOT, 'bin', 'yaw')}' "$@"\n`, { mode: 0o755 });
  return `${bin}:${process.env.PATH}`;
}

// What the recipe printed before this task (`before`, run as it was), what it prints now with compact off (raw) and
// with compact on, for the last body line of `recipe` in `profile`.
function sizes({ profile, recipe, before, cwd }) {
  const wrapped = recipeLines(compactJust(justSource(profile), loadProfile(KIT_ROOT, profile).compact), recipe).at(-1).replace(/^@/, '');
  const env = { ...process.env, PATH: yawPath(), YAW_HOME: tmp('yaw-home-') };
  const go = (line, extra) => {
    const r = spawnSync('sh', ['-cu', line], { cwd, env: { ...env, ...extra }, encoding: 'utf8' });
    return { status: r.status, text: r.stdout + r.stderr, size: Buffer.byteLength(r.stdout + r.stderr) };
  };
  return { loud: go(before, {}), raw: go(wrapped, { YAW_COMPACT: '0' }), compact: go(wrapped, { YAW_COMPACT: '1' }) };
}

// Passing run: shorter than before, exit 0. Failing run: shorter than before, same non-zero exit code as the raw run.
function verify({ profile, recipe, before, pass, fail }) {
  const ok = sizes({ profile, recipe, before, cwd: pass });
  assert.equal(ok.loud.status, 0, ok.loud.text);
  assert.equal(ok.compact.status, 0, ok.compact.text);
  assert.ok(ok.compact.size < ok.loud.size, `pass: compact ${ok.compact.size} bytes, before ${ok.loud.size}`);
  assert.ok(ok.compact.size <= ok.raw.size, `pass: compact ${ok.compact.size} bytes, raw ${ok.raw.size}`);
  assert.match(ok.compact.text, new RegExp(`^ok ${recipe} \\(\\d+ lines, \\d+\\.\\ds\\)\\n$|^${recipe}: \\d+ warnings\\n`));
  const bad = sizes({ profile, recipe, before, cwd: fail });
  assert.notEqual(bad.loud.status, 0, bad.loud.text);
  assert.equal(bad.raw.status, bad.loud.status);
  assert.equal(bad.compact.status, bad.raw.status, bad.compact.text);
  assert.ok(bad.compact.size < bad.loud.size, `fail: compact ${bad.compact.size} bytes, before ${bad.loud.size}`);
  assert.ok(bad.compact.size <= bad.raw.size, `fail: compact ${bad.compact.size} bytes, raw ${bad.raw.size}`);
  return { ok, bad };
}

// A copy of a profile's scaffold with extra files.
function project(profile, files = {}) {
  const dir = tmp('yaw-compact-smoke-');
  cpSync(join(KIT_ROOT, 'profiles', profile, 'scaffold'), dir, { recursive: true });
  writeTree(dir, files);
  return dir;
}
const repeat = (line, n = 30) => Array.from({ length: n }, () => line);

test('smoke python profiles: uv run pytest -q through the wrapper (needs uv and network)', { skip: (!hasTool('uv') && 'uv is not installed') || offline, timeout: 300000 }, () => {
  const pass = project('python-cli', { 'tests/test_more.py': 'def test_a():\n    assert True\n\n\ndef test_b():\n    assert True\n' });
  const fail = project('python-cli', { 'tests/test_fail.py': `def test_flaky():\n${repeat('    print("retrying connection")').join('\n')}\n    assert False\n` });
  const warn = project('python-cli', { 'tests/test_warn.py': 'import warnings\n\n\ndef test_old():\n    warnings.warn("old api", DeprecationWarning)\n' });
  for (const profile of FAMILIES.python.profiles) verify({ profile, recipe: 'test', before: 'uv run pytest', pass, fail });
  const r = sizes({ profile: 'python-cli', recipe: 'test', before: 'uv run pytest', cwd: warn });
  assert.match(r.compact.text, /^test: \d+ warnings\n/);
  assert.match(r.compact.text, /DeprecationWarning: old api/);
  assert.ok(r.compact.size < r.loud.size);
});

test('smoke rust profiles: cargo test -q through the wrapper (needs cargo)', { skip: !hasTool('cargo') && 'cargo is not installed', timeout: 600000 }, () => {
  const pass = project('rust-cli');
  const fail = project('rust-cli', { 'tests/fail.rs': `#[test]\nfn flaky() {\n    for _ in 0..30 {\n        println!("retrying connection");\n    }\n    panic!("boom");\n}\n` });
  const warn = project('rust-cli', { 'tests/warn.rs': '#[test]\nfn unused() {\n    let x = 1;\n}\n' });
  for (const profile of FAMILIES.rust.profiles) verify({ profile, recipe: 'test', before: 'cargo test', pass, fail });
  const r = sizes({ profile: 'rust-cli', recipe: 'test', before: 'cargo test', cwd: warn });
  assert.match(r.compact.text, /^test: \d+ warnings\nwarning: unused variable: `x`\n/);
  assert.ok(r.compact.size < r.loud.size);
});

test('smoke go profiles: go test ./... through the wrapper (needs go)', { skip: !haveGo && 'go is not installed', timeout: 300000 }, () => {
  const packages = Object.fromEntries([1, 2, 3, 4].flatMap((n) => [[`p${n}/p${n}.go`, `package p${n}\n\nfunc One() int { return 1 }\n`], [`p${n}/p${n}_test.go`, `package p${n}\n\nimport "testing"\n\nfunc TestOne(t *testing.T) {\n\tif One() != 1 {\n\t\tt.Fatal("one")\n\t}\n}\n`]]));
  const pass = project('go-basic', packages);
  const fail = project('go-basic', { 'fail_test.go': `package app\n\nimport "testing"\n\nfunc TestFlaky(t *testing.T) {\n\tfor i := 0; i < 30; i++ {\n\t\tt.Log("retrying connection")\n\t}\n\tt.Fatal("boom")\n}\n` });
  for (const profile of FAMILIES.go.profiles) verify({ profile, recipe: 'test', before: 'go test ./...', pass, fail });
});

test('smoke node profiles: npx vitest run --reporter=dot through the wrapper (needs npm and network)', { skip: (!hasTool('npm') && 'npm is not installed') || offline, timeout: 300000 }, () => {
  const base = { 'package.json': '{ "name": "app", "private": true, "type": "module" }\n' };
  const pass = tmp('yaw-compact-vitest-');
  const fail = tmp('yaw-compact-vitest-');
  writeTree(pass, { ...base, 'tests/a.test.js': "import { test, expect } from 'vitest';\ntest('a', () => expect(1).toBe(1));\ntest('b', () => expect(2).toBe(2));\n" });
  writeTree(fail, { ...base, 'tests/a.test.js': `import { test, expect } from 'vitest';\ntest('flaky', () => {\n${repeat('  console.log("retrying connection");').join('\n')}\n  expect(1).toBe(2);\n});\n` });
  const install = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--save-dev', 'vitest'], { cwd: pass, encoding: 'utf8' });
  assert.equal(install.status, 0, install.stderr);
  symlinkSync(join(pass, 'node_modules'), join(fail, 'node_modules'));
  for (const profile of ['cloudflare-workers', 'node-app', 'node-static', 'node-ts-vercel', 'node-web']) verify({ profile, recipe: 'test', before: 'npx vitest run', pass, fail });
});

test('smoke php profiles: vendor/bin/phpunit --no-progress through the wrapper (needs php, composer and network)', { skip: (!hasTool('php') && 'php is not installed') || (!hasTool('composer') && 'composer is not installed') || offline, timeout: 600000 }, (t) => {
  const manifest = '{ "name": "app/app", "require-dev": { "phpunit/phpunit": "11.5.57" }, "autoload-dev": { "psr-4": { "Tests\\\\": "tests/" } } }\n';
  const test = (body) => `<?php\nuse PHPUnit\\Framework\\TestCase;\n\nfinal class ATest extends TestCase\n{\n${body}\n}\n`;
  const pass = tmp('yaw-compact-phpunit-');
  const fail = tmp('yaw-compact-phpunit-');
  writeTree(pass, { 'composer.json': manifest, 'tests/ATest.php': test('    public function testA(): void { $this->assertSame(1, 1); }\n    public function testB(): void { $this->assertSame(2, 2); }') });
  writeTree(fail, { 'composer.json': manifest, 'tests/ATest.php': test(`    public function testA(): void\n    {\n${repeat('        fwrite(STDERR, "retrying connection\\n");').join('\n')}\n        $this->assertSame(1, 2);\n    }`) });
  // Composer needs GitHub downloads; where they are refused (some sandboxes) it falls back to slow full clones, so
  // the install gets two minutes and a cache of its own, and the smoke test is skipped with the reason if it fails.
  const install = spawnSync('composer', ['install', '--prefer-dist', '--no-interaction', '--no-progress'], { cwd: pass, encoding: 'utf8', timeout: 120000, env: { ...process.env, COMPOSER_CACHE_DIR: tmp('yaw-composer-cache-') } });
  if (install.status !== 0) return t.skip(`composer install failed: ${install.error?.code ?? install.stderr.match(/Could not authenticate against \S+|Failed to download \S+/)?.[0] ?? install.stderr.trim().split('\n').at(-1)}`);
  symlinkSync(join(pass, 'vendor'), join(fail, 'vendor'));
  for (const dir of [pass, fail]) writeFileSync(join(dir, 'phpunit.xml'), '<phpunit bootstrap="vendor/autoload.php"><testsuite name="t"><directory>tests</directory></testsuite></phpunit>\n');
  for (const profile of ['php-cli', 'php-serverless', 'php-web', 'wordpress-plugin']) verify({ profile, recipe: 'test', before: 'vendor/bin/phpunit', pass, fail });
});

// The wrapper and the plain console are shared by all gradle profiles; the Kotlin and Android plugins and JUnit come
// from Maven Central, so the smoke test compiles a plain Java project (the typecheck recipe of java-cli).
test('smoke gradle profiles: ./gradlew --console=plain through the wrapper (needs a JDK and network)', { skip: (!hasTool('java') && 'java is not installed') || offline, timeout: 600000 }, () => {
  const wrapper = join(KIT_ROOT, 'profiles', 'java-cli', 'scaffold');
  const make = (source) => {
    const dir = tmp('yaw-compact-gradle-');
    cpSync(join(wrapper, 'gradle'), join(dir, 'gradle'), { recursive: true });
    cpSync(join(wrapper, 'gradlew'), join(dir, 'gradlew'));
    writeTree(dir, { 'settings.gradle.kts': 'rootProject.name = "app"\n', 'build.gradle.kts': 'plugins { java }\n', 'src/main/java/App.java': source });
    return dir;
  };
  const ok = 'public class App { public static void main(String[] a) { System.out.println("hi"); } }\n';
  const pass = make(ok);
  const fail = make(`public class App {\n${repeat('    int x = ;').join('\n')}\n}\n`);
  verify({ profile: 'java-cli', recipe: 'typecheck', before: './gradlew compileJava compileTestJava', pass, fail });
});

test('smoke swift profiles: swift build through the wrapper (needs swift 6)', { skip: !hasTool('swift') && 'swift is not installed', timeout: 900000 }, () => {
  const make = (main) => {
    const dir = tmp('yaw-compact-swift-');
    writeTree(dir, { 'Package.swift': '// swift-tools-version:5.9\nimport PackageDescription\n\nlet package = Package(name: "app", targets: [.executableTarget(name: "app", path: "Sources")])\n', 'Sources/main.swift': main });
    mkdirSync(join(dir, 'Tests'));
    return dir;
  };
  const pass = make('print("hi")\n');
  const fail = make(`${repeat('let x: Int = "a"').join('\n')}\n`);
  for (const profile of FAMILIES.swift.profiles) verify({ profile, recipe: 'typecheck', before: 'swift build --build-tests', pass, fail });
});
