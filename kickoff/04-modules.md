# 04 — Modules

A module is a folder in `modules/` with a `module.yaml`. It owns its questions, templates, customisation (skills, agents, hooks), scripts, `just` recipes and tests. Enabling a module adds exactly these; removing it deletes exactly these.

## 1. Catalogue and mode defaults

Phase 1 (ADR-0009): **Quick** = `core`, `communication`, `standards`, `devenv`, `tasks`, `security` (minimal; ADR-0009 adds it to BD5); **Standard** = Quick + `git-hooks`, `github`, `ci`, `decisions`, `security` (minimal), `sessions`, `comfort` (hygiene + status line), and `team` when the project is a team (ADR-0031); **Full** = Standard + the F questions and team-mode options. Modules in the table that are in none of these lists (`quality-code`, `performance`, `business-logic`, `ui-design`, `privacy`, `backup`, `environments`, `vendors`, `knowledge`, `dashboard`, `evaluation`, `remote`) are phase 2 or 3.

| Module | Purpose | Quick | Standard | Full | Depends |
|---|---|:-:|:-:|:-:|---|
| `core` | `AGENTS.md`, `CLAUDE.md`, `justfile`, manifest | ✔ (always) | ✔ | ✔ | – |
| `communication` | Speaking style from user profile into `AGENTS.md`; Claude output style | ✔ | ✔ | ✔ | core |
| `standards` | Baseline coding + review standards, stack overlay from profile | ✔ | ✔ | ✔ | core |
| `devenv` | `just setup/dev`, `.env.example`, Docker/devcontainer when the profile advises it | ✔ | ✔ | ✔ | core |
| `tasks` | Task ledger (local / GitHub / both) | ✔ | ✔ | ✔ | core |
| `git-hooks` | `lefthook`/`pre-commit`: format, lint-staged, `gitleaks` | – | ✔ | ✔ | core |
| `github` | Repo, branch, commit, PR (and PR template), label, issue (native type or label), release, protection scripts (ADR-0027) | – | ✔ | ✔ | core |
| `ci` | CI workflow running `just check` plus a gitleaks scan, Dependabot for the pinned actions (ADR-0027) | – | ✔ | ✔ | github |
| `decisions` | ADR + notice journal, local RAG, recall hook | – | ✔ | ✔ | core |
| `quality-code` | Lint/type/test gates, `change-reviewer` subagent (phase 2; phase-1 gates come from the profiles) | – | ✔ | ✔ | standards |
| `security` | `security-reviewer`, guard hooks, `just audit`, secret scan (phase 1: only `.env*`/secret read deny and destructive-command guard) | ✔ (minimal) | ✔ | ✔ | standards |
| `performance` | Budgets, Lighthouse/bench recipes, perf review checklist | – | – | ✔ | quality-code |
| `business-logic` | Domain-rule checklist from interview 2.3, business notices, reviewer pass | – | ✔ | ✔ | decisions |
| `ui-design` | Design direction, tokens, `just screenshot`, `visual-reviewer`, a11y | – | if UI | if UI | standards |
| `privacy` | Privacy journal kind, data map, privacy gate | – | if public | ✔ | decisions |
| `backup` | `just backup/restore`, restore test, schedule template | – | if data | ✔ | devenv |
| `environments` | staging/prod/preview config, guarded `just deploy <env>` | – | if hosted | ✔ | devenv |
| `vendors` | Service catalogue, key onboarding, `.env` wiring | – | if needed | if needed | devenv |
| `comfort` | Session hygiene, status line, notifications, cache reminder (doc 11; ADR-0030: personal settings in `~/.yaw/comfort.yaml`, cache reminder is phase 2) | – | hygiene + status line | asked | core |
| `sessions` | Session registry, commit trailer, `/handoff` (doc 12) | – | ✔ | ✔ | tasks |
| `team` | Team mode (doc 14 §2–3, ADR-0031): lefthook `commit-msg` / `pre-push`, `pr-policy` check, agent rules in `AGENTS.md` (guidance), session-start sync; the ruleset (`just gh-protect`) is the boundary | – | if team | if team | tasks, github, git-hooks |
| `knowledge` | Global knowledge store recall + `/remember` (doc 12) | – | if set up | if set up | decisions |
| `dashboard` | Local UI, OTel receiver, metrics store (doc 13) | – | ✔ | ✔ | sessions |
| `evaluation` | Session outcome classification, tier 1/2/3 (doc 13) | – | tier 1 | tier 1 | sessions |
| `remote` | Remote dev loop: own Telegram wrapper `yaw-tg` (Python add-on), device + preview recipes (doc 11) | – | – | – (explicit) | comfort, security |

"if X" = preselected only when the interview says so. Everything can be unchecked; dependency violations are shown in the form, not silently fixed.

## 2. `module.yaml` format

```yaml
name: ui-design
description: Design direction, tokens, screenshots and visual review.
appliesTo: { hasUI: true }            # hidden when the product has no UI
depends: [standards]
default: { quick: false, standard: { hasUI: true }, full: { hasUI: true } }   # per mode: true | false | ask | facts
questions:                             # inline, same format as interview/base.yaml (ADR-0017)
  - { id: ui.direction, ref: "6.1", mode: Q, type: choice, label: Pick a design direction, choices: [surprise-me], default: surprise-me }
  # ui.brand, ui.theme, ui.density, ui.a11y follow the same shape
outputs:
  templates: [design/direction.md, design/tokens.json]
  skills: [design-direction, visual-review]
  agents: [visual-reviewer]
  hooks: []
  just: just/ui.just
  gates: [screenshot, a11y]
agentsMd: |                            # ≤ 5 lines injected into AGENTS.md
  - UI work follows `design/direction.md` and `design/tokens.json`; never invent colours or fonts.
  - After UI changes run `just screenshot` and use `visual-review` before reporting done.
agents:                                # compatibility attribute, see doc 09 §3
  claude:  { support: native }
  codex:   { support: native }
  gemini:  { support: partial, note: "no subagent for visual review; runs as skill" }
  copilot: { support: partial, note: "custom agent instead of subagent" }
tokenCost: low                         # model tokens added per turn: none | low | medium
lastVerified: 2026-10-20
```

Each output item (hook, skill, agent) can override `agents` and `tokenCost`. Full format: `core/schema/module.schema.json`, reference in `docs/spec/formats.md`. The form uses both: unsupported items are greyed out with the reason, and the live summary shows the expected per-turn token overhead of the selection.

`AGENTS.md` is assembled from the `core` frame and each enabled module's `agentsMd`, with a hard budget of 80 lines in every mode: rendering fails, naming the contributors, when it is exceeded (ADR-0009). Detail goes into `docs/spec/` or the skill.

## 3. Module notes

### core

`AGENTS.md` sections: Scope · Communication · Workflow (task-start protocol, skill routing) · Engineering · Security & operations · Verification · Repository workflow. The first workflow rule: *read `TASKS.md` (if present), run decision retrieval (if enabled), then work*.

### communication

Renders the user profile into ≈ 6 lines (language, length, register, examples, explanation depth, autonomy). For Claude Code additionally an output style (`.claude/output-styles/<name>.md`) when verbosity or register differs from the default. Project-level language rules (code, commits, UI) go into the same section. In team mode nothing personal is committed: the module writes no section and no output style (ADR-0013).

### standards (baseline, all projects)

Kept short; the reviewer subagents use it as their checklist.

- **Clean code:** small focused units, clear names, no dead code, no speculative abstraction, comments only for what code cannot say, consistent error handling, no silent catches.
- **Security:** validate at boundaries, parameterised queries, output encoding, least privilege, no secrets in code/logs, dependency hygiene, OWASP Top 10 awareness.
- **Performance:** no N+1, bounded loops/queries, pagination, caching where measured, asset budgets.
- **Testing:** tests for business rules and bug fixes, deterministic, no network in unit tests.
- **Review standard:** findings with severity, location, impact, concrete fix; behaviour over style; state what could not be verified.
- **Git:** Conventional Commits, small PRs, no force-push to shared branches.

The profile adds a stack overlay (`profiles/<p>/standards.md`, ≤ 20 lines: linters, idioms, pitfalls).

### decisions

Technical spec: [reference/governance-blueprint.md](reference/governance-blueprint.md) sections D, E, F, K, with these changes:

- Logic in kit `modules/decisions/lib/` (vendor-neutral), not under `.claude/`; the retrieval engine (tokenizer, embedding, ranking) is shared in `core/lib/retrieval.js` with a Unicode-aware tokenizer (ADR-0011).
- Notice kinds: `security`, `business-logic`, `privacy`.
- Index fields added: `importance`, `status`, `supersedes`, `scope`, `reviewBy`, `embeddingModel`, `refs` (detail doc, spec, code symbol, issue, commit, session; see doc 12).
- Short record is injected; optional detail doc in `.decisions/details/` is linked, not injected.
- Single `embeddingText(entry)` recipe; `parseArgs` CLI; ID uniqueness check in `just check`.
- Hooks (ADR-0028, BUILD.md rule 5): `SessionStart` re-injects the critical decisions, one line of ID and title each (no record bodies; Claude and Codex). The number is chosen by the user; the default is 0 (nothing). The lines come from the generated file `.decisions/CRITICAL.md`, built from the index and checked by `decisions check`. `UserPromptSubmit` recall is comfort only: a `systemMessage` naming matching records for the user. No `PreToolUse` hook; path-aware recall is `--path`.
- Recall of full records: the agent runs `just decisions recall "<task>"` at task start (critical records always included). Copilot does not support `SessionStart` context; Copilot and other agents without it read `.decisions/CRITICAL.md`, which `AGENTS.md` references (a reference line, never the decision text, so nothing is duplicated); `just decisions recall` is the second fallback.
- Storage (ADR-0028, design only, not implemented): plain text in `.decisions/` is the source; `yaw.db` has a `decisions` table as the discovery index. Each record is embedded as title + short summary + category path; the detail body is not embedded, only shown on retrieval (a longer embedding can be added if recall is poor). Categories reuse `taxonomy.json` (Architecture, Agents, Modules, Memory, Security, Delivery, Governance) plus UI.
- Project name (ADR-0028, ADR-0029, design only): `yaw init` asks one question (default: folder name), stored in the manifest; session and decision rows carry it; filters `--project`, `--model`, `--session` on `yaw sessions` and `yaw decisions`.

### quality-code / security / performance / business-logic

Each contributes (a) commands to `just check`, (b) a review checklist file, (c) a subagent or a section of `change-reviewer`. To avoid bloat, Standard uses **one** `change-reviewer` that loads the checklists of the enabled modules; Full can split into dedicated `security-reviewer`, `perf-reviewer`.

Guard hooks (security module): `PreToolUse` on `Bash` (and file tools, Codex `apply_patch`) denies patterns from `profiles/<p>/guards.yaml` + `modules/security/guards.yaml` (force-push, every `rm -rf`, prod deploy, remote migrations, secret reads); the user runs a blocked command themselves (ADR-0022). Prefer Claude Code `permissions.deny` where a static rule suffices; use a hook only for logic.

### ui-design

See doc 06.

### privacy, backup, environments

See doc 07.

### vendors

See doc 08.

### tasks, github, ci

See doc 10.
