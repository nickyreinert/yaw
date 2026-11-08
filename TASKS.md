# Tasks

## How to work with this file

1. Work in priority order: P1 = safety/correctness first; P2 = reliability, performance and maintenance. Move selected work to Active as `in progress`, retaining a resume point.
2. Each item includes a suggested model tier and reasoning effort. Add a regression check for the reported behavior; archive completed, validated work in TASKS.archive.md.

Audit: 2026-11-02, Node 22.21.1. Findings below come from source review, isolated reproductions and repository checks. Model names are tier examples; effort reflects task complexity.

Checks: npm test = 1,120 passed / 16 failed / 8 skipped (9 failures: invalid JAVA_HOME; 7: repository/test issues). Schema examples: 28/28 valid. Shellcheck passed. Optional Claude adapter npm audit: 0 reported vulnerabilities. Live provider/Telegram services and Linux isolation were not exercised.

## Active

- T-018 [P2] in progress — Remove quadratic scan merging. Resume: regression test in test/session-insights.test.js (spy on rows.find during cached refresh), then replace `old.rows.find` with `byId.get` in core/lib/session-analysis.js collectAnalysis, benchmark 20,000 sessions.
  model: low tier (Luna/Haiku) · effort: medium

- T-020 [P2] in progress — Repair brittle UI/parity tests. Resume: run test/analytics-filters.test.js and test/form-parity.test.js, make them locate controls semantically / questions by id.

- T-009 [P1] Repair this repo's own YAW setup — resolve `.gitignore` conflict markers; reconcile missing AGENTS.md, CLAUDE.md, agent settings and hook shim with `.yaw/manifest.json`. Align `test/dogfood.test.js` with the selected code-map module.
  in progress: needs decision: keep the intentional removal of AGENTS.md/CLAUDE.md/.claude hooks/.codex/hooks.json/.yaw/bin/yaw-hook (commit a1411d8) and drop them from .yaw/manifest.json, or restore them via `yaw apply`? Resume: resolve .gitignore markers (keep .DS_Store plus kit block), then apply the choice and align test/dogfood.test.js module list with code-map.
  model: middle tier (Sonnet) · effort: medium

- T-011 [P2] Preserve permissions during atomic replacement — `core/render/files.js:writeAtomic` changes an existing 0600 file to 0644 under umask 022 and drops executable bits. Preserve existing modes unless an explicit override is supplied; check callers too. — in progress; fix + test in core/render/files.js, test/render.test.js; next: npm test, archive.
  model: middle tier (Sonnet) · effort: medium

- T-025 [P2] Remove generated artifacts from scaffolds — tracked `.gradle/` caches in `profiles/android-kotlin/scaffold` and `profiles/java-basic/scaffold`, plus Android `build/reports/`, pollute generated projects. Remove them and enforce scaffold exclusions while retaining the Gradle wrapper.
  model: low tier (Luna/Haiku) · effort: low
  status: in progress · resume: write scaffold-artifact regression test, then remove tracked .gradle/build reports and add exclusions

- T-015 [P2] Bound hosted setup and shutdown — `core/cli/init.js` has no child-process deadline; `HostedProjects.close()` waits indefinitely for verification. Add cancellation, process-tree termination and a bounded shutdown that preserves partial-project status.
  model: top tier (Astra/Opus) · effort: high
  status: in progress · resume: investigate core/cli/init.js child processes and HostedProjects.close()

- T-047 [P2] Record Claude Code fixtures for output replacement — capture real PostToolUse payloads for Bash, Grep, WebFetch and Read under `test/fixtures/claude/`, including a Bash command that exits with a non-zero code. Confirm the `updatedToolOutput` shapes rtk assumes (Bash `stdout`/`stderr`, Read `file.content` + `numLines`/`totalLines`, Grep `content` + `numLines`, WebFetch `result`) and whether a non-zero Bash exit fires PostToolUse or PostToolUseFailure. Check Copilot CLI `modifiedResult`. First step, with T-048.
  spec: kickoff/16-compact-output.md §4 L2 and §8
  acceptance: recorded fixtures per tool; a short report to the user if replacement does not work as assumed, before T-052 starts
  model: middle tier (Sonnet) · effort: medium
  status: blocked · resume: Bash, Bash-failure (exit 3), Grep, Read fixtures committed in test/fixtures/claude/ (see README-posttooluse.md); still needed: a SUCCESSFUL WebFetch PostToolUse capture (needs network egress to a fetchable host) and a Copilot CLI `modifiedResult` check.

## Backlog

- T-012 [P2] Fix Markdown deletion in sync — `core/lib/data-sync.js:applyPortableRecords` parses deleted knowledge files as YAML; normal front matter throws and prevents deletion. Parse answers only for settings/preset records.
  model: low tier (Luna/Haiku) · effort: medium

- T-013 [P2] Use the same knowledge directory everywhere — `core/web/knowledge.js` honors YAW_HOME, while `core/lib/data-sync.js` reads/writes HOME/.yaw. Sync the configured knowledge store and test with distinct HOME and YAW_HOME.
  model: middle tier (Sonnet) · effort: medium

- T-015 [P2] Bound hosted setup and shutdown — `core/cli/init.js` has no child-process deadline; `HostedProjects.close()` waits indefinitely for verification. Add cancellation, process-tree termination and a bounded shutdown that preserves partial-project status.
  model: top tier (Astra/Opus) · effort: high
  status: in progress · resume: investigate core/cli/init.js child processes and HostedProjects.close()

- T-047 [P2] Record Claude Code fixtures for output replacement — capture real PostToolUse payloads for Bash, Grep, WebFetch and Read under `test/fixtures/claude/`, including a Bash command that exits with a non-zero code. Confirm the `updatedToolOutput` shapes rtk assumes (Bash `stdout`/`stderr`, Read `file.content` + `numLines`/`totalLines`, Grep `content` + `numLines`, WebFetch `result`) and whether a non-zero Bash exit fires PostToolUse or PostToolUseFailure. Check Copilot CLI `modifiedResult`. First step, with T-048.
  spec: kickoff/16-compact-output.md §4 L2 and §8
  acceptance: recorded fixtures per tool; a short report to the user if replacement does not work as assumed, before T-052 starts
  model: middle tier (Sonnet) · effort: medium
  status: blocked · resume: Bash, Bash-failure (exit 3), Grep, Read fixtures committed in test/fixtures/claude/ (see README-posttooluse.md); still needed: a SUCCESSFUL WebFetch PostToolUse capture (needs network egress to a fetchable host) and a Copilot CLI `modifiedResult` check.

## Backlog

- T-012 [P2] Fix Markdown deletion in sync — `core/lib/data-sync.js:applyPortableRecords` parses deleted knowledge files as YAML; normal front matter throws and prevents deletion. Parse answers only for settings/preset records.
  model: low tier (Luna/Haiku) · effort: medium

- T-013 [P2] Use the same knowledge directory everywhere — `core/web/knowledge.js` honors YAW_HOME, while `core/lib/data-sync.js` reads/writes HOME/.yaw. Sync the configured knowledge store and test with distinct HOME and YAW_HOME.
  model: middle tier (Sonnet) · effort: medium

- T-014 [P2] Reject malformed LAN responses safely — `core/remote/lan.js:lanFetch` throws uncaught on HTTP 204 when constructing a Response with a body. Handle bodyless statuses and response-construction errors through promise rejection, including aborted responses.
  model: middle tier (Sonnet) · effort: medium

- T-016 [P2] Enforce transcript limits before buffering — `core/lib/session-analysis.js` and `modules/sessions/lib/import.js` check line size after readline buffers it. A discarded 64 MiB line raised RSS from 87 to 247 MiB; bound line buffering and stream scan metrics.
  model: top tier (Astra/Opus) · effort: high

- T-021 [P2] Add a cheap automatic CI gate — `.github/workflows/kit-ci.yml` runs only manually. Run schema checks, shell checks and isolated core tests on PRs; keep expensive profile builds separate to respect the documented minutes budget.
  model: middle tier (Sonnet) · effort: medium

- T-022 [P2] Invalidate obsolete review approvals — `modules/review/lib/cli.js` caches only commit SHA and reviewer kind. Include effective prompts/rules, reviewed range and relevant configuration so changed review requirements cannot reuse an old PASS.
  model: middle tier (Sonnet) · effort: high

- T-024 [P2] Validate the actual Gradle JDK prerequisite — `test/profiles.test.js` checks Java on PATH, but Gradle uses JAVA_HOME. Nine smoke tests hit an invalid JAVA_HOME; diagnose that mismatch explicitly and rerun Java/Kotlin/Android checks with a valid supported JDK.
  model: low tier (Luna/Haiku) · effort: medium

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

- T-048 [P2] Measure tool-output share before building (L5, part 1) — transcript scan of tool-result sizes by tool and by the command's first word, shown in Analytics. Store sizes and first words only, no content (ADR-0052). Reuse the streaming reader in `core/lib/session-analysis.js` and respect T-016's line limits. First step, with T-047.
  spec: kickoff/16-compact-output.md §4 L5
  model: middle tier (Sonnet) · effort: high

- T-049 [P2] Module `compact`: definition, interview and scope — `modules/compact/module.yaml` with the `compact.levers` multi-choice question. Off in Basic; Quick reuses saved personal defaults; the All default is open (assume off). Per-project scope: committed (`.yaw/answers.yaml`, `.claude/settings.json`) or personal (`~/.yaw`, `.claude/settings.local.json`); precedence `YAW_COMPACT`, then personal, then project. The recall store (T-055) is a separate choice, off by default. Includes the L4 AGENTS.md fragment (`tokenCost: low`), rendered only when L1 or L2 is on.
  spec: kickoff/16-compact-output.md §4 and §7
  acceptance: `yaw add compact` and `yaw remove compact` proven by tests; both scopes render the right files
  model: middle tier (Sonnet) · effort: high

- T-050 [P2] L1 wrapper `yaw run --compact` with the node-cli recipes — exit 0: one line `ok <step> (<n> lines, <s>s)`. Exit 0 with warnings: count line, first 10 warnings and `… +<k> more warnings`, as rtk does for `cargo build`. Exit not 0: ANSI, progress and dedup stripping plus a head/tail cap with a recovery hint; the exit code is kept. `YAW_VERBOSE=1` prints raw output; `rawBytes`/`outBytes` are recorded per step. This repo's recipes come first. Depends on T-049.
  spec: kickoff/16-compact-output.md §4 L1
  model: top tier (Astra/Opus) · effort: high

- T-051 [P2] L1 for the remaining profiles — per profile: a warning pattern and quieter reporter flags (for example `pytest -q`). Depends on T-050.
  spec: kickoff/16-compact-output.md §4 L1
  acceptance: each profile's smoke test verifies its compact output
  model: middle tier (Sonnet) · effort: high

- T-052 [P2] Hook kind `compress` — amend ADR-0007 and BUILD.md rule 5. PostToolUse only, returning only `updatedToolOutput`; the dispatcher drops any result that is not smaller than the original, and the result may end with one recall line. Add `compress` to the kind enum in `core/schema/module.schema.json`. In `core/hooks/adapters.js`, hold `tool_response` in memory for compress handlers only and add a PostToolUse branch to `renderOutput`. Optional `rawBytes`/`outBytes`/`method` in `hook-event.schema.json`. Depends on T-047.
  spec: kickoff/16-compact-output.md §5
  acceptance: existing silent-hook tests still pass; "never worse" is enforced; tool output never reaches a log
  model: top tier (Astra/Opus) · effort: high

- T-053 [P2] Lean compress entry and shim size gate — a compress entry point that loads neither the kit nor the schemas (prototype: 34 ms against 67 ms through `yaw hook`). The shim exits without starting Node below a payload threshold (prototype: 3 ms); the threshold applies to the whole payload, not to the output alone. Depends on T-052.
  spec: kickoff/16-compact-output.md §5 (latency plan, steps 2 and 3)
  acceptance: a timing check that does not depend on the machine
  model: middle tier (Sonnet) · effort: medium

- T-054 [P2] L2 compress methods and guards (Claude Code) — methods: `ansi`, `progress`, `dedup`, `cap` (recall or re-run hint), grep grouping by file, lockfile summary. Skips output under 512 bytes, commands with detail flags (`-v`, `--verbose`, `--nocapture`), `git diff|show`, `yaw run` output and every Read except lockfiles. Fails open. Depends on T-047, T-052 and T-053.
  spec: kickoff/16-compact-output.md §4 L2
  acceptance: tests run on the T-047 fixtures
  model: top tier (Astra/Opus) · effort: high

- T-055 [P2] L6 optional recall store — `~/.yaw/recall/<hash>.gz` in a private directory: mode 0600, no symlinks (see T-010). At most 200 entries, 30 days and 10 MB per entry; excluded from sync; read back with `yaw recall <hash>`. Off by default; when off, cut output ends with a hint to re-run with `YAW_VERBOSE=1`. Needs an ADR and a privacy NOTICE, since this is the first stored tool-output content. Depends on T-049.
  spec: kickoff/16-compact-output.md §4 L6
  model: middle tier (Sonnet) · effort: high

- T-056 [P2] Savings view and A/B validation (L5, part 2) — Analytics shows `rawBytes`/`outBytes` per tool and method, with tokens estimated as bytes/4 and labelled as estimates. Compare the same kind of task with the module on and off, using per-session `tokensIn` and the number of `YAW_VERBOSE=1` re-runs (filter misses). Depends on T-050 or T-054.
  spec: kickoff/16-compact-output.md §4 L5
  acceptance: the result is reported to the user
  model: middle tier (Sonnet) · effort: medium

- T-057 [P2] Decide on L3 command rewrite — after T-056, report to the user whether rewriting commands (`cargo test` → `yaw run -- cargo test`) is worth it. Claude Code checks permission rules against the rewritten command, so deny rules can be bypassed. If built: only a short allowlist of read-only commands, never auto-allow, and deny and ask rules read from every settings file. Also settle the All default left open in T-049. Do not implement before the user decides.
  spec: kickoff/16-compact-output.md §4 L3 and §7
  model: top tier (Astra/Opus) · effort: high

## Done → TASKS.archive.md
