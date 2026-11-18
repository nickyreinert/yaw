# Tasks

## How to work with this file

1. Work in priority order: P1 = safety/correctness first; P2 = reliability, performance and maintenance. Move selected work to Active as `in progress`, retaining a resume point.
2. Include a suggested model tier and reasoning effort. Add a regression check for the reported behavior. Move completed and validated tasks to TASKS.archive.md.
3. Archive superseded tasks with the reason and the ID of the task carrying any remaining work.

## Active
### T-073 Session classification v2: per-exchange labels — in progress (80 %)
- **Brief:** Implement kickoff/17-session-classification.md (ADR-0136): per-exchange assistant and user labels saved locally without text, so Profiling can filter a conversation's turns by admitted error, frustration and the other labels.
- **Priority:** P2
- **Model / effort:** middle tier (Sonnet) · effort: high
- **Spec:** kickoff/17-session-classification.md §13 T1–T8
- **Resume point:** T7: optional exchange labelling, temperature calibration and agreement reporting. Then finish the T8 decision record and rerun just check.
- **Journal:**
  - 2026-11-11 User chose rules first (ADR-0136 supersedes ADR-0135); spec revised 2026-11-11: section 6.1 rules, source per value, JSON-object states, reaction first, calibration optional
  - 2026-11-11 T3 done (uncommitted): reader keeps tool calls/errors/denials/interrupts per message (claudeEvents); core/lib/session-classification.js (exchanges, taxonomy, JSON states, scale/choice/tag parsing, section 6.1 rules, source precedence, classifyExchanges); postLaya/validChoice shared with v1; test/session-classification.test.js + test/fixtures/claude/transcript-events.jsonl; just check 53 failures, all pre-existing (smoke, T-027, T-061, dogfood manifest)
  - 2026-11-11 T4 done (uncommitted): rollup + taxonomyHash + schema 2 result in classifyExchanges; collectAnalysis uses it; session-rows sends session/counts only (no exchanges), legacy flag for schema 1; data-sync whitelist already excludes evaluation; tests updated (test/helpers/laya-v2.js); just check 53 failures, same as before
  - 2026-11-11 T5 done (uncommitted): taxonomyOverrides/effectiveTaxonomy (only changes stored in classifier.taxonomy, limits 1-1000/1-2000/0.5-0.99), per-category thresholds (empty = shared), taxonomyHash covers shared prompt + category texts (not thresholds), Settings Categories card (per category: instruction, label/level texts, threshold, Reset, uncalibrated; signals and rules read-only), preview on classifyExchanges per exchange with source; Insights 'older criteria' mark left for T6; just check 53 failures, same as before
  - 2026-11-18 T6 implemented and reviewed. Profiling uses v2 roll-ups, marks legacy and older-criteria results, supports confirmed row reclassification, and filters local conversations by fingerprint-matched exchange labels. Focused checks: 90 passed.
  - 2026-11-18 Headless Chrome verified both criteria badges, the row action, exchange filtering and focus restoration. just check reported 53 failures outside the focused suite. The separate sync check still reports stale code-map entries.

### T-047 Verify Copilot CLI output replacement — blocked
- **Brief:** Capture a real Copilot CLI hook payload and verify whether `modifiedResult` replaces tool output. Record the payload and observed behavior.
- **Priority:** P2
- **Model / effort:** middle tier (Sonnet) · effort: medium
- **Spec:** kickoff/16-compact-output.md §4 L2 and §8
- **Resume point:** Run the replacement check when Copilot CLI is available.
- **Journal:**
  - 2026-11-18 Claude Code coverage is already recorded in test/fixtures/claude/ for Bash, Bash failure (PostToolUseFailure), Grep, Read and WebFetch (0edf9e0).

### T-075 Make Git repository purpose optional and clarify setup loading — in progress (95 %)
- **Brief:** Existing Git projects can apply with blank purpose and keep their README. Browser setup shows its current preparation stage without menus until ready, and can recover from a startup error.
- **Priority:** P2
- **Model / effort:** sonnet · effort: medium
- **Spec:** kickoff/02-setup-flow.md
- **Resume point:** Rerun just check after the existing suite failures are resolved, then close T-075.
- **Journal:**
  - 2026-11-18 Implemented Git-optional purpose, isolated browser startup, and restored the missing browser module. Targeted tests and headless Chrome checks pass.
  - 2026-11-18 Implementation and scoped review complete. Headless Chrome verified delayed startup, retry and blank-purpose Apply with the README preserved. just check reports 54 failures, including six surrounding tests reproduced on HEAD.

## Backlog
- T-059 Update tests stale after "settings default to team" — assertions still expect personal-by-default (ADR-0013 / T-027): user.* keys now in answers.yaml, Communication section committed, status line in project settings; fails in add, cli, init (4), personal-defaults (4), edit, interview-depth, user-store and the status-line/communication tests; check whether ADR-0013 needs superseding
  priority: P1
  model: middle tier (Sonnet) · effort: medium
  acceptance: the listed tests pass and match the agreed team default
- T-061 Investigate unrelated test failures — latest check still fails hook fixture normalization (see T-047), the AGENTS.md instruction budget, CLI secret entry, dogfood manifest and wrapper checks, "Learn is gone", comfort hooks, host provisioning, and setup opt-in and secret validation
  priority: P2
  model: middle tier (Sonnet) · effort: medium
  acceptance: each failure has a cause and a fix or a task
- T-062 Fix sync-check (map-check) — the latest run reports stale Claude, GitHub, examples, modules and profiles sections and uncovered .agents/ files. It also warns about 15 placeholder area descriptions and missing references in ADR-0133, ADR-0063 and ADR-0097
  priority: P2
  model: low tier (Haiku) · effort: low
  acceptance: just sync-check exits 0
- T-063 Fix toolchain and setup failures in profile smoke tests — the latest check reports an invalid JAVA_HOME, Rust failures, npm install errors reading edgesOut in composed, Node and Cloudflare setup, and a failing PHP Bref smoke test
  priority: P2
  model: middle tier (Sonnet) · effort: medium
  acceptance: fix failures or skip with a clear reason when a toolchain is missing. After setup succeeds, rerun the verification and next-steps assertions in test/composition.test.js and test/profiles.test.js (from T-060).
- T-064 Shorten just check (about 13 minutes) — the smoke tests dominate; decide whether to split them into a separate recipe
  priority: P2
  model: middle tier (Sonnet) · effort: medium
  acceptance: default just check finishes in minutes; smoke tests run on request
- T-065 Show "Module not enabled" for Tasks when the Task List module is off — with the Task List module not activated, TASKS.md is still parsed and reports a format error (TASKS.md:14: expected a task heading) instead of a "Module not enabled" state
  priority: P2
  model: middle tier (Sonnet) · effort: low
  acceptance: with the Task List module off, Tasks shows "Module not enabled" and TASKS.md is not parsed; regression test added
- T-066 Web Apply on an existing project shows kickoff next steps — after enabling modules and confirming Apply, the web UI returns to Settings but shows the Interview's finished step with first-setup next steps (concept, coding agent, apply log), though the project is already set up; Apply on an initialized project should show only what changed, no kickoff; switching Settings/Interview afterwards stays stuck on the finished step
  priority: P1
  model: middle tier (Sonnet) · effort: medium
  acceptance: after Apply on an initialized project no first-setup next steps appear; switching Settings and Interview works normally; regression test added
- T-067 Reload the project tab automatically after Apply — after Apply the banner "setup changed on disk, reload the project tab" appears and the user must reload by hand; the tab should refresh itself (keeping the current view) and show no banner for the user's own Apply
  priority: P2
  model: middle tier (Sonnet) · effort: medium
  acceptance: after Apply the project tab shows the new state without a manual reload; a change made outside the web UI still shows the banner or reloads; test added
- T-068 Merge the Compact settings into one Coding assistance section — "Which parts of compact output do you want?" sits in its own section "Compact" while the "Compact tool output active" container sits at the bottom under Coding assistance; both belong in Coding assistance, in one container
  priority: P2
  model: middle tier (Sonnet) · effort: low
  acceptance: one Coding Assistance card titled "Compact Output" contains the activation control and independent output options in Settings and Interview. Its subtitle describes shortening common tool output. Explain the two options in plain language and give technical detail in the right-hand help. Rename the unrelated Collaboration display toggle to "Details". Use the shared multi-select control from T-069 and add a regression test.
- T-069 Design a consistent settings UI system — checkboxes, switches, radios and selects all look different for the same job (enable, disable, choose, switch); card rows use 1, 2 or 3 columns at random and a lone card (for example Expert under Layperson/Intermediate) spans the full width; sections inside a tab have no visual distinction; define one control per interaction type, one card grid (columns, equal widths), one spacing scale (margin, padding, gaps) and a section container style, and show a wireframe first
  priority: P1
  model: top tier (Astra/Opus) · effort: high
  acceptance: obtain user acceptance of a wireframe or clickable example and link it from the UI/UX foundation. Define equal card widths, shared spacing, and visibly distinct controls for single-select, independent multi-select, and on/off. Align title, Personal/Team switch, and choices across cards even when a title wraps.
- T-070 Apply the settings UI system to workspace Settings and Interview — replace the individual controls, card grids and section containers with the shared components from T-069; check every section (communication style, coding assistance, tools, workflow) at narrow and wide widths; after T-069
  priority: P1
  model: middle tier (Sonnet) · effort: high
  acceptance: rename the browser interview step to "About Your Agent". Put Personal/Team directly under each applicable setting title, including Experience, and keep the choices aligned across cards with wrapped titles. Visually group GitHub and Tasks under Collaboration, and Coding Style, Advanced Coding Rules and Coding Assistance together, followed by a separate Review Subagents group. Remove the redundant Git/GitHub icon. Put the Unit Tests switch below its title and align its icon size and Core label with the other cards. Add layout checks for shared components, equal-width grids and spacing at narrow and wide sizes.
- T-071 Make Global settings and presets use the workspace settings layout — Global settings first picks a setting or preset and then shows four tabs (About you, Communication, Tools, Workflow) in a different layout, size and placement than the workspace settings (one page with sections); both should look and behave the same, with the preset picker as the only addition; after T-069
  priority: P1
  model: middle tier (Sonnet) · effort: high
  acceptance: Global defaults and presets render the same sections, components and alignment as workspace Settings; the tab layout is gone or matches the workspace navigation; test added
- T-072 Personal/team switch in Global defaults and presets — when editing defaults or presets in Global settings, each setting needs the same personal or team choice as in the workspace settings (T-027); after T-071
  priority: P2
  model: middle tier (Sonnet) · effort: medium
  acceptance: each switchable setting in Global defaults and presets shows the Personal/Team switch with the same warning as the workspace form; the choice is saved with the preset; test added
- T-058 Personal presets repo (later) — decide whether presets and defaults live in a separate settings-only git repo; today `yaw sync` pushes them to a git target manually and presets and profile always live in HOME, so YAW_HOME does not move them (core/lib/user-store.js:17-23); open: live store or snapshot, shared vs project-specific presets, automatic pull on new projects
  priority: P3
  model: middle tier (Sonnet) · effort: medium
- T-074 Custom additions to AGENTS.md
  priority: P2
- T-076 Migrate legacy setup presets and cover upgrades
  priority: P1
  model: sonnet · effort: high
  spec: kickoff/02-setup-flow.md
  acceptance: Reproduce Invalid answer for arch.language and Unknown answer key with legacy fixtures. Map known legacy values and renamed keys, preserve valid choices, and explain unsupported fields without discarding the preset. Test preview and load before and after yaw update, including repeat upgrades. Preserve validation for new data.
- T-077 Keep browser interview depth independent of presets
  priority: P2
  model: sonnet · effort: medium
  spec: kickoff/02-setup-flow.md
  acceptance: Select All, switch between saved presets and New setup, and continue through the interview without changing depth. Only the depth control changes it. Repeat with Quick and Basic and add a regression test. Update the browser prefill contract in ADR-0043 when implemented.
- T-078 Review and retire the generic approval frequency question
  priority: P2
  model: sonnet · effort: medium
  spec: kickoff/02-setup-flow.md
  acceptance: Verify what user.autonomy actually configures for each adapter. Plan removal of the generic onboarding question under ADR-0079, with native permission settings for tool approvals and project instructions for concrete confirmation boundaries. Keep old answers and presets readable, and verify that existing permissions and safeguards are preserved.
- T-079 Make purpose an opt-in detail on the existing Git project step
  priority: P2
  model: sonnet · effort: medium
  spec: kickoff/02-setup-flow.md
  acceptance: Follow T-075 and ADR-0137. Show Team as the main question and explain that YAW detected an existing Git project. Offer an explicit way to add or view a purpose. A blank purpose lets the user continue and preserves the README. Fresh projects still require a purpose.
- T-080 Suggest the existing project language in Architecture
  priority: P2
  model: sonnet · effort: medium
  spec: kickoff/02-setup-flow.md
  acceptance: Reuse the bounded filename and manifest-name evidence from ADR-0066. A Python repo surfaces an editable Python suggestion with its source. Mixed, unsupported or uncertain evidence leaves the choice open. Saved and explicit answers win. Test that detection leaves Destination undecided and avoids reading source or secret contents.
- T-081 Clarify where Coolify fits in Destination
  priority: P3
  model: haiku · effort: low
  spec: kickoff/02-setup-flow.md
  acceptance: Identify Coolify under Server in the Architecture help. Explain that it deploys containers to connected servers. Keep Support Docker in Architecture. Verify that Python with Server still maps to the existing Python profile.
- T-082 Default GitHub integration on for a detected GitHub remote
  priority: P2
  model: sonnet · effort: medium
  spec: kickoff/02-setup-flow.md
  acceptance: Suggest Yes for first-time setup when the workspace has a GitHub remote. Explicit saved and user choices win. Preserve ADR-0047 for local Git and non-GitHub remotes. Add tests for HTTPS and SSH remotes and Git worktrees. Detect remotes locally without GitHub authentication.
- T-083 Decouple GitHub checks, project management, and task storage
  priority: P1
  model: sonnet · effort: high
  spec: kickoff/02-setup-flow.md
  acceptance: GitHub CI and project management can be enabled or disabled independently. CI works without issue forms, and either GitHub feature can coexist with local-only TASKS.md. GitHub-only and mirrored task storage remain available with GitHub integration. Require an issue-backed workflow only when choosing No change without an issue. Test the combinations and preservation of saved selections.
- T-084 Derive review and comfort activation from selected options
  priority: P2
  model: sonnet · effort: high
  spec: kickoff/02-setup-flow.md
  acceptance: Enable review when any reviewer is configured and Comfort when any feature is selected. Remove their redundant master switches. Warn and Block remain editable up front, and the push gate takes effect only when a reviewer is required on push. Test first selection, last deselection and saved settings.
- T-085 Make preset saving an opt-in on Review and Apply
  priority: P2
  model: sonnet · effort: medium
  spec: kickoff/02-setup-flow.md
  acceptance: Show an unchecked Save as preset checkbox and Apply as the main action. Replace the standalone Save draft and Save preset buttons on this step. Save a preset only by explicit opt-in on a successful Apply and report any save error separately. Existing drafts and presets remain loadable. Cover cancel, failed Apply and both checkbox states.

## Done → TASKS.archive.md
