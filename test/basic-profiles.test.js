import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '../core/lib/yaml.js';
import { listProfiles, loadProfile, renderProfiles } from '../core/render/kit.js';
import { KIT_ROOT } from './helpers/fixtures.js';

const EXPECTED = {
  'python-basic': { language: ['python'], runsOn: ['edge'] },
  'node-basic': { language: ['typescript'], runsOn: ['static'] },
  'go-basic': { language: ['go'], runsOn: ['app-store'] },
  'rust-basic': { language: ['rust'], runsOn: ['edge', 'app-store'] },
  'java-basic': { language: ['java'], runsOn: ['app-store'] },
};
const SOURCE_FILES = {
  'python-basic': 'src/app.py',
  'node-basic': 'src/index.js',
  'go-basic': 'greeting.go',
  'rust-basic': 'src/lib.rs',
  'java-basic': 'src/main/java/com/example/app/Greeting.java',
};
const VERBS = ['setup', 'dev', 'fmt', 'lint', 'typecheck', 'test', 'check', 'build', 'audit'];

function renderedTestFile(files) {
  return [...files.keys()].find((path) =>
    /(?:^|\/)(?:test|tests)\//.test(path)
    || /(?:\.test\.js|_test\.go|Test\.kt|Test\.java|Tests\.swift)$/.test(path));
}

test('each basic profile loads, validates its stack, and renders a scaffold and justfile', () => {
  for (const [name, stack] of Object.entries(EXPECTED)) {
    const profile = loadProfile(KIT_ROOT, name);
    assert.equal(profile.stack.basic, true, name);
    assert.deepEqual(profile.stack.language, stack.language, name);
    assert.deepEqual(profile.stack.runsOn, stack.runsOn, name);
    assert.ok(profile.requires.includes('just'), `${name} requires just`);

    for (const part of ['standards.md', 'guards.yaml', 'gitignore', `just/${name}.just`, 'ci/check.yml', 'scaffold']) {
      assert.ok(existsSync(join(KIT_ROOT, 'profiles', name, part)), `${name}/${part}`);
    }
    const standards = readFileSync(join(KIT_ROOT, 'profiles', name, 'standards.md'), 'utf8').trimEnd().split('\n');
    assert.ok(standards.length <= 20, `${name}/standards.md has ${standards.length} lines`);

    const rendered = renderProfiles({ kitRoot: KIT_ROOT, profiles: [name], scaffold: () => false });
    assert.deepEqual(rendered.missing, []);
    assert.ok(rendered.files.has(`just/${name}.just`), `${name} justfile rendered`);
    assert.ok(rendered.files.has(SOURCE_FILES[name]), `${name} scaffold has a rendered source file`);
    assert.ok(renderedTestFile(rendered.files), `${name} scaffold has a rendered test file`);
    const text = readFileSync(join(KIT_ROOT, 'profiles', name, 'just', `${name}.just`), 'utf8');
    const recipes = [...text.matchAll(/^([a-z][a-z-]*)(?: [^:\n]*)?:(?!=)/gm)].map((match) => match[1]);
    assert.deepEqual(recipes.sort(), [...VERBS].sort(), `${name} verbs`);
  }
});

test('every language and runsOn pair belongs to at most one profile', () => {
  const pairs = new Map();
  for (const profile of listProfiles(KIT_ROOT)) {
    for (const language of profile.stack.language) {
      for (const runsOn of profile.stack.runsOn) {
        const pair = `${language} × ${runsOn}`;
        assert.ok(!pairs.has(pair), `${pair} appears in ${pairs.get(pair)} and ${profile.name}`);
        pairs.set(pair, profile.name);
      }
    }
  }
});

// Keep the profile fragments syntactically valid YAML as part of the generic coverage.
test('basic profile CI and guard fragments parse', () => {
  for (const name of Object.keys(EXPECTED)) {
    const dir = join(KIT_ROOT, 'profiles', name);
    const ci = parse(readFileSync(join(dir, 'ci/check.yml'), 'utf8'), { file: `${name}/ci/check.yml` });
    assert.deepEqual(ci.steps.slice(-2).map((step) => step.run), ['just setup', 'just check'], name);
    const guards = parse(readFileSync(join(dir, 'guards.yaml'), 'utf8'), { file: `${name}/guards.yaml` }).guards;
    assert.ok(guards.length > 0, `${name} has guards`);
    for (const guard of guards) {
      assert.match(guard.id, /^[a-z][a-z0-9-]*$/);
      assert.doesNotThrow(() => new RegExp(guard.pattern), `${name}/${guard.id}`);
    }
  }
});
