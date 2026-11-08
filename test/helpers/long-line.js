// T-016: a transcript with one oversized line, and the peak memory a reader needs to skip it, measured in a fresh process.
import { closeSync, openSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Three JSON lines; the string 'PAD' in `padded` is replaced by `mib` MiB of padding, written in chunks so it is never held whole.
export function longLineFile(dir, before, padded, after, mib = 64) {
  const file = join(dir, 'long.jsonl');
  const [head, tail] = JSON.stringify(padded).split('"PAD"');
  const fd = openSync(file, 'w');
  try {
    writeSync(fd, `${JSON.stringify(before)}\n${head}"`);
    const pad = 'x'.repeat(1024 * 1024);
    for (let n = 0; n < mib; n++) writeSync(fd, pad);
    writeSync(fd, `"${tail}\n${JSON.stringify(after)}\n`);
  } finally { closeSync(fd); }
  return file;
}

// Runs `call` (an expression using `mod`, the imported module, and `file`) in a child; returns its result and the
// growth of peak RSS in MiB during the call.
export function peakDuring(modulePath, call, file) {
  const script = `const mod = await import(${JSON.stringify(pathToFileURL(modulePath).href)}); const file = ${JSON.stringify(file)};
const before = process.resourceUsage().maxRSS; const result = await (${call});
console.log(JSON.stringify({ grewMiB: (process.resourceUsage().maxRSS - before) / 1024, result }));`;
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(run.stderr);
  return JSON.parse(run.stdout);
}
