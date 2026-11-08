// `yaw run --compact [--step <name>] [--warn <regex>] -- <command> [args...]` (T-050, kickoff/16-compact-output.md
// §4 L1): runs one recipe step. Compact output is on when resolveCompact gives the `recipes` lever:
//   exit 0           one line, `ok <step> (<n> lines, <s>s)`
//   exit 0, warnings `<step>: <m> warnings`, the first 10 warning lines, `… +<k> more warnings`
//   exit not 0       ANSI removed, `\r` progress cut to its last frame, 3+ identical adjacent lines collapsed,
//                    head and tail kept with the re-run hint at the end; the exit code is kept
// Otherwise, and with YAW_VERBOSE=1, the output is passed through unchanged. Each compact run appends
// { step, method, exitCode, rawBytes, outBytes, ms } to ~/.yaw/logs/run.jsonl, never output.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { constants } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { appendLog } from '../../../core/hooks/common.js';
import { readAnswers } from '../../../core/render/project.js';
import { UsageError } from '../../../core/cli/commands.js';
import { storeRecall } from './recall.js';
import { resolveCompact } from './settings.js';

const WARNINGS_SHOWN = 10;
const HEAD = 40;
const TAIL = 60;
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

// The project the step runs in: the nearest folder up from cwd with .yaw/answers.yaml (a composed profile
// runs in <root>/<profile>/).
function projectRoot(cwd) {
  for (let dir = cwd; ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.yaw', 'answers.yaml'))) return dir;
    if (dirname(dir) === dir) return null;
  }
}

// The levers in force for a step, [] when compact output is off (YAW_VERBOSE=1 included).
function activeLevers(env, cwd) {
  if (env.YAW_VERBOSE === '1') return [];
  const root = projectRoot(cwd);
  let answers = {};
  try { if (root) answers = readAnswers(root).answers ?? {}; } catch { /* unreadable answers: no project answer */ }
  const { levers } = resolveCompact({ env, root: root ?? cwd, answers });
  return levers.includes('recipes') ? levers : [];
}

const exitCode = (code, signal) => code ?? 128 + (constants.signals[signal] ?? 0);

function lines(text) {
  const rows = text.split('\n');
  if (rows.at(-1) === '') rows.pop();
  return rows;
}

// Failure output: ANSI, progress frames and repeats removed, then head and tail with the hint. `store` (the
// recall lever) is called with nothing when the output is cut and returns the recall hash, or null.
export function condense(text, store) {
  const rows = lines(text.replace(ANSI, '').replace(/\r\n/g, '\n')).map((l) => l.split('\r').filter(Boolean).at(-1) ?? '');
  const out = [];
  for (let i = 0; i < rows.length;) {
    let n = 1;
    while (rows[i + n] === rows[i]) n++;
    out.push(rows[i]);
    if (n >= 3) out.push(`… ${n - 1} more identical lines`);
    else if (n === 2) out.push(rows[i]);
    i += n;
  }
  if (out.length <= HEAD + TAIL) return out;
  const hash = store?.() ?? null;
  const hint = hash ? `full output: yaw recall ${hash}` : 're-run with YAW_VERBOSE=1 for the full output';
  return [...out.slice(0, HEAD), `… ${out.length - HEAD - TAIL} lines cut …`, ...out.slice(-TAIL), hint];
}

// -> { text, method } for one finished step.
export function summarize({ step, code, output, seconds, warn, store }) {
  if (code !== 0) {
    const rows = condense(output, store);
    return { text: rows.length > 0 ? `${rows.join('\n')}\n` : '', method: 'failed' };
  }
  const rows = lines(output);
  const warnings = warn ? rows.map((l) => l.replace(ANSI, '')).filter((l) => warn.test(l)) : [];
  if (warnings.length === 0) return { text: `ok ${step} (${rows.length} lines, ${seconds.toFixed(1)}s)\n`, method: 'ok' };
  const more = warnings.length - WARNINGS_SHOWN;
  return { text: [`${step}: ${warnings.length} warnings`, ...warnings.slice(0, WARNINGS_SHOWN), ...(more > 0 ? [`… +${more} more warnings`] : [])].join('\n') + '\n', method: 'warnings' };
}

function spawnStep(command, args, io, capture) {
  return new Promise((resolve) => {
    const inherit = !capture && io.stdout === process.stdout && io.stderr === process.stderr;
    const child = spawn(command, args, { cwd: io.cwd, env: io.env, stdio: inherit ? 'inherit' : ['inherit', 'pipe', 'pipe'] });
    const chunks = [];
    if (!inherit) {
      child.stdout.on('data', (c) => (capture ? chunks.push(c) : io.stdout.write(c)));
      child.stderr.on('data', (c) => (capture ? chunks.push(c) : io.stderr.write(c)));
    }
    child.on('error', (e) => {
      io.stderr.write(`yaw run: ${command}: ${e.code === 'ENOENT' ? 'command not found' : e.message}\n`);
      resolve({ code: 127, output: Buffer.concat(chunks) });
    });
    child.on('close', (code, signal) => resolve({ code: exitCode(code, signal), output: Buffer.concat(chunks) }));
  });
}

export async function run({ values, positionals, io }) {
  const [command, ...args] = positionals;
  if (!command) throw new UsageError('give the command after --');
  let warn = null;
  if (values.warn) {
    try { warn = new RegExp(values.warn); } catch { throw new UsageError(`--warn is not a valid regular expression: ${values.warn}`); }
  }
  const env = io.env ?? process.env;
  const levers = values.compact ? activeLevers(env, io.cwd) : [];
  if (levers.length === 0) return (await spawnStep(command, args, { ...io, env }, false)).code;
  const step = values.step || basename(command);
  const started = performance.now();
  const { code, output } = await spawnStep(command, args, { ...io, env }, true);
  const ms = Math.round(performance.now() - started);
  const store = levers.includes('recall') ? () => storeRecall(env, output) : undefined;
  const { text, method } = summarize({ step, code, output: output.toString('utf8'), seconds: ms / 1000, warn, store });
  io.stdout.write(text);
  appendLog(env, 'run.jsonl', JSON.stringify({ v: 1, ts: new Date().toISOString(), step, method, exitCode: code, rawBytes: output.length, outBytes: Buffer.byteLength(text), ms }));
  return code;
}
