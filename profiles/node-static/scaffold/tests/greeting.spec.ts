import { expect, test } from 'vitest';
import { greeting } from '../src/greeting';

test('greets the world by default and a name when given', () => {
  expect(greeting(null)).toBe('Hello, world!');
  expect(greeting(' Ada ')).toBe('Hello, Ada!');
});
