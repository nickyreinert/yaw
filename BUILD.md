# YAW — Build Instructions (starting point for the coding agent)

You are building **YAW (Yet Another Wrapper)** in this repository. The concept is complete and lives in `KICK-OFF.md` and `kickoff/01–14`. Those documents are the **source of truth**. This file defines the build order, the working rules and, per step, the recommended model and reasoning effort.

## How to use this file

- **One orchestrator session** (Haiku is fine) runs the whole build. It does no implementation itself: every step runs in a **subagent** with the model and effort from the step's table.
- The orchestrator continues from step to step on its own. It stops only (a) after step 1 for the user to review the ADRs, and (b) for the "still ask" cases in rule 0.
- If the orchestrator session gets long, the user starts a new one with the same prompt; progress is tracked in `docs/build/plan.md` and the GitHub issues.

### Model tiers used below

| Tier | Claude Code | Use for |
|---|---|---|
| **A** | Claude Opus (latest) | Formats, architecture, security-relevant logic, reviews |
| **B** | Claude Sonnet (latest) | Implementing against a fixed schema, modules, profiles |
| **C** | Claude Haiku (latest) | Boilerplate, docs, changelogs, repetitive fixtures |

Effort: `low` / `medium` / `high`. Use **plan mode** for every step marked "plan first".

### Orchestration with subagents

- The orchestrator only dispatches and tracks progress. Every decision and all code are made by subagents of the tier given for the step.
- After every step, a **Tier A review subagent** checks the result (rules, tests, scope) before the PR is merged.
- Each subagent gets its model **set explicitly** to the tier of its step (subagent definition `model:` field); do not rely on inheritance or defaults.
- Steps 0–4 are **sequential** (each builds on the previous formats/code): run them one at a time, no parallel subagents.
- Parallel subagents are fine for: step 5 modules after step 4 is merged, step 6 profiles, research/reading, test fixtures, reviews. Each parallel subagent works in its **own git worktree/branch**.
- Update `docs/build/plan.md` (status per step) after every merge.

## Working rules (apply to every step)

0. **Pre-approved actions (do not ask):** create the repo `nickyreinert/yaw` as **private** via `gh repo create`; commit and push to feature branches; create labels, milestones, issues, sub-issues and PRs; merge your own PR when CI is green and the review subagent found no blocker. **Still ask before:** making the repo public, force push, deleting branches/files outside the step, rewriting history, touching anything outside this repo.
1. **Docs first.** Read the docs listed for the step before writing code. If the implementation must deviate from a doc, write an ADR (`docs/adr/NNNN-*.md`) and update the doc in the same PR.
2. **One step = one GitHub issue = one branch = one PR.** Sub-tasks become sub-issues. No change without an issue (we follow our own team-mode rules from doc 14).
3. **Node ≥ 22, zero runtime dependencies.** Only Node built-ins (`node:test`, `node:sqlite`, `node:http`, `node:crypto`, …). Dev-only tooling is allowed if listed in an ADR.
4. **No black box.** Every generated file is recorded in the manifest with its hash; every module must be removable (`yaw remove <module>`), with a test proving it.
5. **Token-free hooks, precisely:**
   - *Evaluation/metrics hooks* print nothing, return nothing, exit 0, detach, fail open. Test asserts empty stdout.
   - *Comfort hooks* may return a **synchronous** `systemMessage` / `terminalSequence` (user-visible only); never `additionalContext`, never from async hooks. Test asserts no `additionalContext`.
   - *Status line* scripts are exempt (rendered by the agent UI, not sent to the model).
   - Only allowed model-visible output: `SessionStart` re-injection of the active task (doc 11), a few lines once per session.
6. **Secrets never pass through the model.** No secret values in logs, fixtures, prompts or test snapshots.
7. **Tests with every change.** `node --test`; adapter tests use recorded hook payloads as fixtures (`test/fixtures/<agent>/<event>.json`).
8. **Scope discipline.** Build only what the step asks for. Ideas for later go into an issue labelled `later`.
9. **Dogfooding.** From step 3 on, this repo is set up and maintained with YAW itself. Enabling a YAW feature on this source repository is a live integration test of that feature; record its setup and results separately from the reusable implementation for projects using YAW. For step 5.9, applying GitHub rulesets to `nickyreinert/yaw` tests the team-mode feature. The user has made the repository public; use it for that test. GitHub plan and visibility requirements belong in the feature's documentation, and an unavailable live test is a validation limitation rather than an implementation blocker.
10. **Decide, don't ask.** The concept is closed. For implementation details the docs do not cover, pick the simplest option consistent with the docs, record it in an ADR, and list it in the step summary. Ask the user **only** if the choice changes scope, user-visible behaviour, security, or is hard to reverse. Max. 3 questions per step, each with a recommended answer. Check "Decisions after step 0" below first.

---

## Decisions after step 0 (binding)

| # | Topic | Decision |
|---|---|---|
| 1 | YAML subset | Allow block scalars `\|` and `>` (needed for `agentsMd`). Typing like YAML 1.2 core: `true/false`, `null`, ints, floats; `yes/no/on/off` stay strings. Comments are **not** preserved when the kit rewrites a YAML file; the kit writes a header comment saying so and rewrites only via explicit commands (`yaw config set`). |
| 2 | `github.yaml` / `taxonomy.json` | `github.yaml` stays YAML (user edits labels/rules). `taxonomy.json` stays JSON (managed through `yaw decisions` commands, as in the blueprint). |
| 3 | `yaw.db`, release plan, `pr-policy` | Phase 1 defines only the tables it uses (session registry). Evaluation tables and `release-plan.yaml` come in phase 2. Phase-1 `pr-policy` enforces only "PR links an open issue"; phase gating comes with the launch plan in phase 2. |
| 4 | Tasks source of truth | Local mode: `TASKS.md` is the source of truth, IDs `T-NNN`. GitHub-only and team mode: issues are the source, IDs are issue numbers (`#123`), `TASKS.md` is a generated read-only view. Both mode: `T-NNN` with linked issue number. |
| 5 | Presets | "Lean" = **Quick** (one name, docs updated). Quick = `core`, `communication`, `standards`, `devenv`, `tasks` (doc 04). Step 3 builds `core` only; Quick is complete after 5.3. No reordering. |
| 6 | `security` / `quality-code` | Minimal `security` joins phase 1: deny reading `.env*`/secret files, guard destructive commands (`rm -rf`, force push, prod deploy). This is the blocking hook that proves step 4. `quality-code` reviewer subagent stays phase 2; `just check` gates come from the profiles. |
| 7 | Dogfooding profile, ADR location | Add 9th profile **`node-cli`** (Node ≥ 22, `node --test`, no deps) and use it for this repo. ADRs live in `docs/adr/` until step 5.6, then move into `.decisions/` via the decisions module. |
| 8 | Gemini CLI | Phase 3, together with Antigravity (Gemini CLI is enterprise/API-key only now). Phase 1 agents: Claude, Codex, Copilot. |
| 9 | Token-free split | Confirmed; see working rule 5. |
| 10 | CI and the kit | CI installs the kit at the tag pinned in `manifest.json` (`install.sh --tag <kit>`). `--vendor` stays optional for repos whose collaborators don't have the kit. |
| 11 | Platforms, Node | v0.1: macOS + Linux (Windows via WSL only). Node floor **22.13** (`node:sqlite` without flag); CI tests 22 and 24. Suppress the experimental warning for `node:sqlite`. |
| 12 | Repo and issues | Pre-approved (rule 0): the agent creates `github.com/nickyreinert/yaw` as private, then labels, milestones and issues from `docs/build/plan.md` with `gh`, idempotently. |

---

## Step 0 — Read, check, plan

- **Model / effort:** Tier A, `high`, plan first
- **Read:** `KICK-OFF.md`, all of `kickoff/`, `kickoff/reference/governance-blueprint.md`
- **Do:**
  - Find contradictions, gaps and ambiguities across the docs; list them with doc references.
  - Produce `docs/build/plan.md`: the issue list for phase 1 (title, type, priority P0–P3, dependencies, acceptance criteria), mapped to the steps below.
  - Propose the initial ADR list (see step 1).
- **Done when:** plan and contradiction list exist; repo, labels, milestones and issues are created. No code yet.

## Step 1 — Formats and schemas (the real interface)

- **Model / effort:** Tier A, `high`, plan first
- **Read:** docs 01, 04, 05, 09, 10, 12, 13
- **Do:** define, document and validate (JSON Schema + example files + validator in plain Node):
  - `.yaw/manifest.json` (doc 01 §5)
  - `module.yaml` incl. `agents` compatibility (`native/partial/fallback/none`) and `tokenCost` (doc 04 §2)
  - `profile.yaml` (doc 05 §2)
  - Task ledger schema (doc 10)
  - **Normalised hook event** (agent-independent: event, session id, model id, prompt length, tool, result, timing) (doc 09, 13)
  - `~/.yaw/yaw.db` schema, phase-1 tables only (session registry, doc 12)
- **Not in step 1 (phase 2, see decision 3):** `yaw.db` evaluation tables, `.yaw/release-plan.yaml`.
- **Decided (write as ADR-0001):** YAML for files humans write or edit (`answers.yaml`, `module.yaml`, `profile.yaml`, `release-plan.yaml`, `github.yaml`, presets), JSON for kit-written files (`manifest.json`, ledger/registry data, normalised hook events). Human-edited YAML still has to be read, so build a **strict YAML subset parser** in plain Node: maps, lists, scalars, quoted strings, flow lists/maps, comments; reject anchors, tags, multi-docs and other features with a clear error (file + line). Keep it small and fully tested.
- **Decide by ADR (required):**
  - Template engine (plain string templates vs. tiny built-in renderer).
  - Hash/merge strategy for `yaw update` on user-edited files.
- **Done when:** schemas validate all example files; ADRs accepted by the user.

## Step 2 — Kit skeleton, install, update

- **Model / effort:** Tier B, `medium`; merge/update logic Tier A, `high`
- **Read:** doc 01 §2, §4, §5
- **Do:** kit repo layout, `install.sh` (clone into `~/.yaw/kit`, shim for `yaw`), `yaw --version`, `yaw self-update`, `yaw doctor`, render engine writing files + manifest hashes, `yaw update` with keep / take / merge for edited files, `yaw remove <module>`.
- **Done when:** install → init (empty) → update → remove works in a temp dir test; `install.sh` is idempotent and passes `shellcheck`.

## Step 3 — First vertical slice: `yaw init` (CLI lane, Quick preset with `core` only, two profiles)

- **Model / effort:** Tier B, `medium`
- **Read:** docs 02, 03 (sections 0–1), 04 (`core`), 05 (`python-cli`)
- **Do:** CLI interview for the Quick preset (only `core` active for now), `core` module (`AGENTS.md`, `CLAUDE.md` importing it, `justfile`, manifest), profiles `python-cli` and `node-cli`. Then set up **this repo** with YAW using `node-cli` (dogfooding).
- **Done when:** `yaw init` in an empty folder produces a project where `just check` passes; the `core`-only result produces only a handful of files.

## Step 4 — Agent adapter layer and hook wrapper

- **Model / effort:** Tier A, `high`, plan first
- **Read:** doc 09 (all), doc 11 (token-free rules), doc 13 §3 (hook rules)
- **Do:**
  - One hook entry point (`yaw hook <event>`) that normalises payloads per agent and dispatches to module handlers.
  - Adapters in this order: **Claude Code** (full), **Codex** (incl. trust note), **Copilot** (reads `.claude/settings.json` hooks; `sessionStart` context only).
  - Skills authored once in `.agents/skills/`; Claude gets `.claude/skills/` generated or symlinked.
  - Compatibility matrix rendered from `module.yaml` attributes (`yaw agents`).
- **Done when:** recorded fixtures for each agent pass; silent-hook tests pass; the `security` guard (deny `.env` read, block destructive commands) blocks in Claude and Codex.

## Step 5 — Phase-1 modules (one issue each, in this order)

| # | Module | Docs | Model / effort |
|---|---|---|---|
| 5.0 | Minimal `security`: `.env*`/secret read deny, destructive-command guard (built together with step 4) | 04, 08 | **A, `high`** |
| 5.1 | `communication`, `standards` | 04 | B, `low` |
| 5.2 | `devenv` | 04, 05 | B, `medium` |
| 5.3 | `tasks` (local / GitHub / both) | 10 | B, `medium` |
| 5.4 | `git-hooks` (lefthook, gitleaks) | 04 | B, `low` |
| 5.5 | `github` + `ci` (scripts, labels, issue-type auto-detect with label fallback) | 10, 14 §1 | B, `medium` |
| 5.6 | `decisions` (ADR + notices journal, local recall hook) | 04, 12, reference blueprint | **A, `high`** |
| 5.7 | `sessions` (registry, commit trailer, `/handoff`) | 12 | B, `medium` |
| 5.8 | `comfort`: hygiene, status line, notifications | 11 | B, `medium` |
| 5.9 | Team mode: issue-required hooks, lefthook, `pr-policy` CI check ("PR links an open issue"), rulesets, session-start sync | 14 | **A, `high`** |

## Step 5.10 — Setup depth: Quick Start / Full Setup

- Model / effort: Tier B, medium; selection/dependency review Tier A, high.
- Added during step 5.9; completed steps remain complete.
- Define two primary setup choices:
  - Quick Start: essential development baseline for prototypes/MVPs.
  - Full Setup: applicable tooling for maintained products.
- Audit existing module and item defaults; explicitly assign which
  hooks and skills each mode enables.
- Ensure mode selection controls generated outputs, not just which
  questions are shown.
- Preserve existing Standard configurations.
- Support gradual expansion through `yaw add <module>`, preserving
  existing answers and edits.
- Record the revised policy in an ADR and update conflicting docs.
- Keep phase-2/3 features outside this step.
- Done when: documented selection rules are implemented and tested;
  Quick produces only its intended baseline, Full respects relevance
  and dependencies, and existing configurations still work.

- **Done when (each):** module installs, works for Claude + Codex (+ Copilot where the matrix says so), is removable, has tests, and its manifest entries are correct.

## Step 5.11 — Code map and freshness checks

- Model / effort: Tier B, medium; design and review Tier A, high.
- New scope added during the build; completed steps remain complete.
- Read: docs 04, 09, 10, 12; existing rendering, module removal,
  Git-hook and CI contracts.
- Implement a removable `code-map` module, independent of GitHub.

### Navigation artifacts

- Maintain a concise, version-controlled `docs/code-map.md`:
  major subsystems, responsibilities, entry points, related tests,
  important cross-subsystem relationships and links to relevant ADRs.
- Separate generated sections from maintained explanations.
  Automatic refresh must preserve maintained explanations.
- Keep the detailed file index in an ignored, rebuildable local cache.
  Do not inject the entire index into agent context.
- Add a short AGENTS.md navigation rule: consult the map first,
  inspect relevant implementation/callers/tests, and broaden search
  when needed. Verify map guidance against current code.

### Commands and freshness

- `yaw map update`: refresh generated map sections and local index.
- `yaw map check`: read-only validation; fail on stale generated
  sections, broken references or uncovered source areas.
- `yaw map show [area]`: ensure the local index is current, then
  return a bounded overview of the requested area.
- Detect additions, edits, renames and deletions, including
  uncommitted and non-ignored untracked files.
- Reconcile against the current working tree, including after branch
  changes. Keep caches separate for different Git worktrees.
- Use deterministic output, incremental refresh where practical,
  atomic writes and safe handling of concurrent refreshes.
- Exclude secrets, dependencies, generated outputs and the cache
  itself. Never read secret files or follow links outside the project.

### Existing workflow integration

- Add `yaw map check` to `just check` when the module is enabled.
- Reuse existing Git-hook infrastructure for validation when present.
- Existing GitHub CI runs the same check on PR updates.
- Checks report the repair command; they do not automatically stage,
  commit or push map updates.
- Structural changes require reviewing the maintained descriptions
  in the same PR. Review may conclude no wording change is needed.
- Distinguish mechanically verified freshness from semantic review:
  passing checks cannot prove architectural explanations are correct.
- Automatic agent hooks stay silent, invoke no LLM and follow the
  existing token-free/fail-open rules. Explicit checks may fail.

### Setup depth and scope

- Quick: concise map, navigation rule and explicit update/check.
- Full: same foundation, with existing Git-hook/CI integration
  enabled where those modules are selected.
- Step 7 exposes these choices consistently in CLI and browser.
- Phase 1 indexes paths and declared subsystem relationships.
  Language-aware symbol/dependency extraction is later scope.
- An optional foreground `yaw map watch` is later scope. It may
  refresh the local cache using debounced events, but freshness must
  remain correct without it. No mandatory background daemon.

### Acceptance

- Tests cover stale maps, broken references, new/renamed/deleted
  files, dirty working trees, branch/worktree changes, exclusions,
  deterministic output and preservation of maintained explanations.
- Works locally without GitHub and without a watcher.
- Removal follows existing ownership and user-edit preservation rules.
- Record the design in an ADR and update the build plan and module docs.

## Step 6 — Remaining profiles

- **Model / effort:** Tier B, `low` (static-site, python-web, php-web, node-ts-vercel); Tier B, `medium` (wordpress-plugin, cloudflare-workers, android-kotlin)
- **Read:** doc 05
- **Do:** one profile per PR, each with a fixture project in `test/profiles/<name>/` and a CI matrix job that runs `yaw init` + `just check`.
- **Done when:** all 9 profiles green in CI (Android may run on a macOS/Linux runner with SDK cache).

## Step 7 — Full interview and browser form

- **Model / effort:** Tier B, `medium`; server security review Tier A, `high`
- **Read:** docs 02, 03 (all sections), 08
- **Do:** complete CLI interview incl. agent multi-select (0.0), solo/team (1.5), presets, saved setups; browser form served on `127.0.0.1` with one-time token, no external assets, same answer schema as CLI.

Present the setup depths defined in step 5.10 as the first choice in both CLI and browser setup; Quick uses a short interview with defaults, Full exposes the applicable configuration.

- **Done when:** CLI and form produce identical answer files for the same choices (test); form server rejects requests without token and from non-local origins.

## Step 8 — Hardening review

- **Model / effort:** Tier A, `high`, as a separate review session (fresh context)
- **Do:** security review (shell quoting in hooks, path traversal in render engine, token handling, secret leakage, CSRF/DNS rebinding on the local server), token-free audit of all hooks, removal test of every module, `yaw doctor` coverage.
- **Done when:** findings fixed or filed as issues with priority.

## Step 9 — Release v0.1

- **Model / effort:** Tier C, `low`
- **Do:** README (install, quick start, Quick vs. Full preset), CHANGELOG, tag `v0.1.0`, verify `curl … install.sh | bash` from the tag on a clean machine/container.

---

## Later phases (outline only; plan each with step 0 again)

| Phase | Content | Model / effort |
|---|---|---|
| 2 | `ui-design` loop, `privacy`, `backup`, `knowledge`, cache reminder, `quality-code` reviewer, dashboard + OTel receiver + tier-1 evaluation (incl. apology/admission tracking, `yaw.db` evaluation tables), launch plan / `release-plan.yaml` / phase gating in `pr-policy` | Formats + evaluation rules: A `high`; UI + recipes: B `medium` |
| 3 | Remote dev loop (`yaw-tg`, Python add-on via `uv`), tier-2 decision models (`classify()` + adapters: Laya, WaterSheep, Kev, SemIf, Ollama; `yaw eval compare/calibrate`), Gemini CLI / Antigravity / Pi / Hermes adapters | Adapters + `classify()`: A `high`; Telegram wrapper: B `medium` |

## First prompt to paste (orchestrator session, Haiku)

```
Read BUILD.md. You are the orchestrator: do not implement anything yourself.
Run each step in a subagent with the model and effort from BUILD.md, in order,
starting with the first step not marked done in docs/build/plan.md.
Follow rule 0. Stop only after step 1 (ADR review) and for the "still ask" cases.
```
