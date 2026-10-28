// Runs inside bubblewrap, with only this worker's HOME and registered checkout writable.
import { spawn, spawnSync } from 'node:child_process';
import { JsonPeer } from './rpc.js';
import { claudeAdapter } from './claude-adapter.js';
import { codexAdapter } from './codex-adapter.js';
const peer = new JsonPeer(process.stdin, process.stdout, { timeoutMs: 6 * 60000 });
let adapter;
const emit = (params) => {
  if (params.type === 'done') {
    const result = spawnSync('git', ['-C', '/work', 'status', '--porcelain=v1', '-z', '--untracked-files=normal'], { encoding: 'utf8', maxBuffer: 32000, timeout: 5000, env: process.env });
    if (result.status === 0 && result.stdout) peer.write({ method: 'event', params: { type: 'files', text: `Current checkout changes (includes changes present before this turn):\n${result.stdout.split('\0').filter(Boolean).join('\n').slice(0, 24000)}` } });
  }
  peer.write({ method: 'event', params });
};
const request = (params) => peer.request('decision', params);
peer.on('request', async (m) => {
  try {
    if (m.method === 'initialize') {
      if (adapter) throw new Error('Already initialized');
      if (m.params.agent === 'claude') {
        const { query } = await import('../../adapters/remote-claude/index.js');
        adapter = claudeAdapter({ query, options: m.params, emit, request });
      } else if (m.params.agent === 'codex') {
        const child = spawn('/opt/bin/codex', ['app-server'], { env: process.env, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
        adapter = await codexAdapter({ child, options: m.params, emit, request });
      } else throw new Error('Unsupported adapter');
      await adapter.start();
    } else if (m.method === 'send' && adapter) await adapter.send(m.params.prompt);
    else if (m.method === 'interrupt' && adapter) await adapter.interrupt();
    else throw new Error('Unsupported method');
    peer.write({ id: m.id, result: {} });
  } catch { peer.write({ id: m.id, error: { code: -32603, message: 'Worker operation failed; verify provider setup' } }); }
});
peer.on('failure', () => process.exit(1));
process.once('SIGTERM', async () => { await adapter?.stop(); process.exit(0); });
process.stdin.once('end', async () => { await adapter?.stop(); process.exit(0); });
