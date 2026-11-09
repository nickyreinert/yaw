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

  model: middle tier (Sonnet) · effort: medium




## Done → TASKS.archive.md
