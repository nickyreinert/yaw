# Tasks

## How to work with this file

1. Work in priority order: P1 = safety/correctness first; P2 = reliability, performance and maintenance. Move selected work to Active as `in progress`, retaining a resume point.
2. Each item includes a suggested model tier and reasoning effort. Add a regression check for the reported behavior; archive completed, validated work in TASKS.archive.md.

Audit: 2026-11-02, Node 22.21.1. Findings below come from source review, isolated reproductions and repository checks. Model names are tier examples; effort reflects task complexity.

Checks: npm test = 1,120 passed / 16 failed / 8 skipped (9 failures: invalid JAVA_HOME; 7: repository/test issues). Schema examples: 28/28 valid. Shellcheck passed. Optional Claude adapter npm audit: 0 reported vulnerabilities. Live provider/Telegram services and Linux isolation were not exercised.

## Active




- T-047 [P2] Record Claude Code fixtures for output replacement — capture real PostToolUse payloads for Bash, Grep, WebFetch and Read under `test/fixtures/claude/`, including a Bash command that exits with a non-zero code. Confirm the `updatedToolOutput` shapes rtk assumes (Bash `stdout`/`stderr`, Read `file.content` + `numLines`/`totalLines`, Grep `content` + `numLines`, WebFetch `result`) and whether a non-zero Bash exit fires PostToolUse or PostToolUseFailure. Check Copilot CLI `modifiedResult`. First step, with T-048.
  spec: kickoff/16-compact-output.md §4 L2 and §8
  acceptance: recorded fixtures per tool; a short report to the user if replacement does not work as assumed, before T-052 starts
  model: middle tier (Sonnet) · effort: medium
  status: blocked · resume: Bash, Bash-failure (exit 3), Grep, Read fixtures committed in test/fixtures/claude/ (see README-posttooluse.md); still needed: a SUCCESSFUL WebFetch PostToolUse capture (needs network egress to a fetchable host) and a Copilot CLI `modifiedResult` check.

## Backlog

- T-021 [P2] Add a cheap automatic CI gate — `.github/workflows/kit-ci.yml` runs only manually. Run schema checks, shell checks and isolated core tests on PRs; keep expensive profile builds separate to respect the documented minutes budget.
  model: middle tier (Sonnet) · effort: medium

  model: middle tier (Sonnet) · effort: medium


- T-045 [P2] Investigate Safe Verdicts before changing it — explain what it stores, how verdicts arise, what "No Important Verdict", "Set Retention" and "Import a Verdict" do, why it is separate from Analytics and Sync, and its user benefit. Report to the user first; then decide keep/rename/move/remove. Do not alter or delete data or the UI before that decision.
  model: middle tier (Sonnet) · effort: medium

- T-057 [P2] Decide on L3 command rewrite — after T-056, report to the user whether rewriting commands (`cargo test` → `yaw run -- cargo test`) is worth it. Claude Code checks permission rules against the rewritten command, so deny rules can be bypassed. If built: only a short allowlist of read-only commands, never auto-allow, and deny and ask rules read from every settings file. Also settle the All default left open in T-049. Do not implement before the user decides.
  spec: kickoff/16-compact-output.md §4 L3 and §7
  model: top tier (Astra/Opus) · effort: high

## Done → TASKS.archive.md
