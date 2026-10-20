// Output policy limits (ADR-0007): context clipped to 10 lines / 1000 characters, deny reason one line
// of at most 300 characters, outputs of several handlers combined.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONTEXT_MAX_CHARS, CONTEXT_MAX_LINES, REASON_MAX_CHARS, allowed, combine } from '../core/hooks/policy.js';

test('context: SessionStart only, clipped to the line and character budget', () => {
  const long = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
  const out = allowed({ kind: 'context', event: 'SessionStart', agent: 'claude', result: { context: long } });
  assert.equal(out.context.split('\n').length, CONTEXT_MAX_LINES);
  const wide = allowed({ kind: 'context', event: 'SessionStart', agent: 'claude', result: { context: 'x'.repeat(5000) } });
  assert.equal(wide.context.length, CONTEXT_MAX_CHARS);
  assert.deepEqual(allowed({ kind: 'context', event: 'UserPromptSubmit', agent: 'claude', result: { context: 'x' } }), {});
});

test('guard: one line, at most 300 characters; nothing but deny on PreToolUse', () => {
  const out = allowed({ kind: 'guard', event: 'PreToolUse', agent: 'codex', result: { decision: 'deny', reason: `a\nb ${'x'.repeat(400)}` } });
  assert.ok(!out.deny.includes('\n'));
  assert.equal(out.deny.length, REASON_MAX_CHARS);
  assert.deepEqual(allowed({ kind: 'guard', event: 'PreToolUse', agent: 'codex', result: { decision: 'allow', reason: 'ok' } }), {});
  assert.deepEqual(allowed({ kind: 'guard', event: 'PreToolUse', agent: 'codex', result: { decision: 'deny', reason: '  ' } }), {});
  assert.deepEqual(allowed({ kind: 'guard', event: 'Stop', agent: 'codex', result: { decision: 'deny', reason: 'r' } }), {});
});

test('evaluation and non-objects: nothing', () => {
  for (const result of [{ context: 'x', systemMessage: 'y', decision: 'deny', reason: 'r' }, 'text', 42, null, undefined]) {
    assert.deepEqual(allowed({ kind: 'evaluation', event: 'SessionStart', agent: 'claude', result }), {});
    assert.deepEqual(allowed({ kind: 'comfort', event: 'Stop', agent: 'claude', result: typeof result === 'object' ? {} : result }), {});
  }
});

test('combine: reasons and contexts are joined within the limits', () => {
  const c = combine([{ deny: 'first' }, { deny: 'second' }, { context: 'a' }, { context: 'b' }, { systemMessage: 'm1' }, { systemMessage: 'm2' }]);
  assert.deepEqual(c, { deny: 'first; second', context: 'a\nb', systemMessage: 'm1\nm2' });
  const many = combine(Array.from({ length: 20 }, () => ({ deny: 'x'.repeat(50) })));
  assert.equal(many.deny.length, REASON_MAX_CHARS);
  const lines = combine(Array.from({ length: 20 }, (_, i) => ({ context: `c${i}` })));
  assert.equal(lines.context.split('\n').length, CONTEXT_MAX_LINES);
});
