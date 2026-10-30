import { createServer, type Server } from 'node:http';
import { handle } from './app.js';

export function createApp(host: string): Server {
  return createServer(async (req, res) => {
    const response = handle(new Request(`http://${host}${req.url ?? '/'}`, { method: req.method }));
    res.writeHead(response.status, { 'content-type': response.headers.get('content-type') ?? 'text/plain' });
    res.end(await response.text());
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const host = process.env.HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? 3000);
  createApp(host).listen(port, host, () => console.log(`listening on http://${host}:${port}`));
}
