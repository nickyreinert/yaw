import { greeting } from './greeting.js';

export function handle(request: Request): Response {
  const url = new URL(request.url);
  if (request.method !== 'GET') return Response.json({ error: 'method not allowed' }, { status: 405 });
  if (url.pathname === '/health') return Response.json({ status: 'ok' });
  if (url.pathname === '/hello') return Response.json({ message: greeting(url.searchParams.get('name')) });
  return Response.json({ error: 'not found' }, { status: 404 });
}
