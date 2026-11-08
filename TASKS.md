# Tasks

## How to work with this file

1. Work in priority order: P1 = safety/correctness first; P2 = reliability, performance and maintenance. Move selected work to Active as `in progress`, retaining a resume point.
2. Each item includes a suggested model tier and reasoning effort. Add a regression check for the reported behavior; archive completed, validated work in TASKS.archive.md.

Audit: 2026-11-02, Node 22.21.1. Findings below come from source review, isolated reproductions and repository checks. Model names are tier examples; effort reflects task complexity.

Checks: npm test = 1,120 passed / 16 failed / 8 skipped (9 failures: invalid JAVA_HOME; 7: repository/test issues). Schema examples: 28/28 valid. Shellcheck passed. Optional Claude adapter npm audit: 0 reported vulnerabilities. Live provider/Telegram services and Linux isolation were not exercised.

## Active

## Backlog

- T-006 [P1] Stop sync exclusions deleting files — `core/lib/data-sync.js`: a previously synced note exceeding 128 KiB is omitted, published as a tombstone and deleted locally. Distinguish excluded/unreadable records from intentional deletions.
  model: top tier (Astra/Opus) · effort: high

- T-007 [P1] Preserve analytics when history is unavailable — `core/lib/session-analysis.js:collectAnalysis` replaces saved rows with an empty scan when a source disappears. Keep prior metrics/classifications and report incomplete discovery; cover disabled sources and discovery limits too.
  model: middle tier (Sonnet) · effort: high

- T-008 [P1] Fail the push review gate on Git errors — `modules/review/lib/cli.js:pushedCommits` turns an unknown remote SHA into zero commits, bypassing review; failed diffs also become empty text. Propagate failures and require an exact final verdict line.
  model: middle tier (Sonnet) · effort: high

- T-009 [P1] Repair this repo's own YAW setup — resolve `.gitignore` conflict markers; reconcile missing AGENTS.md, CLAUDE.md, agent settings and hook shim with `.yaw/manifest.json`. Align `test/dogfood.test.js` with the selected code-map module.
  model: middle tier (Sonnet) · effort: medium

- T-010 [P2] Harden hook logs — `core/hooks/dispatch.js:appendLog` follows symlinks and creates 0644 logs containing session IDs/workspace paths. Require private directories/files, reject non-regular targets and preserve those protections during rotation.
  model: middle tier (Sonnet) · effort: high

- T-011 [P2] Preserve permissions during atomic replacement — `core/render/files.js:writeAtomic` changes an existing 0600 file to 0644 under umask 022 and drops executable bits. Preserve existing modes unless an explicit override is supplied; check callers too.
  model: middle tier (Sonnet) · effort: medium

- T-012 [P2] Fix Markdown deletion in sync — `core/lib/data-sync.js:applyPortableRecords` parses deleted knowledge files as YAML; normal front matter throws and prevents deletion. Parse answers only for settings/preset records.
  model: low tier (Luna/Haiku) · effort: medium

- T-013 [P2] Use the same knowledge directory everywhere — `core/web/knowledge.js` honors YAW_HOME, while `core/lib/data-sync.js` reads/writes HOME/.yaw. Sync the configured knowledge store and test with distinct HOME and YAW_HOME.
  model: middle tier (Sonnet) · effort: medium

- T-014 [P2] Reject malformed LAN responses safely — `core/remote/lan.js:lanFetch` throws uncaught on HTTP 204 when constructing a Response with a body. Handle bodyless statuses and response-construction errors through promise rejection, including aborted responses.
  model: middle tier (Sonnet) · effort: medium

- T-015 [P2] Bound hosted setup and shutdown — `core/cli/init.js` has no child-process deadline; `HostedProjects.close()` waits indefinitely for verification. Add cancellation, process-tree termination and a bounded shutdown that preserves partial-project status.
  model: top tier (Astra/Opus) · effort: high

- T-016 [P2] Enforce transcript limits before buffering — `core/lib/session-analysis.js` and `modules/sessions/lib/import.js` check line size after readline buffers it. A discarded 64 MiB line raised RSS from 87 to 247 MiB; bound line buffering and stream scan metrics.
  model: top tier (Astra/Opus) · effort: high

- T-017 [P2] Keep Git sync off the HTTP event loop — `core/web/workspace-api.js` invokes synchronous `runSync`; each Git/gh subprocess can block for 60 seconds. Use an asynchronous job with progress, cancellation and concurrent dashboard reads.
  model: middle tier (Sonnet) · effort: high

- T-018 [P2] Remove quadratic scan merging — `core/lib/session-analysis.js:collectAnalysis` calls `old.rows.find` for every result despite already building `byId`. Use indexed lookup and benchmark a 20,000-session cached refresh.
  model: low tier (Luna/Haiku) · effort: medium

- T-019 [P2] Isolate recipe tests from installed YAW — code-map, GitHub and composition tests inherit the host PATH, so “kit absent” cases execute the real installed CLI. Provide explicit tool stubs and isolated configuration instead.
  model: middle tier (Sonnet) · effort: medium

- T-020 [P2] Repair brittle UI/parity tests — `test/analytics-filters.test.js` addresses children by outdated positions; `test/form-parity.test.js` assumes unique labels (39 distinct labels for 41 questions). Locate controls semantically and identify questions by stable IDs.
  model: middle tier (Sonnet) · effort: medium

- T-021 [P2] Add a cheap automatic CI gate — `.github/workflows/kit-ci.yml` runs only manually. Run schema checks, shell checks and isolated core tests on PRs; keep expensive profile builds separate to respect the documented minutes budget.
  model: middle tier (Sonnet) · effort: medium

- T-022 [P2] Invalidate obsolete review approvals — `modules/review/lib/cli.js` caches only commit SHA and reviewer kind. Include effective prompts/rules, reviewed range and relevant configuration so changed review requirements cannot reuse an old PASS.
  model: middle tier (Sonnet) · effort: high

- T-023 [P2] Publish personal YAML updates atomically — `core/lib/user-store.js:write` truncates profiles/presets before writing. Use private temporary files and atomic publication; preserve existing data on write failure and prevent concurrent preset creation from overwriting another save.
  model: middle tier (Sonnet) · effort: high

- T-024 [P2] Validate the actual Gradle JDK prerequisite — `test/profiles.test.js` checks Java on PATH, but Gradle uses JAVA_HOME. Nine smoke tests hit an invalid JAVA_HOME; diagnose that mismatch explicitly and rerun Java/Kotlin/Android checks with a valid supported JDK.
  model: low tier (Luna/Haiku) · effort: medium

- T-025 [P2] Remove generated artifacts from scaffolds — tracked `.gradle/` caches in `profiles/android-kotlin/scaffold` and `profiles/java-basic/scaffold`, plus Android `build/reports/`, pollute generated projects. Remove them and enforce scaffold exclusions while retaining the Gradle wrapper.
  model: low tier (Luna/Haiku) · effort: low

- T-026 [P2] Simplify Communication Style — keep Language. Relabel "Frequency: How often should the agent ask before acting?", "Depth: How long should answers be?" (Brief & on point → generated rule "Prefer bullet points, key points and direct answers. Avoid unnecessary explanations."), "Response: Should the agent explain its actions?" (short confirmation vs. detailed change report). Remove "technical wording" and "examples and analogies"; move "Your experience with software development" here and derive technical level/analogies from it. Keep its effect on question coverage and tool permissions. Check which rules the removed questions generated and carry them over.
  model: middle tier (Sonnet) · effort: high

- T-027 [P2] Separate personal from shared settings — in team projects, Communication Style and personal agent preferences must not sync via Git; hooks, skills, tools, shared instructions and project rules may. Decide the storage split (open architecture point), implement it, and rewrite the Solo/Team explanation. Reduce "Who works on this project?" to Solo/Team (drop External Reviewers; check dependents).
  model: top tier (Astra/Opus) · effort: high

- T-028 [P2] Rework Collaboration texts and rules — inspect the implementation first. (a) "Checks on GitHub": describe the actual workflows, checks, Dependabot role and failure behavior. (b) "GitHub Workflow": explain as project-management support; audit epics, milestones, structured issues and progress tracking, add what is missing. (c) Rename "Team Rules" to "Workflow Rules"; verify real session-start behavior (issue display, PR creation) and that it applies to solo projects.
  model: middle tier (Sonnet) · effort: high

- T-029 [P2] Move Task List and add model recommendations — move Task List out of Advanced Coding Rules to directly below Collaboration; mark "Local only"; describe it as backlog/in-progress/done management with priorities for coding agents. Every task and GitHub issue (local list, issue templates, generated tasks, planning-skill issues) must carry priority, status, recommended model and reasoning effort; audit existing support and make it consistent.
  model: middle tier (Sonnet) · effort: high

- T-030 [P2] Consolidate Coding Rules cards — clarify Unit Tests wording (part of `just check`, no overlap with other test/standards settings). Remove Docker from Local Settings and Secrets if it has no independent function. Audit Coding Standards / Git Style / Rules of your Stack against stack, Coding Rules and other cards; remove or merge the card and move missing rules into generated agent instructions.
  model: middle tier (Sonnet) · effort: high

- T-031 [P2] Dissolve Coding Practices — remove user-facing errors, diagnostic logs and internal documentation as user options. Generate equivalent rules automatically from language/framework/destination/architecture/tools (e.g. no logging infrastructure for a plain HTML page; docs rules coordinated with Code Map). Remove the section if no real decision remains.
  model: middle tier (Sonnet) · effort: high

- T-032 [P2] Rework Review Sub-Agents — keep Quality, Business Logic, UI/UX, Security. Show Push Gate (Warn/Block) as a full-width card above the agent cards. Decide on Feature Fit (possibly "Task Review"): check overlap with existing review/completion checks, merge if duplicated, do not remove unchecked.
  model: middle tier (Sonnet) · effort: medium

- T-033 [P2] Rewrite Coding Assistance help texts — Session Hygiene, Status line, Task Context, Notifications after long runs, Cache Warmth Reminder (and other comfort features). Each tooltip states what it does, the concrete benefit and what changes technically; verify against the implementation first.
  model: low tier (Luna/Haiku) · effort: medium

- T-034 [P2] Unify card layout and order — consistent grouping, spacing and containers; the five Coding Style cards adjacent in logical order; remove the extra frame around Coding Practices; use "Category: question" labels. Check whether the "Choose a support language and destination" step repeats already-asked stack questions. Do this after T-026–T-033 settle the card set. Principle: fewer questions, no lost behavior.
  model: middle tier (Sonnet) · effort: medium

- T-035 [P1] Fix Classification opening error — opening Classification throws "Cannot access 'link' before initialization" (temporal dead zone in web code). Find the cause, fix it and add a regression test that opens the view.
  model: low tier (Luna/Haiku) · effort: medium

- T-036 [P2] Feature toggles: Settings Sync and Profiling — add a "Settings Sync" checkbox under Features (off → hide its tab and entry points; Server Mode unchanged). Merge Classification and Learning into one optional "Profiling" feature (name supersedes "Session Intelligence"; see T-042) with one checkbox; off → hide their Settings tabs, the sidebar Profiling section, workspace Profiling and the Analytics Classification block. Rename "Outcomes" in Analytics to "Classification". Check whether Classification and Learning are technically one function or two steps before merging internally. Hidden features must not be reachable via other navigation.
  model: top tier (Astra/Opus) · effort: high

- T-037 [P2] Replace Settings/Interview buttons with a segmented switch — keep behavior; review its interplay with the Focus switch so the two switches have a clear hierarchy and do not change views ambiguously.
  model: middle tier (Sonnet) · effort: medium

- T-038 [P2] Shared pagination component — one component with page sizes 5/10/25/50 (default 5), Previous/Next/page numbers; reuse existing pagination. Apply to Workspace Overview (Sessions, Tasks), Analytics tables, Knowledge, Workspace Tasks and Code Map. Knowledge selection and preview must stay correct across pages. Do this before T-039–T-041.
  model: middle tier (Sonnet) · effort: high

- T-039 [P2] Compact Analytics — evaluate merging Session Length and Session Timings into one table without losing data; keep the other Analytics sections (Agents & Models, collapsible layout). Depends on T-036 for the Classification block.
  model: low tier (Luna/Haiku) · effort: medium

- T-040 [P2] Workspace Knowledge tabs and sticky filter — tabs "Knowledge" and "Decision Categories" (category management integrated properly); sticky search/filter bar that doesn't cover other navigation; keep the list/preview layout. Depends on T-038.
  model: middle tier (Sonnet) · effort: medium

- T-041 [P2] Rework Code Map view — table as the primary view with pagination (T-038); raw YAML moved into a collapsed "Show raw data / Hide raw data" section below, formatted and complete.
  model: low tier (Luna/Haiku) · effort: medium

- T-042 [P2] Rename Learning to Profiling and add workspace scope — rename everywhere (menu, icon, labels, settings; "Learning" disappears as a feature name; Classification stays as the process, "Profiling Settings" as config). Add a Profiling menu entry inside a workspace limited to that workspace's sessions. Global and workspace views use the same components, configured by scope; no second system. Toggle lives in global Features (T-036).
  model: middle tier (Sonnet) · effort: high

- T-043 [P2] Classify controller and slimmer filter bar — remove Classify, Classify Unclassified and Classification Settings buttons from the shared filter bar (keep Search, Refresh, Auto, Expand filters, Reset, sticky). Add a separate controller above it (`/global/improve` and the workspace view) with 5 / 10 / All sessions, a start button and a deep link to Profiling Settings. First check how sessions are selected, whether batching exists, how "All" is handled and whether only unclassified sessions are processed; reuse the existing logic.
  model: middle tier (Sonnet) · effort: high

- T-044 [P2] Rebuild "Where did work get difficult?" navigation and preview — replace the Projects/Sessions buttons with a "View" switch: Folder Browser (project/folder hierarchy, reliable back navigation) vs. All Sessions (flat list); same data and filters in both. "Read Conversation" opens a right-hand preview (table narrows) with an X that restores full width, no page change. Make the preview component reusable for other session lists; reuse existing folder-hierarchy components.
  model: middle tier (Sonnet) · effort: high

- T-045 [P2] Investigate Safe Verdicts before changing it — explain what it stores, how verdicts arise, what "No Important Verdict", "Set Retention" and "Import a Verdict" do, why it is separate from Analytics and Sync, and its user benefit. Report to the user first; then decide keep/rename/move/remove. Do not alter or delete data or the UI before that decision.
  model: middle tier (Sonnet) · effort: medium

## Done → TASKS.archive.md
