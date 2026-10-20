# YAW — Phase 1 Build Plan (Step 0 output)

Status: **approved (2026-10-20).** BD1–BD12 applied to this plan and to the concept docs (Y-0.1 done). Y-0.2 repository bootstrap **done**: private repo `github.com/nickyreinert/yaw`; labels (incl. `later`), 10 milestones (one per step) and 85 issues (10 epics, 75 sub-issues) created idempotently with `gh`. Docs pushed to `main` (`ab8de70`; its commit message wrongly says "empty root commit").

Sources read: `BUILD.md`, `KICK-OFF.md`, `kickoff/01`–`14`, `kickoff/reference/governance-blueprint.md`.

Abbreviations: `K` = KICK-OFF.md, `B` = BUILD.md, `D01`…`D14` = kickoff docs, `R` = governance blueprint (section letter), **`BD1`…`BD12` = binding decisions in BUILD.md**.

---

## 0. Binding decisions (from BUILD.md)

| BD | Decision (short) | Resolves |
|---|---|---|
| 1 | YAML subset includes block scalars `\|` and `>`. YAML 1.2 core typing (`true/false`, `null`, ints, floats; `yes/no/on/off` stay strings). Comments not preserved on rewrite; kit writes a header comment saying so; rewrites only via explicit commands (`yaw config set`). | F1, F2, F3 |
| 2 | `github.yaml` stays YAML (user-edited). `taxonomy.json` stays JSON (managed via `yaw decisions`). | F4 |
| 3 | Phase 1 `yaw.db` = session registry tables only. Evaluation tables and `release-plan.yaml` → phase 2. Phase-1 `pr-policy` enforces only "PR links an open issue". | F11, M9 |
| 4 | Local mode: `TASKS.md` is the source of truth, IDs `T-NNN`. GitHub-only and team mode: issues are the source, IDs `#123`, `TASKS.md` is a generated read-only view. Both mode: `T-NNN` with linked issue number. | F9, M3, M4 |
| 5 | "Lean" = **Quick** (one name; docs updated). Quick = `core`, `communication`, `standards`, `devenv`, `tasks`. Step 3 builds `core` only; Quick complete after 5.3. No reordering. | P1, P4 |
| 6 | Minimal `security` in phase 1 (deny `.env*`/secret reads, guard `rm -rf`, force push, prod deploy). It is the blocking hook proving Step 4. `quality-code` reviewer stays phase 2; `just check` gates come from profiles. | P6 (partly), M15, H6 |
| 7 | 9th profile **`node-cli`** (Node ≥ 22, `node --test`, no deps), used for this repo. ADRs in `docs/adr/` until Step 5.6, then moved to `.decisions/` by the decisions module. | P5, M12 |
| 8 | Gemini CLI → phase 3 with Antigravity. Phase-1 agents: Claude, Codex, Copilot. | H3, F10 (partly) |
| 9 | Token-free split confirmed (B rule 5): evaluation hooks silent; comfort hooks sync `systemMessage`/`terminalSequence` only, never `additionalContext`; status line exempt; only model-visible output = `SessionStart` task re-injection. | H1 |
| 10 | CI installs the kit at the tag pinned in `manifest.json` (`install.sh --tag <kit>`). `--vendor` optional. | U5, U4 (CI part) |
| 11 | v0.1: macOS + Linux (Windows via WSL only). Node floor **22.13**; CI tests 22 and 24. Suppress `node:sqlite` experimental warning. | H9, H10 |
| 12 | User creates `github.com/nickyreinert/yaw` (or approves `gh repo create`). After plan approval the agent creates labels, milestones and issues with `gh`, idempotently. | S8, S4 (repo part) |

Note: B Step 1 still lists evaluation tables and `release-plan.yaml`; BD3 overrides this for phase 1.

---

## 1. Contradictions, gaps, ambiguities

Severity: **C** = contradiction, **G** = gap, **A** = ambiguity. "Blocks" = first step that cannot finish without a resolution. Status: **✅ BDn** = resolved by binding decision, **◐** = partly resolved, **ADR-NNNN** = open, decided by ADR per B rule 10.

### 1.1 Formats and schemas (block Step 1)

| # | Sev | Finding | References | Blocks | Status |
|---|---|---|---|---|---|
| F1 | C | ADR-0001 subset vs. block literal scalar in `module.yaml` (`agentsMd: \|`). | B Step 1; D04 §2 | 1 | ✅ BD1 (block scalars allowed) |
| F2 | G | YAML scalar typing undefined (`on:`, unquoted dates, `no`, `de`). | D14 §4; D03 | 1 | ✅ BD1 (1.2 core; dates stay strings) |
| F3 | G | Kit also writes YAML; emitter and comment handling undefined. | D02 §1, §3, §5; D12 §3 | 1 | ✅ BD1 (emitter; comments dropped, header comment) |
| F4 | C | `github.yaml` kit-written but YAML; `taxonomy.json` human-adjusted but JSON. | K "File formats"; D01 §5; D14 §1; D03 11.4; R D3 | 1 | ✅ BD2 |
| F5 | G | Step 1 schema list omits `answers.yaml` + question definitions, `user-profile.yaml`, presets, `capabilities.yaml`, comfort items, `.yaw/config.yaml`, `github.yaml`, `guards.yaml`, `visual.yaml`, `vendors/*.yaml`, `~/.yaw/notify.yaml`. | B Step 1; D01 §2; D02 §5; D09 §3; D11 §1–2; D05 §2; D08 §2 | 1, 3, 7 | ◐ Step 1 defines answers, questions, user profile, presets, capabilities, config, github (ADR-0017); `guards.yaml`, `visual.yaml`, `vendors/*.yaml`, `notify.yaml` come with their modules |
| F6 | G | Question ID scheme (`6.1` vs. `ui.direction`) and location of question definitions undefined. | D02 §3; D03; D04 §2 | 1 | ADR-0017 (Proposed): `<group>.<name>` IDs, doc 03 number in `ref` |
| F7 | G | Derived-facts vocabulary (`hasUI`, `language`, `runsOn`, "if public/data/hosted", `auto`) undefined. | D04 §1–2; D05 §2 | 1, 3 | ADR-0017 (Proposed): facts vocabulary |
| F8 | G | Manifest lacks vendor mode, MCP servers, pinned-version semantics, fragment ownership; task-mode enum differs (D01 vs. D10). | D01 §3, §5; D09 §6; D10 §1; D14 §5 | 1 | ◐ enum follows BD4; vendor mode, MCP servers, pinned version in ADR-0017; fragment owner in ADR-0004 (Proposed) |
| F9 | A | Task ledger: `TASKS.md` parsed as source, or rendered from JSON? | B Step 1; K; D10 §2 | 1, 5.3 | ✅ BD4 |
| F10 | C | `agents` key enum in `module.yaml` undefined; Gemini/Antigravity separate. | D04 §2; D09 §2–3; D03 0.0 | 1 | ◐ BD8: phase-1 enum `claude`, `codex`, `copilot`; schema leaves room for phase-3 keys |
| F11 | A | `yaw.db` evaluation tables and `release-plan.yaml` now or phase 2? | B Step 1; K "Phase plan" | 1 | ✅ BD3 (phase 2) |

### 1.2 Update, remove, ownership (block Step 2)

| # | Sev | Finding | References | Blocks | Status |
|---|---|---|---|---|---|
| U1 | G | Shared files (`AGENTS.md`, `justfile`, `.claude/settings.json`, `.gitignore`, PR template) written by several modules; no fragment model. | D01 §5–6; D04; D09 §4 | 2 | ADR-0004 (Proposed): owner `core` renders the whole file, fragments hashed |
| U2 | G | 3-way merge needs a base (`.yaw/base/` vs. re-render from old tag). | D01 §4 | 2 | ADR-0003 (Proposed): `.yaw/base/` |
| U3 | A | `managed: false` files on `remove` / `update`. | D01 §5; D05 §3 | 2 | ADR-0003 (Proposed) |
| U4 | C | Project-pinned kit version vs. single global `~/.yaw/kit` used by hooks. | D01 §3; D14 §5 | 2, 4 | ◐ CI part ✅ BD10; rest ADR-0006 (Proposed): one global kit, doctor warns, writes refuse an older kit |
| U5 | G | CI and collaborators without the kit fail `just check`. | D01 §3, §6; D04; D09 §3; D12 §2 | 2, 5.5 | ✅ BD10 |
| U6 | A | Is `core` removable? | B rule 4; D04 §1 | 2 | ADR-0004 (Proposed): yes, as the last module |

### 1.3 Presets, modes, phases (block Step 3)

| # | Sev | Finding | References | Blocks | Status |
|---|---|---|---|---|---|
| P1 | C | "Preset" has three meanings; Lean vs. Quick. | D02 §2, §5; D03 1.3; D04 §1; D01 §5 | 3 | ✅ BD5 (Lean = Quick); mode vs. saved setup naming → ADR-0009 |
| P2 | C | Quick mode "3–5 essentials" vs. ~13 Q-marked questions in D03. | D02 §2; D03 | 3 | Open → ADR-0009 |
| P3 | C | Lean footprint "≈ 5–8 files" not reachable with `devenv`, `standards`, `communication`, just fragments. | D01 §3; D02 §2; D04 §1, §3 | 3 | Open → ADR-0009 (Step 3 `core`-only result: "a handful of files", B Step 3) |
| P4 | C | Step 3 builds lean with only `core`; other Quick modules come in 5.1–5.3. | B Steps 3, 5; D04 §1 | 3 | ✅ BD5 (no reordering) |
| P5 | G | No Node profile for dogfooding. | B rule 9, Step 3; D05 §1 | 3 | ✅ BD7 (`node-cli`, built in Step 3) |
| P6 | C | Phase-1 contents of Standard/Full undefined; `security`, `quality-code` etc. not in K phase 1. | K; D04 §1; B Steps 5, 9 | 3, 9 | ◐ `security` phase 1, `quality-code` phase 2 (BD6); Standard/Full phase-1 contents → ADR-0009 |
| P7 | C | Interview 0.1 has three expertise levels; D02 §4 defines two. | D02 §4; D03 0.1 | 7 | Open → Y-7.1 (ADR) |
| P8 | A | Where global answers live if `~/.yaw/` storage is declined. | D02 §5; D03 §0 | 3, 7 | Open → Y-7.2 (ADR) |
| P9 | G | Quick has no `decisions`; where do APPLY's ADRs / provisional ADRs go? | D02 §1; D03 | 3 | Open → ADR-0009 |

### 1.4 Hooks, agents, token-free rule (block Step 4)

| # | Sev | Finding | References | Blocks | Status |
|---|---|---|---|---|---|
| H1 | C | Token-free rule vs. comfort `systemMessage` / status line / session start. | B rule 5; D11; D13 §3; D14 §3 | 4, 5.8 | ✅ BD9 (B rule 5 reworded; record as ADR-0007) |
| H2 | C | Blueprint section I vs. newer D09 §2 matrix; currency of R sections C, G, J, N, O. | R; D09 §2; D01 §3 | 4, 5.6 | Open → D09 wins; doc note in Y-0.1 |
| H3 | G | Gemini CLI in no phase. | K non-neg. 3; B Step 4; D01 §2; D09 | 4 | ✅ BD8 (phase 3); K non-neg. 3 updated in Y-0.1 |
| H4 | A | Copilot + Claude hooks: double firing; Copilot-only hook location. | B Step 4; D09 §2; D14 §5 | 4 | Open → Y-4.5 (ADR) |
| H5 | A | Skills to Claude: generated copies vs. symlinks; Copilot duplicates. | B Step 4; D09 §2 | 4 | Open → ADR-0012 |
| H6 | G | Which blocking hook proves Step 4? | B Step 4; D04 §3; D14 §2 | 4 | ✅ BD6 (`security` guard) |
| H7 | G | Hook command resolution; shim location/format/fail-open. | D01 §3; B Step 4 | 4 | ADR-0006 (Proposed): `.yaw/bin/yaw-hook`, built in Y-4.2 |
| H8 | A | Model id availability per agent/event; vendor facts must be re-verified with fixtures. | B Steps 1, 4; D09 §2; D13 §0 | 1, 4 | ◐ draft mapping in `docs/spec/formats.md` (ADR-0018); verify in Y-4.3–4.5 |
| H9 | G | No platform statement. | D01 §4; D11; D13 §3 | 2 | ✅ BD11 (ADR-0008) |
| H10 | A | `node:sqlite` needs 22.13; ExperimentalWarning. | K; D13 §2 | 1, 4 | ✅ BD11 |

### 1.5 Modules, tasks, team mode (block Step 5)

| # | Sev | Finding | References | Blocks | Status |
|---|---|---|---|---|---|
| M1 | G | Shared retrieval engine belongs in `core/lib/`, not `modules/decisions/lib/`. | D04; D11 §1; D12 §1; D13 §3 | 5.6 | Open → ADR-0011 |
| M2 | C | ASCII-only tokenizer vs. German default; classify/embed tokenize differently. | R E2, K1, K2; D03 0.2; D13 §3 | 5.6 | Open → ADR-0011 |
| M3 | C | `TASKS.md` in GitHub-only mode: not generated vs. read-only view. | D10 §1; D14 | 5.3 | ✅ BD4 (generated read-only view) |
| M4 | C | `T-NNN` vs. issue-number IDs and branch names. | D10 §2–3; D14 §1–2 | 5.3, 5.5 | ✅ BD4 (IDs); branch pattern follows the ID → ADR-0010 |
| M5 | C | Recipe naming (`just task …`, `just gh-init`, `just commit/pr/branch`). | D01 §6; D10 §3; D12 §4; D14 §1 | 5.3, 5.5 | Open → ADR-0010 |
| M6 | C | Just `import` (flat) vs. `mod` (namespaced); verb collisions. | D01 §6; D05 §3 | 3, 6 | ADR-0004 (Proposed): `import` per module, `mod` per profile when several |
| M7 | C | Personal vs. committed config (comfort hooks, `.yaw/config.yaml`, communication in team repos). | D04; D11 §1; D12 §3; D14 §5 | 5.1, 5.8, 5.9 | Open → ADR-0013 |
| M8 | G | Comfort depends on sessions/tasks; "last `just check` status" not stored. | D04 §1; D11 §1, §1a | 5.8 | Open → Y-5.8 |
| M9 | C | Phase-1 `pr-policy` vs. phase-2 launch plan; `docs` type; boundary rules. | K; D14 §1, §2, §4; B 5.9 | 5.9 | ✅ BD3 (open-issue check only; rest phase 2) |
| M10 | C | D14 §4 cites "section 13 of doc 03"; it is section 12. | D14 §4; D03 §12–13 | – | Doc fix in Y-0.1 |
| M11 | C | ADR IDs: sequential vs. team-mode `ADR-<issue#>-<n>` / date-based. | R D5, N11; D14 §5 | 5.6 | Open → ADR-0010 |
| M12 | C | YAW ADRs in `docs/adr/` vs. `.decisions/`. | B rules 1, 9; D12 §1 | 3 | ✅ BD7 (move at Step 5.6) |
| M13 | G | Team mode: Stop-hook journal lines when `TASKS.md` is read-only. | D10 §2; D14 | 5.3, 5.9 | Open → ADR-0010 (BD4 makes it apply to GitHub-only too) |
| M14 | A | Hygiene "on (Standard), uncheckable". | D11 | 5.8 | Open → ADR-0013 |
| M15 | G | Quick has no `.env` read protection. | K non-neg. 5; D04 §1; D08 §3 | 3, 5.4 | ◐ BD6 adds `security` to phase 1; whether Quick includes it → ADR-0009 (BD5 Quick list excludes it) |
| M16 | A | `AGENTS.md` line budget can be exceeded in Full. | D04 §2–3 | 3 | Open → Y-3.2 |

### 1.6 Setup flow, form, distribution (block Steps 2, 3, 7)

| # | Sev | Finding | References | Blocks | Status |
|---|---|---|---|---|---|
| S1 | G | Claude plugin + marketplace (`/kickoff`) in no build step. | D02 §1; D09 §4; B | 3 / later | Open → `later`; Step 3 `init` works without `/kickoff` |
| S2 | G | Phase-1 CLI surface undefined; `init` vs. `apply`. | D01 §2, §4; D02; D09–D14 | 2 | ADR-0019 (Proposed) |
| S3 | A | Minimal Step 2 `init`. | B Steps 2, 3 | 2 | ADR-0019 (Proposed): `--answers <file> --yes`, `core` stub only |
| S4 | G | No release tag before v0.1; repo existence. | D01 §4; B Steps 2, 9 | 2 | ◐ repo ✅ BD12; pre-tag install via `--channel main` / `YAW_REPO` in ADR-0006 (Proposed) |
| S5 | C | `tests/` vs. `test/` vs. `examples/` dirs. | D01 §2; D05 §2, §4; B | 2 | ADR-0014 (Proposed): `test/`, `modules/*/tests/`, `examples/<profile>/` (not `test/profiles/`) |
| S6 | G | Form secret fields and design picker depend on non-phase-1 modules. | D02 §3; D08; K | 7 | Open → Y-7 (ADR) |
| S7 | G | Dev-tool ADR (`shellcheck`); JSON Schema subset. | B rule 3, Steps 1, 2 | 1, 2 | dev tools ADR-0008 (Proposed); schema subset ADR-0005 (Accepted) |
| S8 | A | Who creates remote, labels, issues, and when. | B rule 2 | 1 | ✅ BD12 |

---

## 2. ADR list

YAW's own ADRs live in `docs/adr/` until Step 5.6, then move to `.decisions/` (BD7).

| ADR | Title | Resolves | Needed by | Status |
|---|---|---|---|---|
| 0001 | YAML for human-edited files, JSON for kit-written files; strict subset parser + emitter; block scalars; YAML 1.2 core typing; comments dropped on rewrite with header comment; `github.yaml` / `taxonomy.json` exceptions | F1–F4 | Step 1 | **Decided** (BD1, BD2); written, Proposed (PR #87) |
| 0002 | Template engine: plain JS template functions vs. tiny built-in renderer | B Step 1 | Step 1 | Proposed (PR #87): tiny `<% %>` renderer |
| 0003 | Hash/merge strategy for `yaw update`: SHA-256, base store, `git merge-file`, keep/take/merge UX, `managed:false` | U2, U3 | Step 1 | Proposed (PR #87): `.yaw/base/` + `git merge-file` |
| 0004 | Shared-file composition and fragment ownership; just `import` vs. `mod`; `core` removability | U1, U6, M6 | Step 2 | Written, Proposed (Step 2 PR) |
| 0005 | JSON Schema subset and validator | S7 | Step 1 | Proposed (PR #87) |
| 0006 | Kit resolution, hook shim, versioning: shim location/format, fail-open, PATH independence, local pinned vs. global kit, pre-tag install; CI installs pinned tag | U4, H7, S4 | Step 2 | Written, Proposed (Step 2 PR); CI part **decided** (BD10) |
| 0007 | Hook output policy (token-free) | H1 | Step 4 | **Decided** (BD9); write up |
| 0008 | Runtime floor and platforms: Node ≥ 22.13, CI on 22 + 24, macOS + Linux (WSL), `node:sqlite` warning suppressed; dev-tool list (`shellcheck`) | H9, H10, S7 | Step 2 | **Decided** (BD11); written, Proposed (Step 2 PR) |
| 0009 | Terminology and preset contents: Quick (= Lean) per BD5; mode vs. saved setup; phase-1 Standard/Full contents; Quick question count; footprint; ADRs without `decisions`; `security` in Quick? | P1–P3, P6, P9, M15 | Step 3 | Partly decided (BD5, BD6) |
| 0010 | Task and record IDs per mode (BD4); branch names; recipe naming; ADR ID scheme; journal lines when `TASKS.md` is read-only | M4, M5, M11, M13 | Step 5.3 | Partly decided (BD4) |
| 0011 | Shared retrieval engine in `core/lib/` + Unicode-aware tokenizer | M1, M2 | Step 5.6 | Proposed |
| 0012 | Skill distribution to Claude: generated copies vs. symlinks; drift check | H5 | Step 4 | Proposed |
| 0013 | Personal vs. committed configuration; hygiene opt-out | M7, M14 | Step 5.1 | Proposed |
| 0014 | Kit repo and test layout (supersedes 0016 when accepted) | S5 | Step 2 | Written, Proposed (Step 2 PR) |
| 0015 | Phase-1 scope: `yaw.db` registry-only, `release-plan.yaml` + evaluation deferred, `pr-policy` open-issue check only, minimal `security` in, `quality-code` out, Gemini CLI phase 3, `node-cli` profile | F11, M9, P5, P6, H3, H6 | Step 1 | **Decided** (BD3, BD6, BD7, BD8); written, Proposed (PR #87) |
| 0016 | Step 1 code, schema and test layout (interim until ADR-0014) | S5 (part) | Step 1 | Proposed (PR #87) |
| 0017 | Format conventions: names, agent keys, facts vocabulary, question IDs, answers by ID, manifest fields | F6, F7, F8, F10 | Step 1 | Proposed (PR #87) |
| 0018 | Normalised hook event (no content) and session registry in `yaw.db` | H8, H10 | Step 1 | Proposed (PR #87) |
| 0019 | Phase-1 CLI surface and step-2 command behaviour (flags, non-TTY rules, remove of edited files, minimal `init`, renderer details) | S2, S3 | Step 2 | Written, Proposed (Step 2 PR) |

---

## 3. Phase 1 issue list

Conventions:

- IDs are placeholders (`Y-<step>.<n>`) until GitHub issues exist. Each step is one parent issue (one branch, one PR). Rows below it are sub-issues (B rule 2).
- Type follows D14 §1: Epic, Feature, Chore, Spike, Bug. Docs work is typed Chore.
- Priority: **P0** blocks the release or later steps, **P1** needed for v0.1, **P2** desirable for v0.1, **P3** may slip to `later`.
- Every Feature also has the implicit AC: `node --test` green on Node 22 and 24, no secrets in fixtures, zero runtime dependencies.

### Step 0 — Read, check, plan

| ID | Title | Type | Prio | Depends | Acceptance criteria |
|---|---|---|---|---|---|
| Y-0 | Step 0: plan and contradiction review | Epic | P0 | – | `docs/build/plan.md` approved by the user |
| Y-0.1 | Apply binding decisions to concept docs (**done**) | Chore | P0 | Y-0 | BD1–BD12 reflected in K and D01–D14 (Lean → Quick, Gemini phase 3, token-free rule, `node-cli`, `security` in phase 1, platforms); doc-only fixes (M10, H2 note) applied; each open finding points to its ADR or `later` |
| Y-0.2 | Repository bootstrap | Chore | P0 | Y-0, BD12 | `github.com/nickyreinert/yaw` exists (user-created or approved `gh repo create`); labels (incl. `later`), milestones and issues from this plan created by `gh`, idempotently (re-run creates nothing new); first commit contains docs only |

### Step 1 — Formats and schemas

Status: **implemented, awaiting the user's ADR review** (PR #87). All 24 example files validate; `node --test` 156/156 on Node 22.13.0, 22.21.1 and 24.22.0. Open: ADRs 0001–0003, 0005, 0015 (and 0016–0018) accepted by the user; Y-1.4 (acceptance); Y-1.6 fragment owner (needs ADR-0004, step 2).

| ID | Title | Type | Prio | Depends | Acceptance criteria |
|---|---|---|---|---|---|
| Y-1 | Step 1: formats and schemas | Epic | P0 | Y-0.1 | All schemas validate their example files; ADRs 0001–0003, 0005, 0015 accepted |
| Y-1.1 | ADR-0001 + ADR-0015 write-up (**done**) | Chore | P0 | – | ADR-0001 states the grammar per BD1 (incl. `\|`, `>`), YAML 1.2 core typing, emitter scope, header comment, rejected features with `file:line: message`; ADR-0015 records phase-1 scope |
| Y-1.2 | Strict YAML subset parser + emitter (**done**) | Feature | P0 | Y-1.1 | Parses maps, lists, scalars, quoted strings, flow collections, comments, block scalars `\|`/`>`. Rejects anchors, aliases, tags, multi-doc with file + line. `yes/no/on/off` and dates parse as strings. Emitter writes the "comments not preserved" header and round-trips every example file |
| Y-1.3 | ADR-0005 + JSON Schema subset validator (**done**) | Feature | P0 | – | Supported keywords documented; validator reports JSON-pointer path + source line for YAML input; test per keyword |
| Y-1.4 | ADR-0002 template engine (written; awaiting acceptance) | Chore | P0 | – | Options compared; decision accepted |
| Y-1.5 | ADR-0003 hash/merge strategy (**done**) | Chore | P0 | – | Covers hash input, base storage, merge tool, keep/take/merge UX, `managed:false`, deleted files, renamed templates |
| Y-1.6 | `manifest.json` schema + examples (done except fragment owner, pending ADR-0004) | Feature | P0 | Y-1.3 | Kit version (pinned tag, BD10), profiles, preset, agents, modules (+ options), task mode `local`/`github`/`both` (BD4), files (path, module, hash, managed, fragment owner per ADR-0004), vendor mode, MCP servers. Quick and Standard examples validate |
| Y-1.7 | `module.yaml` schema (+ item schema) (**done**) | Feature | P0 | Y-1.2, Y-1.3 | `agents` keys `claude`/`codex`/`copilot` (BD8; extensible); `support` native/partial/fallback/none; `tokenCost` none/low/medium; per-item overrides; `appliesTo` facts vocabulary (F7). Examples for `core`, `security`, comfort `session-hygiene` validate |
| Y-1.8 | `profile.yaml` schema (**done**) | Feature | P0 | Y-1.2, Y-1.3 | `suggestWhen`, `options`, `defaults` (incl. `auto`), `requires`. `python-cli` and `node-cli` examples validate |
| Y-1.9 | Question definition + `answers.yaml` schema (**done**) | Feature | P0 | Y-1.2, Y-1.3 | One question format for `interview/base.yaml` and modules (ID scheme per F6, mode Q/S/F, default, help, `agents`). `answers.yaml` incl. `proposal:` section; no secret fields possible |
| Y-1.10 | Normalised hook event schema (**done**) | Feature | P0 | Y-1.3 | Fields: agent, event, session id, model id (nullable, source documented), prompt length (no content), tool, result, timing. Mapping table Claude/Codex/Copilot drafted |
| Y-1.11 | Task ledger schema (**done**) | Feature | P1 | Y-1.3 | Per BD4: `TASKS.md` grammar (local source of truth, `T-NNN`); generated read-only view format for GitHub/team; Both-mode `T-NNN` + issue link. Example round-trips |
| Y-1.12 | `user-profile.yaml`, preset, `capabilities.yaml`, `.yaw/config.yaml` schemas (**done**) | Feature | P1 | Y-1.3 | Each with an example that validates |
| Y-1.13 | `github.yaml` schema (**done**) | Feature | P2 | Y-1.2, Y-1.3 | YAML, user-editable (BD2); labels/rules example validates |
| Y-1.14 | `~/.yaw/yaw.db` schema (session registry only) (**done**) | Feature | P2 | Y-1.3 | Per BD3: registry tables + migration version table only; created in a temp DB in a test; no ExperimentalWarning on stderr (BD11) |

### Step 2 — Kit skeleton, install, update

| ID | Title | Type | Prio | Depends | Acceptance criteria |
|---|---|---|---|---|---|
| Y-2 | Step 2: kit skeleton, install, update | Epic | P0 | Y-1 | install → init (empty) → update → remove passes in a temp-dir test; `install.sh` idempotent and `shellcheck`-clean |
| Y-2.1 | ADRs 0004, 0006, 0008, 0014 | Chore | P0 | Y-1 | Accepted; 0008 records BD11 |
| Y-2.2 | Kit repo layout + test runner + kit CI | Chore | P0 | Y-2.1 | Layout per D01 §2 (adjusted by ADR-0014); `node --test` on Node 22 + 24 and `shellcheck` in CI; macOS + Linux runners |
| Y-2.3 | `install.sh` | Feature | P0 | Y-2.2 | Checks git/node (≥ 22.13)/just, prints install hints, never installs; clones or fetches into `~/.yaw/kit`; `--tag <kit>` (BD10) and `--channel main`; links into `~/.local/bin` or prints a PATH line; no `sudo`; second run is a no-op; tested in a container |
| Y-2.4 | CLI entry (`bin/yaw`), arg parsing, `--version`, help | Feature | P0 | Y-2.2 | `parseArgs`-based; unknown command exits 1 with usage; phase-1 command list fixed (S2) |
| Y-2.5 | Render engine + manifest writer | Feature | P0 | Y-1.4, Y-1.6, Y-2.1 | Atomic writes; rejects paths escaping the project (traversal tests); every written file recorded with SHA-256 |
| Y-2.6 | `yaw update` keep/take/merge | Feature | P0 | Y-1.5, Y-2.5 | Unedited files updated silently; edited files show a diff and offer keep/take/merge; conflicts left marked and reported; non-interactive flag documented |
| Y-2.7 | `yaw remove <module>` | Feature | P0 | Y-2.5 | Deletes exactly the module's files/fragments after confirmation, unregisters its hooks, updates the manifest; test proves zero residue |
| Y-2.8 | `yaw self-update` + `self-uninstall` | Feature | P1 | Y-2.3 | Shows the changelog and switches the tag; uninstall removes kit and shim only, prints what remains |
| Y-2.9 | `yaw doctor` + `yaw status` | Feature | P1 | Y-2.5 | Doctor checks kit version vs. manifest pin, manifest consistency, shim reachability, Node ≥ 22.13, `just --list`; status prints the module/file table |
| Y-2.10 | Minimal `yaw init --answers --yes` (core only) | Feature | P0 | Y-2.5 | Renders the `core` stub from an answers file; used by the Y-2 end-to-end test |

### Step 3 — First vertical slice (`yaw init`, CLI lane, Quick with `core` only, two profiles)

| ID | Title | Type | Prio | Depends | Acceptance criteria |
|---|---|---|---|---|---|
| Y-3 | Step 3: first vertical slice | Epic | P0 | Y-2 | `yaw init` in an empty folder → `just check` passes; `core`-only result is a handful of files |
| Y-3.1 | ADR-0009 terminology + preset contents | Chore | P0 | Y-2 | Accepted; Quick = BD5 list; Standard/Full phase-1 contents fixed; D02/D04 updated in the same PR |
| Y-3.2 | `core` module | Feature | P0 | Y-3.1 | `AGENTS.md` assembled from `agentsMd` with the line budget enforced (M16); `CLAUDE.md` = `@AGENTS.md`; root `justfile` composing fragments per ADR-0004; removability per ADR-0004 |
| Y-3.3 | CLI interview engine (Quick subset) | Feature | P0 | Y-1.9 | Batches, `[default]`, `?` help, `skip`; skipped questions listed as "default" in the summary; nothing written before confirmation |
| Y-3.4 | Profile `python-cli` | Feature | P0 | Y-1.8 | `profile.yaml`, `standards.md`, just fragment with all verbs (n/a verbs exit 0), `guards.yaml`, `ci/check.yml`, scaffold, smoke test in a temp dir |
| Y-3.5 | Profile `node-cli` | Feature | P0 | Y-1.8 | Same parts as Y-3.4; Node ≥ 22.13, `node --test`, no deps (BD7) |
| Y-3.6 | Rule-based profile suggestion (`suggestWhen`) | Feature | P1 | Y-3.4, Y-3.5 | Picks the matching profile for an answers file without an LLM; deterministic test |
| Y-3.7 | `yaw init` pipeline (collect → confirm → apply → verify) | Feature | P0 | Y-3.2–Y-3.5 | Runs `just setup && just check` at the end; non-interactive mode reproducible (same answers → identical files and hashes) |
| Y-3.8 | Dogfooding: set this repo up with YAW (`node-cli`) | Chore | P1 | Y-3.7 | This repo has a YAW manifest; `just check` runs the kit tests; ADRs stay in `docs/adr/` (BD7) |

### Step 4 — Agent adapter layer and hook wrapper (+ Step 5.0 `security`)

| ID | Title | Type | Prio | Depends | Acceptance criteria |
|---|---|---|---|---|---|
| Y-4 | Step 4: adapters and hook wrapper | Epic | P0 | Y-3 | Recorded fixtures pass per agent; silent-hook tests pass; `security` guard blocks in Claude and Codex |
| Y-4.1 | ADRs 0007, 0012 | Chore | P0 | Y-3 | 0007 records BD9; 0012 accepted |
| Y-4.2 | `yaw hook <event>` dispatcher + project shim | Feature | P0 | Y-4.1, ADR-0006 | One entry point; per-agent normalisation to the Y-1.10 schema; dispatch to module handlers; fails open (exit 0, no output) when the kit is missing or a handler throws; timing recorded |
| Y-4.3 | Claude Code adapter | Feature | P0 | Y-4.2 | Settings rendering (hooks, permissions); fixtures in `test/fixtures/claude/<event>.json` for SessionStart, UserPromptSubmit, PreToolUse, Stop, Notification |
| Y-4.4 | Codex adapter | Feature | P0 | Y-4.2 | `.codex/hooks.json` rendering; trust note at init and in `yaw doctor`; fixtures; `apply_patch` covered for guards |
| Y-4.5 | Copilot adapter | Feature | P1 | Y-4.2 | Reads `.claude/settings.json` hooks; `sessionStart` context only; Copilot-only and no-double-firing behaviour per H4 ADR (test) |
| Y-4.6 | Skill rendering + `yaw sync --check` | Feature | P0 | ADR-0012 | Authored once in `.agents/skills/`; Claude copy per ADR-0012; check fails on drift; wired into `just check` |
| Y-4.7 | `yaw agents` compatibility matrix | Feature | P1 | Y-1.7 | Rendered from `module.yaml` + `capabilities.yaml` for enabled modules and selected agents |
| Y-4.8 | Silent-hook test harness | Chore | P0 | Y-4.2 | Asserts empty stdout + exit 0 for evaluation/metrics hooks; asserts no `additionalContext` for comfort hooks (BD9) |
| Y-5.0 | Minimal `security` module (built with Step 4) | Feature | P0 | Y-4.3, Y-4.4 | Denies reading `.env*` / secret files; blocks `rm -rf`, force push, prod deploy (`permissionDecision: deny`) in Claude and Codex; tests per guard; removable (BD6) |

### Step 5 — Phase-1 modules

Common AC for every row: installs, works for Claude + Codex (+ Copilot where the matrix says so), removable with zero residue, tests, correct manifest entries.

| ID | Title | Type | Prio | Depends | Extra acceptance criteria |
|---|---|---|---|---|---|
| Y-5 | Step 5: phase-1 modules | Epic | P0 | Y-4 | All sub-issues done; Quick complete after Y-5.3 (BD5) |
| Y-5.A | `yaw add <module>` | Feature | P0 | Y-2.5 | Asks only that module's questions; dependency violations reported, not auto-fixed |
| Y-5.1 | `communication` + `standards` | Feature | P1 | Y-5.A, ADR-0013 | ≈ 6 lines rendered from the profile; Claude output style only when non-default; profile overlay ≤ 20 lines; team-mode rule per ADR-0013 |
| Y-5.2 | `devenv` | Feature | P1 | Y-5.A | `just setup/dev`; `.env.example`; `.env*` git-ignored; Docker/devcontainer only when the profile advises it |
| Y-5.3 | `tasks` (local / GitHub / both) | Feature | P0 | Y-1.11, ADR-0010 | Per BD4: local `TASKS.md` source with `T-NNN`; GitHub/team issues as source with generated read-only `TASKS.md`; Both `T-NNN` + issue link. `just task …` recipes per ADR-0010; Claude Stop hook enforces the resume point; sync one-way and idempotent (recorded `gh` fixtures) |
| Y-5.4 | `git-hooks` (lefthook, gitleaks) | Feature | P1 | Y-5.A | Format/lint-staged/gitleaks on commit; a planted fake secret is blocked (test) |
| Y-5.5 | `github` + `ci` | Feature | P1 | Y-5.3 | Recipes per ADR-0010; guarded actions require authorisation; issue-type auto-detect with label fallback; `quality-gate.yml` installs the kit at the manifest tag (BD10) and runs `just check` |
| Y-5.6 | `decisions` (ADR + notices, recall hook) | Feature | P0 | ADR-0010, ADR-0011 | R D/E/F/K behaviour incl. N1–N12 upgrades listed in D04; R H4 test list passes; recall hook < 1 s, fails open; ID uniqueness in `just check`; German prompts retrieve correctly; this repo's `docs/adr/` migrated to `.decisions/` (BD7) |
| Y-5.7 | `sessions` (registry, trailer, `/handoff`) | Feature | P1 | Y-5.3, Y-5.6, Y-1.14 | Registry in `yaw.db` per BD3 / D12 §4; `Agent-Session` trailer; title from the active task; `yaw sessions find/for/resume`; registry git-ignored |
| Y-5.8 | `comfort`: hygiene, status line, notifications | Feature | P2 | Y-5.7, ADR-0007, ADR-0013 | Token-free per BD9 (test per hook); cooldown; `yaw hygiene off`; notifications only after N minutes; payload has no code/diff/secrets; personal config not committed |
| Y-5.9 | Team mode enforcement | Feature | P1 | Y-5.5 | Issue-required edit/commit guards in Claude and Codex; lefthook `commit-msg` / `pre-push`; `pr-policy` CI check = "PR links an open issue" only (BD3); `just gh-protect` applies and verifies rulesets; session-start sync per D14 §3 with offline fail-open and 5-min cache |

### Step 6 — Remaining profiles

| ID | Title | Type | Prio | Depends | Acceptance criteria |
|---|---|---|---|---|---|
| Y-6 | Step 6: remaining profiles | Epic | P1 | Y-5 | All 9 profiles green in the CI matrix (`yaw init` + `just check`) |
| Y-6.1 | `static-site` | Feature | P1 | Y-3.4 | Fixture project in `test/profiles/static-site/` + CI matrix job |
| Y-6.2 | `python-web` | Feature | P1 | Y-3.4 | same |
| Y-6.3 | `node-ts-vercel` | Feature | P1 | Y-3.4 | same |
| Y-6.4 | `php-web` | Feature | P2 | Y-3.4 | same |
| Y-6.5 | `wordpress-plugin` | Feature | P2 | Y-3.4 | same; `wp-env` in CI |
| Y-6.6 | `cloudflare-workers` | Feature | P2 | Y-3.4 | same; no remote calls in CI |
| Y-6.7 | `android-kotlin` | Feature | P2 | Y-3.4 | same; SDK cache; runner documented |
| Y-6.8 | Multi-profile composition (namespaced verbs) | Feature | P2 | ADR-0004 | Two profiles combined (`static-site` + `cloudflare-workers`); top-level verbs call both |

### Step 7 — Full interview and browser form

| ID | Title | Type | Prio | Depends | Acceptance criteria |
|---|---|---|---|---|---|
| Y-7 | Step 7: full interview and browser form | Epic | P1 | Y-5 | CLI and form produce identical answer files for the same choices; the form server rejects requests without the token and from non-local origins |
| Y-7.1 | Full CLI interview (0.0 agents, 1.5 solo/team, presets, expertise levels) | Feature | P1 | Y-3.3 | Agent choice: Claude, Codex, Copilot (others greyed out "phase 3", BD8); all Q/S/F questions of phase-1 modules; expertise levels per P7 ADR |
| Y-7.2 | User profile + saved setups (`~/.yaw/`, opt-in) | Feature | P1 | Y-1.12 | Opt-in prompt; `yaw presets list/show/delete`; history.jsonl; saved setups never hold secrets |
| Y-7.3 | Local form server | Feature | P1 | Y-2.4 | `127.0.0.1` only, random port, one-time token, Host/Origin checks (DNS rebinding), CSRF protection, 30-min idle shutdown, no external assets |
| Y-7.4 | Form UI (single page, live summary, module toggles) | Feature | P1 | Y-7.3 | Keyboard navigation; help blocks per expertise; *Save draft / Save as preset / Show diff / Apply* with a streamed log |
| Y-7.5 | CLI ↔ form parity test | Chore | P1 | Y-7.1, Y-7.4 | Byte-identical `answers.yaml` for scripted choices |
| Y-7.6 | Secret entry (hidden prompt / password field → `.env`) | Feature | P2 | S6 ADR | Values never in `answers.yaml`, logs or responses; test with a canary value |
| Y-7.7 | Form server security review | Spike | P0 | Y-7.3 | Tier A review; findings fixed or filed |

### Step 8 — Hardening review

| ID | Title | Type | Prio | Depends | Acceptance criteria |
|---|---|---|---|---|---|
| Y-8 | Step 8: hardening review (fresh session) | Epic | P0 | Y-7 | Findings fixed or filed with priority |
| Y-8.1 | Security review: hook shell quoting, render path traversal, token handling, secret leakage, CSRF/DNS rebinding | Spike | P0 | – | Written report; each finding has an issue |
| Y-8.2 | Token-free audit of all hooks | Chore | P0 | – | Every hook classified per BD9 / ADR-0007; tests prove it |
| Y-8.3 | Removal test of every module | Chore | P0 | – | Add + remove each module → tree equals the pre-add state |
| Y-8.4 | `yaw doctor` coverage | Chore | P1 | – | Doctor detects each failure mode the review lists |

### Step 9 — Release v0.1

| ID | Title | Type | Prio | Depends | Acceptance criteria |
|---|---|---|---|---|---|
| Y-9 | Step 9: release v0.1.0 | Epic | P0 | Y-8 | Tag `v0.1.0` exists; install from the tag verified |
| Y-9.1 | README (install, read-then-run variant, SHA256, quick start, Quick vs. Full, macOS/Linux/WSL, Node ≥ 22.13) | Chore | P0 | Y-3.1 | Matches the actual phase-1 preset contents |
| Y-9.2 | CHANGELOG | Chore | P1 | – | Keep-a-Changelog style for 0.1.0 |
| Y-9.3 | Clean-machine install check | Chore | P0 | Y-9.1 | `curl … install.sh \| bash` from the tag in clean macOS-like and Linux containers: `yaw --version`, `yaw init` Quick, `just check` green |

### Not in phase 1 (label `later`)

- Phase 2: `quality-code` reviewer, `yaw.db` evaluation tables + tier-1 evaluation, `release-plan.yaml` + launch plan + phase gating in `pr-policy`, ui-design, privacy, backup, knowledge, cache reminder, dashboard + OTel receiver.
- Phase 3: Gemini CLI + Antigravity adapters, Pi/Hermes adapters, remote loop, tier-2 decision models.
- Unplaced: Claude plugin + marketplace (S1), `business-logic`, `vendors`, `environments` (unless ADR-0009 places them).

---

## 4. Remaining open points

None need a user answer before Step 1. Per B rule 10 each is decided by the ADR named in §1 and listed in that step's summary. A question goes to the user only if an ADR changes scope, user-visible behaviour or security, or is hard to reverse. Likely candidates:

1. **ADR-0009:** Does Quick include minimal `security`? (BD5 Quick list excludes it; M15 leaves Quick without `.env` read protection.)
2. **ADR-0009:** Phase-1 contents of Standard and Full.
3. **ADR-0013:** Personal vs. committed config in team repos (M7).
