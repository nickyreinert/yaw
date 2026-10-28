import { JsonPeer } from './rpc.js';

export async function codexAdapter({ child, options = {}, emit, request }) {
  const peer = new JsonPeer(child.stdout, child.stdin);
  let thread, turn, busy = false;
  child.stderr.resume(); child.on('error', () => peer.rejectAll()); child.once('close', () => { peer.rejectAll(); emit({ type: 'exit' }); });
  peer.on('failure', () => child.kill('SIGTERM'));
  peer.on('notification', ({ method, params: p }) => {
    if (p?.threadId && p.threadId !== thread) return;
    if (method === 'turn/started') turn = p.turn.id;
    if (method === 'turn/completed') { busy = false; turn = null; emit({ type: 'done', failed: p.turn.status === 'failed' }); }
    if (method === 'item/completed') {
      if (p.item?.type === 'agentMessage') emit({ type: 'message', role: 'assistant', text: p.item.text });
      if (p.item?.type === 'fileChange') emit({ type: 'files', text: (p.item.changes ?? []).map((c) => c.path).join('\n') });
    }
    if (method === 'item/started' && p.item?.type !== 'agentMessage') emit({ type: 'activity', text: p.item?.type ?? 'Working' });
  });
  peer.on('request', async (m) => {
    const p = m.params ?? {};
    // Unknown server requests fail closed. Never forward a request for a different turn.
    if (p.threadId !== thread || !turn || p.turnId !== turn) return peer.write({ id: m.id, error: { code: -32601, message: 'Unowned request' } });
    try {
      if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(m.method)) {
        const r = await request({ kind: 'tool', tool: m.method, input: p });
        peer.write({ id: m.id, result: { decision: r.allow ? 'accept' : 'decline' } });
      } else if (m.method === 'item/tool/requestUserInput') {
        const r = await request({ kind: 'question', tool: m.method, input: p });
        peer.write({ id: m.id, result: { answers: r.allow ? Object.fromEntries(Object.entries(r.answers ?? {}).map(([id, answer]) => [id, { answers: Array.isArray(answer) ? answer : [String(answer)] }])) : {} } });
      } else peer.write({ id: m.id, error: { code: -32601, message: 'Unsupported request' } });
    } catch { peer.write({ id: m.id, error: { code: -32603, message: 'Request denied' } }); }
  });
  await peer.request('initialize', { clientInfo: { name: 'yaw_remote', title: 'YAW Remote', version: '0.1.0' }, capabilities: {} });
  peer.write({ method: 'initialized' });
  const result = await peer.request(options.session ? 'thread/resume' : 'thread/start', {
    ...(options.session ? { threadId: options.session } : {}), ...(options.model ? { model: options.model } : {}),
    cwd: '/work', approvalPolicy: 'untrusted', sandbox: 'workspaceWrite', config: { web_search: 'disabled' },
  });
  thread = result.thread.id; emit({ type: 'session', id: thread });
  return {
    async start() {},
    async send(prompt) {
      if (busy) throw new Error('Worker is busy'); busy = true;
      const r = await peer.request('turn/start', { threadId: thread, input: [{ type: 'text', text: prompt, text_elements: [] }] }); turn = r.turn.id;
    },
    async interrupt() { if (turn) await peer.request('turn/interrupt', { threadId: thread, turnId: turn }); },
    async stop() { child.kill('SIGTERM'); peer.rejectAll(); },
  };
}
