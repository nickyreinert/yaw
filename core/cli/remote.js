import { startRemoteServer } from '../remote/server.js';
import { configureHubClient, syncHub } from '../remote/client.js';
import { readUserData } from '../lib/user-store.js';
import { UsageError } from './commands.js';

export async function remote({ values, positionals, io }) {
  const [verb, ...rest] = positionals;
  if (rest.length) throw new UsageError('Unexpected remote arguments');
  const allowed = verb === 'serve' ? ['port'] : verb === 'sync' ? (values.hub ? ['hub', 'token-env', 'scopes', 'migrate'] : ['resolve']) : [];
  if (Object.keys(values).some((key) => !allowed.includes(key))) throw new UsageError('These options do not apply to this remote operation');
  if (verb === 'status') {
    const cfg = readUserData(io.env, 'hub-sync.json'), sync = readUserData(io.env, 'hub-sync-state.json');
    io.stdout.write(`${JSON.stringify({ client: cfg, revision: sync?.revision ?? null, lastSync: sync?.lastSync ?? null, conflicts: sync?.conflicts ?? [] }, null, 2)}\n`); return 0;
  }
  if (verb === 'sync') {
    const result = values.hub ? configureHubClient({ env: io.env, url: values.hub, tokenEnv: values['token-env'], scopes: values.scopes?.split(','), migrate: values.migrate })
      : await syncHub({ env: io.env, kitRoot: io.kitRoot, resolution: values.resolve });
    io.stdout.write(`${JSON.stringify(result, null, 2)}\n`); return result.conflicts?.length ? 1 : 0;
  }
  if (verb !== 'serve') throw new UsageError('Use remote serve, sync or status');
  const port = Number(values.port ?? 4318);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new UsageError('Use a port from 1024 to 65535');
  const service = await startRemoteServer({ env: io.env, kitRoot: io.kitRoot, port });
  io.stdout.write(`YAW Remote: ${service.url}\nSign in with the owner credential entered in the service environment. Use an SSH tunnel with the same local port. Ctrl+C stops managed workers; browser disconnects do not.\n`);
  await new Promise((resolve) => service.server.once('close', resolve)); return 0;
}
