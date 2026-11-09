import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyImprovement, previewImprovement } from '../core/lib/improve-store.js';
import { createWorkspaceApi } from '../core/web/workspace-api.js';
import { KIT_ROOT, tmp, writeTree } from './helpers/fixtures.js';
const fixture = () => ({ root: tmp(), env: { HOME: tmp() }, kitRoot: KIT_ROOT, now: Date.UTC(2026, 9, 28) });
const verdict = { verdict: 'The task recovered after a scope correction.', assessment: { outcome: 'unknown', collaboration: 'recovered', adherence: 'partial' }, evidence: ['E1: the user corrected the target component.'], instruction: 'Confirm the target component before a substantial change.' };

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
  assert.throws(() => previewImprovement({ ...f, input }), /90-line/);
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

test('workspace instruction actions preserve consent, scope and stale-preview checks without starting a reviewer', async () => {
  const f = fixture(); writeTree(f.root, { 'AGENTS.md': '# AGENTS.md\n\nExisting project rules.\n' });
  const api = createWorkspaceApi({ ...f, spawnFn() { throw new Error('No reviewer should start.'); } });
  try {
    const preview = await api.action('improve-instruction-preview', { target: 'project-instructions', instruction: verdict.instruction });
    await assert.rejects(api.action('improve-instruction-apply', { ...preview, expected: 'stale', confirm: true }), (e) => e.status === 409);
    await api.action('improve-instruction-apply', { ...preview, confirm: true });
    assert.match(readFileSync(join(f.root, 'AGENTS.md'), 'utf8'), /Confirm the target component/);
  } finally { api.close(); }
});

test('no saved-verdict history exists: no endpoint, no stored file', async () => {
  const f = fixture(); writeTree(f.root, { 'AGENTS.md': '# AGENTS.md\n' });
  const api = createWorkspaceApi({ ...f, spawnFn() { throw new Error('No reviewer should start.'); } });
  try {
    assert.equal(api.get['/api/improve/history'], undefined);
    for (const name of ['improve-history-save', 'improve-history-import', 'improve-history-read', 'improve-history-delete', 'improve-history-retention']) {
      await assert.rejects(api.action(name, { verdict: 'Review.', text: 'Review.', confirm: true }));
    }
    assert.equal(existsSync(join(f.env.HOME, '.yaw/improve-history.json')), false);
  } finally { api.close(); }
});
