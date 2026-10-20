// Hook output policy (ADR-0007, BUILD.md rule 5): what a handler of each kind may return.
// The dispatcher passes every handler result through allowed(); everything else is dropped.

export const CONTEXT_MAX_LINES = 10;
export const CONTEXT_MAX_CHARS = 1000;
export const REASON_MAX_CHARS = 300;

const COMFORT = {
  systemMessage: ['claude', 'codex'],
  terminalSequence: ['claude'],
};

function oneLine(text, max) {
  const s = String(text).replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function clipContext(text) {
  const lines = String(text).replace(/\r\n/g, '\n').trim().split('\n').slice(0, CONTEXT_MAX_LINES).join('\n');
  return lines.length > CONTEXT_MAX_CHARS ? lines.slice(0, CONTEXT_MAX_CHARS) : lines;
}

// kind: guard | context | comfort | evaluation; event: normalised event name; result: handler return value.
// -> { deny?: reason, context?: text, systemMessage?: text, terminalSequence?: text } (possibly empty)
export function allowed({ kind, event, agent, result }) {
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
  }
  // evaluation: nothing, ever
  return out;
}

// Combine the allowed outputs of several handlers: deny reasons and contexts are joined.
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
