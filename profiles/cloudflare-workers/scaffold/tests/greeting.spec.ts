import { exports } from 'cloudflare:workers';
import { expect, test } from 'vitest';
import { greeting } from '../src/greeting';

test('greets the world by default', () => {
  expect(greeting(null)).toBe('Hello, world!');
  expect(greeting('  ')).toBe('Hello, world!');
});

test('greets a name', () => {
  expect(greeting(' Ada ')).toBe('Hello, Ada!');
});

test('GET / returns JSON from the Worker', async () => {
  const res = await exports.default.fetch('http://localhost/?name=Ada');
  expect(await res.json()).toEqual({ message: 'Hello, Ada!' });
});
