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
| `~/.yaw/comfort.yaml` | user (YAW only reads it) | YAML | `comfort.schema.json` | `comfort/comfort.yaml` |
| `.yaw/github.yaml` | user + `yaw gh setup` | YAML | `github.schema.json` | `github/github.yaml` |
| `TASKS.md` | user (local, both) / kit (GitHub view) | Markdown | `tasks.schema.json` (parsed form) | `tasks/local.md`, `both.md`, `github-view.md` |
| `modules/security/guards.yaml`, `profiles/<p>/guards.yaml` | kit authors | YAML | `guards.schema.json` | `guards/security.yaml`, `guards/node-cli.yaml` |
| normalised hook event | kit | JSON | `hook-event.schema.json` | `hook-event/*.json` |
| `~/.yaw/yaw.db` | kit | SQLite | `core/lib/db.js` migrations | `test/db.test.js` |
| `.decisions/ADR-*.md`, `NOTICE-*.md` | user / `yaw decisions record` | Markdown | parser in `modules/decisions/lib/journal.js` | `.decisions/` of this repository |
| `.decisions/taxonomy.json` | user / `yaw decisions taxonomy` | JSON | parser in `modules/decisions/lib/journal.js` | `modules/decisions/templates/.decisions/taxonomy.json` |
| `.decisions/decisions.index.json` | kit (`yaw decisions rebuild`) | JSON | derived from the records | `.decisions/decisions.index.json` |

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

Mapping per agent (ADR-0021). Checked on 2026-10-20 against the vendor docs and covered by the fixtures in `test/fixtures/<agent>/<event>.json`; no live session was recorded yet, so fields ADR-0021 marks "assumed" stay to be confirmed.

| Field | Claude Code | Codex | Copilot (runs the `.claude/settings.json` hooks) |
|---|---|---|---|
| `agent` | command `--agent claude` | `--agent codex` | `--agent claude` + payload has `timestamp` → `copilot` |
| `event`, `nativeEvent` ← | `hook_event_name` | `hook_event_name` (same names; no `Notification`) | `hook_event_name` (Claude names under Claude event names) |
| `sessionId` ← | `session_id` | `session_id` | `session_id` |
| `cwd` ← | `cwd` | `cwd` | `cwd` |
| `modelId` ← | `model` on `SessionStart` when present (`payload`), else `null` | `model` on every event (`payload`) | not in the payload: `null` |
| `promptLength` ← | code points of `prompt` (`UserPromptSubmit`) | same | same |
| `tool.name` ← | `tool_name` | `tool_name` (`Bash`, `apply_patch`) | `tool_name` (Claude names) |
| `result` | `allow`/`deny` when a guard ran on `PreToolUse`; `PostToolUse` → `ok`, `PostToolUseFailure` → `error` | same | same |
| `timing.ts` | time YAW received the event | same | payload `timestamp` |
| `timing.hookMs` | run time of `yaw hook` | same | same |

Records go to `~/.yaw/logs/hooks.jsonl` (one JSON line each, validated against the schema).

## Session registry (`~/.yaw/yaw.db`)

Phase 1 has only `schema_migrations`, `sessions` and `session_links` (BD3). See `core/lib/db.js` and ADR-0018; fields follow doc 12 §4 (`tasks`, `decisions`, `commits`, `files` become `session_links` rows of that `kind`). The `sessions` module (ADR-0029) fills it: ids are `<agent>:<native id>`, `task` / `commit` / `file` links are written by its hooks, `Agent-Session: <id>` is the commit trailer, `resume` is informational (`yaw sessions resume` rebuilds the command).

## Decision journal (`.decisions/`)

Records are Markdown (blueprint D4 plus the D2 fields): `# ADR-0007: Title`, metadata bullets (`Date`, `Category: C / S`, `Status` or for notices `Kind`, `Importance`, optional `Supersedes`, `Superseded by`, `Scope`, `Review by`, `Tags`), then `## Context`, `## Decision` + `## Consequences` (notices: `## Consideration`) and optional `## References` (`- detail|spec|code|issue|commit|session: value`). IDs `ADR-NNNN` / `NOTICE-NNNN`, in team mode `ADR-<issue>-<n>`. `taxonomy.json` is `{ version, categories: [{ name, subcategories: [{ name, keywords }] }] }`. The index (`version: 2`, `model: local-hash-ngram-v2`, `dimensions: 384`) is derived from the records and must equal `yaw decisions rebuild`. Details: ADR-0028, engine: ADR-0011.
