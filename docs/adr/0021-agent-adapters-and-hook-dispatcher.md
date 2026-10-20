# ADR-0021: Agent adapters and the hook dispatcher (Claude Code, Codex, Copilot)

- Status: Proposed
- Date: 2026-10-20
- Issues: #41 – #44 (Y-4.2 – Y-4.5), #46 (Y-4.7)
- Resolves: H4, H7 (command strings), H8 (`docs/build/plan.md` §1.4); details of step 4 the docs leave open (B rule 10); extends ADR-0004, ADR-0006, ADR-0018

## Context

Step 4 needs one hook entry point that every agent calls, a per-agent translation of payloads and outputs, and the rendering of each agent's hook registration. ADR-0006 fixed the shim and left the command strings to Y-4.3 – Y-4.5; ADR-0018 left the field mapping as a draft to be confirmed with fixtures; H4 asked how Copilot, which also reads `.claude/settings.json`, avoids firing twice.

**Sources.** No live Claude Code, Codex or Copilot session could record payloads in this step (follow-up: #94). The mapping below was checked on 2026-10-20 against the vendor documentation (Claude Code hooks reference, Codex hooks docs, GitHub Copilot CLI hooks reference). The fixtures in `test/fixtures/<agent>/<event>.json` are written from that documentation ("recorded-style"), without secrets. "Documented" below means: stated in the vendor docs; "assumed": not stated there, chosen by YAW, to be confirmed with a real recording.

## Decision

### Entry point and dispatch (Y-4.2)

- `yaw hook <event> --agent claude|codex|copilot --module <module>` reads the JSON payload from stdin. One registration per module and event, so removing a module removes exactly its registrations (ADR-0004 JSON composition: lists concatenate).
- The dispatcher normalises the payload (`core/hooks/adapters.js`), loads the manifest of the project (the shim `cd`s to the project root), and runs the handlers of that module's hooks whose `event` matches, whose `matcher` accepts the tool, and whose `agents` support is not `none`. A handler is `modules/<m>/hooks/<name>.js`, default export `(event, ctx) => result`; `event.input` holds `{ command, paths }` (tool input reduced to what guards need, in memory only).
- Results pass the output policy (ADR-0007, `core/hooks/policy.js`); the agent adapter renders the rest.
- Every call that has a session id and a known event appends one ADR-0018 record (validated against the schema, so no content can slip in) with `hookMs` to `~/.yaw/logs/hooks.jsonl` (`$YAW_HOME` overrides `~/.yaw`), rotated to `.1` above 5 MB. `result` is `allow`/`deny` when a guard ran on `PreToolUse`. Errors go to `~/.yaw/logs/hook-errors.log` as one line without payload content. Two modules on the same event give two records per call (phase 1 has one hook module).
- Code layout (extends ADR-0014): `core/hooks/` (dispatcher, adapters, policy, `yaw-hook.sh`), `core/render/agents.js` (settings parts, shim, skills), `adapters/capabilities.yaml` at the kit root.

### Shim and command strings (ADR-0006, H7)

- `core` renders `.yaw/bin/yaw-hook` (from `core/hooks/yaw-hook.sh`) whenever an enabled module has hooks for a selected agent, and drops it with the last one. It uses only shell builtins until `node` runs, drops Node's stderr and always exits 0, prefers `.yaw/lib/bin/yaw` when it exists (vendored), then `${YAW_KIT:-$HOME/.yaw/kit}`; no Node or no kit → exit 0, no output. It is called through `sh`, so no executable bit is needed in git.
- Command (all agents): `f="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.yaw/bin/yaw-hook"; [ ! -f "$f" ] || sh "$f" <Event> --agent <agent> --module <module>`, `timeout: 10`, never `async`. A missing shim (wrong root, file deleted) is skipped with exit 0 and no output. Claude sets `CLAUDE_PROJECT_DIR` (documented); Codex runs commands in the session cwd and uses `git rev-parse --show-toplevel` in its own examples (documented); Copilot sets no project variable (not documented, so the git fallback applies).

### Claude Code (Y-4.3)

- `.claude/settings.json` (shared, owner `core`): `hooks.<Event>[] = { matcher, hooks: [{ type: command, command, timeout }] }` plus module template parts such as `permissions.deny` (ADR-0022). Written when Claude **or Copilot** is selected.
- Output: `hookSpecificOutput { hookEventName, permissionDecision: deny, permissionDecisionReason }`, `hookSpecificOutput.additionalContext` on `SessionStart`, top-level `systemMessage` / `terminalSequence` (documented).

| Field | Source | Status |
|---|---|---|
| `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `permission_mode`, `prompt_id` | common input | documented |
| `source`, `model` (`SessionStart`) | event input; `model` optional ("not always included") | documented; the model value in the fixture is assumed |
| `prompt` (`UserPromptSubmit`) | event input | documented |
| `tool_name`, `tool_input` (`Bash.command`, `Read/Edit/Write.file_path`, `Grep.path/glob`), `tool_use_id` | `PreToolUse` | documented |
| `stop_hook_active`, `last_assistant_message` (`Stop`) | event input | documented |
| `message`, `title`, `notification_type` (`Notification`) | event input | documented |
| no `timestamp` field in any payload | absence (used to tell Copilot apart) | assumed |

### Codex (Y-4.4)

- `.codex/hooks.json` (shared, owner `core`), same shape as Claude's `hooks` (documented). Matchers are translated from Claude tool names: `Bash` → `Bash`, `Edit|Write|MultiEdit` → `apply_patch`, others dropped. Written when Codex is selected.
- Payload: common `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `model`; `turn_id` on turn events; `tool_name` is `Bash` or `apply_patch`; both carry their text in `tool_input.command` (documented). The guards read file paths from the patch headers (`*** Add|Update|Delete File:`, `*** Move to:`; patch format assumed from Codex's `apply_patch` format, not stated in the hooks docs).
- Output: same `hookSpecificOutput` shape as Claude (documented; Codex also accepts the older `decision: block`). Codex has no `Notification` event (doc 09 §2), so there is no fixture for it.
- **Trust:** Codex runs a non-managed hook only after the user reviewed and trusted it via `/hooks` (documented). `yaw init` prints a note when it wrote `.codex/hooks.json`, and `yaw doctor` repeats it as a `note` line (YAW cannot see the trust state).

### Copilot (Y-4.5, H4)

- **Copilot gets no hook file of its own.** The Copilot CLI reads `.claude/settings.json` (documented: "cross-tool `.claude/settings.json` … are also read") and runs every entry from every source without de-duplication (documented). YAW therefore never writes `.github/hooks/*.json`: each event fires exactly once in Copilot, and Claude does not read Copilot's files. Copilot-only projects get `.claude/settings.json` for this reason.
- Under Claude event names Copilot sends snake_case payloads (`hook_event_name`, `session_id`, `timestamp`, `cwd`, `tool_name` with the Claude tool name, `tool_input` parsed from JSON when possible) and no `model` (documented). The command says `--agent claude`; the dispatcher recognises Copilot by the `timestamp` field (assumed: Claude payloads have none). `modelId` is `null`.
- Output: top-level `permissionDecision` / `permissionDecisionReason` on `PreToolUse`, top-level `additionalContext` on `SessionStart`, nothing else (`userPromptSubmitted` output is dropped; documented). Whether Copilot also reads `hookSpecificOutput` under Claude event names is not documented, so YAW does not rely on it.
- Copilot support of `security` is `partial` in `module.yaml` until a live session confirms the deny.

### `yaw agents` (Y-4.7)

Rows: each enabled module, its hooks and skills (outside a project: every kit module); columns: the selected agents (outside a project: the phase-1 agents). A cell is the item's own `agents` entry, else the module's, else the capability default from `adapters/capabilities.yaml` (`guard` → `blockTool`, `context` → `sessionStartContext`/`promptContext`, `comfort` → `userMessage`, `evaluation` → `hooks`, skill → `skills`), else `none`. `via` and `note` become footnotes; the agents' `note`s from `capabilities.yaml` are listed below.

## Consequences

- `docs/spec/formats.md` replaces the draft mapping with this one. Fields marked "assumed" must be re-checked with one real recording per agent before v0.1 (#94).
- If Copilot ever sets `CLAUDE_PROJECT_DIR` or Claude adds a `timestamp`, the detection moves to an explicit marker (e.g. an env variable in the command).
- A user's own `.github/hooks/*.json` keeps working; YAW does not touch it.
