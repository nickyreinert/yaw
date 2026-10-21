// Per-agent hook adapters (ADR-0021): payload -> normalised event (ADR-0018) and YAW decision -> the
// agent's output shape (ADR-0007). Field names: docs/spec/formats.md#normalised-hook-event.

export const EVENTS = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'StopFailure', 'SubagentStop', 'Notification', 'PreCompact'];

const str = (v) => (typeof v === 'string' && v !== '' ? v : null);

// Which agent sent the payload. Commands in .claude/settings.json say --agent claude, but Copilot
// runs them too (ADR-0021). Under Claude event names Copilot sends Claude-style snake_case payloads
// plus `timestamp` (Copilot CLI hooks reference); Claude Code's payloads have no `timestamp`.
export function detectAgent(declared, payload) {
  if (declared === 'claude' && payload && Object.hasOwn(payload, 'timestamp')) return 'copilot';
  return declared;
}

// Paths an apply_patch body touches (Codex patch format: "*** Add|Update|Delete File: <path>", "*** Move to: <path>").
export function patchPaths(patch) {
  const out = [];
  for (const m of String(patch).matchAll(/^\*\*\* (?:(?:Add|Update|Delete) File|Move to): (.+)$/gm)) out.push(m[1].trim());
  return out;
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// Tool input reduced to what agent-independent handlers need; held in memory only, never written.
function toolInput(agent, toolName, input) {
  const i = input && typeof input === 'object' ? input : {};
  if (agent === 'codex' && toolName === 'apply_patch') return { command: null, paths: patchPaths(i.command ?? i.patch ?? i.input ?? '') };
  const command = Array.isArray(i.command) ? i.command.join(' ') : str(i.command);
  const paths = [i.file_path, i.path, i.notebook_path, i.glob].filter((p) => typeof p === 'string' && p !== '');
  return { command, paths, runInBackground: i.run_in_background === true };
}

// Tool names a matcher is tested against: the native one plus its Claude equivalents.
function toolNames(agent, name) {
  if (!name) return [];
  if (agent === 'codex' && name === 'apply_patch') return ['apply_patch', 'Edit', 'Write', 'MultiEdit'];
  return [name];
}

function isoTime(value, now) {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return now.toISOString();
}

// -> { agent, event, nativeEvent, sessionId, cwd, modelId, modelIdSource, promptLength, tool, toolNames, input, ts }
export function normalise({ agent: declared, event: argEvent, payload, now = new Date() }) {
  const p = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const agent = detectAgent(declared, p);
  // Every payload names its event; the command line's event is the fallback.
  const nativeEvent = str(p.hook_event_name) ?? str(argEvent);
  const tool = str(p.tool_name);
  // Copilot parses tool_input from a JSON string "when possible"; accept both.
  const rawInput = parseMaybeJson(p.tool_input);
  const prompt = typeof p.prompt === 'string' ? p.prompt : null;
  const model = agent === 'copilot' ? null : str(p.model);
  return {
    agent,
    event: nativeEvent,
    nativeEvent,
    sessionId: str(p.session_id),
    cwd: str(p.cwd),
    modelId: model,
    modelIdSource: model ? 'payload' : null,
    promptLength: nativeEvent === 'UserPromptSubmit' && prompt !== null ? [...prompt].length : null,
    tool: tool ? { name: tool } : null,
    toolNames: toolNames(agent, tool),
    input: toolInput(agent, tool, rawInput),
    ts: isoTime(agent === 'copilot' ? p.timestamp : undefined, now),
  };
}

// The record written to the event log (ADR-0018): no prompt text, no tool input, no output.
export function record(ev, { result = null, hookMs = null } = {}) {
  return {
    v: 1,
    agent: ev.agent,
    event: ev.event,
    nativeEvent: ev.nativeEvent,
    sessionId: ev.sessionId,
    cwd: ev.cwd,
    modelId: ev.modelId,
    modelIdSource: ev.modelIdSource,
    promptLength: ev.promptLength,
    tool: ev.tool,
    result,
    timing: { ts: ev.ts, hookMs },
  };
}

// Allowed output (policy.js) -> stdout text for the agent; '' when there is nothing to say.
export function renderOutput(agent, event, out) {
  const json = {};
  if (agent === 'copilot') {
    if (event === 'PreToolUse' && out.deny) Object.assign(json, { permissionDecision: 'deny', permissionDecisionReason: out.deny });
    if (event === 'SessionStart' && out.context) json.additionalContext = out.context;
  } else {
    if (event === 'PreToolUse' && out.deny) {
      json.hookSpecificOutput = { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: out.deny };
    }
    if (event === 'SessionStart' && out.context) json.hookSpecificOutput = { hookEventName: 'SessionStart', additionalContext: out.context };
    if (out.systemMessage) json.systemMessage = out.systemMessage;
    if (out.terminalSequence) json.terminalSequence = out.terminalSequence;
  }
  return Object.keys(json).length === 0 ? '' : `${JSON.stringify(json)}\n`;
}
