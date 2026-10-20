# ADR-0018: Normalised hook event and session registry storage

- Status: Proposed
- Date: 2026-10-20
- Issues: #14 (Y-1.10), #18 (Y-1.14)
- Resolves: H8 (draft), H10 (`docs/build/plan.md` §1.4); BD3, BD11

## Context

Step 4 normalises hook payloads of Claude Code, Codex and Copilot into one event. Doc 13 requires that no prompt or response content is stored. Doc 12 §4 defines the session registry; BD3 puts it into `~/.yaw/yaw.db`, which uses `node:sqlite` (BD11: Node ≥ 22.13, warning suppressed).

## Decision

### Normalised hook event (`core/schema/hook-event.schema.json`)

- One JSON record per hook call with exactly: `v`, `agent`, `event`, `nativeEvent`, `sessionId`, `cwd`, `modelId`, `modelIdSource`, `promptLength`, `tool` (`{ name }`), `result`, `timing` (`ts`, `hookMs`). All keys are present; unknown values are `null`, except `event`, `nativeEvent` and `sessionId`, which are never null: a payload without them is not recorded (fail open).
- Event names are Claude Code's (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`, `StopFailure`, `SubagentStop`, `Notification`, `PreCompact`, `SessionEnd`); `nativeEvent` keeps the agent's own name. Native events outside this list are passed to handlers but not recorded; adding one needs a schema change.
- **No content:** prompt text, tool input and tool output never enter the record (`additionalProperties: false` enforces it). `promptLength` counts Unicode code points. Handlers that need content (e.g. the `security` guard reading a command) get the raw payload in memory during dispatch; it is never written.
- `modelIdSource` is `payload`, `transcript`, `otel`, `settings` or `null`. The per-agent mapping in `docs/spec/formats.md` is a **draft**: field names and model-id availability are confirmed with recorded fixtures in Y-4.3 – Y-4.5 (H8).
- `result`: `ok` / `error` (tool outcome), `allow` / `deny` (YAW decision on `PreToolUse`), `block` (YAW continued the agent on `Stop`), else `null`.

### Session registry in `~/.yaw/yaw.db`

- Tables: `schema_migrations (version, name, applied_at)`, `sessions (id, agent, project, title, started, ended, branch, pr, resume, transcript)`, where `id` is `<agent>:<agent session id>` so a hook event matches its row by `agent` + `sessionId`, `session_links (session_id, kind, ref)` with `kind` ∈ `task`, `decision`, `commit`, `file`. `STRICT` tables, foreign keys on, links cascade on delete. `project` is the absolute project path, so one global database serves all projects.
- Migrations are numbered and applied in order inside a transaction; a database newer than the kit is refused. No other tables in phase 1 (BD3).
- `transcript` holds only the local path, never content (doc 12 §4 privacy).
- `node:sqlite` is loaded through `loadSqlite()`, which filters only the SQLite `ExperimentalWarning` from `process.emitWarning` while the module loads; other warnings still print. No `--no-warnings` flag, so hook commands stay plain `node`.
- Doc 12 §1 is updated: the global index is `~/.yaw/yaw.db` instead of `~/.yaw/sessions.index.json`. Whether `.yaw/sessions/` also keeps per-project records is decided in Y-5.7.

## Consequences

- Metrics and evaluation (phase 2) add tables by migration without touching the registry.
- If Node removes the warning or changes its text, the filter simply stops matching; the test on empty stderr catches a regression.
