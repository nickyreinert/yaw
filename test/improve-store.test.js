import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyImprovement, deleteImprovement, importImprovement, improveHistory, previewImprovement, retainImprovements, savedImprovement, saveImprovement } from '../core/lib/improve-store.js';
import { createWorkspaceApi } from '../core/web/workspace-api.js';
import { readUserData } from '../core/lib/user-store.js';
import { KIT_ROOT, tmp, writeTree } from './helpers/fixtures.js';
const fixture = () => ({ root: tmp(), env: { HOME: tmp() }, kitRoot: KIT_ROOT, now: Date.UTC(2026, 9, 28) });
const verdict = { verdict: 'The task recovered after a scope correction.', assessment: { outcome: 'unknown', collaboration: 'recovered', adherence: 'partial' }, evidence: ['E1: the user corrected the target component.'], instruction: 'Confirm the target component before a substantial change.' };

test('saved verdicts require explicit consent, exclude prompts by default and survive reopening', () => {
  const f = fixture();
  assert.throws(() => saveImprovement({ ...f, input: { verdict: 'A verdict.' } }), /Confirm/);
  const saved = saveImprovement({ ...f, input: { verdict: JSON.stringify(verdict), prompt: 'Private reference text.', confirm: true } });
  assert.equal(saved.prompt, undefined);
  assert.equal(saved.assessment.adherence, 'partial');
  assert.equal(improveHistory(f).records.length, 1);
  assert.deepEqual(savedImprovement({ ...f, id: saved.id }), saved);
  assert.equal(readUserData(f.env, 'session-analysis.json'), null);
  assert.equal(readUserData(f.env, 'registry.json'), null);
});

test('prompt retention, export/import, deletion and expiry are explicit and separate from analytics', () => {
  const f = fixture();
  const saved = saveImprovement({ ...f, input: { verdict: JSON.stringify(verdict), prompt: 'Edited anonymous examples.', includePrompt: true, confirm: true } });
  const imported = importImprovement({ ...f, input: { text: JSON.stringify(saved), confirm: true } });
  assert.notEqual(imported.id, saved.id); assert.equal(imported.prompt, undefined);
  assert.equal(savedImprovement({ ...f, id: saved.id }).prompt, 'Edited anonymous examples.');
  assert.throws(() => deleteImprovement({ ...f, input: { id: saved.id } }), /Confirm/);
  deleteImprovement({ ...f, input: { id: saved.id, confirm: true } });
  assert.throws(() => savedImprovement({ ...f, id: saved.id }), /not found/);
  retainImprovements({ ...f, input: { days: 7, confirm: true } });
  assert.equal(improveHistory({ ...f, now: f.now + 8 * 86400000 }).records.length, 0);
  assert.equal(readUserData(f.env, 'improve-history.json').records.length, 0);
});

test('imported instructions and structured labels are data; invalid, oversized and secret-like data is refused', () => {
  const f = fixture();
  assert.throws(() => importImprovement({ ...f, input: { text: '{invalid JSON', confirm: true } }), /JSON/);
  assert.throws(() => saveImprovement({ ...f, input: { verdict: JSON.stringify({ ...verdict, assessment: { outcome: 'certain' } }), confirm: true } }), /supported/);
  assert.throws(() => saveImprovement({ ...f, input: { verdict: `Example ${'sk-'}${'a1b2c3d4'.repeat(5)}`, confirm: true } }), /secret/);
  assert.throws(() => saveImprovement({ ...f, input: { verdict: 'x'.repeat(32001), confirm: true } }), /large/);
  assert.equal(existsSync(join(f.env.HOME, '.yaw/improve-history.json')), false);
});

test('instruction changes require exact diff review, preserve existing rules and reject stale or changed additions', () => {
  const f = fixture();
  const original = '# AGENTS.md\n\nProject-owned rules.\n';
  writeTree(f.root, { 'AGENTS.md': original });
  const input = { target: 'project-instructions', instruction: verdict.instruction };
  const preview = previewImprovement({ ...f, input });
  assert.equal(readFileSync(join(f.root, 'AGENTS.md'), 'utf8'), original);
  assert.match(preview.diff, /Confirm the target component/);
  assert.throws(() => applyImprovement({ ...f, input: preview }), /confirm applying/);
  assert.throws(() => applyImprovement({ ...f, input: { ...preview, instruction: 'Different rule.', confirm: true } }), /preview again/);
  applyImprovement({ ...f, input: { ...preview, confirm: true } });
  const changed = readFileSync(join(f.root, 'AGENTS.md'), 'utf8');
  assert.ok(changed.startsWith(original)); assert.ok(changed.includes(verdict.instruction));
  assert.throws(() => applyImprovement({ ...f, input: { ...preview, confirm: true } }), /preview again/);
});

test('instruction targets are bounded, refuse symlinks/markers and preserve the AGENTS line budget', () => {
  const f = fixture();
  writeTree(f.root, { 'other.md': '# Instructions\n', 'AGENTS.md': '# AGENTS.md\n' + 'Existing rule.\n'.repeat(78) });
  const input = { target: 'project-instructions', instruction: 'One more rule.' };
  assert.throws(() => previewImprovement({ ...f, input }), /80-line/);
  assert.throws(() => previewImprovement({ ...f, input: { ...input, target: '../outside' } }), /Choose/);
  assert.throws(() => previewImprovement({ ...f, input: { ...input, instruction: '<!-- yaw:core -->\nBad rule.' } }), /markers/);
  const linked = tmp(); symlinkSync(join(f.root, 'other.md'), join(linked, 'AGENTS.md'));
  assert.throws(() => previewImprovement({ ...f, root: linked, input }), /regular file/);
});

test('project and personal reviewer additions inherit existing rules and respect layer concurrency', () => {
  const f = fixture();
  for (const target of ['project-review-rules', 'personal-review-rules']) {
    const preview = previewImprovement({ ...f, input: { target, instruction: 'Check this project constraint.' } });
    assert.match(preview.diff, /Check this project constraint/);
    assert.match(preview.diff, /findings|VERDICT|report/i);
    applyImprovement({ ...f, input: { ...preview, confirm: true } });
    const file = target === 'project-review-rules' ? join(f.root, '.yaw/review/rules.md') : join(f.env.HOME, '.yaw/review/rules.md');
    assert.match(readFileSync(file, 'utf8'), /Check this project constraint/);
    assert.throws(() => applyImprovement({ ...f, input: { ...preview, confirm: true } }), /preview again/);
  }
});

test('a browser-chat verdict can be imported as plain text without a prompt or structured estimates', () => {
  const f = fixture();
  const saved = importImprovement({ ...f, input: { text: 'The examples show a recovered scope correction.', confirm: true } });
  assert.equal(saved.verdict, 'The examples show a recovered scope correction.');
  assert.equal(saved.prompt, undefined); assert.equal(saved.assessment, undefined);
});

test('workspace actions preserve consent, scope and stale-preview checks without starting a reviewer', async () => {
  const f = fixture(); writeTree(f.root, { 'AGENTS.md': '# AGENTS.md\n\nExisting project rules.\n' });
  const api = createWorkspaceApi({ ...f, spawnFn() { throw new Error('No reviewer should start.'); } });
  try {
    await assert.rejects(api.action('improve-history-save', { verdict: 'Review.' }), (e) => e.status === 400);
    const record = await api.action('improve-history-import', { text: JSON.stringify(verdict), confirm: true });
    assert.equal(api.get['/api/improve/history']().records[0].id, record.id);
    const preview = await api.action('improve-instruction-preview', { target: 'project-instructions', instruction: record.instruction });
    await assert.rejects(api.action('improve-instruction-apply', { ...preview, expected: 'stale', confirm: true }), (e) => e.status === 409);
    await api.action('improve-instruction-apply', { ...preview, confirm: true });
    await api.action('improve-history-delete', { id: record.id, confirm: true });
    assert.equal(api.get['/api/improve/history']().records.length, 0);
    assert.match(readFileSync(join(f.root, 'AGENTS.md'), 'utf8'), /Confirm the target component/);
  } finally { api.close(); }
});
