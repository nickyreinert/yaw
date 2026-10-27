# Local workspace

`yaw web` serves the application on loopback with the existing one-time login and session checks. Setup is available before project initialization. The interface uses the website's cream/teal palette and shark wordmark, with compact application typography and direct labels.

| Area | Data / controls |
| --- | --- |
| Overview | Current workspace: session counts, reported tokens, elapsed time, task count, configuration, activity |
| Setup | Six revisitable steps, expertise-specific help, live file plan, diff, draft/preset save, explicit Apply |
| Global overview | Folder drill-down from the shared project root; totals; charts split by agent/model/folder/project; device filter for session metrics |
| Sessions | Workspace (locked to the project) and Global; sticky folder/project/device/agent/model/period filter (device on Global only); usage and message-insight cards; stackable charts; filter/sort/page tables; Refresh, Auto and Classify in the filter bar (Global reads all workspaces, Workspace only the open one); state in the URL |
| Knowledge | Workspace (project records, decisions, decision categories) and Global (user records); full-text search; namespace/type filters; list/detail reader; rendered/source views; pagination |
| Settings | Workspace: Interview (`yaw edit` in the browser: preview, then apply; first setup for a folder without YAW), Files (YAW-written files by purpose, read-only Form/Raw drawer), Review prompts (project overrides). Global: personal-defaults interview and presets, `~/.yaw` files, Notifications, Classification (editable prompt and temporary sample preview; no model training), Review prompts (blueprint) |
| Tasks | Workspace `TASKS.md`; Global task snapshots filterable by folder/project, linking to each project |
| Code map | Saved map; shown only when the code-map module is enabled |

## Sessions

**Insights review** in the filter bar (also a table tab) opens a temporary review flow using the same filters. It shows saved coverage and keeps estimated outcome and collaboration counts separate, including unknowns and skipped/unclassified records. Select up to five local scanned sessions and confirm the transcript scope. The authenticated `insights-review` POST uses filename-only discovery and reads only selected transcripts, at most 8 MiB or 1,000 messages each; larger Gemini documents are skipped. It runs no model and saves no evidence.

Tentative phrase hints plus ordinary exchanges suggest up to five examples per session across the readable portion; a confirmed manual turn read works without Laya. Original, previous, selected and following-user context is bounded and omissions are marked. Edit/redact up to five examples, optionally supply existing instructions, preview/edit the exact package (24,000 characters maximum), acknowledge inspection and copy it to a user-chosen LLM. Identifying session metadata is omitted and recognized absolute paths are redacted initially; other sensitive text may remain. The prompt asks for a verdict sentence and at most three bullets within 150 words, without treating examples as population statistics. Filter changes, refresh and navigation clear temporary evidence; it never enters saved analytics, sync, URLs or logs. See ADR-0064 and `CONCEPT.md` for limits and validation still needed.

The default is all history across all projects. The application requests read-only native discovery; no per-project import is required. Metadata from local agent history is merged with registry rows by agent/session ID. Hook-written titles and project identities are preserved. Native usage augments the registry in memory only. No database is created by this discovery; ordinary session rows contain no conversation text or transcript paths. Confirmed Insights reads and classification previews temporarily return excerpts. The existing per-project `yaw sessions import` CLI behavior is unchanged.

Native scans cache their metadata for 60 seconds; Refresh rescans. Existing parser bounds apply: up to 20,000 files per agent and lines up to 4 MiB. Symlinked agent-history directories/files are skipped. Missing/unreadable history files do not hide other projects. Full prompt/response objects are parsed transiently by the existing import readers and discarded; only metadata is retained. The UI discloses the scan limit.

Project/agent/model/date filters run before totals, sorting and pagination.
Global overview and Global Sessions also have a device selector (**All
devices** by default, **This device**, or a synced device name); it filters
every session metric, chart and table, and is kept in the URL. Synced sessions
have no project path, so the overview groups them by device and project counts
include only sessions with known project paths. The overview's open-task count
is project data and is not affected by the device filter. All matching rows
remain accessible in pages of 50. Sorting supports date, project, agent,
model, tokens, duration and cost; unknown numbers sort last in either
direction. Aggregates cover the entire selection. Comparisons sort in the
client. Activity displays the latest 30 active days; tooltips give UTC dates
and counts. Session timestamps use the browser timezone.

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

Focused checks: `node --test test/knowledge.test.js test/knowledge-store.test.js test/session-rows.test.js test/session-analysis.test.js test/global-settings.test.js test/dashboard.test.js test/form-ui.test.js test/web-background.test.js modules/sessions/tests/import.test.js`.

Repository gate: `just check`. Keep its pre-existing adapter drift separate from web changes. Browser QA covers setup retention, sorting/filtering/pagination, source coverage, knowledge scope/search/reader, keyboard navigation, and narrow layouts.

## Settings

`core/web/settings.js` backs the Settings view (ADR-0050 amendment). GET `/api/settings` lists `manifest.files` plus `.yaw/answers.yaml` and `.yaw/manifest.json`, grouped by purpose; knowledge, decision, task and code-map files are left to their own views, and `.env*` and secret-rule matches are never listed. GET `/api/settings/file?path=` only serves a listed path (no-follow read, 128 KiB cap). `.yaw/base/` is shown as an expandable folder (at most 500 files, symlinks skipped).

Writes are CSRF-protected actions that carry the SHA-256 of the content they started from (409 on a concurrent change):

- `taxonomy-save` validates `.decisions/taxonomy.json`, requires a keyword for each new pair, and refuses removing or renaming a pair still used by a decision (409, listing the IDs).
- `review-prompt-save` / `review-prompt-remove` (ADR-0056) write or delete a review prompt: `scope: project` is `.yaw/review/<kind>.md` in the workspace, `scope: global` the blueprint `~/.yaw/review/<kind>.md` (0600). GET `/api/review-prompts?workspace=` and `/api/global/review-prompts` return every layer per kind. The store (`modules/review/lib/prompts.js`) refuses symbolic links, empty text, more than 32 KiB and secret-rule matches.
- `interview-preview` renders the `yaw edit` plan and diff (capped at 256 KiB) without writing; `interview-apply` applies it through `editProject` with the keep strategy. Only one apply runs at a time.
