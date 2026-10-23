# Changelog

All notable changes to YAW are documented here. This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses semantic versioning.

## [Unreleased]

### Fixed

- GitHub is optional for team and external-reviewer setups, including projects with a local bare Git remote. CLI and browser selection stay identical.
- Shared team instructions omit personal language, autonomy and output-style preferences; adding team enforcement to a solo Full setup stays within the 80-line budget.
- Module add/remove keeps saved proposal modules synchronized, preserves unrelated YAML comments when only the module list changes, and rejects invalid module answer values before writes.
- Interview summaries omit questions hidden by their conditions.
- Code-map cache reads and session ledger reads use no-follow file descriptors; session IDs and resume paths reject or sanitize terminal controls, and relative registry homes are refused before permission changes.
- Critical decision references quote titles as data and exclude retired statuses case-insensitively.
- GitHub task journals accept only repository-owner comments; generated task views use a root-anchored ignore and retain it when released on removal.
- GitHub permission prompts cover raw API variants, issue creation and Project additions; ruleset application requires remote checks to have reported, and private-kit CI failures give an actionable diagnostic.

### Changed

- Prepared the macOS/Node 22.13 and 24 hosted test matrix for the deferred November run. No hosted CI has been executed for these changes.

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
