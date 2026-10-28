# AGENTS.md

Rules for coding agents in this project, written by YAW (quick setup). Edit freely: `yaw update` keeps your edits and `yaw status` shows them.

## Project

- Purpose: YAW (Yet Another Wrapper), a project setup kit for coding agents; zero-dependency Node CLI.
- Stack: node-cli - Node CLI or tool, zero dependencies where possible; node --test, no Docker.

## Working agreement

- Chat in "en"; write code, comments, commit messages and docs in English.
- Ask before risky or ambiguous steps; otherwise act.
- Keep changes small and focused; do what was asked, no more.
- Keep product UI copy terse: concise labels, controls and factual status. No explanatory, promotional or narrative paragraphs on screens.

<!-- yaw:core -->
- Start every task by reading `TASKS.md` (if present) and running decision retrieval (if enabled).
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
