// Output methods of the compress hook (T-054, kickoff/16-compact-output.md §4 L2): `ansi`, `progress`, `dedup`,
// `cap`, grep grouping by file and the lockfile summary. Pure functions without imports, so the lean hook entry
// (T-053) stays lean. Each returns a shorter version of the real output; nothing is stored, so a cut ends with
// the re-run hint.

export const CAP_LINES = 300;
const CAP_HEAD = 50;
const CAP_TAIL = 200;
export const RERUN_HINT = 're-run with YAW_VERBOSE=1 for the full output';
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

// text -> { rows, end } where end is the final newline, if any.
function split(text) {
  const rows = text.split('\n');
  const end = rows.at(-1) === '' ? (rows.pop(), '\n') : '';
  return { rows, end };
}

export const ansi = (text) => text.replace(ANSI, '');

// `\r` progress: each line keeps its last frame.
export function progress(text) {
  return text.replace(/\r\n/g, '\n').split('\n').map((l) => (l.includes('\r') ? l.split('\r').filter(Boolean).at(-1) ?? '' : l)).join('\n');
}

// Three or more identical adjacent lines: the line once and a count.
export function dedup(text) {
  const { rows, end } = split(text);
  const out = [];
  for (let i = 0; i < rows.length;) {
    let n = 1;
    while (i + n < rows.length && rows[i + n] === rows[i]) n++;
    if (n >= 3) out.push(rows[i], `… ${n - 1} more identical lines`);
    else out.push(...rows.slice(i, i + n));
    i += n;
  }
  return out.join('\n') + end;
}

// Over 300 lines: the first 50 and the last 200, then the re-run hint.
export function cap(text) {
  const { rows, end } = split(text);
  if (rows.length <= CAP_LINES) return text;
  return [...rows.slice(0, CAP_HEAD), `… ${rows.length - CAP_HEAD - CAP_TAIL} lines cut …`, ...rows.slice(-CAP_TAIL), RERUN_HINT].join('\n') + end;
}

const METHODS = { ansi, progress, dedup, cap };

// -> { text, methods: names of the methods that changed something, in order }
export function condense(text) {
  const methods = [];
  for (const [name, fn] of Object.entries(METHODS)) {
    const next = fn(text);
    if (next !== text) methods.push(name);
    text = next;
  }
  return { text, methods };
}

// Grep content lines `path:line:text`, grouped by file: the path once, then `  line:text`. -> null unless every
// line has that form (context lines, separators and output without line numbers stay as they are).
export function groupGrep(content) {
  const out = [];
  let file = null;
  for (const row of content.split('\n')) {
    const m = /^(.+?):(\d+):(.*)$/.exec(row);
    if (!m) return null;
    if (m[1] !== file) out.push((file = m[1]));
    out.push(`  ${m[2]}:${m[3]}`);
  }
  return out.join('\n');
}

const at = (spec) => spec.indexOf('@', 1);

function npmLock(text) {
  const lock = JSON.parse(text);
  const out = [];
  if (lock.packages) {
    for (const [key, p] of Object.entries(lock.packages)) {
      if (key === '' || !p?.version) continue;
      out.push(`${p.name ?? key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length)}@${p.version}`);
    }
  } else {
    const walk = (deps) => {
      for (const [name, p] of Object.entries(deps ?? {})) {
        if (p?.version) out.push(`${name}@${p.version}`);
        walk(p?.dependencies);
      }
    };
    walk(lock.dependencies);
  }
  return out;
}

function composerLock(text) {
  const lock = JSON.parse(text);
  return [...(lock.packages ?? []), ...(lock['packages-dev'] ?? [])].filter((p) => p?.name && p.version).map((p) => `${p.name}@${p.version}`);
}

// yarn.lock, classic (`version "1.0.0"`) and berry (`version: 1.0.0`).
function yarnLock(text) {
  const out = [];
  let name = null;
  for (const row of text.split('\n')) {
    if (/^[^\s#].*:$/.test(row)) {
      const spec = row.slice(0, -1).split(', ')[0].replace(/^"|"$/g, '');
      name = spec === '__metadata' || at(spec) < 0 ? null : spec.slice(0, at(spec));
      continue;
    }
    const v = /^\s+version:? "?([^"\s]+)"?$/.exec(row);
    if (name && v) {
      out.push(`${name}@${v[1]}`);
      name = null;
    }
  }
  return out;
}

// pnpm-lock.yaml: the keys of `packages:` (v9 `name@1.0.0`, v6 `/name@1.0.0(peer@…)`, v5 `/name/1.0.0`).
function pnpmLock(text) {
  const out = [];
  let inPackages = false;
  for (const row of text.split('\n')) {
    if (/^\S/.test(row)) inPackages = row === 'packages:';
    const m = inPackages && /^ {2}'?\/?([^\s'(]+)(?:\([^']*\))?'?:\s*$/.exec(row);
    if (!m) continue;
    const key = m[1];
    const cut = at(key) > 0 ? at(key) : key.lastIndexOf('/');
    if (cut > 0) out.push(`${key.slice(0, cut)}@${key.slice(cut + 1)}`);
  }
  return out;
}

// Cargo.lock, poetry.lock, uv.lock: `[[package]]` tables with `name` and `version`.
function tomlLock(text) {
  const out = [];
  let pkg = null;
  for (const row of text.split('\n')) {
    if (row.startsWith('[')) {
      pkg = row === '[[package]]' ? {} : null;
      continue;
    }
    const m = pkg && /^(name|version) = "(.+)"$/.exec(row);
    if (!m) continue;
    pkg[m[1]] ??= m[2];
    if (pkg.name && pkg.version) {
      out.push(`${pkg.name}@${pkg.version}`);
      pkg = null;
    }
  }
  return out;
}

function goSum(text) {
  return text.split('\n').map((row) => /^(\S+) (v[^\s/]+)(?:\/go\.mod)? /.exec(row)).filter(Boolean).map((m) => `${m[1]}@${m[2]}`);
}

// The lockfiles of the kit's profiles (node, python, rust, go, php).
const LOCKFILES = {
  'package-lock.json': npmLock,
  'npm-shrinkwrap.json': npmLock,
  'yarn.lock': yarnLock,
  'pnpm-lock.yaml': pnpmLock,
  'Cargo.lock': tomlLock,
  'poetry.lock': tomlLock,
  'uv.lock': tomlLock,
  'go.sum': goSum,
  'composer.lock': composerLock,
};

export const isLockfile = (name) => Object.hasOwn(LOCKFILES, name);

// A lockfile's text -> a note and one `name@version` line per package, or null (not a lockfile, unreadable, empty).
export function lockfile(name, text) {
  if (!isLockfile(name)) return null;
  let list;
  try {
    list = [...new Set(LOCKFILES[name](text))];
  } catch {
    return null;
  }
  if (list.length === 0) return null;
  return [`[lockfile summary: ${list.length} packages as name@version; an Edit old_string will not match; Read with offset and limit for the raw lines]`, ...list].join('\n');
}
