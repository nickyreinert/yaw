# Tasks

## How to work with this file

1. Work in priority order: P1 = safety/correctness first; P2 = reliability, performance and maintenance. Move selected work to Active as `in progress`, retaining a resume point.
2. Each item includes a suggested model tier and reasoning effort. Add a regression check for the reported behavior; archive completed, validated work in TASKS.archive.md.

Audit: 2026-11-02, Node 22.21.1. Findings below come from source review, isolated reproductions and repository checks. Model names are tier examples; effort reflects task complexity.

Checks: npm test = 1,120 passed / 16 failed / 8 skipped (9 failures: invalid JAVA_HOME; 7: repository/test issues). Schema examples: 28/28 valid. Shellcheck passed. Optional Claude adapter npm audit: 0 reported vulnerabilities. Live provider/Telegram services and Linux isolation were not exercised.

## Active

- T-024 [P2] Validate the actual Gradle JDK prerequisite — `test/profiles.test.js` checks Java on PATH, but Gradle uses JAVA_HOME. Nine smoke tests hit an invalid JAVA_HOME; diagnose that mismatch explicitly and rerun Java/Kotlin/Android checks with a valid supported JDK.
  model: low tier (Luna/Haiku) · effort: medium
  needs decision: with an invalid JAVA_HOME, should the Java/Kotlin/Android smoke gates fail with a message naming JAVA_HOME instead of skipping; and may `just` be installed here (`cargo install just --locked`, denied in this session) so the smoke tests can run?
  resume: diagnosed: JDK 21 at JAVA_HOME is valid; `gradlew` exits at its JAVA_HOME check when JAVA_HOME is invalid even with `java` on PATH (reproduced). Gates `kotlinSkip`, `javaSkip` and the Android gate check only `hasTool('java')`. Smoke tests currently skip with "just is not installed". Next after the decision: regression test for the JAVA_HOME gate, then run the smoke tests.

- T-009 [P1] Repair this repo's own YAW setup — resolve `.gitignore` conflict markers; reconcile missing AGENTS.md, CLAUDE.md, agent settings and hook shim with `.yaw/manifest.json`. Align `test/dogfood.test.js` with the selected code-map module.
  in progress: needs decision: keep the intentional removal of AGENTS.md/CLAUDE.md/.claude hooks/.codex/hooks.json/.yaw/bin/yaw-hook (commit a1411d8) and drop them from .yaw/manifest.json, or restore them via `yaw apply`? Resume: resolve .gitignore markers (keep .DS_Store plus kit block), then apply the choice and align test/dogfood.test.js module list with code-map.
  model: middle tier (Sonnet) · effort: medium


- T-047 [P2] Record Claude Code fixtures for output replacement — capture real PostToolUse payloads for Bash, Grep, WebFetch and Read under `test/fixtures/claude/`, including a Bash command that exits with a non-zero code. Confirm the `updatedToolOutput` shapes rtk assumes (Bash `stdout`/`stderr`, Read `file.content` + `numLines`/`totalLines`, Grep `content` + `numLines`, WebFetch `result`) and whether a non-zero Bash exit fires PostToolUse or PostToolUseFailure. Check Copilot CLI `modifiedResult`. First step, with T-048.
  spec: kickoff/16-compact-output.md §4 L2 and §8
  acceptance: recorded fixtures per tool; a short report to the user if replacement does not work as assumed, before T-052 starts
  model: middle tier (Sonnet) · effort: medium
  status: blocked · resume: Bash, Bash-failure (exit 3), Grep, Read fixtures committed in test/fixtures/claude/ (see README-posttooluse.md); still needed: a SUCCESSFUL WebFetch PostToolUse capture (needs network egress to a fetchable host) and a Copilot CLI `modifiedResult` check.

- T-030 [P2] Consolidate Coding Rules cards — clarify Unit Tests wording (part of `just check`, no overlap with other test/standards settings). Remove Docker from Local Settings and Secrets if it has no independent function. Audit Coding Standards / Git Style / Rules of your Stack against stack, Coding Rules and other cards; remove or merge the card and move missing rules into generated agent instructions.
  model: middle tier (Sonnet) · effort: high
  status: in progress · needs decision: should the Coding standards card (module `standards`: docs/standards.md = clean code, security, performance, testing, review, git style + the profile's stack rules) be merged into Project rules (docs/engineering.md, always on, so the toggle disappears), or kept as is with only the duplicated Testing/Security lines trimmed? It has unique content (clean code, performance, Conventional Commits, stack rules), and `security` depends on it, so merging means removing a module and regenerating the manifests/fixtures.
  done: Unit Tests wording ("Part of `just check`: ..."), Docker removed from Local settings & secrets (card text, Dockerfile/compose/devcontainer templates, profileDevenv container support; tests in test/coding-rules-cards.test.js, modules/devenv/tests). resume: after the decision, merge or trim `standards`, then archive.

- T-055 [P2] L6 optional recall store — `~/.yaw/recall/<hash>.gz` in a private directory: mode 0600, no symlinks (see T-010). At most 200 entries, 30 days and 10 MB per entry; excluded from sync; read back with `yaw recall <hash>`. Off by default; when off, cut output ends with a hint to re-run with `YAW_VERBOSE=1`. Needs an ADR and a privacy NOTICE, since this is the first stored tool-output content. Depends on T-049.
  spec: kickoff/16-compact-output.md §4 L6
  model: middle tier (Sonnet) · effort: high
  status: in progress · needs decision: accept ADR-0133 and NOTICE-0002 (both Proposed; the NOTICE wording is a privacy decision), and whether `recall` may be set by a committed project answer or only personally. Resume: implemented and tested (modules/compact/lib/recall.js, `yaw recall`, run.js); after the decision set both records to accepted and archive

## Backlog

- T-021 [P2] Add a cheap automatic CI gate — `.github/workflows/kit-ci.yml` runs only manually. Run schema checks, shell checks and isolated core tests on PRs; keep expensive profile builds separate to respect the documented minutes budget.
  model: middle tier (Sonnet) · effort: medium

- T-027 [P2] Separate personal from shared settings — in team projects, Communication Style and personal agent preferences must not sync via Git; hooks, skills, tools, shared instructions and project rules may. Decide the storage split (open architecture point), implement it, and rewrite the Solo/Team explanation. Reduce "Who works on this project?" to Solo/Team (drop External Reviewers; check dependents).
  model: top tier (Astra/Opus) · effort: high

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

- T-051 [P2] L1 for the remaining profiles — per profile: a warning pattern and quieter reporter flags (for example `pytest -q`). Depends on T-050.
  spec: kickoff/16-compact-output.md §4 L1
  acceptance: each profile's smoke test verifies its compact output
  model: middle tier (Sonnet) · effort: high

- T-057 [P2] Decide on L3 command rewrite — after T-056, report to the user whether rewriting commands (`cargo test` → `yaw run -- cargo test`) is worth it. Claude Code checks permission rules against the rewritten command, so deny rules can be bypassed. If built: only a short allowlist of read-only commands, never auto-allow, and deny and ask rules read from every settings file. Also settle the All default left open in T-049. Do not implement before the user decides.
  spec: kickoff/16-compact-output.md §4 L3 and §7
  model: top tier (Astra/Opus) · effort: high

## Done → TASKS.archive.md
