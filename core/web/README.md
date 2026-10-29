# Local workspace

`yaw web` serves the application on loopback with the existing one-time login and session checks. Setup is available before project initialization. The interface uses the website's cream/teal palette and shark wordmark, with compact application typography and direct labels.

| Area | Data / controls |
| --- | --- |
| Overview | Current workspace: shared overview cards (projects, sessions, agents, tokens, elapsed, reported cost, open tasks), configuration, recent tasks/sessions and activity |
| Setup | Six revisitable steps, button choices, persistent setting help, live file plan, diff, draft/preset save, explicit Apply |
| Global overview | Folder drill-down from the shared project root; totals; charts split by agent/model/folder/project; device filter for session metrics |
| Analytics | Workspace (locked to the project) and Global; shared multi-select column browser: Device → Folders → Projects → Programming language → Agent → Model; dates and chart split below; usage and message-insight cards; stackable charts; filter/sort/page tables; Refresh, Auto and Classify in the filter bar (Global reads all workspaces, Workspace only the open one); state in the URL |
| Learn | Classified project/session browsing, filtered classification, highlighted dialogue and browser/CLI review; temporary evidence |
| Knowledge | Workspace (project records, decisions, decision categories) and Global (user records); full-text search; namespace/type filters; list/detail reader; rendered/source views; pagination |
| Settings | Workspace: Interview (`yaw edit` in the browser: preview, then apply; first setup for a folder without YAW), Files (YAW-written files by purpose, read-only Form/Raw drawer), Review prompts (project overrides). Global: personal-defaults interview and presets, `~/.yaw` files, Notifications, Classification (editable prompt and temporary sample preview; no model training), Review prompts (blueprint) |
| Tasks | Workspace `TASKS.md`; Global task snapshots filterable by folder/project, linking to each project |
| Code map | Saved map; shown only when the code-map module is enabled |

## Analytics

**Global → Learn** is the home for reviewing collaboration. It reuses the shared Analytics filters and sortable, searchable, paged tables. Saved classification charts show outcomes, assistant behaviour and sentiment separately. Start with a recognizable project or browse sessions under Needs attention, All classified or All sessions. Learn classifies only eligible saved local session IDs matching those filters (unclassified first), without touching other saved rows. Pause, Resume and Stop use the shared classifier job controls. Refresh collects saved metadata separately.

**Read conversation** explicitly authorizes reading that named local transcript. The authenticated `insights-review` POST performs filename-only discovery, then returns chronological user/assistant messages with tentative correction, apology/mistake and recovery ranges for safe text-node highlighting. Previous/Next clue moves through the conversation. No turn count or excerpt checklist is required. Reads remain capped at 8 MiB or 1,000 recorded messages; larger Gemini documents are skipped. Missing evidence and partial reads are visible. Synced statistics still work but cannot supply local dialogue.

**Review this conversation** automatically prepares relevant marked exchanges and nearby context in one editable prompt (24,000 characters maximum). It requests one verdict sentence and at most three action bullets within 150 words. Inspect/redact the exact prompt, copy it, and use the same browser-chat links as the interview; URLs carry no conversation text. **Global → Settings → Learn** enables installed Claude Code/Codex reviewers and chooses a default browser or CLI destination. An explicit, confirmed CLI review sends the inspected prompt over stdin to a fixed non-shell command in a fresh temporary working folder. Claude uses bare mode with tools disabled and no session persistence; Codex uses an ephemeral read-only session without user config, shell tools, apps, hooks or delegation. Existing sign-in is used, provider usage may be billed, and provider-side retention still applies. CLI results are displayed temporarily, with Stop and a three-minute timeout; output is capped and stderr is never returned or logged. Completed server results expire after 15 minutes. No suggestions are applied.

Conversation evidence, prompts and verdicts never enter analytics, registry, sync, logs or URL state. Leaving Learn, changing filters or refreshing clears the temporary review. Saved aggregate coverage retains unknown, mixed, skipped and unclassified records; keyword clues and classifier predictions are unvalidated. See ADR-0065 and `CONCEPT.md`.

The default is all history across all projects. The application requests read-only native discovery; no per-project import is required. Metadata from local agent history is merged with registry rows by agent/session ID. Hook-written titles and project identities are preserved. Native usage augments the registry in memory only. No database is created by this discovery; ordinary session rows contain no conversation text or transcript paths. Confirmed Insights reads and classification previews temporarily return excerpts. The existing per-project `yaw sessions import` CLI behavior is unchanged.

Native scans cache their metadata for 60 seconds; Refresh rescans. Existing parser bounds apply: up to 20,000 files per agent and lines up to 4 MiB. Symlinked agent-history directories/files are skipped. Missing/unreadable history files do not hide other projects. Full prompt/response objects are parsed transiently by the existing import readers and discarded; only metadata is retained. The UI discloses the scan limit.

The six filter columns combine choices with OR within a column and AND across columns. Each column lists choices allowed by the columns to its left and the date range; changing an earlier column clears incompatible later selections. All is the default. Filters run before totals, sorting and pagination. Repeated URL parameters preserve multiple selections; legacy #sessions and #global-sessions links redirect to #analytics and #global-analytics.
Global overview and Global Analytics also have a device selector (**All
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

## Setup prompts and agent API

Your project includes an optional copy-only interview prompt containing the current idea and supported settings. An external chat can ask focused questions and recommend Architecture and Workflow values for manual entry. Review shows one automatically regenerated final kickoff prompt for a local coding agent to write Architecture, Data Model and UI/UX directly in the target project. Setup, completion and Settings use copy-only cards; there is no reply input or refresh action. Prompt generation uses validated effective answers and clears stale text while updating. Chat links carry no project data.

Interview choices use native buttons with `aria-pressed` and hand-drawn `currentColor` icons. A persistent right column shows help for the focused or hovered setting; narrow layouts place it above the choices. Personal language uses a text input and labels remain stable at every expertise level. Legacy architecture values remain readable; fresh interviews omit redundant no-preference choices and defer hosting ownership to document planning.

`yaw init --api` starts the authenticated local REST service without a browser. Agents discover the same question/module catalogue, replace validated in-memory setup state with revision checks, preview files, then explicitly apply the reviewed setup. Opening/reloading the wizard picks up API state. See [the API contract](../../docs/setup-api.md). Existing CLI plan-import commands remain available separately.

## YAW visual identity

`yaw-theme.css` supplies the shared brand treatment after `app.css` in setup and the dashboard: navy ink, chart-paper dots, cobalt, sunny yellow selection/action states and coral fin details. The recoloured SVG shark, wordmark, waterline and interview mascot make the identity visible across the workspace. Trebuchet headings and monospace metadata use local font fallbacks; no font CDN or runtime dependency is added. Keep focus visible on dark and light surfaces, preserve semantic warning/success colours, and respect reduced motion. Component geometry and responsive layout stay in `app.css`.
