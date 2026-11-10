# Tasks

## How to work with this file

1. Work in priority order: P1 = safety/correctness first; P2 = reliability, performance and maintenance. Move selected work to Active as `in progress`, retaining a resume point.
2. Each item includes a suggested model tier and reasoning effort. Add a regression check for the reported behavior; archive completed, validated work in TASKS.archive.md.

Audit: 2026-11-02, Node 22.21.1. Findings below come from source review, isolated reproductions and repository checks. Model names are tier examples; effort reflects task complexity.

Checks: npm test = 1,120 passed / 16 failed / 8 skipped (9 failures: invalid JAVA_HOME; 7: repository/test issues). Schema examples: 28/28 valid. Shellcheck passed. Optional Claude adapter npm audit: 0 reported vulnerabilities. Live provider/Telegram services and Linux isolation were not exercised.

## Active

### T-073 Session classification v2: per-exchange labels — in progress
- **Brief:** Implement kickoff/17-session-classification.md (ADR-0135): per-exchange assistant and user labels saved locally without text, so Profiling can filter a conversation's turns by admitted error, frustration and the other labels.
- **Priority:** P2
- **Model / effort:** middle tier (Sonnet) · effort: high
- **Spec:** kickoff/17-session-classification.md §13 T1–T8
- **Resume point:** T1 done (non-human Claude user lines filtered, reader version 4, test/fixtures/claude/transcript-user-lines.jsonl). T2 done: fixtures and findings in test/fixtures/laya/README.md; zero-shot quality is poor on obvious cases. Waiting for the user's decision on how to continue before T3.

### T-047 Record Claude Code fixtures for output replacement — blocked
- **Brief:** Capture real PostToolUse payloads for Bash, Grep, WebFetch and Read under `test/fixtures/claude/`, including a Bash command that exits with a non-zero code. Confirm the `updatedToolOutput` shapes rtk assumes (Bash `stdout`/`stderr`, Read `file.content` + `numLines`/`totalLines`, Grep `content` + `numLines`, WebFetch `result`) and whether a non-zero Bash exit fires PostToolUse or PostToolUseFailure. Check Copilot CLI `modifiedResult`. First step, with T-048. Acceptance: recorded fixtures per tool; a short report to the user if replacement does not work as assumed, before T-052 starts.
- **Priority:** P2
- **Model / effort:** middle tier (Sonnet) · effort: medium
- **Spec:** kickoff/16-compact-output.md §4 L2 and §8
- **Resume point:** Bash, Bash-failure, Grep, Read and WebFetch fixtures committed in test/fixtures/claude/ (WebFetch: 0edf9e0). Still needed: a Copilot CLI `modifiedResult` check (Copilot not installed here).

## Backlog

- T-059 Update tests stale after "settings default to team" — assertions still expect personal-by-default (ADR-0013 / T-027): user.* keys now in answers.yaml, Communication section committed, status line in project settings; fails in add, cli, init (4), personal-defaults (4), edit, interview-depth, user-store and the status-line/communication tests; check whether ADR-0013 needs superseding
  priority: P1
  acceptance: the listed tests pass and match the agreed team default
  model: middle tier (Sonnet) · effort: medium
- T-060 Fix "next steps" text mismatch — test/composition.test.js:108 and test/profiles.test.js (:401, :437, :452, :536) fail on the next-steps output; diff expected vs actual first, then fix test or text
  priority: P2
  acceptance: the five tests pass
  model: middle tier (Sonnet) · effort: low
- T-061 Investigate unrelated test failures — hooks.test.js:26 (fixture cwd holds real paths, see T-047), improve-store.test.js:27, env-secrets.test.js:62 (ENOENT, 61 s), data-sync.test.js:284 (ESRCH), plus "Learn is gone", "comfort hooks", "background host and client", "host provisioning", "opt-in: the default is no", "secrets: a secret-type key"
  priority: P2
  acceptance: each failure has a cause and a fix or a task
  model: middle tier (Sonnet) · effort: medium
- T-062 Fix sync-check (map-check) — docs/code-map.md sections area-examples, area-modules, area-profiles are stale (just map update), 15 placeholder area descriptions; ADR-0133, ADR-0063 and ADR-0097 reference missing files
  priority: P2
  acceptance: just sync-check exits 0
  model: low tier (Haiku) · effort: low
- T-063 Smoke tests fail in this environment (24) — JAVA_HOME points to a missing jdk-17 path (only JBR 21 installed), rustc -vV aborts with SIGABRT, Node/PHP/Cloudflare smoke tests need npm/composer/network (cause not checked)
  priority: P2
  acceptance: failures are fixed, or skipped with a clear reason when the toolchain is missing
  model: middle tier (Sonnet) · effort: medium
- T-064 Shorten just check (about 13 minutes) — the smoke tests dominate; decide whether to split them into a separate recipe
  priority: P2
  acceptance: default just check finishes in minutes; smoke tests run on request
  model: middle tier (Sonnet) · effort: medium

- T-065 Show "Module not enabled" for Tasks when the Task List module is off — with the Task List module not activated, TASKS.md is still parsed and reports a format error (TASKS.md:14: expected a task heading) instead of a "Module not enabled" state
  priority: P2
  acceptance: with the Task List module off, Tasks shows "Module not enabled" and TASKS.md is not parsed; regression test added
  model: middle tier (Sonnet) · effort: low
- T-066 Web Apply on an existing project shows kickoff next steps — after enabling modules and confirming Apply, the web UI returns to Settings but shows the Interview's finished step with first-setup next steps (concept, coding agent, apply log), though the project is already set up; Apply on an initialized project should show only what changed, no kickoff; switching Settings/Interview afterwards stays stuck on the finished step
  priority: P1
  acceptance: after Apply on an initialized project no first-setup next steps appear; switching Settings and Interview works normally; regression test added
  model: middle tier (Sonnet) · effort: medium
- T-067 Reload the project tab automatically after Apply — after Apply the banner "setup changed on disk, reload the project tab" appears and the user must reload by hand; the tab should refresh itself (keeping the current view) and show no banner for the user's own Apply
  priority: P2
  acceptance: after Apply the project tab shows the new state without a manual reload; a change made outside the web UI still shows the banner or reloads; test added
  model: middle tier (Sonnet) · effort: medium
- T-068 Merge the Compact settings into one Coding assistance section — "Which parts of compact output do you want?" sits in its own section "Compact" while the "Compact tool output active" container sits at the bottom under Coding assistance; both belong in Coding assistance, in one container
  priority: P2
  acceptance: one Coding assistance section holds the compact toggle and its output options; no separate Compact section; applies to Settings and Interview; test added
  model: middle tier (Sonnet) · effort: low
- T-069 Design a consistent settings UI system — checkboxes, switches, radios and selects all look different for the same job (enable, disable, choose, switch); card rows use 1, 2 or 3 columns at random and a lone card (for example Expert under Layperson/Intermediate) spans the full width; sections inside a tab have no visual distinction; define one control per interaction type, one card grid (columns, equal widths), one spacing scale (margin, padding, gaps) and a section container style, and show a wireframe first
  priority: P1
  acceptance: wireframe or clickable example with sample states reviewed and accepted by the user and linked from the UI/UX foundation; rules written down with observable criteria (equal card widths per row, same spacing, one control per type)
  model: top tier (Astra/Opus) · effort: high
- T-070 Apply the settings UI system to workspace Settings and Interview — replace the individual controls, card grids and section containers with the shared components from T-069; check every section (communication style, coding assistance, tools, workflow) at narrow and wide widths; after T-069
  priority: P1
  acceptance: all controls and card grids use the shared components; no full-width orphan cards; same spacing everywhere; a layout test per grid rule
  model: middle tier (Sonnet) · effort: high
- T-071 Make Global settings and presets use the workspace settings layout — Global settings first picks a setting or preset and then shows four tabs (About you, Communication, Tools, Workflow) in a different layout, size and placement than the workspace settings (one page with sections); both should look and behave the same, with the preset picker as the only addition; after T-069
  priority: P1
  acceptance: Global defaults and presets render the same sections, components and alignment as workspace Settings; the tab layout is gone or matches the workspace navigation; test added
  model: middle tier (Sonnet) · effort: high
- T-072 Personal/team switch in Global defaults and presets — when editing defaults or presets in Global settings, each setting needs the same personal or team choice as in the workspace settings (T-027); after T-071
  priority: P2
  acceptance: each switchable setting in Global defaults and presets shows the Personal/Team switch with the same warning as the workspace form; the choice is saved with the preset; test added
  model: middle tier (Sonnet) · effort: medium
- T-058 Personal presets repo (later) — decide whether presets and defaults live in a separate settings-only git repo; today `yaw sync` pushes them to a git target manually and presets and profile always live in HOME, so YAW_HOME does not move them (core/lib/user-store.js:17-23); open: live store or snapshot, shared vs project-specific presets, automatic pull on new projects
  priority: P3
  model: middle tier (Sonnet) · effort: medium

## Done → TASKS.archive.md

