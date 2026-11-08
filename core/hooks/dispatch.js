// `yaw hook <event> --agent <agent> --module <module>` (Y-4.2, ADR-0021): the one hook entry point.
//
// Reads the agent's JSON payload from stdin, normalises it (adapters.js), runs the handlers of the
// module's hooks for this event (modules/<m>/hooks/<name>.js), keeps only what the hook kind may
// return (policy.js, ADR-0007), prints it in the agent's shape, and appends the normalised event
// (no content) with its timing to ~/.yaw/logs/hooks.jsonl.
// It never fails: every error ends in exit 0 with empty stdout (fail open, doc 13 §3).

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { hasModule, KIT_ROOT, loadModule, moduleDir, schemas } from '../render/kit.js';
import { readManifest } from '../render/manifest.js';
import { matcherAccepts, support } from '../render/agents.js';
import { EVENTS, normalise, record, renderOutput, toolOutput } from './adapters.js';
import { allowed, combine } from './policy.js';
import { appendLog, HookError, logError, muted, readStdin, yawHome } from './common.js';

export { yawHome };

export const AGENTS = ['claude', 'codex', 'copilot'];

// -> { stdout, result, ran, compressed } for one call; exported for tests.
export async function dispatch({ agent, event, module, payload, root, kitRoot = KIT_ROOT, env = process.env, now = new Date() }) {
  const ev = normalise({ agent, event, payload, now });
  const manifest = readManifest(root);
  if (!manifest || !manifest.modules[module]?.enabled || !hasModule(kitRoot, module)) return { ev, stdout: '', result: null, ran: [] };
  const def = loadModule(kitRoot, module);
  const items = (def.outputs?.hooks ?? []).filter((h) => h.event === ev.event
    && support(def, h, ev.agent) !== 'none'
    && (ev.tool === null || matcherAccepts(ev.agent, h.matcher, ev.toolNames)));
  const outputs = [];
  const ran = [];
  // The prompt text is handed to handlers in memory (the decisions recall, ADR-0028); like tool input it never
  // enters the normalised event or any log (ADR-0018).
  const prompt = typeof payload?.prompt === 'string' ? payload.prompt : null;
  // The transcript path is metadata for the session registry (ADR-0029); like the prompt it stays in memory, and
  // no handler opens it.
  const transcript = typeof payload?.transcript_path === 'string' ? payload.transcript_path : null;
  // The notification type (permission_prompt, idle_prompt, ...) is a short enum string; comfort notifications
  // read it (ADR-0030). Nothing else of the payload is handed on.
  const notificationType = typeof payload?.notification_type === 'string' && /^[a-z_]{1,40}$/.test(payload.notification_type) ? payload.notification_type : null;
  // The tool's output goes to compress handlers only, in memory (ADR-0007); other kinds never see it.
  const original = toolOutput(ev, payload);
  for (const item of items) {
    const file = join(moduleDir(kitRoot, module), 'hooks', `${item.name}.js`);
    let result;
    try {
      const handler = (await import(pathToFileURL(file).href)).default;
      const ctx = { root, kitRoot, manifest, module: def, item, env, prompt, transcript, notificationType };
      if (item.kind === 'compress') ctx.toolResponse = structuredClone(original);
      result = await muted(() => handler(ev, ctx));
    } catch (e) {
      logError(env, `${module}/${item.name}`, e);
      continue;
    }
    ran.push(item);
    outputs.push(allowed({ kind: item.kind, event: ev.event, agent: ev.agent, result, original }));
  }
  const out = combine(outputs);
  let result = null;
  if (ev.event === 'PreToolUse' && ran.some((i) => i.kind === 'guard')) result = out.deny ? 'deny' : 'allow';
  if (ev.event === 'PostToolUse') result = 'ok';
  if (ev.event === 'PostToolUseFailure') result = 'error';
  return { ev, stdout: renderOutput(ev.agent, ev.event, out), result, ran, compressed: out.compressed ?? null };
}

// CLI entry; always resolves to 0. io: { stdin, stdout, cwd, env, kitRoot }.
export async function runHook(args, io) {
  const started = performance.now();
  const env = io.env ?? process.env;
  try {
    const { values, positionals } = parseArgs({ args, options: { agent: { type: 'string' }, module: { type: 'string' } }, allowPositionals: true, strict: true });
    const [event] = positionals;
    if (!event || !AGENTS.includes(values.agent) || !values.module) throw new HookError('usage: yaw hook <event> --agent claude|codex|copilot --module <module>');
    const text = await readStdin(io.stdin ?? process.stdin);
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new HookError(`invalid JSON payload (${Buffer.byteLength(text)} bytes)`);
    }
    const { ev, stdout, result, compressed } = await dispatch({ agent: values.agent, event, module: values.module, payload, root: io.cwd ?? process.cwd(), kitRoot: io.kitRoot ?? KIT_ROOT, env });
    const hookMs = Math.round((performance.now() - started) * 10) / 10;
    if (EVENTS.includes(ev.event) && ev.sessionId) {
      const rec = record(ev, { result, hookMs, compressed });
      if (schemas().validate('hook-event.schema.json', rec).length === 0) appendLog(env, 'hooks.jsonl', JSON.stringify(rec));
    }
    if (stdout) (io.stdout ?? process.stdout).write(stdout);
  } catch (e) {
    logError(env, 'yaw hook', e);
  }
  return 0;
}
