# Changelog

All notable changes to YAW are documented here. This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses semantic versioning.

## [Unreleased]

### Added
- `yaw init` offers `p) Load a previous setup` in its first menu. Choose a saved preset to review its mode and answers as defaults, edit them for the new project, or continue in the browser without losing unreviewed defaults. Loading does not copy project files or secrets, modify the source, or bypass confirmation.
- Bare `yaw` and general help group commands by project setup, daily work, monitoring, YAW maintenance and agent integrations. Unimplemented `apply`, `config` and `session` commands are explicitly labelled placeholders; their help explains what is missing instead of promising past phase steps.
- `yaw web --background` keeps a loopback-only server running after the CLI returns, with no idle shutdown. Run `yaw web` in the same folder to reopen it with a fresh login link, and `yaw web --stop` to stop it. Background setup switches to the dashboard after Apply.
- `yaw sessions import [--dry-run] [--agent claude|codex|copilot]` (#174): loads the past sessions of the current folder from the agents' own local history (Claude Code, Codex, Copilot CLI) into `~/.yaw/yaw.db`, also in a project without YAW. Metadata only (times, branch, model, input/output tokens, the cost Claude Code reports); prompts, titles and file content are never stored. Importing again updates in place. Registry migration 2 adds the usage columns; the dashboard shows tokens, cost and the model per session.
- Kickoff guidance (#173): `yaw init` (terminal interview) asks at the end whether you want guidance to kick off; `yaw kickoff` prints the steps and a planning prompt built from your idea, stack and task store (phases with model tier and reasoning effort). Save the answer as `docs/plan/kickoff.md`; `yaw kickoff import <plan.md> [--dry-run]` turns it into tasks or GitHub issues with model and effort through `yaw task new`, skipping titles that already exist and items checked as done.
- `TASKS.md` explains itself (#175): a "How to work with this file" section with the working rules (track in progress, finish into the Done history, model tier and effort per task, specs vs plans), local and GitHub wording. Backlog items carry `  model: <tier> · effort: <level>`; `just task new --model --effort` writes it, `start` carries it into "Model / effort". On GitHub: `model:`/`effort:` labels or a body line.
- Terminal interview: colour (bold titles, cyan keys, dimmed hints, the default in green) and up/down arrow keys to move through choices, without dependencies; `NO_COLOR`, `TERM=dumb` and pipes stay plain (#163).
- `yaw init`: every interview question, including setup depth and profile selection, shows `w) Continue in the browser`, selectable with `w` or the arrow keys; `web` remains an alias. Continue in the browser form with your answers so far (#162).
- Local web servers use distinct cookie names, so opening a second YAW page no longer logs the first one out. Active use renews the cookie; authenticated browsers may revisit their consumed launch link, while unauthenticated replays remain blocked. Authentication errors explain how to get a new link.
- `yaw init` puts your idea into `README.md` (#171): a new README if there is none, otherwise one marked "Idea" section appended without touching your text. The confirmation lists it.

- The language question offers Kotlin, Swift, Go, Rust and Java; "where should it run" offers `static` (GitHub Pages, Netlify) and every option of both questions has a one-line description. `static` suggests the static-site profile, Kotlin for an app store suggests android-kotlin, and the help explains what happens when no profile fits (#164, #165).
- `yaw web`: a read-only local dashboard with project setup, tasks, decisions and session statistics for this project and all projects; without a YAW setup it opens the setup form (#172).
- `yaw init` (terminal and web) ends with next steps: how to start the selected agent, Codex hook trust, where tasks, sessions and decisions live, the dashboard and the tools the setup needs (#167).
- GitHub issue forms for feature, bug, chore, spike and epic, plus issue-create, issue-triage and epic-plan skills for the selected agents.
- Optional, guarded Project Status updates on GitHub task start/done and explicit epic-to-milestone mappings synchronized by task sync. Existing local-only workflows stay offline.
- Profile-aware Dependabot ecosystems, including namespaced composed profiles; dependency-free profiles retain only action updates.

### Fixed

- "Use GitHub for the repo?" shows a GitHub check in the terminal and the form (gh not installed, not logged in or unreachable, no GitHub remote). After "no", the task-mode question no longer offers GitHub choices that would be ignored; init says tasks are local because GitHub is off (#166).
- `yaw init` and `yaw web` refuse the home folder and the file-system root unless `--force` is given, and ask before writing into a non-empty folder that is not a Git repository or YAW project, such as a folder of projects (#168).
- Codex hook entries have readable labels (`YAW security: guard-secret-read, guard-destructive`) and init reminds the user to trust them with `/hooks` (#176).
- `CLAUDE.md` is only written when Claude Code is a selected agent; Codex and Copilot read `AGENTS.md` (#169).
- The generated `.gitignore` ignores machine-local YAW files: the web-form draft `.yaw/draft.yaml`, and `.claude/settings.local.json` when Claude is selected (#170).
- The local form session cookie has an explicit `Max-Age` no longer than the server's idle timeout.
- User profile, preset and history access refuses symlinked files and directories; file modes are set through validated descriptors.
- GitHub is optional for team and external-reviewer setups, including projects with a local bare Git remote. CLI and browser selection stay identical.
- Shared team instructions omit personal language, autonomy and output-style preferences; adding team enforcement to a solo Full setup stays within the 80-line budget.
- Module add/remove keeps saved proposal modules synchronized, preserves unrelated YAML comments when only the module list changes, and rejects invalid module answer values before writes.
- Interview summaries omit questions hidden by their conditions.
- Code-map cache reads and session ledger reads use no-follow file descriptors; session IDs and resume paths reject or sanitize terminal controls, and relative registry homes are refused before permission changes.
- Session ledger reads also verify file identity after opening, directory permission changes use validated descriptors, and registry initialization rejects unsafe homes, writable ancestry and linked SQLite sidecars. SQLite's pathname-open race remains an explicit limitation (#123); these checks are not same-user process isolation.
- Critical decision references quote titles as data and exclude retired statuses case-insensitively.
- Critical decision titles remove invisible format/bidirectional controls. The session directory permission helper also rejects relative paths directly.
- Guarded terminal confirmations close their readline interface after answering, so completed commands do not hang; a real local PTY test documents the known non-human-authentication boundary.
- GitHub task journals accept only repository-owner comments; generated task views use a root-anchored ignore and retain it when released on removal.
- GitHub permission prompts cover raw API variants, issue creation and Project additions; ruleset application requires remote checks to have reported, and private-kit CI failures give an actionable diagnostic.

### Changed

- Prepared the macOS/Node 22.13 and 24 hosted test matrix for the deferred November run. No hosted CI has been executed for these changes.
- Pinned the remaining kit workflow actions to the full SHAs already used in its profile matrix.

## [0.1.0] - 2026-10-23

### Added

- Interactive Node.js CLI setup with Quick and Full choices, profile selection, module composition and generated project instructions.
- Local browser-based setup form with live preview, drafts, optional presets, diff review and an explicit Apply confirmation.
- Agent adapters and project configuration for Claude Code, Codex and GitHub Copilot.
- Project commands for module add/remove, update reconciliation, status, diagnostics, tasks and local decision records.
- Optional modules for development environment setup, coding standards, security guards, sessions, team workflows, GitHub, CI, code maps, comfort and decision recall.
- A local installer that checks prerequisites, installs a selected kit tag and links the CLI without using `sudo` or installing tools.

### Security

- Hidden terminal input and masked browser fields for local secrets. Newly entered values are written only to a new mode-0600 `.env`, never to saved setup data or logs.
- Automatic project verification is skipped after new secrets are saved, so project-controlled recipes do not run with those new values available.
- Local form requests use a one-time token, a session cookie, CSRF protection and Host/Origin checks.
