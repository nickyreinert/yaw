# Review agents

Reviewers read a change and report; they never edit. Each one has its own trigger:

- **Off:** not installed.
- **On request:** you (or the agent) run `just review <kind>` or the `review` skill.
- **Suggest when a task is done:** at the end of a session with unpushed work you get a one-line hint.
- **Required before push:** `git push` first runs the reviewer headless through your agent CLI
  (`claude -p`, `codex exec` or `copilot -p`) on the commits being pushed. Needs a git repository.

The push gate decides what findings do. **Warn:** you see them and confirm in the terminal to push anyway; when
an agent pushes there is no terminal, so the push stops and the message names the override
(`YAW_REVIEW=skip git push`). **Block:** the push stops until the findings are fixed. Commits that passed are not
reviewed again; `git push --no-verify` skips every git hook.

Example: quality and business logic required before push, feature fit on request.
