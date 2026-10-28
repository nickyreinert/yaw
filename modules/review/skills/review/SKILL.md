---
name: review
description: Review a change from a non-technical angle (quality, business logic, UI/UX, feature fit). Read and report only; never edit. Use when the user asks for a review, before a push, or when a task is done and the project suggests a review.
---

# Review

1. Pick the reviewer: `quality`, `logic`, `ux` or `feature` (the user names it, or use the ones the project suggests).
2. Get the change: `git diff HEAD` for uncommitted work; for commits, `git diff <base>..HEAD`.
3. Get the instructions: `just review-prompt <kind>` prints the reviewer's prompt and `just review-prompt rules`
   the reporting rules (the project may have adjusted both). Follow them. Read files when you need context, but
   never edit, stage, commit or push.
4. Read `yaw kickoff context`: apply the kit practices within the project's reviewed foundations, relevant ADRs and selected knowledge. Read complete linked sources where needed. Report conflicts and missing evidence; never silently change project rules to match the code. Report as the rules say.
5. End with exactly one line: `VERDICT: PASS` (nothing that should block a push) or `VERDICT: FINDINGS`.

`just review <kind>` runs the same reviewer headless through your agent CLI and prints the report.
