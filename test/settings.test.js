// yaw web Settings: YAW file overview, decision categories, interview preview/apply.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { interviewApply, interviewData, interviewPreview, saveTaxonomy, settingsFile, settingsFiles, taxonomyData } from '../core/web/settings.js';
import { readManifest, writeManifest } from '../core/render/manifest.js';
import { hashContent } from '../core/render/files.js';
import { makeProject } from './helpers/hooks.js';
import { KIT_ROOT, tmp } from './helpers/fixtures.js';

const SECRET = `.e${'nv'}.private`;
const env = () => ({ HOME: tmp('yaw-home-') });
const adr = (category) => `# ADR-0001: Pick a format\n\n- **Date:** 2026-10-20\n- **Category:** ${category}\n- **Status:** Accepted\n- **Importance:** high\n\n## Context\n\nWhy.\n\n## Decision\n\n- JSON.\n\n## Consequences\n\n- Fine.\n`;

test('settings files: YAW files grouped by purpose; secrets and records excluded; only listed paths readable', async () => {
  const root = await makeProject({ modules: ['core', 'standards', 'security', 'decisions'] });
  const manifest = readManifest(root);
  manifest.files.push({ path: SECRET, module: 'core', managed: false, hash: hashContent('x') });
  writeManifest(root, manifest);
  const s = settingsFiles({ root, kitRoot: KIT_ROOT });
  assert.equal(s.available, true);
  const paths = s.groups.flatMap((g) => g.files.map((f) => f.path));
  assert.ok(paths.includes('AGENTS.md') && paths.includes('.yaw/answers.yaml'));
  assert.ok(paths.every((p) => !p.includes('.e' + 'nv') && !p.startsWith('.decisions/') && p !== 'TASKS.md'));
  assert.equal(s.excluded, 1);
  assert.equal(s.groups.flatMap((g) => g.files).find((f) => f.path === '.yaw/answers.yaml').editable, 'interview');
  assert.match(settingsFile({ root, kitRoot: KIT_ROOT, path: 'AGENTS.md' }).content, /AGENTS/);
  for (const path of [SECRET, '../x', 'src/main.js', '.decisions/taxonomy.json']) {
    assert.throws(() => settingsFile({ root, kitRoot: KIT_ROOT, path }), /unavailable/i, path);
  }
  assert.equal(settingsFiles({ root: tmp('yaw-empty-'), kitRoot: KIT_ROOT }).available, false);
});

test('decision categories: save validates, refuses stale hashes and keeps pairs used by decisions', async () => {
  const root = await makeProject({ modules: ['core', 'decisions'] });
  const t = await taxonomyData({ root, kitRoot: KIT_ROOT });
  assert.equal(t.available, true);
  const doc = JSON.parse(t.content), [cat] = doc.categories, [sub] = cat.subcategories;
  mkdirSync(join(root, '.decisions'), { recursive: true });
  writeFileSync(join(root, '.decisions', 'ADR-0001.md'), adr(`${cat.name} / ${sub.name}`));
  const used = await taxonomyData({ root, kitRoot: KIT_ROOT });
  assert.deepEqual(used.usage[`${cat.name} / ${sub.name}`], ['ADR-0001']);

  const without = structuredClone(doc); without.categories[0].subcategories.shift();
  await assert.rejects(saveTaxonomy({ root, kitRoot: KIT_ROOT, input: { content: JSON.stringify(without), expected: used.hash } }), (e) => e.status === 409 && /ADR-0001/.test(e.message));
  const bare = structuredClone(doc); bare.categories[0].subcategories.push({ name: 'Brand new', keywords: [] });
  await assert.rejects(saveTaxonomy({ root, kitRoot: KIT_ROOT, input: { content: JSON.stringify(bare), expected: used.hash } }), /keyword/);
  await assert.rejects(saveTaxonomy({ root, kitRoot: KIT_ROOT, input: { content: '{', expected: used.hash } }), /valid JSON/);

  const added = structuredClone(doc); added.categories[0].subcategories.push({ name: 'Brand new', keywords: ['fresh'] });
  const saved = await saveTaxonomy({ root, kitRoot: KIT_ROOT, input: { content: JSON.stringify(added), expected: used.hash } });
  assert.match(readFileSync(join(root, '.decisions', 'taxonomy.json'), 'utf8'), /Brand new/);
  assert.notEqual(saved.hash, used.hash);
  await assert.rejects(saveTaxonomy({ root, kitRoot: KIT_ROOT, input: { content: JSON.stringify(added), expected: used.hash } }), (e) => e.status === 409);
});

test('interview: preview lists changes without writing; apply needs the current answers hash', async () => {
  const root = await makeProject({ modules: ['core', 'standards', 'security'] });
  const e = env(), i = interviewData({ root, kitRoot: KIT_ROOT, env: e });
  assert.equal(i.available, true);
  const answers = readFileSync(join(root, '.yaw', 'answers.yaml'), 'utf8');
  const input = { ...i.initial, modules: [...i.initial.modules, 'tasks'], expected: i.hash };
  const p = interviewPreview({ root, kitRoot: KIT_ROOT, env: e, input });
  assert.ok(p.modules.includes('tasks'));
  assert.ok(p.files.length > 0 && p.diff.length > 0);
  assert.equal(readFileSync(join(root, '.yaw', 'answers.yaml'), 'utf8'), answers, 'preview writes nothing');
  assert.throws(() => interviewPreview({ root, kitRoot: KIT_ROOT, env: e, input: { ...input, expected: 'stale' } }), (x) => x.status === 409);

  const r = await interviewApply({ root, kitRoot: KIT_ROOT, env: e, input });
  assert.match(r.message, /Applied/);
  assert.ok(readManifest(root).modules.tasks?.enabled);
  await assert.rejects(interviewApply({ root, kitRoot: KIT_ROOT, env: e, input }), (x) => x.status === 409, 'the old hash is stale after apply');
});
