import { greeting } from '../src/greeting.js';

export function GET(request: Request): Response {
  const name = new URL(request.url).searchParams.get('name');
  return Response.json({ message: greeting(name) });
}
