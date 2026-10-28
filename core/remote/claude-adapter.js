// Optional SDK supplied by adapters/remote-claude; no dependency added to the core CLI.
export function claudeAdapter({ query, options = {}, emit, request }) {
  let stream, wake, done = false, busy = false, session = options.session;
  const queue = [];
  async function* prompts() {
    while (!done) {
      if (!queue.length) await new Promise((r) => { wake = r; });
      while (queue.length) yield { type: 'user', message: { role: 'user', content: queue.shift() }, parent_tool_use_id: null, session_id: session ?? '' };
    }
  }
  const abortController = new AbortController();
  return {
    async start() {
      stream = query({ prompt: prompts(), options: {
        cwd: '/work', env: process.env, systemPrompt: { type: 'preset', preset: 'claude_code' }, settingSources: ['project'],
        permissionMode: 'default', ...(options.model ? { model: options.model } : {}), ...(session ? { resume: session } : {}),
        abortController, maxTurns: 100, maxBudgetUsd: 10,
        canUseTool: async (name, input, context) => {
          const response = await request({ kind: name === 'AskUserQuestion' ? 'question' : 'tool', tool: name, input });
          if (context.signal.aborted || !response.allow) return { behavior: 'deny', message: 'Owner declined, request expired, or execution interrupted' };
          return { behavior: 'allow', updatedInput: name === 'AskUserQuestion' ? { ...input, answers: response.answers } : input };
        },
      } });
      (async () => {
        try {
          for await (const m of stream) {
            if (m.type === 'system' && m.subtype === 'init') { session = m.session_id; emit({ type: 'session', id: session }); }
            if (m.type === 'assistant') for (const block of m.message?.content ?? []) {
              if (block.type === 'text') emit({ type: 'message', role: 'assistant', text: block.text });
              if (block.type === 'tool_use') emit({ type: 'activity', text: block.name });
            }
            if (m.type === 'result') { busy = false; emit({ type: 'done', failed: m.is_error === true || m.subtype !== 'success' }); }
          }
        } catch { if (!done) emit({ type: 'notice', text: 'Claude worker failed; check installed SDK version and provider authentication.' }); }
        finally { if (!done) emit({ type: 'exit' }); }
      })();
    },
    async send(prompt) { if (busy || done) throw new Error('Worker is busy or closed'); busy = true; queue.push(prompt); wake?.(); wake = null; },
    async interrupt() { await stream.interrupt(); },
    async stop() { done = true; abortController.abort(); wake?.(); stream?.close(); },
  };
}
