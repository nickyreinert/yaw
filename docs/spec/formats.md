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
file        = "# Tasks" [notice] [rules] active backlog [done]
notice      = "> " text                                  ; GitHub view only, fixed text when generated
rules       = "## How to work with this file" { text }  ; working rules for the agent, kept verbatim (#175)
active      = "## Active" { task }
task        = "### " id [" (#" number ")"] " " title " — " status [" (" percent " %)"]
              { "- **" field ":** " text }
              [ "- **Journal:**" { "  - " YYYY-MM-DD " " text } ]
field       = "Brief" | "Priority" | "Model / effort" | "Spec" | "Resume point"
status      = "todo" | "in progress" | "blocked" | "in review"
backlog     = "## Backlog" { "- " id [" (#" number ")"] " " title [" — " note]
                             [ "  priority: " priority ]
                             [ "  model: " tier [" · effort: " effort] ]
                             [ "  spec: " reference ] [ "  acceptance: " outcome ] }
priority    = "P0" | "P1" | "P2" | "P3"                  ; P0 blocks the release, P1 needed, P2 desirable, P3 may wait
effort      = "low" | "medium" | "high" | "xhigh" | "max"
done        = "## Done → " path                          ; one-line archive entries live in that file
```

| Mode | ID | Issue link | File |
|---|---|---|---|
| local | `T-NNN` | – (may cite issues in Spec) | source of truth |
| both | `T-NNN` | `T-012 (#34)` once synced | source of truth |
| GitHub only / team | `#123` | – (the ID is the issue) | generated, read-only, starts with the notice |

Model tier and effort (#175): a backlog item carries them on its indented `model:` line (`just task new "title" --model sonnet --effort medium`); `just task start` copies them into the "Model / effort" field as `sonnet · effort: medium`. On GitHub they are the labels `model:<tier>` and `effort:<level>`, or the body line `**Model / effort:** sonnet · effort: medium` (`just task new` writes it); both-mode sync writes that body line. The rules section is written by `yaw init` (local and GitHub wording) and is kept when the GitHub view is regenerated.

Priority and status (T-029): every task carries both. A backlog item is `todo` and has a `priority:` line (`just task new "title" --priority P1`, P2 when omitted); `just task start` copies it into the "Priority" field of the active task, whose status is in the heading. On GitHub the priority is the label `priority:P<n>`, the body line `**Priority:** P1` or the issue-form answer; the status is the label `status:todo|in-progress|in-review|blocked` or the body line `**Status:** todo`. Both-mode sync and `just task new` (GitHub) write the body lines, the issue forms ask for priority, recommended model and reasoning effort and label new issues `status:todo`, and `just gh-issue` accepts `--model` and `--effort`.

The parsed form (`tasks.schema.json`) is `{ readOnly, active[], backlog[], archive?, rules? }`; `renderTasks(parseTasks(text))` gives the canonical text back (`core/lib/tasks.js`).

Guided kickoff tasks also carry `spec` and `acceptance` (or `yaw task new "title" --spec path#section --acceptance "observable outcome"`). Starting a local task copies these into its active **Spec** and **Brief** fields. GitHub bodies use **Spec** and **Acceptance**; both-mode sync and generated GitHub views preserve them. Legacy tasks need neither field.

## Guided kickoff foundations

Legacy phase/task plans remain accepted. A foundation bundle adds `kickoff-format: 1` under its title and exactly three `## Foundation: <kind>` sections, where kind is `architecture`, `data-model` or `ui-ux`. Each has a project-relative Markdown `path:` and `action: create` with one fenced `markdown` body, `action: update` with the complete revised document for an existing path, or `action: reuse` without a body. Existing equivalent documents may use different paths. Foundation headings and bullets are never tasks. Each phase task in a bundle needs indented `spec: <foundation path[#heading-anchor]>` and `acceptance: <observable outcome>` lines; the importer checks references and heading anchors.

`yaw kickoff import plan.md --dry-run` previews the exact sources and tasks without writes. Actual foundation import requires `--reviewed`; browser setup shows the same document contents and requires an explicit acknowledgement. `create` refuses an existing differing document; `update` replaces it with the reviewed revision (dry-run and browser preview show the diff, ADR-0130), and `reuse` keeps it. Reused and updated sources are checked for changes between preview and Apply. All documents are preflighted before import; paths must be distinct, bounded, non-secret Markdown regular files with no symlinks.

After review, `.yaw/foundations.json` stores `{ version: 1, practicesVersion, kit, documents: [{ kind, path, hash }] }`. `practicesVersion` identifies the kit guidance revision (currently 2); bundle and index format remain version 1. Markdown remains authoritative: this index contains references and review hashes, not duplicate rules. Generated foundations and the index are user-owned manifest entries; kit updates preserve them. Changed hashes produce a review warning in context, while current source text remains visible. Reimport with `action: reuse` after reviewing changes to refresh hashes. Changing registered authoritative paths requires explicitly editing the index.

`yaw kickoff context` displays versioned generic kit practices separately from registered project sources; `--json` returns the same structured context. Sources over 8,000 characters are explicitly excerpted with a path to the complete document. Applicable ADRs and linked knowledge still require retrieval. This provides LLM-readable references without a mandatory embedding service or model call. Existing knowledge search also includes canonical `docs/spec` sources.

Context also carries saved project `constraints` from `.yaw/answers.yaml`: `arch.hosting-control`, `arch.libraries`, `arch.services`, `arch.cost` and conditional `arch.cost-limit`. Missing values remain explicitly undecided in text prompts; neither a permitted paid option nor an undecided value grants purchase/provisioning approval. Resolve discrepancies with reviewed foundation sources and decisions. These inputs leave language × runtime profile selection unchanged.

`yaw kickoff ux` prints an optional design walkthrough prompt with this context for manual drafting or deliberate use with a local/external model. Review the exact printed package before sharing it. Optional reviewers consume the same two scopes and surface conflicts; neither prompts nor tool gates automatically change approved project behavior. No new per-prompt hook output is introduced.

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

Optional on `PostToolUse` when a compress hook replaced the output (ADR-0007): `rawBytes` and `outBytes` (sizes of the tool's output and of the replacement as JSON) and `method` (a short identifier such as `cap`). The output itself is never stored.

Records go to `~/.yaw/logs/hooks.jsonl` (one JSON line each, validated against the schema).

`yaw run --compact` (compact module, ADR-0132) appends one line per recipe step to `~/.yaw/logs/run.jsonl`, with the same file rules: `{ v: 1, ts, step, method: ok|warnings|failed, exitCode, rawBytes, outBytes, ms }`. `rawBytes` is the step's combined stdout and stderr, `outBytes` what it printed instead. The output itself is never stored.

## Session registry (`~/.yaw/yaw.db`)

Phase 1 has only `schema_migrations`, `sessions` and `session_links` (BD3). See `core/lib/db.js` and ADR-0018; fields follow doc 12 §4 (`tasks`, `decisions`, `commits`, `files` become `session_links` rows of that `kind`). The `sessions` module (ADR-0029) fills it: ids are `<agent>:<native id>`, `task` / `commit` / `file` links are written by its hooks, `Agent-Session: <id>` is the commit trailer, `resume` is informational (`yaw sessions resume` rebuilds the command). Migration 2 (`session-usage`, #174) adds `model`, `tokens_in` (cached input included), `tokens_out`, `cost_usd` (only what Claude Code reports) and `source` (`NULL` = hooks, `import`); `yaw sessions import` fills them from the agents' local history (Claude Code `~/.claude/projects/<path with non-alphanumerics as ->/*.jsonl`, Codex `~/.codex/sessions/**/rollout-*.jsonl`, Copilot CLI `~/.copilot/session-state/<id>/{workspace.yaml,events.jsonl}`), keyed by session id, never storing prompt, response, title or file content.

## Decision journal (`.decisions/`)

Records are Markdown (blueprint D4 plus the D2 fields): `# ADR-0007: Title`, metadata bullets (`Date`, `Category: C / S`, `Status` or for notices `Kind`, `Importance`, optional `Supersedes`, `Superseded by`, `Scope`, `Review by`, `Tags`), then `## Context`, `## Decision` + `## Consequences` (notices: `## Consideration`) and optional `## References` (`- detail|spec|code|issue|commit|session: value`). IDs `ADR-NNNN` / `NOTICE-NNNN`, in team mode `ADR-<issue>-<n>`. `taxonomy.json` is `{ version, categories: [{ name, subcategories: [{ name, keywords }] }] }`. The index (`version: 2`, `model: local-hash-ngram-v2`, `dimensions: 384`) is derived from the records and must equal `yaw decisions rebuild`. Details: ADR-0028, engine: ADR-0011.

## Interview and Improve preferences

Interview labels are Quick, Basic and All. Stored depth values are `quick`, `basic` and `pro`; `all` is an alias for `pro`. Legacy `full` and `standard` remain accepted. Explicit confirmed module proposals and existing project selections are preserved. `~/.yaw/setup-defaults.json` (version 1) stores explicitly saved optional module names and supported GitHub/review defaults separately from the personal profile; absent or invalid defaults enable no optional tools. Noninteractive answers never implicitly merge it.

`~/.yaw/improve-history.json` is a private version-1 store, separate from analytics, the registry and sync. Saving/importing requires explicit consent. Each verdict has a generated ID, title, creation/expiry timestamps and text; optional structured fields are outcome/collaboration/adherence estimates, evidence references and a candidate instruction. The edited review prompt is omitted unless separately included. Limit: 100 records; verdict 32,000 characters; prompt 24,000; candidate instruction 4,000. Retention defaults to 30 days, configurable to 7/30/90/365; expiry is purged on access. Shortening retention can expire existing records; increasing it does not extend their original expiry. Deletion removes the record and retained prompt, not already-applied instructions. Exports are JSON; imports accept verdict text or JSON and receive fresh IDs/timestamps.

Instruction previews accept only fixed AGENTS.md or project/personal reviewer-rule targets. Apply requires explicit confirmation and matching content hashes, preserves existing content and appends the reviewed addition. AGENTS.md retains its 80-line limit. No model or history action automatically changes instructions.

Personal-default onboarding and automatic first-setup seeding use only `user.expertise`, `user.language`, `user.autonomy`, `user.length`, `user.register`, `user.examples` and `user.explain`. Quick reads these values or factory defaults without saving them implicitly. Basic/All expose them as editable project defaults; first confirmed values seed an absent personal profile only after Apply. Existing saved preferences and invalid profiles are preserved; legacy agent/tool fields remain readable. Project facts, module selections, presets and history are not seeded by this action. `yaw defaults` explicitly edits global preferences; noninteractive `--answers`, drafts, previews and project edits do not seed them.
