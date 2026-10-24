# Local workspace

`yaw web` serves the application on loopback with the existing one-time login and session checks. Setup is available before project initialization. The interface uses the website's cream/teal palette and shark wordmark, with compact application typography and direct labels.

| Area | Data / controls |
| --- | --- |
| Overview | Current workspace: session counts, reported tokens, elapsed time, task count, configuration, activity |
| Setup | Six revisitable steps, expertise-specific help, live file plan, diff, draft/preset save, explicit Apply |
| Sessions | Workspace (project filter locked) and Global; registry + native Claude Code/Codex/Copilot history; project/agent/model/period filters; sortable session columns; Agents/Projects/Models comparisons; pagination |
| Knowledge | Workspace (project records, decisions, decision categories) and Global (user records); full-text search; namespace/type filters; list/detail reader; rendered/source views; pagination |
| Settings | Interview (`yaw edit` in the browser: preview, then apply), Files (YAW-written files by purpose, read-only Form/Raw drawer), Notifications |
| Tasks | Workspace `TASKS.md`; Global task snapshots with a project filter |
| Code map | Saved map; shown only when the code-map module is enabled |

## Sessions

The default is all history across all projects. The application requests read-only native discovery; no per-project import is required. Metadata from local agent history is merged with registry rows by agent/session ID. Hook-written titles and project identities are preserved. Native usage augments the registry in memory only. No database is created by this discovery and no transcripts or paths are sent to the browser. The existing per-project `yaw sessions import` CLI behavior is unchanged.

Native scans cache their metadata for 60 seconds; Refresh rescans. Existing parser bounds apply: up to 20,000 files per agent and lines up to 4 MiB. Symlinked agent-history directories/files are skipped. Missing/unreadable history files do not hide other projects. Full prompt/response objects are parsed transiently by the existing import readers and discarded; only metadata is retained. The UI discloses the scan limit.

Project/agent/model/date filters run before totals, sorting and pagination. All matching rows remain accessible in pages of 50. Sorting supports date, project, agent, model, tokens, duration and cost; unknown numbers sort last in either direction. Aggregates cover the entire selection. Comparisons sort in the client. Activity displays the latest 30 active days; tooltips give UTC dates and counts. Session timestamps use the browser timezone.

Missing usage, cost and end times remain unknown; coverage accompanies the totals. Zero reported cost is distinct from missing cost. Tokens include cache input where supplied by the agent; duration is elapsed time rather than active work. Outcome evaluation, cache breakdowns, tool-failure rates and OTel are not collected.

## Knowledge

The browser reads, creates, edits and deletes Markdown in these fixed roots (writes go through `core/lib/knowledge-store.js`, shared with `yaw knowledge`; ADR-0053 amendment):

| Scope | Sources |
| --- | --- |
| User | `~/.yaw/knowledge/` (or `$YAW_HOME/knowledge/`) |
| Project | `.decisions/` including details, `docs/knowledge/`, `docs/spec/` |

User knowledge is not automatically injected into project context. The explicit User/All scopes browse the user's namespaces; the Project scope reads only the current project's sources. CLI retrieval and namespace permission behavior are unchanged. No source folder, index, format migration or record is created by viewing. Writes are explicit CSRF-protected actions (`knowledge-save`, `knowledge-remove`) that carry the opened content's SHA-256 (409 on a concurrent change), refuse links, secrets and non-Markdown targets, and write atomically. Decision records are edited here but created with `yaw decisions record`.

The dashboard serves several projects from one server: every request names a `workspace`, resolved against known YAW projects (ADR-0050 amendment); unknown folders get 404.

Titles come from the first heading or optional YAML frontmatter. ADR/notice metadata is recognized; optional `type`, `tags`, `status`, and `category` frontmatter supports plain rule/preference/lesson/snippet documents. A user record's first subfolder identifies its namespace. Search covers title, path, category, tags and content. Listing responses omit content; selecting a listed record fetches its body through an opaque source/relative-name key, never a caller-supplied filesystem path.

Reads reject symlinked roots/components and files, bind to checked file descriptors, cap each file at 128 KiB, and scan at most 1,000 Markdown records to depth four. Secret-like content is withheld. Sources, missing stores, exclusions, and scan limits are visible. Markdown is rendered with text nodes; raw HTML never executes. Source view preserves the original text.

## Verification

Focused checks: `node --test test/knowledge.test.js test/knowledge-store.test.js test/session-profile.test.js test/dashboard.test.js test/form-ui.test.js test/web-background.test.js modules/sessions/tests/import.test.js`.

Repository gate: `just check`. Keep its pre-existing adapter drift separate from web changes. Browser QA covers setup retention, sorting/filtering/pagination, source coverage, knowledge scope/search/reader, keyboard navigation, and narrow layouts.

## Settings

`core/web/settings.js` backs the Settings view (ADR-0050 amendment). GET `/api/settings` lists `manifest.files` plus `.yaw/answers.yaml` and `.yaw/manifest.json`, grouped by purpose; knowledge, decision, task and code-map files are left to their own views, and `.env*` and secret-rule matches are never listed. GET `/api/settings/file?path=` only serves a listed path (no-follow read, 128 KiB cap). `.yaw/base/` is shown as an expandable folder (at most 500 files, symlinks skipped).

Writes are CSRF-protected actions that carry the SHA-256 of the content they started from (409 on a concurrent change):

- `taxonomy-save` validates `.decisions/taxonomy.json`, requires a keyword for each new pair, and refuses removing or renaming a pair still used by a decision (409, listing the IDs).
- `interview-preview` renders the `yaw edit` plan and diff (capped at 256 KiB) without writing; `interview-apply` applies it through `editProject` with the keep strategy. Only one apply runs at a time.
