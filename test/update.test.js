// yaw update: every row of ADR-0003's "update flow per managed file" table, plus deleted files,
// renamed templates, managed:false and the CRLF rule.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashContent } from '../core/render/files.js';
import { readManifest, writeManifest } from '../core/render/manifest.js';
import { fileStates, initProject, updateProject } from '../core/render/project.js';
import { runChecks } from '../core/cli/doctor.js';
import { main } from '../core/cli/main.js';
import { makeKit, read, scripted, tmp, writeAnswers } from './helpers/fixtures.js';

const V1 = 'line one\nline two\nline three\n';
const V2 = 'line one\nline two\nline three (kit v2)\n';

function kit(version, notes, { path = 'notes.md' } = {}) {
  return makeKit(tmp('yaw-kit-'), { version, modules: { core: { templates: { [path]: notes, 'AGENTS.md': '# Agents\n' } } } });
}

async function project(kitRoot) {
  const root = tmp('yaw-proj-');
  await initProject({ root, kitRoot, answersFile: writeAnswers(tmp('yaw-ans-')) });
  return root;
}

const entry = (root, path) => readManifest(root).files.find((f) => f.path === path);
const actions = (result) => result.report.map((r) => `${r.action} ${r.path}`);

test('row 1: unedited, template unchanged -> nothing', async () => {
  const k1 = kit('1.0.0', V1);
  const root = await project(k1);
  const before = read(root, '.yaw/manifest.json');
  const result = await updateProject({ root, kitRoot: k1, interactive: true, prompter: scripted([]) });
  assert.deepEqual(result.report, []);
  assert.equal(read(root, 'notes.md'), V1);
  assert.equal(read(root, '.yaw/manifest.json'), before);
});

test('row 2: unedited, template changed -> overwritten silently, base and hash updated', async () => {
  const root = await project(kit('1.0.0', V1));
  const prompter = scripted([]);
  const result = await updateProject({ root, kitRoot: kit('1.1.0', V2), interactive: true, prompter });
  assert.deepEqual(actions(result), ['updated notes.md']);
  assert.equal(prompter.asked.length, 0);
  assert.equal(read(root, 'notes.md'), V2);
  assert.equal(read(root, '.yaw/base/notes.md'), V2);
  assert.equal(entry(root, 'notes.md').hash, hashContent(V2));
  assert.equal(readManifest(root).kit, '1.1.0');
});

test('row 3: edited, template unchanged -> nothing, the edit stays', async () => {
  const k1 = kit('1.0.0', V1);
  const root = await project(k1);
  writeFileSync(join(root, 'notes.md'), `${V1}my note\n`);
  const prompter = scripted([]);
  const result = await updateProject({ root, kitRoot: k1, interactive: true, prompter });
  assert.equal(prompter.asked.length, 0);
  assert.deepEqual(actions(result), ['edited notes.md']);
  assert.equal(read(root, 'notes.md'), `${V1}my note\n`);
  assert.equal(entry(root, 'notes.md').hash, hashContent(V1));
});

test('row 4: edited, template changed -> diff shown; keep moves base and hash to the new render', async () => {
  const root = await project(kit('1.0.0', V1));
  const edited = `${V1}my note\n`;
  writeFileSync(join(root, 'notes.md'), edited);
  const prompter = scripted(['k']);
  const k2 = kit('1.1.0', V2);
  const result = await updateProject({ root, kitRoot: k2, interactive: true, prompter });
  assert.deepEqual(actions(result), ['kept notes.md']);
  const diff = prompter.shown.join('');
  assert.match(diff, /^--- current\/notes\.md$/m);
  assert.match(diff, /^\+\+\+ new\/notes\.md$/m);
  assert.match(diff, /^-my note$/m);
  assert.match(diff, /^\+line three \(kit v2\)$/m);
  assert.match(prompter.asked[0], /\[k\]eep \/ \[t\]ake \/ \[m\]erge/);
  assert.equal(read(root, 'notes.md'), edited);
  assert.equal(read(root, '.yaw/base/notes.md'), V2);
  assert.equal(entry(root, 'notes.md').hash, hashContent(V2));
  assert.equal(fileStates(root, readManifest(root)).find((f) => f.path === 'notes.md').state, 'edited');
  // the next update diffs from the new render: same kit -> nothing to ask
  const again = await updateProject({ root, kitRoot: k2, interactive: true, prompter: scripted([]) });
  assert.deepEqual(actions(again), ['edited notes.md']);
});

test('row 4: take overwrites after confirmation; a "no" keeps the file', async () => {
  const root = await project(kit('1.0.0', V1));
  writeFileSync(join(root, 'notes.md'), 'mine\n');
  const no = await updateProject({ root, kitRoot: kit('1.1.0', V2), interactive: true, prompter: scripted(['t', 'n']) });
  assert.deepEqual(actions(no), ['kept notes.md']);
  assert.equal(read(root, 'notes.md'), 'mine\n');

  const root2 = await project(kit('1.0.0', V1));
  writeFileSync(join(root2, 'notes.md'), 'mine\n');
  const prompter = scripted(['take', 'y']);
  const yes = await updateProject({ root: root2, kitRoot: kit('1.1.0', V2), interactive: true, prompter });
  assert.deepEqual(actions(yes), ['taken notes.md']);
  assert.match(prompter.asked[1], /Overwrite notes\.md/);
  assert.equal(read(root2, 'notes.md'), V2);
  assert.equal(read(root2, '.yaw/base/notes.md'), V2);
  assert.equal(entry(root2, 'notes.md').hash, hashContent(V2));
});

test('row 4: merge combines both edits with git merge-file', async () => {
  const root = await project(kit('1.0.0', V1));
  writeFileSync(join(root, 'notes.md'), 'line one (mine)\nline two\nline three\n');
  const result = await updateProject({ root, kitRoot: kit('1.1.0', V2), interactive: true, prompter: scripted(['m']) });
  assert.deepEqual(actions(result), ['merged notes.md']);
  assert.deepEqual(result.conflicts, []);
  assert.equal(read(root, 'notes.md'), 'line one (mine)\nline two\nline three (kit v2)\n');
  assert.equal(read(root, '.yaw/base/notes.md'), V2);
  assert.equal(entry(root, 'notes.md').hash, hashContent(V2));
});

test('row 5: merge with conflicts leaves markers, reports them, doctor lists them until resolved', async () => {
  const root = await project(kit('1.0.0', V1));
  writeFileSync(join(root, 'notes.md'), 'line one\nline two\nline three (mine)\n');
  const k2 = kit('1.1.0', V2);
  const result = await updateProject({ root, kitRoot: k2, strategy: 'merge' });
  assert.deepEqual(actions(result), ['conflict notes.md']);
  assert.deepEqual(result.conflicts, ['notes.md']);
  const text = read(root, 'notes.md');
  assert.match(text, /^<<<<<<< yours$/m);
  assert.match(text, /^>>>>>>> kit 1\.1\.0$/m);
  assert.equal(fileStates(root, readManifest(root)).find((f) => f.path === 'notes.md').state, 'conflict');
  const fails = runChecks({ cwd: root, kitRoot: k2 }).filter((c) => c.level === 'fail');
  assert.ok(fails.some((c) => /notes\.md has unresolved merge conflict markers/.test(c.message)));
  // resolved by hand -> no longer listed
  writeFileSync(join(root, 'notes.md'), 'line one\nline two\nline three (both)\n');
  assert.ok(!runChecks({ cwd: root, kitRoot: k2 }).some((c) => /conflict/.test(c.message)));
});

test('row 5: the CLI exits 1 when update leaves conflicts', async () => {
  const root = await project(kit('1.0.0', V1));
  writeFileSync(join(root, 'notes.md'), 'line one\nline two\nline three (mine)\n');
  const out = [];
  const code = await main(['update', '--strategy', 'merge'], {
    cwd: root, kitRoot: kit('1.1.0', V2), stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => out.push(s) }, prompter: scripted([]),
  });
  assert.equal(code, 1);
  assert.match(out.join(''), /CONFLICT: notes\.md \(1 conflict; resolve the markers/);
});

test('row 6: non-interactive (--yes) keeps edited files and reports them; --strategy overrides', async () => {
  const mine = 'line one (mine)\nline two\nline three\n';
  const root = await project(kit('1.0.0', V1));
  writeFileSync(join(root, 'notes.md'), mine);
  const keep = await updateProject({ root, kitRoot: kit('1.1.0', V2), interactive: false });
  assert.deepEqual(keep.report.map((r) => [r.action, r.path, r.reason]), [['kept', 'notes.md', 'edited']]);
  assert.equal(read(root, 'notes.md'), mine);

  for (const [strategy, expected] of [['take', V2], ['merge', 'line one (mine)\nline two\nline three (kit v2)\n']]) {
    const r = await project(kit('1.0.0', V1));
    writeFileSync(join(r, 'notes.md'), mine);
    await updateProject({ root: r, kitRoot: kit('1.1.0', V2), interactive: false, strategy });
    assert.equal(read(r, 'notes.md'), expected, strategy);
  }

  const out = [];
  const r = await project(kit('1.0.0', V1));
  writeFileSync(join(r, 'notes.md'), mine);
  const code = await main(['update', '--yes'], { cwd: r, kitRoot: kit('1.1.0', V2), stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => out.push(s) }, prompter: scripted([]) });
  assert.equal(code, 0);
  assert.match(out.join(''), /kept your version: notes\.md \(edited\)/);
});

test('an edited file that already matches the new render is re-based without a question', async () => {
  const root = await project(kit('1.0.0', V1));
  writeFileSync(join(root, 'notes.md'), V2);
  const result = await updateProject({ root, kitRoot: kit('1.1.0', V2), interactive: true, prompter: scripted([]) });
  assert.deepEqual(actions(result), ['rebased notes.md']);
  assert.equal(fileStates(root, readManifest(root)).find((f) => f.path === 'notes.md').state, 'unedited');
});

test('CRLF checkout of an unedited file counts as unedited', async () => {
  const root = await project(kit('1.0.0', V1));
  writeFileSync(join(root, 'notes.md'), V1.replace(/\n/g, '\r\n'));
  assert.equal(fileStates(root, readManifest(root)).find((f) => f.path === 'notes.md').state, 'unedited');
  const result = await updateProject({ root, kitRoot: kit('1.1.0', V2), interactive: false });
  assert.deepEqual(actions(result), ['updated notes.md']);
  assert.equal(read(root, 'notes.md'), V2);
});

test('managed:false: never written; a template change is reported once with a diff; remove keeps the file', async () => {
  const root = await project(kit('1.0.0', V1));
  const m = readManifest(root);
  writeManifest(root, { ...m, files: m.files.map((f) => (f.path === 'notes.md' ? { ...f, managed: false } : f)) });
  writeFileSync(join(root, 'notes.md'), 'owned by me\n');
  const k2 = kit('1.1.0', V2);
  const result = await updateProject({ root, kitRoot: k2, strategy: 'take' });
  assert.deepEqual(actions(result), ['owned-changed notes.md']);
  assert.match(result.report[0].diff, /^\+line three \(kit v2\)$/m);
  assert.equal(read(root, 'notes.md'), 'owned by me\n');
  const again = await updateProject({ root, kitRoot: k2 });
  assert.deepEqual(again.report, []);
  // .yaw/answers.yaml is managed:false too and is never touched by update
  assert.ok(existsSync(join(root, '.yaw/answers.yaml')));
  assert.equal(entry(root, '.yaw/answers.yaml').managed, false);
});

test('deleted file: not recreated, reported; --restore recreates it; --forget drops it', async () => {
  const root = await project(kit('1.0.0', V1));
  const k2 = kit('1.1.0', V2);
  rmSync(join(root, 'notes.md'));
  const report = await updateProject({ root, kitRoot: k2, interactive: false });
  assert.deepEqual(actions(report), ['missing notes.md']);
  assert.ok(!existsSync(join(root, 'notes.md')));
  assert.ok(entry(root, 'notes.md'));

  const restored = await updateProject({ root, kitRoot: k2, restore: new Set(['notes.md']) });
  assert.deepEqual(actions(restored), ['restored notes.md']);
  assert.equal(read(root, 'notes.md'), V2);

  rmSync(join(root, 'notes.md'));
  const forgotten = await updateProject({ root, kitRoot: k2, forget: new Set(['notes.md']) });
  assert.deepEqual(actions(forgotten), ['forgotten notes.md']);
  assert.equal(entry(root, 'notes.md'), undefined);
  assert.ok(!existsSync(join(root, '.yaw/base/notes.md')));
});

test('renamed template: unedited old path deleted, new path written', async () => {
  const root = await project(kit('1.0.0', V1));
  const result = await updateProject({ root, kitRoot: kit('1.1.0', V1, { path: 'docs/notes.md' }) });
  assert.deepEqual(actions(result), ['added docs/notes.md', 'deleted notes.md']);
  assert.ok(!existsSync(join(root, 'notes.md')));
  assert.ok(!existsSync(join(root, '.yaw/base/notes.md')));
  assert.equal(read(root, 'docs/notes.md'), V1);
});

test('renamed template: edited old path kept, marked managed:false and reported', async () => {
  const root = await project(kit('1.0.0', V1));
  writeFileSync(join(root, 'notes.md'), 'mine\n');
  const result = await updateProject({ root, kitRoot: kit('1.1.0', V1, { path: 'docs/notes.md' }) });
  assert.deepEqual(actions(result), ['added docs/notes.md', 'released notes.md']);
  assert.equal(read(root, 'notes.md'), 'mine\n');
  assert.equal(entry(root, 'notes.md').managed, false);
  assert.ok(!existsSync(join(root, '.yaw/base/notes.md')));
});

test('renamed template onto an existing file: keep / take only (no base), keep by default', async () => {
  const root = await project(kit('1.0.0', V1));
  writeFileSync(join(root, 'other.md'), 'user file\n');
  const k2 = makeKit(tmp('yaw-kit-'), { version: '1.1.0', modules: { core: { templates: { 'other.md': V1, 'AGENTS.md': '# Agents\n' } } } });
  const prompter = scripted(['m', 'k']);
  const result = await updateProject({ root, kitRoot: k2, interactive: true, prompter });
  assert.match(prompter.asked[0], /\[k\]eep \/ \[t\]ake \(default keep\)/);
  assert.doesNotMatch(prompter.asked[0], /merge/);
  assert.equal(prompter.asked.length, 2); // "m" is not accepted, asked again
  assert.deepEqual(actions(result), ['deleted notes.md', 'kept other.md']);
  assert.equal(read(root, 'other.md'), 'user file\n');
  assert.equal(entry(root, 'other.md').hash, hashContent(V1));

  const root2 = await project(kit('1.0.0', V1));
  writeFileSync(join(root2, 'other.md'), 'user file\n');
  const merge = await updateProject({ root: root2, kitRoot: k2, strategy: 'merge' });
  assert.equal(merge.report.find((r) => r.path === 'other.md').action, 'kept');
  const root3 = await project(kit('1.0.0', V1));
  writeFileSync(join(root3, 'other.md'), 'user file\n');
  const take = await updateProject({ root: root3, kitRoot: k2, strategy: 'take' });
  assert.equal(take.report.find((r) => r.path === 'other.md').action, 'taken');
  assert.equal(read(root3, 'other.md'), V1);
});

test('update refuses a kit older than the project pin', async () => {
  const root = await project(kit('2.0.0', V1));
  await assert.rejects(updateProject({ root, kitRoot: kit('1.0.0', V1) }), /written by kit 2\.0\.0, the installed kit is 1\.0\.0/);
});

test('--restore and --forget accept only missing managed files', async () => {
  const root = await project(kit('1.0.0', V1));
  assert.throws(() => updateProject({ root, kitRoot: kit('1.0.0', V1), restore: new Set(['notes.md']) }), /--restore notes\.md: the file exists/);
  assert.throws(() => updateProject({ root, kitRoot: kit('1.0.0', V1), forget: new Set(['nope.md']) }), /--forget nope\.md: not a managed file/);
  assert.throws(() => updateProject({ root, kitRoot: kit('1.0.0', V1), forget: new Set(['.yaw/answers.yaml']) }), /not a managed file/);
});
