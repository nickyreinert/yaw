import type { AddressInfo } from 'node:net';
import { expect, test } from 'vitest';
import { handle } from '../src/app.js';
import { greeting } from '../src/greeting.js';
import { createApp } from '../src/server.js';

test('greets the world by default and a name when given', () => {
  expect(greeting(null)).toBe('Hello, world!');
  expect(greeting(' Ada ')).toBe('Hello, Ada!');
});

test('routes answer JSON with specific status codes', async () => {
  expect(await handle(new Request('http://x/health')).json()).toEqual({ status: 'ok' });
  expect(await handle(new Request('http://x/hello?name=Ada')).json()).toEqual({ message: 'Hello, Ada!' });
  expect(handle(new Request('http://x/missing')).status).toBe(404);
  expect(handle(new Request('http://x/health', { method: 'POST' })).status).toBe(405);
});

test('the node:http server serves the handler over loopback', async () => {
  const server = createApp('127.0.0.1');
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/hello?name=YAW`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: 'Hello, YAW!' });
  } finally {
    server.close();
  }
});
