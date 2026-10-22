import { greeting } from './greeting';

export default {
  async fetch(request: Request): Promise<Response> {
    const name = new URL(request.url).searchParams.get('name');
    return Response.json({ message: greeting(name) });
  },
} satisfies ExportedHandler;
