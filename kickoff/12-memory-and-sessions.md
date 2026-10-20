# 12 — Memory: Decisions, Global Knowledge, Session Registry

## 1. Three memory scopes

| Store | Scope | Holds | Location | Committed |
|---|---|---|---|---|
| **Decision journal** | Project | ADRs, notices (`security`, `business-logic`, `privacy`) | `.decisions/` | yes |
| **Global knowledge** | User, all projects | Personal rules, preferences, lessons learned, reusable snippets | user-chosen, default `~/.yaw/knowledge/` | optional (own git repo) |
| **Session registry** | Project (+ global index) | Which agent session worked on what, with links | `.yaw/sessions/` + `~/.yaw/sessions.index.json` | no (default) |

All three use the **same storage pattern**: Markdown (or JSON line) records as truth, a derived index with metadata + local embedding, the same retrieval code. One engine, three folders.

## 2. Record structure (answer to "does the index point to the full doc?")

Yes. The index never is the content; it is a pointer with metadata.

```
index entry ──file──▶ short record (ADR-0007.md: summary, context, decision, consequences)
            ──refs──▶ detail doc, code, spec, issue, commit, session
```

- **Short record** (`.decisions/ADR-0007.md`): concise, injected verbatim into context on retrieval, so it stays short.
- **Detail doc** (optional): longer rationale, diagrams, benchmarks in `.decisions/details/ADR-0007.md` or a living spec in `docs/spec/…`. Not injected; listed as a link the agent opens when needed.
- **`refs`** field in the index entry (and mirrored as a "References" list in the Markdown):

```json
"refs": [
  { "type": "detail",  "path": ".decisions/details/ADR-0007.md" },
  { "type": "spec",    "path": "docs/spec/deployment-and-migrations.md#forward-only" },
  { "type": "code",    "path": "src/db/migrate.ts", "symbol": "applyMigrations" },
  { "type": "issue",   "ref": "#34" },
  { "type": "commit",  "ref": "a1b2c3d" },
  { "type": "session", "ref": "claude:5f2c…" }
]
```

- Code refs use path + symbol (stable) rather than line numbers (drift). `just check` validates that referenced paths exist and warns on dead refs.
- The embedding is computed from summary + context + decision (the short record), not from the detail doc, to keep vectors focused.
- Reverse direction: code comments and `docs/spec/` may cite `ADR-0007`; the `scope` globs (path-aware recall) link records to files.

## 3. Global knowledge store

Purpose: rules that apply to *you*, everywhere ("always use `uv` for Python", "German UI texts use the informal 'du'", "never use Google Fonts"), plus lessons learned across projects.

- Location chosen during first setup (`~/.yaw/knowledge/` default, or a synced folder / separate private git repo).
- Record types: `rule` (binding unless the project overrides), `preference`, `lesson`, `snippet`. Same Markdown + index format, with `scope: global` and optional `tags` / `profiles` filter (e.g. only for `python-*`).
- **Add:** skill/command `/remember "<instruction>"` (Claude) or `yaw remember "…"`: classifies, asks for type and tags, writes the record, rebuilds the index. `/forget <id>` marks it `deprecated`.
- **Recall:** the `UserPromptSubmit` hook queries project journal **and** global store; precedence on conflict: project ADR > global rule > preference. Injected text marks the source (`[global] RULE-0012`).
- **Always-on vs. retrieved:** a handful of truly universal rules go into the agent's user-level instruction file (e.g. `~/.claude/CLAUDE.md`), generated from records tagged `always`. Everything else is retrieved on demand, so the global store can grow without bloating every prompt.
- **Isolation:** namespaces (e.g. `personal`, `client-a`) with per-project allow-list in `.yaw/config.yaml`, so knowledge from one client never leaks into another project.
- **Embeddings:** the local hashing model is lexical; across many projects paraphrase misses grow. The global store is the first place where an optional semantic embedding model (local or hosted) is justified (see reference blueprint N1). Pluggable backend: an existing knowledge-graph or MCP memory server can be configured as the store instead of the folder.

## 4. Session registry

Goal: find the conversation behind a task, decision or commit later, and resume it.

**Captured automatically** (hooks `SessionStart`, `Stop`, `SessionEnd`; Codex/Gemini via tier-2 `/handoff`):

```json
{
  "id": "claude:5f2c…",
  "agent": "claude-code",
  "title": "Invite flow: signaling server + token expiry",
  "started": "2026-10-20T09:12:00Z",
  "ended": "2026-10-20T11:40:00Z",
  "branch": "feat/T-012-invite-flow",
  "tasks": ["T-012"],
  "decisions": ["ADR-0004", "NOTICE-0002"],
  "commits": ["a1b2c3d", "e4f5a6b"],
  "files": ["server/index.js", "src/signaling.js"],
  "pr": "#41",
  "resume": "claude --resume 5f2c…",
  "transcript": "<local path to the agent's transcript>"
}
```

- **Title:** Claude Code supports this natively: `UserPromptSubmit` and `SessionStart` hooks can return `sessionTitle`, and receive the current custom `session_title`. YAW sets `T-012 invite flow` style titles automatically from the active task (only if no custom title exists); other agents get the title at `/handoff`. Editable via `yaw session rename`.
- **Links:** tasks from the active `TASKS.md` entry / branch name; decisions from IDs cited in the session; commits from the git range between start and end HEAD; files from the diff.
- **Commit trailer:** `just commit` adds `Agent-Session: claude:5f2c…` so `git log` leads back to the conversation.
- **Back-links:** the task journal line, the ADR `refs`, and the PR description get the session ID.
- **Search:** `yaw sessions find "token expiry"` (same retrieval engine over title + summary), `yaw sessions for T-012`, `yaw sessions resume <id>`.
- **Privacy:** transcripts stay where the agent stores them (local); the registry only holds metadata and paths. Not committed by default because transcripts may contain secrets or personal data; opt-in commit of titles + links only.
