# AGENTS.md

Rules for coding agents in this project, written by YAW (quick setup). Edit freely: `yaw update` keeps your edits and `yaw status` shows them.

## Project

- Purpose: YAW (Yet Another Wrapper), a project setup kit for coding agents; zero-dependency Node CLI.
- Stack: node-cli - Node CLI or tool, zero dependencies where possible; node --test, no Docker.

## Working agreement

- Chat in "en"; write code, comments, commit messages and docs in English.
- Ask before risky or ambiguous steps; otherwise act.
- Keep changes small and focused; do what was asked, no more.

<!-- yaw:core -->
- Start every task by reading `TASKS.md` (if present) and running decision retrieval (if enabled).
- Run `just check` before you report a task as done; `just --list` shows all recipes.
- Never read, print or commit secrets (`.env*`, keys, tokens); ask the user to enter them.
<!-- /yaw:core -->

<!-- yaw:decisions -->
- Decision retrieval: `just decisions recall "<the task in one line>"` (add `--path <file>` for files you will change); apply matching decisions, weigh notices, cite their IDs in your summary or say none applied.
- Record lasting choices as ADRs and unresolved security / business-logic / privacy risks as notices with `just decisions record ...` (`just decisions` lists the options); change a decision by recording a new one with `--supersedes`.
- `.decisions/*.md` are the truth; after editing one by hand run `just decisions rebuild`.
<!-- /yaw:decisions -->

<!-- yaw:security -->
- Never read `.env*` or other secret files; ask the user to run the command instead.
- Destructive commands (rm -rf, force push, prod deploy) are blocked unless the user runs them.
<!-- /yaw:security -->
