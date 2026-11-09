// Lean entry for compress hooks (T-053, kickoff/16-compact-output.md §5, latency plan step 2):
// `node core/hooks/compress.js PostToolUse --agent claude --module <module> --compress`, started by the shim
// (yaw-hook.sh) for modules whose hooks on the event are all of kind compress.
// It does what dispatch.js does for those hooks, but loads neither the kit nor the schemas nor the CLI: the
// manifest is read as plain JSON, module.yaml is parsed without validation, and the event record is built by
// adapters.js without schema validation. Like dispatch.js it never fails: every error ends in exit 0 with
// empty stdout (fail open).

import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { parseDocument } from '../lib/yaml.js';
import { matcherAccepts, support } from '../render/agents.js';
import { normalise, record, renderOutput, toolOutput } from './adapters.js';
import { allowed, combine } from './policy.js';
import { appendLog, HookError, logError, muted, readStdin } from './common.js';

const AGENTS = ['claude', 'codex', 'copilot'];
const KIT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// -> exit code 0. io: { stdin, stdout, cwd, env, kitRoot }.
export async function runCompress(args, io = {}) {
  const started = performance.now();
  const env = io.env ?? process.env;
  try {
    const { values, positionals } = parseArgs({ args, options: { agent: { type: 'string' }, module: { type: 'string' }, compress: { type: 'boolean' } }, allowPositionals: true, strict: true });
    const [event] = positionals;
    if (!event || !AGENTS.includes(values.agent) || !/^[a-z][a-z0-9-]*$/.test(values.module ?? '')) throw new HookError('usage: yaw hook <event> --agent claude|codex|copilot --module <module> --compress');
    const text = await readStdin(io.stdin ?? process.stdin);
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new HookError(`invalid JSON payload (${Buffer.byteLength(text)} bytes)`);
    }
    const root = io.cwd ?? process.cwd();
    const kitRoot = io.kitRoot ?? KIT_ROOT;
    const ev = normalise({ agent: values.agent, event, payload });
    if (!JSON.parse(readFileSync(join(root, '.yaw', 'manifest.json'), 'utf8')).modules?.[values.module]?.enabled) return 0;
    const dir = join(kitRoot, 'modules', values.module);
    const file = join(dir, 'module.yaml');
    const def = parseDocument(readFileSync(file, 'utf8'), { file }).value;
    const items = (def.outputs?.hooks ?? []).filter((h) => h.kind === 'compress' && h.event === ev.event
      && support(def, h, ev.agent) !== 'none'
      && (ev.tool === null || matcherAccepts(ev.agent, h.matcher, ev.toolNames)));
    const original = toolOutput(ev, payload);
    const outputs = [];
    for (const item of items) {
      let result;
      try {
        const handler = (await import(pathToFileURL(join(dir, 'hooks', `${item.name}.js`)).href)).default;
        result = await muted(() => handler(ev, { root, kitRoot, module: def, item, env, toolResponse: structuredClone(original) }));
      } catch (e) {
        logError(env, `${values.module}/${item.name}`, e);
        continue;
      }
      outputs.push(allowed({ kind: 'compress', event: ev.event, agent: ev.agent, result, original }));
    }
    const out = combine(outputs);
    const hookMs = Math.round((performance.now() - started) * 10) / 10;
    if (ev.sessionId) appendLog(env, 'hooks.jsonl', JSON.stringify(record(ev, { result: 'ok', hookMs, compressed: out.compressed ?? null })));
    const stdout = renderOutput(ev.agent, ev.event, out);
    if (stdout) (io.stdout ?? process.stdout).write(stdout);
  } catch (e) {
    logError(env, 'yaw hook --compress', e);
  }
  return 0;
}

try {
  if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = await runCompress(process.argv.slice(2));
} catch { /* not run as a script */ }
