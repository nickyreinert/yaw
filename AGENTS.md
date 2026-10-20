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
