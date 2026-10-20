# ADR-0012: Skill distribution to Claude (generated copies) and the drift check

- Status: Accepted
- Date: 2026-10-20
- Issue: #40 (Y-4.1); implemented in #45 (Y-4.6)
- Resolves: H5 (`docs/build/plan.md` §1.4)

## Context

Doc 09 §2: skills (`SKILL.md`) are authored once and read from `.agents/skills/` by Codex, Copilot, Gemini CLI, Antigravity and Pi. Claude Code reads only `.claude/skills/`, so the adapter generates or symlinks it. Doc 09 §3: adapter files are generated, never hand-copied, and `yaw sync --check` in `just check` fails when a rendered adapter differs from its source. Copilot reads `.agents/skills/` **and** `.claude/skills/`.

## Options

| Option | For | Against |
|---|---|---|
| A. Symlink `.claude/skills/<n>` → `../../.agents/skills/<n>` | one copy on disk, no drift possible | git on Windows/WSL-less checkouts and zip downloads lose symlinks; the render engine refuses symlinks out of a path (ADR-0003 path guard) and hashes files, not links; some tools do not follow links |
| B. Generated copies, recorded in the manifest, checked for drift | plain files everywhere; same update/remove flow as every other file (ADR-0003/0004); hashable | two copies; a hand edit of one copy drifts |
| C. Claude plugin only | no project copy | project-specific skills belong in the project (doc 09 §4) |

## Decision

**Option B.**

- A module ships a skill as `modules/<m>/skills/<name>/` (`SKILL.md` plus any files) and lists it in `outputs.skills`.
- The render writes it byte for byte to `.agents/skills/<name>/…` (always: it is the neutral location) and, when `claude` is a selected agent, to `.claude/skills/<name>/…`. Both are owned by the module, `managed: true`, hashed in the manifest, and go away with `yaw remove <m>`. Skills are copied, not templated.
- Adapter files are: `.agents/skills/**`, `.claude/skills/**`, `.claude/settings.json`, `.codex/hooks.json` and the hook shim `.yaw/bin/yaw-hook`.
- **`yaw sync --check`** re-renders the project from the installed kit and the answers (no write) and compares every adapter file: missing, different content, or present but no longer rendered is **drift**; it prints one line per file with its fix and exits 1. The fix depends on the cause: the kit renders something new → `yaw update`; a hand edit (the manifest hash equals the render, so ADR-0003 would keep the edit) → `git checkout -- <path>`, or delete the file and `yaw update --restore <path>`; a missing file → `yaw update --restore <path>`. No drift: exit 0. Outside a project: exit 1.
- Phase 1 has only `yaw sync --check`. `yaw sync` without `--check` says to use `yaw update`, which already re-renders every adapter file through the keep / take / merge flow; a second writer would be a second update mechanism.
- **Wiring into `just check`:** `core`'s `justfile` frame defines `sync-check`; each profile's `check` is `lint typecheck test audit sync-check` (extends ADR-0020). `sync-check` runs `yaw` from `PATH`, else `${YAW_KIT:-$HOME/.yaw/kit}/bin/yaw`; when neither exists it prints a note and passes, like the `shellcheck` note, so collaborators without the kit are not blocked. CI installs the kit (BD10), so CI always checks.
- A hand edit of an adapter file fails `just check` on purpose. Personal Claude settings belong in `.claude/settings.local.json`, which YAW never writes.
- User-authored skills in `.agents/skills/` that no module renders are not mirrored to `.claude/skills/` in phase 1 and are not checked.

## Consequences

- Copilot sees the same skill twice (`.agents/skills/` and `.claude/skills/`) when Claude and Copilot are both selected. Content is identical; whether Copilot de-duplicates by name is **unverified** (no live Copilot session) and to be checked when the first module ships a skill.
- After `yaw self-update`, `just check` reports drift until `yaw update` ran, because the check compares with the installed kit. That is the intended reminder.
- No phase-1 module ships a skill yet; the behaviour is covered by fixture-kit tests.
