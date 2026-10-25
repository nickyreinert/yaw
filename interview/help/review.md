# Review agents

Reviewers read a change and report; they never edit. Triggers:

- **Off:** not installed.
- **On request:** `just review <kind>` or the `review` skill.
- **Suggest when a task is done:** a one-line hint at the end of a session with unpushed work.
- **Required before push:** `git push` runs the reviewer headless (`claude -p`, `codex exec`, `copilot -p`) on the pushed commits. Needs git.

Push gate:

- **Warn:** you see the findings and confirm in the terminal; an agent push has no terminal, so it stops and names the override (`YAW_REVIEW=skip git push`).
- **Block:** the push stops until the findings are fixed.
- Passed commits are not reviewed again; `git push --no-verify` skips every git hook.

Example: quality and business logic before push, feature fit on request.
