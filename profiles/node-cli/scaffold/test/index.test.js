import { test } from 'node:test';
import assert from 'node:assert/strict';
import { greet } from '../src/index.js';

test('greet names the person', () => {
  assert.equal(greet('YAW'), 'Hello, YAW!');
});
