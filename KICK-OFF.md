# YAW — Yet Another Wrapper: Kick-off Concept

Icon idea: a jaw / shark bite ("YAW" ≈ "jaw"); also a nod to *yaw* = steering axis.

A portable, **coding-agent-agnostic** kit that turns a project idea into a ready-to-work repository: architecture proposal, dev environment, wrapper scripts, quality gates, decision memory, task ledger, and agent customisation (skills, hooks, subagents, instructions). We call all agent-facing artefacts **customisation**.

Works for any kind of job: a quick Python script, a dockerized static page, a self-hosted Flask app, a PHP site, a WordPress plugin, a Vercel/TypeScript app, an Android app.

## Non-negotiables

1. **No black box, no bloat.** Every module is opt-in, every generated file is listed in the project manifest, and every module can be removed again. The Quick preset produces only a handful of files.
2. **Flexible, not deterministic.** The user describes the idea; the agent proposes an architecture. Profiles and modules are building blocks, not cages.
3. **Agent-agnostic core, Claude-first depth.** `AGENTS.md` is the single entry point. Claude Code gets the full feature set (hooks, subagents, skills, plugin). Codex and Copilot get adapters in phase 1, Gemini CLI / Antigravity / Pi / Hermes in phase 3, where their tooling allows it.
4. **Advisory vs. enforced.** Anything that must happen lives in a hook, a script or a gate, not in prose.
5. **Secrets never pass through the model.**
6. **Two audiences.** Experts get speed and defaults; laypeople get short explanations that can be expanded on demand.

## Documents

| # | Document | Content |
|---|---|---|
| 1 | [kickoff/01-architecture.md](kickoff/01-architecture.md) | Three layers, kit repo layout, project footprint, install/update, manifest, `just` interface |
| 2 | [kickoff/02-setup-flow.md](kickoff/02-setup-flow.md) | Setup pipeline, CLI lane and browser-form lane, presets, saved setups, expert vs. layperson |
| 3 | [kickoff/03-interview.md](kickoff/03-interview.md) | Interview catalogue, grouped and module-scoped |
| 4 | [kickoff/04-modules.md](kickoff/04-modules.md) | Module catalogue: what each installs, defaults, dependencies |
| 5 | [kickoff/05-profiles.md](kickoff/05-profiles.md) | Stack profiles (9 initial), profile format, how to add one |
| 6 | [kickoff/06-design-and-aesthetics.md](kickoff/06-design-and-aesthetics.md) | Design directions, tokens, anti-"AI look" rules, visual review loop |
| 7 | [kickoff/07-privacy-backup-environments.md](kickoff/07-privacy-backup-environments.md) | Privacy journal and gate, backup/restore, environment strategy |
| 8 | [kickoff/08-vendors-and-secrets.md](kickoff/08-vendors-and-secrets.md) | External service catalogue, guided key onboarding, secret handling |
| 9 | [kickoff/09-agents-and-adapters.md](kickoff/09-agents-and-adapters.md) | Claude-first customisation, Codex/Gemini adapters, capability matrix |
| 10 | [kickoff/10-tasks-and-github.md](kickoff/10-tasks-and-github.md) | Task strategy (local / GitHub / both), ledger schema, GitHub scripts |
| 11 | [kickoff/11-comfort-features.md](kickoff/11-comfort-features.md) | Session hygiene, notifications, cache-warmth reminder, remote control |
| 12 | [kickoff/12-memory-and-sessions.md](kickoff/12-memory-and-sessions.md) | Record/reference structure, global knowledge store, session registry |
| 13 | [kickoff/13-dashboard-and-evaluation.md](kickoff/13-dashboard-and-evaluation.md) | Local dashboard, metrics/profiling, token-free session evaluation |
| 14 | [kickoff/14-team-mode.md](kickoff/14-team-mode.md) | Team mode: issue-driven work, enforcement, session-start sync, launch plan and freezes |
| R | [kickoff/reference/governance-blueprint.md](kickoff/reference/governance-blueprint.md) | Original technical spec: decision journal, embeddings, hooks, gates |

## Status of decisions (concept level)

| Topic | Decision | Status |
|---|---|---|
| Distribution | Separate kit repo `github.com/nickyreinert/yaw`, one-line install script, clone + update routine | Accepted |
| Task runner | `just` as uniform command interface | Accepted |
| Kit runtime | Node ≥ 22.13 (Node 20 is end-of-life since April 2026; 22.13 runs `node:sqlite` without a flag, its experimental warning is suppressed), CI tests Node 22 and 24. v0.1 supports macOS + Linux (Windows via WSL only). Zero dependencies (CLI, hooks, form/dashboard server, `node:sqlite`). Rationale below | Accepted |
| File formats | YAML for files humans write or edit (`answers.yaml`, `module.yaml`, `profile.yaml`, `release-plan.yaml`, `github.yaml`, presets), JSON for kit-written files (`manifest.json`, ledger/registry data, normalised hook events, agent settings). YAML is read by a small built-in strict-subset parser (maps, lists, scalars, quoted strings, flow collections, block scalars `\|`/`>`, comments; YAML 1.2 core typing, `yes/no/on/off` stay strings). Comments are not preserved when the kit rewrites a YAML file; the kit writes a header comment saying so and rewrites only via explicit commands (`yaw config set`). Exception: `taxonomy.json` stays JSON (managed via `yaw decisions`) | Accepted |
| Entry point | `AGENTS.md`; `CLAUDE.md` / `GEMINI.md` import it | Accepted |
| Agent focus | Claude Code first; user ticks supported agents on the first screen; every item carries a per-agent compatibility attribute (doc 09) | Accepted |
| Tasks | User chooses: local only, GitHub only, both (local-first). Local: `TASKS.md` is the source, IDs `T-NNN`. GitHub only / team: issues are the source, IDs `#123`, `TASKS.md` is a generated read-only view. Both: `T-NNN` with linked issue number | Accepted |
| Profiles | 9 initial (incl. `node-cli`), extensible by folder | Accepted |
| Decision memory | ADR + notices (`security`, `business-logic`, `privacy`) in one journal; index points to records, records link details/code | Accepted |
| Kit name | **YAW** (Yet Another Wrapper); CLI `yaw`, home `~/.yaw/`, project folder `.yaw/`. npm name `yaw` is taken (old watch utility), irrelevant because distribution is via git | Accepted |
| Remote control | Add-on, phase 3: own Python Telegram wrapper `yaw-tg` (`python-telegram-bot`) for all agents, baked into hooks/skills/`just` recipes; Claude Remote Control optional extra; dev loop via `just device-*` / `preview-share` | Accepted |
| Comfort features | Each opt-in, zero model tokens by design (user-facing output only) | Accepted |
| Session evaluation | Tier 1 implicit signals (free) default; decision models selectable and comparable (Laya, WaterSheep, Kev, SemIf; Jev hosted only with privacy approval) or Ollama-compatible | Accepted |
| Agents | Multi-select per project: Claude, Codex, Copilot, Gemini CLI, Antigravity CLI, Pi, Hermes | Accepted |
| Team mode | GitHub issues only, no change/PR without issue, session-start sync, phase-aware launch plan | Accepted |
| Phase plan | 1 = core, profiles (+ `node-cli`), decisions, tasks, github, hygiene, status line, notifications, sessions, minimal `security` guards (`.env` read deny, destructive-command guard), team mode "no PR without issue"; agents Claude, Codex, Copilot. 2 = ui-design loop, privacy, backup, knowledge, cache reminder, `quality-code` reviewer, dashboard + tier-1 evaluation, launch plan / phase gating. 3 = remote dev loop, decision-model evaluation, Gemini CLI / Antigravity / Pi / Hermes adapters | Accepted |

### Why Node (and not Go, Rust, Python)

| | Node | Go | Rust | Python |
|---|---|---|---|---|
| Already on dev machines | very often (and required by Playwright, most web profiles) | rarely | rarely | not reliably on macOS anymore; venv/version friction |
| Distribution | git clone, no build | single binary, needs release pipeline per OS/arch | same as Go, slower builds | clone + interpreter + venv |
| Hook startup | ≈ 40–60 ms, fine | ≈ 5 ms | ≈ 5 ms | ≈ 30–80 ms |
| Browser form | same language front and back | separate JS anyway | separate JS anyway | separate JS anyway |
| Hackability by users/agents | high, plain source | needs rebuild | needs rebuild | high |

Node is the easiest to build, extend and keep transparent (no black box: users read the source they run). Go would be the safest *distribution* (one binary, no runtime), so it stays the fallback if Node's presence becomes a problem: the file formats are the interface, the runtime is replaceable.

## Open items

None at concept level. Implementation notes (e.g. Antigravity hook schema) live in the respective docs.
