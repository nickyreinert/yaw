# YAW file formats (phase 1)

Schemas are the binding definition; this page is the readable overview. Check files with `node core/schema/validate.js` (all examples) or `node core/schema/validate.js <schema> <file>`.

| File | Written by | Format | Schema | Examples |
|---|---|---|---|---|
| `.yaw/manifest.json` | kit | JSON | `manifest.schema.json` | `manifest/quick.json`, `manifest/standard.json` |
| `modules/<m>/module.yaml` | kit authors | YAML | `module.schema.json` | `module/core.yaml`, `security.yaml`, `tasks.yaml`, `ui-design.yaml` |
| `modules/<m>/items/<id>.yaml` | kit authors | YAML | `item.schema.json` | `item/session-hygiene.yaml` |
| `profiles/<p>/profile.yaml` | kit authors | YAML | `profile.schema.json` | `profile/python-cli.yaml`, `node-cli.yaml`, `python-web.yaml` |
| `interview/base.yaml` | kit authors | YAML | `questions.schema.json` | `questions/base.yaml` |
| `.yaw/answers.yaml` | user / interview | YAML | `answers.schema.json` | `answers/quick-python.yaml`, `standard-team.yaml` |
| `~/.yaw/user-profile.yaml` | user / interview | YAML | `user-profile.schema.json` | `user-profile/user-profile.yaml` |
| `~/.yaw/presets/<name>.yaml` | user / `yaw presets` | YAML | `preset.schema.json` | `preset/my-flask-default.yaml` |
| `adapters/capabilities.yaml` | kit authors | YAML | `capabilities.schema.json` | `capabilities/capabilities.yaml` |
| `.yaw/config.yaml` | user / `yaw config set` | YAML | `config.schema.json` | `config/config.yaml` |
| `.yaw/github.yaml` | user + `yaw gh setup` | YAML | `github.schema.json` | `github/github.yaml` |
| `TASKS.md` | user (local, both) / kit (GitHub view) | Markdown | `tasks.schema.json` (parsed form) | `tasks/local.md`, `both.md`, `github-view.md` |
| normalised hook event | kit | JSON | `hook-event.schema.json` | `hook-event/*.json` |
| `~/.yaw/yaw.db` | kit | SQLite | `core/lib/db.js` migrations | `test/db.test.js` |

Schemas live in `core/schema/`, examples in `core/schema/examples/<schema>/`. Shared definitions (names, agent keys, facts, answers) are in `common.schema.json`. Conventions: ADR-0017.

## YAML subset

Grammar, typing and rejected features: ADR-0001. In short: maps, lists, plain and quoted one-line scalars, flow collections, `|` and `>` block scalars, comments; YAML 1.2 core typing (`yes`/`no`/`on`/`off` and dates stay strings); anchors, aliases, tags, `---` and multi-line plain scalars are errors with `file:line`. Files rewritten by the kit start with a header comment saying comments are not preserved.

## Task ledger

`TASKS.md` grammar (BD4, doc 10 §2). Lines not listed here are errors (`TASKS.md:<line>: <reason>`); blank lines are free.

```text
file        = "# Tasks" [notice] active backlog [done]
notice      = "> " text                                  ; GitHub view only, fixed text when generated
active      = "## Active" { task }
task        = "### " id [" (#" number ")"] " " title " — " status [" (" percent " %)"]
              { "- **" field ":** " text }
              [ "- **Journal:**" { "  - " YYYY-MM-DD " " text } ]
field       = "Brief" | "Model / effort" | "Spec" | "Resume point"
status      = "todo" | "in progress" | "blocked" | "in review"
backlog     = "## Backlog" { "- " id [" (#" number ")"] " " title [" — " note] }
done        = "## Done → " path                          ; one-line archive entries live in that file
```

| Mode | ID | Issue link | File |
|---|---|---|---|
| local | `T-NNN` | – (may cite issues in Spec) | source of truth |
| both | `T-NNN` | `T-012 (#34)` once synced | source of truth |
| GitHub only / team | `#123` | – (the ID is the issue) | generated, read-only, starts with the notice |

The parsed form (`tasks.schema.json`) is `{ readOnly, active[], backlog[], archive? }`; `renderTasks(parseTasks(text))` gives the canonical text back (`core/lib/tasks.js`).

## Normalised hook event

One JSON record per hook call; no prompt text, tool input or output (ADR-0018).

```json
{ "v": 1, "agent": "claude", "event": "PreToolUse", "nativeEvent": "PreToolUse",
  "sessionId": "…", "cwd": "/path", "modelId": null, "modelIdSource": null,
  "promptLength": null, "tool": { "name": "Bash" }, "result": "deny",
  "timing": { "ts": "2026-10-20T09:15:02.120Z", "hookMs": 41 } }
```

**Draft mapping, not yet verified against recorded payloads** (H8; confirmed or corrected with fixtures in Y-4.3 – Y-4.5):

| Field | Claude Code | Codex | Copilot |
|---|---|---|---|
| `event` ← | `hook_event_name` (same names) | `hook_event_name` (same names as Claude) | configured event: `sessionStart`, `sessionEnd`, `userPromptSubmitted` → `UserPromptSubmit`, `preToolUse`, `postToolUse`, `agentStop` → `Stop`, `subagentStop`, `errorOccurred` → `StopFailure`, `notification` |
| `sessionId` ← | `session_id` | `session_id` | session id field (name to verify) |
| `cwd` ← | `cwd` | `cwd` | `cwd` |
| `modelId` ← | `SessionStart` payload `model` if present (`payload`), else transcript (`transcript`) or OTel (`otel`) | payload `model` if present (`payload`) | not expected in the payload: Copilot settings (`settings`) or `null` |
| `promptLength` ← | length of `prompt` (`UserPromptSubmit`) | length of `prompt` | length of `prompt` (`userPromptSubmitted`) |
| `tool.name` ← | `tool_name` | `tool_name` (incl. `apply_patch`) | `toolName` |
| `result` | `PostToolUse` → `ok`, `PostToolUseFailure` → `error`; YAW decision on `PreToolUse` / `Stop` | same | `postToolUse` result type → `ok` / `error`; YAW decision on `preToolUse` |
| `timing.ts` | time YAW received the event | same | payload timestamp if present, else receipt time |

Copilot also runs hooks from `.claude/settings.json` with Claude event names; how those payloads look and how double firing is avoided is decided in Y-4.5 (H4).

## Session registry (`~/.yaw/yaw.db`)

Phase 1 has only `schema_migrations`, `sessions` and `session_links` (BD3). See `core/lib/db.js` and ADR-0018; fields follow doc 12 §4 (`tasks`, `decisions`, `commits`, `files` become `session_links` rows of that `kind`).
