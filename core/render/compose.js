// Shared-file composition (ADR-0004).
//
// A shared file is written by several modules. One owner module (always `core` in phase 1) renders
// the whole file from the parts of every enabled module: the owner's own template is the frame,
// every other part sits in a block marked with its module name. Each non-owner module's part is
// recorded as a fragment with its hash (manifest files[].fragments). Adding or removing a module
// re-composes the file, and the result goes through the normal update flow (ADR-0003).

import { hashContent } from './files.js';

// M16: hard line budget for the assembled AGENTS.md (ADR-0009).
export const AGENTS_MAX_LINES = 80;

export const SHARED_FILES = {
  'AGENTS.md': { owner: 'core', style: 'markdown' },
  'justfile': { owner: 'core', style: 'lines' },
  '.gitignore': { owner: 'core', style: 'lines' },
  '.github/pull_request_template.md': { owner: 'core', style: 'markdown' },
  '.claude/settings.json': { owner: 'core', style: 'json' },
  '.codex/hooks.json': { owner: 'core', style: 'json' },
};

export class ComposeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ComposeError';
  }
}

const MARKERS = {
  markdown: (m) => [`<!-- yaw:${m} -->`, `<!-- /yaw:${m} -->`],
  lines: (m) => [`# yaw:${m}`, `# /yaw:${m}`],
};

export function markers(style, module) {
  return MARKERS[style]?.(module) ?? null;
}

// parts: [{ module, kind: 'template' | 'agentsMd', content }]
// -> { content: string | null (no parts: the file is not produced), fragments: [{ module, hash }] }
export function compose(path, spec, parts) {
  const byModule = new Map();
  for (const p of parts) {
    if (!byModule.has(p.module)) byModule.set(p.module, []);
    byModule.get(p.module).push(p);
  }
  const order = [...byModule.keys()].sort((a, b) =>
    a === spec.owner ? -1 : b === spec.owner ? 1 : a < b ? -1 : a > b ? 1 : 0);
  const fragments = [];
  if (spec.style === 'json') {
    let acc;
    for (const module of order) {
      const values = byModule.get(module).map((p) => {
        try {
          return JSON.parse(String(p.content));
        } catch (e) {
          throw new ComposeError(`${path}: part from module "${module}" is not valid JSON: ${e.message}`);
        }
      });
      for (const value of values) acc = acc === undefined ? value : merge(acc, value, path, module, '');
      if (module !== spec.owner) fragments.push({ module, hash: hashContent(JSON.stringify(values.length === 1 ? values[0] : values)) });
    }
    return { content: acc === undefined ? null : `${JSON.stringify(acc, null, 2)}\n`, fragments };
  }
  const blocks = [];
  for (const module of order) {
    const list = byModule.get(module);
    const frame = module === spec.owner ? list.filter((p) => p.kind === 'template') : [];
    const wrapped = list.filter((p) => !frame.includes(p));
    for (const p of frame) blocks.push(oneTrailingNewline(String(p.content)));
    if (wrapped.length > 0) {
      const body = wrapped.map((p) => oneTrailingNewline(String(p.content))).join('');
      const [open, close] = markers(spec.style, module);
      blocks.push(`${open}\n${body}${close}\n`);
      if (module !== spec.owner) fragments.push({ module, hash: hashContent(body) });
    }
  }
  return { content: blocks.length === 0 ? null : blocks.join('\n'), fragments };
}

function oneTrailingNewline(text) {
  return `${text.replace(/\n+$/, '')}\n`;
}

// Objects merge key by key, arrays concatenate, equal scalars are fine, differing scalars are an error.
function merge(a, b, path, module, pointer) {
  if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
  if (isObject(a) && isObject(b)) {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = Object.hasOwn(out, k) ? merge(out[k], v, path, module, `${pointer}/${k}`) : v;
    return out;
  }
  if (JSON.stringify(a) === JSON.stringify(b)) return a;
  throw new ComposeError(`${path}: module "${module}" sets ${pointer || '/'} to a different value than an earlier module`);
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
