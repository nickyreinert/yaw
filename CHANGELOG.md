# Changelog

All notable changes to YAW are documented here. This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses semantic versioning.

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
