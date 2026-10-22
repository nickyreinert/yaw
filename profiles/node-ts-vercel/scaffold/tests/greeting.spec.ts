import { expect, test } from 'vitest';
import { GET } from '../api/hello.js';
import { greeting } from '../src/greeting.js';

test('greets the world by default', () => {
  expect(greeting(null)).toBe('Hello, world!');
  expect(greeting('  ')).toBe('Hello, world!');
});

test('greets a name', () => {
  expect(greeting(' Ada ')).toBe('Hello, Ada!');
});

test('GET /api/hello returns JSON', async () => {
  const res = GET(new Request('http://localhost/api/hello?name=Ada'));
  expect(await res.json()).toEqual({ message: 'Hello, Ada!' });
});
