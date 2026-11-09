// Hook output policy (ADR-0007, BUILD.md rule 5): what a handler of each kind may return.
// The dispatcher passes every handler result through allowed(); everything else is dropped.

export const CONTEXT_MAX_LINES = 10;
export const CONTEXT_MAX_CHARS = 1000;
export const REASON_MAX_CHARS = 300;

const COMFORT = {
  systemMessage: ['claude', 'codex'],
  terminalSequence: ['claude'],
};

// Agents whose PostToolUse output YAW may replace: Claude Code (fixtures, T-047). Copilot's `modifiedResult` is
// not verified; Codex cannot replace tool output.
const COMPRESS = ['claude'];
// The method goes to the event log, so it is a short identifier, never text from the output.
const METHOD = /^[a-z][a-z0-9+-]{0,39}$/;

const bytes = (value) => Buffer.byteLength(JSON.stringify(value));

function oneLine(text, max) {
  const s = String(text).replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function clipContext(text) {
  const lines = String(text).replace(/\r\n/g, '\n').trim().split('\n').slice(0, CONTEXT_MAX_LINES).join('\n');
  return lines.length > CONTEXT_MAX_CHARS ? lines.slice(0, CONTEXT_MAX_CHARS) : lines;
}

// kind: guard | context | comfort | evaluation | compress; event: normalised event name; result: handler return
// value; original: the tool's output (compress only).
// -> { deny?: reason, context?: text, systemMessage?: text, terminalSequence?: text,
//      updatedToolOutput?: value, compressed?: { rawBytes, outBytes, method } } (possibly empty)
export function allowed({ kind, event, agent, result, original }) {
  const out = {};
  if (!result || typeof result !== 'object') return out;
  if (kind === 'guard') {
    if (event === 'PreToolUse' && result.decision === 'deny' && typeof result.reason === 'string' && result.reason.trim()) {
      out.deny = oneLine(result.reason, REASON_MAX_CHARS);
    }
  } else if (kind === 'context') {
    if (event === 'SessionStart' && typeof result.context === 'string' && result.context.trim()) out.context = clipContext(result.context);
  } else if (kind === 'comfort') {
    for (const [field, agents] of Object.entries(COMFORT)) {
      if (agents.includes(agent) && typeof result[field] === 'string' && result[field] !== '') out[field] = result[field];
    }
  } else if (kind === 'compress') {
    // A replacement in the tool's own JSON type, kept only when smaller than the original (never worse).
    const update = result.updatedToolOutput;
    if (event === 'PostToolUse' && COMPRESS.includes(agent) && original != null && update != null
      && typeof update === typeof original && Array.isArray(update) === Array.isArray(original)) {
      const rawBytes = bytes(original);
      const outBytes = bytes(update);
      if (outBytes < rawBytes) {
        out.updatedToolOutput = update;
        out.compressed = { rawBytes, outBytes, method: typeof result.method === 'string' && METHOD.test(result.method) ? result.method : null };
      }
    }
  }
  // evaluation: nothing, ever
  return out;
}

// Combine the allowed outputs of several handlers: deny reasons and contexts are joined; the first replaced
// output wins, with its sizes.
export function combine(outputs) {
  const acc = {};
  for (const o of outputs) {
    for (const [k, v] of Object.entries(o)) {
      if (k === 'deny') acc.deny = acc.deny ? oneLine(`${acc.deny}; ${v}`, REASON_MAX_CHARS) : v;
      else if (k === 'context') acc.context = clipContext(acc.context ? `${acc.context}\n${v}` : v);
      else if (k === 'systemMessage') acc.systemMessage = acc.systemMessage ? `${acc.systemMessage}\n${v}` : v;
      else acc[k] = acc[k] ?? v;
    }
  }
  return acc;
}
