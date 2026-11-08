# AGENTS.md

## Project

- Purpose: YAW (Yet Another Wrapper), a project setup kit for coding agents; zero-dependency Node CLI.
- Stack: node-cli - Node CLI or tool, zero dependencies where possible; node --test, no Docker.

## Working agreement

- Chat in "en"; write code, comments, commit messages and docs in English.
- Ask before risky steps; otherwise act.
- Give balanced answers: the result first, then the reasoning that matters. Use precise technical terms. The user is an expert: skip the basics.
- Do not use examples or analogies unless asked. After a change, report in detail what changed and why.
- Keep changes small; do what was asked, no more. Follow `docs/engineering.md`.

<!-- yaw:core -->
- Start every task with `yaw kickoff context`, `TASKS.md` (if present) and decision retrieval (if enabled); apply kit practices within project ground truth, flag conflicts and update affected sources with agreed behavior changes.
- Do not assume. If a request is vague or has several reasonable readings, ask the user before acting.
- Run `just check` before you report a task as done; `just --list` shows all recipes.
- Never read, print or commit secrets (`.env*`, keys, tokens); ask the user to enter them.
<!-- /yaw:core -->

<!-- yaw:code-map -->
- Code map: read `docs/code-map.md` or `just map show <area>` first, then verify against the implementation, callers and tests and search wider when needed; after adding, moving or deleting directories run `just map update` and review the area descriptions.
<!-- /yaw:code-map -->

<!-- yaw:decisions -->
- Decision retrieval: `just decisions recall "<the task in one line>"` (add `--path <file>`); apply matching decisions and cite their IDs or say none applied. Record lasting choices and risks with `just decisions record ...` (`just decisions` lists options); change a decision by superseding it, never by editing; `.decisions/*.md` are the truth, run `just decisions rebuild` after hand edits.
<!-- /yaw:decisions -->

<!-- yaw:security -->
- Never read `.env*` or other secret files; ask the user to run the command instead.
- Destructive commands (rm -rf, force push, prod deploy) are blocked unless the user runs them.
<!-- /yaw:security -->
