# ADR-0015: Phase-1 scope

- Status: Accepted
- Date: 2026-10-20
- Issue: #5 (Y-1.1)
- Resolves: F11, M9, P5, P6 (partly), H3, H6 (`docs/build/plan.md` §1); binding decisions BD3, BD6, BD7, BD8

## Context

`BUILD.md` step 1 and `KICK-OFF.md` listed items that belong to later phases (evaluation tables, `release-plan.yaml`, launch-plan gating). Binding decisions after step 0 settled the scope; this ADR records it in one place so schemas and modules do not drift back.

## Decision

In phase 1 (v0.1):

| Topic | In phase 1 | Later |
|---|---|---|
| `~/.yaw/yaw.db` | Session registry tables + migration version table only (BD3) | Evaluation and metrics tables (phase 2) |
| Release planning | – | `.yaw/release-plan.yaml`, launch plan, phase gating (phase 2) |
| `pr-policy` CI check | Only "PR links an open issue" (BD3) | Definition of Ready, branch name, phase rules (phase 2) |
| `security` module | Minimal: deny reading `.env*` / secret files; guard `rm -rf`, force push, prod deploy. It is the blocking hook that proves step 4 (BD6) | `security-reviewer`, `just audit` extensions |
| `quality-code` | – (phase-1 gates come from the profiles' `just check`) | `change-reviewer` subagent (phase 2, BD6) |
| Agents | Claude Code, Codex, Copilot (BD8) | Gemini CLI + Antigravity, Pi, Hermes (phase 3) |
| Profiles | 9 incl. `node-cli` (Node ≥ 22.13, `node --test`, no deps), used for this repo (BD7) | more profiles by folder |
| YAW's own ADRs | `docs/adr/` until step 5.6, then moved to `.decisions/` (BD7) | – |

Schemas follow this scope:

- Agent selections (manifest, answers, user profile) accept only `claude`, `codex`, `copilot`. Compatibility maps (`agents:` in `module.yaml`, items, questions, `capabilities.yaml`) also accept the phase-3 keys `gemini`, `antigravity`, `pi`, `hermes`, so module authors can record known support early (ADR-0017).
- The session registry lives in `~/.yaw/yaw.db` (ADR-0018). Doc 12 §1 is updated: the global index is `~/.yaw/yaw.db`, not `~/.yaw/sessions.index.json`.

## Consequences

- No phase-2 format is defined now; adding one later is a new migration or schema, not a breaking change.
- Phase-3 agents need an adapter and a schema change to the selection enum, nothing else.
