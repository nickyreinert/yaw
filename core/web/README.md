# Local workspace

`yaw web` serves the application on loopback with the existing one-time login and session checks. Setup is available before project initialization. The interface uses the website's cream/teal palette and shark wordmark, with compact application typography and direct labels.

| Area | Data / controls |
| --- | --- |
| Overview | Global session/project/agent counts, reported tokens, elapsed time, current-project task count, configuration, activity, project table |
| Setup | Six revisitable steps, expertise-specific help, live file plan, diff, draft/preset save, explicit Apply |
| Sessions | Global registry + native Claude Code/Codex/Copilot history; project/agent/model/period filters; sortable session columns; Agents/Projects/Models comparisons; pagination |
| Knowledge | User/project scopes; full-text search; namespace/type filters; list/detail reader; rendered/source views; pagination |
| Maintenance | Non-secret manifest file states, kit pin, terminal commands; no recipe execution |
| Tasks | Current project's active tasks and backlog |

## Sessions

The default is all history across all projects. The application requests read-only native discovery; no per-project import is required. Metadata from local agent history is merged with registry rows by agent/session ID. Hook-written titles and project identities are preserved. Native usage augments the registry in memory only. No database is created by this discovery and no transcripts or paths are sent to the browser. The existing per-project `yaw sessions import` CLI behavior is unchanged.

Native scans cache their metadata for 60 seconds; Refresh rescans. Existing parser bounds apply: up to 20,000 files per agent and lines up to 4 MiB. Symlinked agent-history directories/files are skipped. Missing/unreadable history files do not hide other projects. Full prompt/response objects are parsed transiently by the existing import readers and discarded; only metadata is retained. The UI discloses the scan limit.

Project/agent/model/date filters run before totals, sorting and pagination. All matching rows remain accessible in pages of 50. Sorting supports date, project, agent, model, tokens, duration and cost; unknown numbers sort last in either direction. Aggregates cover the entire selection. Comparisons sort in the client. Activity displays the latest 30 active days; tooltips give UTC dates and counts. Session timestamps use the browser timezone.

Missing usage, cost and end times remain unknown; coverage accompanies the totals. Zero reported cost is distinct from missing cost. Tokens include cache input where supplied by the agent; duration is elapsed time rather than active work. Outcome evaluation, cache breakdowns, tool-failure rates and OTel are not collected.

## Knowledge

The browser reads existing Markdown from these fixed roots:

| Scope | Sources |
| --- | --- |
| User | `~/.yaw/knowledge/` (or `$YAW_HOME/knowledge/`) |
| Project | `.decisions/` including details, `docs/knowledge/`, `docs/spec/` |

User knowledge is not automatically injected into project context. The explicit User/All scopes browse the user's namespaces; the Project scope reads only the current project's sources. CLI retrieval and namespace permission behavior are unchanged. No source folder, index, format migration or record is created by viewing.

Titles come from the first heading or optional YAML frontmatter. ADR/notice metadata is recognized; optional `type`, `tags`, `status`, and `category` frontmatter supports plain rule/preference/lesson/snippet documents. A user record's first subfolder identifies its namespace. Search covers title, path, category, tags and content. Listing responses omit content; selecting a listed record fetches its body through an opaque source/relative-name key, never a caller-supplied filesystem path.

Reads reject symlinked roots/components and files, bind to checked file descriptors, cap each file at 128 KiB, and scan at most 1,000 Markdown records to depth four. Secret-like content is withheld. Sources, missing stores, exclusions, and scan limits are visible. Markdown is rendered with text nodes; raw HTML never executes. Source view preserves the original text.

## Verification

Focused checks: `node --test test/knowledge.test.js test/session-profile.test.js test/dashboard.test.js test/form-ui.test.js test/web-background.test.js modules/sessions/tests/import.test.js`.

Repository gate: `just check`. Keep its pre-existing adapter drift separate from web changes. Browser QA covers setup retention, sorting/filtering/pagination, source coverage, knowledge scope/search/reader, keyboard navigation, and narrow layouts.
