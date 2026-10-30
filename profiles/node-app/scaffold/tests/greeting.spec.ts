import { expect, test } from 'vitest';
import { greeting } from '../src/greeting';

test('greets the world by default', () => {
  expect(greeting(null)).toBe('Hello, world!');
  expect(greeting('  ')).toBe('Hello, world!');
});

test('greets a name', () => {
  expect(greeting(' Ada ')).toBe('Hello, Ada!');
});
