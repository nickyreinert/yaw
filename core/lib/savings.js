// Compact-output savings (T-056, L5): rawBytes/outBytes per tool and method, read back from the sizes-only logs that the
// compress hook (hooks.jsonl) and `yaw run` (run.jsonl) write. No output text is ever stored or read here.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { yawHome } from '../hooks/common.js';

const size = (n) => Number.isFinite(n) && n >= 0 ? n : null;

function records(env, file) {
  const out = [];
  for (const name of [`${file}.1`, file]) {
    const path = join(yawHome(env), 'logs', name);
    if (!existsSync(path)) continue;
    let text;
    try { text = readFileSync(path, 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      try { const r = JSON.parse(line); if (r && typeof r === 'object') out.push(r); } catch { /* skip damaged lines */ }
    }
  }
  return out;
}

// -> { entries: [{ source: 'hook'|'run', tool, method, calls, rawBytes, outBytes }], sessions: ['<agent>:<native id>'] }
// `sessions` are the sessions in which a compress hook replaced at least one output ("module on").
export function readSavings(env = process.env) {
  const table = new Map(), sessions = new Set();
  const add = (source, tool, method, raw, out) => {
    if (typeof tool !== 'string' || size(raw) === null || size(out) === null) return;
    const key = `${source}\u0000${tool}\u0000${method}`;
    const e = table.get(key) ?? { source, tool, method, calls: 0, rawBytes: 0, outBytes: 0 };
    e.calls++; e.rawBytes += raw; e.outBytes += out;
    table.set(key, e);
  };
  for (const r of records(env, 'hooks.jsonl')) {
    if (size(r.rawBytes) === null) continue;
    add('hook', r.tool?.name, typeof r.method === 'string' ? r.method : 'unknown', r.rawBytes, r.outBytes);
    if (typeof r.sessionId === 'string' && typeof r.agent === 'string') sessions.add(`${r.agent}:${r.sessionId}`);
  }
  for (const r of records(env, 'run.jsonl')) add('run', r.step, typeof r.method === 'string' ? r.method : 'unknown', r.rawBytes, r.outBytes);
  return { entries: [...table.values()], sessions: [...sessions] };
}
