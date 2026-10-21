// `yaw hook <event> --agent <agent> --module <module>` (Y-4.2, ADR-0021): the one hook entry point.
//
// Reads the agent's JSON payload from stdin, normalises it (adapters.js), runs the handlers of the
// module's hooks for this event (modules/<m>/hooks/<name>.js), keeps only what the hook kind may
// return (policy.js, ADR-0007), prints it in the agent's shape, and appends the normalised event
// (no content) with its timing to ~/.yaw/logs/hooks.jsonl.
// It never fails: every error ends in exit 0 with empty stdout (fail open, doc 13 §3).

import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { hasModule, KIT_ROOT, loadModule, moduleDir, schemas } from '../render/kit.js';
import { readManifest } from '../render/manifest.js';
import { matcherAccepts, support } from '../render/agents.js';
import { EVENTS, normalise, record, renderOutput } from './adapters.js';
import { allowed, combine } from './policy.js';

export const AGENTS = ['claude', 'codex', 'copilot'];
const LOG_MAX_BYTES = 5 * 1024 * 1024;

export function yawHome(env) {
  return env.YAW_HOME || join(env.HOME || '', '.yaw');
}

function readStdin(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(Buffer.from(c)));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

// Append one line to ~/.yaw/logs/<file>; rotate to <file>.1 above 5 MB. Never throws.
function appendLog(env, file, line) {
  try {
    const dir = join(yawHome(env), 'logs');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, file);
    if (existsSync(path) && statSync(path).size > LOG_MAX_BYTES) renameSync(path, `${path}.1`);
    appendFileSync(path, `${line}\n`);
  } catch { /* logging must not affect the session */ }
}

// Errors YAW raises itself; their messages hold no payload content.
class HookError extends Error {}

// Error log, never payload content (B rule 6): YAW's own messages in full; for anything else (a handler,
// JSON.parse, which quotes the input) only the error's name and code.
function logError(env, where, error) {
  const text = error instanceof HookError ? error.message : `${error?.name ?? 'Error'}${error?.code ? ` ${error.code}` : ''} (message not logged)`;
  appendLog(env, 'hook-errors.log', `${new Date().toISOString()} ${where}: ${text}`);
}

// While handlers run, their own writes to stdout/stderr/console are swallowed: on UserPromptSubmit and
// SessionStart plain stdout would reach the model, and stray text breaks the JSON answer (ADR-0007).
async function muted(fn) {
  const saved = { out: process.stdout.write, err: process.stderr.write, console: { ...console } };
  const none = () => true;
  process.stdout.write = none;
  process.stderr.write = none;
  for (const k of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir', 'table']) console[k] = () => {};
  try {
    return await fn();
  } finally {
    process.stdout.write = saved.out;
    process.stderr.write = saved.err;
    Object.assign(console, saved.console);
  }
}

// -> { stdout, result, ran } for one call; exported for tests.
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
  for (const item of items) {
    const file = join(moduleDir(kitRoot, module), 'hooks', `${item.name}.js`);
    let result;
    try {
      const handler = (await import(pathToFileURL(file).href)).default;
      result = await muted(() => handler(ev, { root, kitRoot, manifest, module: def, item, env, prompt }));
    } catch (e) {
      logError(env, `${module}/${item.name}`, e);
      continue;
    }
    ran.push(item);
    outputs.push(allowed({ kind: item.kind, event: ev.event, agent: ev.agent, result }));
  }
  const out = combine(outputs);
  let result = null;
  if (ev.event === 'PreToolUse' && ran.some((i) => i.kind === 'guard')) result = out.deny ? 'deny' : 'allow';
  if (ev.event === 'PostToolUse') result = 'ok';
  if (ev.event === 'PostToolUseFailure') result = 'error';
  return { ev, stdout: renderOutput(ev.agent, ev.event, out), result, ran };
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
    const { ev, stdout, result } = await dispatch({ agent: values.agent, event, module: values.module, payload, root: io.cwd ?? process.cwd(), kitRoot: io.kitRoot ?? KIT_ROOT, env });
    const hookMs = Math.round((performance.now() - started) * 10) / 10;
    if (EVENTS.includes(ev.event) && ev.sessionId) {
      const rec = record(ev, { result, hookMs });
      if (schemas().validate('hook-event.schema.json', rec).length === 0) appendLog(env, 'hooks.jsonl', JSON.stringify(rec));
    }
    if (stdout) (io.stdout ?? process.stdout).write(stdout);
  } catch (e) {
    logError(env, 'yaw hook', e);
  }
  return 0;
}
