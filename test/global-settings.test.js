import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { globalFile, globalFiles, presetAction, presetsData, profileApply, profileData, profilePreview } from '../core/web/global-settings.js';
import { setupDefaults, saveSetupDefaults } from '../core/lib/setup-defaults.js';
import { KIT_ROOT, tmp, writeTree } from './helpers/fixtures.js';

const home = () => { const HOME = tmp('yaw-global-'); return { env: { HOME }, dir: join(HOME, '.yaw') }; };

test('profile: questions are personal keys only; preview and apply are hash-checked and validated', () => {
  const { env, dir } = home();
  const d = profileData({ kitRoot: KIT_ROOT, env });
  assert.equal(d.exists, false);
  const ids = d.questions.map((q) => q.id);
  assert.ok(ids.includes('user.language') && ids.includes('user.agents'));
  assert.ok(ids.every((id) => id.startsWith('user.')), 'no project questions');
  assert.deepEqual(d.questions.find((q) => q.id === 'user.language').assumedIn, ['quick']);
  assert.deepEqual(d.questions.find((q) => q.id === 'user.agents').assumedIn, ['quick']);
  assert.deepEqual(d.questions.find((q) => q.id === 'user.comfort').assumedIn, ['quick', 'basic']);
  const input = { answers: { 'user.language': 'de' }, expected: d.hash };
  const preview = profilePreview({ kitRoot: KIT_ROOT, env, input });
  assert.equal(preview.changed, true); assert.match(preview.diff, /\+answers:/);
  assert.equal(existsSync(join(dir, 'user-profile.yaml')), false, 'preview never writes');
  profileApply({ kitRoot: KIT_ROOT, env, input });
  assert.match(readFileSync(join(dir, 'user-profile.yaml'), 'utf8'), /user\.language: de/);
  assert.throws(() => profileApply({ kitRoot: KIT_ROOT, env, input }), /changed on disk/);
  const now = profileData({ kitRoot: KIT_ROOT, env });
  assert.equal(now.answers['user.language'], 'de');
  assert.throws(() => profilePreview({ kitRoot: KIT_ROOT, env, input: { answers: { 'project.name': 'x' }, expected: now.hash } }), /Unknown answer key/);
  assert.throws(() => profilePreview({ kitRoot: KIT_ROOT, env, input: { answers: { 'user.agents': 'not-a-list' }, expected: now.hash } }), /Invalid answer/);
  assert.throws(() => profilePreview({ kitRoot: KIT_ROOT, env, input: { answers: { 'user.language': 'ghp_0123456789abcdefghijklmnopqrstuvwxyzAB' }, expected: now.hash } }));
});

test('presets: rename keeps content, refuses clashes and bad names; delete needs confirmation', () => {
  const { env, dir } = home();
  writeTree(dir, { 'presets/alpha.yaml': 'name: alpha\ndescription: First\nanswers: {}\n', 'presets/beta.yaml': 'name: beta\nanswers: {}\n' });
  assert.deepEqual(presetsData({ env }).presets.map((p) => p.name), ['alpha', 'beta']);
  assert.throws(() => presetAction({ env, input: { name: 'alpha', to: 'beta' } }), /already exists/);
  assert.throws(() => presetAction({ env, input: { name: 'alpha', to: '../x' } }), /lower-case/);
  presetAction({ env, input: { name: 'alpha', to: 'gamma' } });
  assert.equal(existsSync(join(dir, 'presets/alpha.yaml')), false);
  assert.match(readFileSync(join(dir, 'presets/gamma.yaml'), 'utf8'), /name: gamma[\s\S]*First/);
  assert.throws(() => presetAction({ env, input: { name: 'beta' }, remove: true }), /Confirm/);
  presetAction({ env, input: { name: 'beta', confirm: true }, remove: true });
  assert.deepEqual(presetsData({ env }).presets.map((p) => p.name), ['gamma']);
});

test('files: only listed ~/.yaw files are readable, links are refused, folders show counts only', () => {
  const { env, dir } = home();
  writeTree(dir, { 'user-profile.yaml': 'answers:\n  user.language: en\n', 'web-projects.json': '{"projects":[]}', 'history.jsonl': '{"a":1}\n{"a":2}\n', 'kit/x': '', 'presets/p.yaml': 'name: p\nanswers: {}\n', 'other.txt': 'secret' });
  symlinkSync(join(dir, 'other.txt'), join(dir, 'notification-settings.json'));
  const groups = globalFiles({ env }).groups;
  const all = groups.flatMap((g) => g.files);
  assert.ok(!all.some((f) => f.path === 'other.txt'));
  assert.equal(all.find((f) => f.path === 'notification-settings.json').blocked, true);
  assert.deepEqual(all.find((f) => f.path === 'kit/'), { path: 'kit/', about: all.find((f) => f.path === 'kit/').about, folder: true, entries: 1 });
  assert.deepEqual(globalFile({ env, path: 'user-profile.yaml' }).data, { answers: { 'user.language': 'en' } });
  assert.deepEqual(globalFile({ env, path: 'history.jsonl' }).data, [{ a: 1 }, { a: 2 }]);
  assert.equal(globalFile({ env, path: 'presets/p.yaml' }).data.name, 'p');
  for (const path of ['other.txt', 'notification-settings.json', '../.yaw/user-profile.yaml', 'kit/', 'kit/x', 'session-analysis.json']) {
    assert.throws(() => globalFile({ env, path }), /unavailable/, path);
  }
});

// The catalog shown in Settings is also returned after saving; writes retain only user choices.
test('tool defaults expose kit descriptions and dependencies without persisting catalog metadata', () => {
  const { env, dir } = home(), ctx = { env, kitRoot: KIT_ROOT };
  const first = setupDefaults(ctx);
  assert.deepEqual(first.catalog.map((m) => m.name), first.availableModules);
  const ci = first.catalog.find((m) => m.name === 'ci');
  assert.equal(ci.group, 'github'); assert.ok(ci.title && ci.short && ci.what);
  assert.ok(ci.depends.includes('github'));
  const saved = saveSetupDefaults(ctx, { modules: ['ci'], answers: {} });
  assert.deepEqual(saved.catalog, first.catalog);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'setup-defaults.json'), 'utf8')), { version: 1, modules: ['ci'], answers: {} });
});
