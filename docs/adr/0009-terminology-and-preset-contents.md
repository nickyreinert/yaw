# ADR-0009: Terminology and preset contents (Quick / Standard / Full)

- Status: Proposed
- Date: 2026-10-20
- Issue: #31 (Y-3.1); implemented in #32 – #37
- Resolves: P1, P2, P3, P6, P9, M15, M16 (`docs/build/plan.md` §1.3, §1.5)

## Context

Docs 01–04 use "preset" for three things (the setup mode, a saved setup, a module preselection), call the smallest mode "Lean" and "Quick", promise "3–5 essentials" and "≈ 5–8 files" for it, and leave open what Standard and Full contain in phase 1, where decisions are recorded when `decisions` is not installed, and what happens when the assembled `AGENTS.md` grows. BD5 fixed Lean = Quick and its module list. Step 3 builds `core` only, so the rest of Quick arrives in steps 5.1 – 5.3.

## Decision

### Terminology

| Word | Meaning | Where it is stored |
|---|---|---|
| **mode** | How deep the interview goes and which modules are preselected: `quick`, `standard`, `full` (BD5: "Lean" is Quick) | `answers.yaml#mode`; copied to `manifest.json#preset` (the field keeps its name, ADR-0017 §8) |
| **saved setup** (UI word "preset") | Answers saved for reuse | `~/.yaw/presets/` (step 7) |
| **module preselection** | `module.yaml#default` per mode | the module |

Docs say "mode" for the first and "saved setup" for the second; "preset" is used only in `yaw presets`, the `~/.yaw/presets/` folder and the manifest field.

### Contents

| Mode | Modules in phase 1 |
|---|---|
| **Quick** | `core`, `communication`, `standards`, `devenv`, `tasks` (BD5). Step 3 builds `core`; Quick is complete after 5.3 |
| **Standard** | Quick + `git-hooks`, `github`, `ci`, `decisions`, `security` (minimal, BD6), `sessions`, `comfort` (hygiene + status line) |
| **Full** | Standard + the questions marked F (governance strictness, budgets, roles), team-mode options, `comfort` items asked one by one |

Not in phase 1, labelled `later`: `quality-code`, `performance`, `business-logic`, `ui-design`, `privacy`, `backup`, `environments`, `vendors`, `knowledge`, `dashboard`, `evaluation`, `remote`. Their rows in doc 04 §1 stay as the target.

### `security` in Quick (M15)

Quick keeps the BD5 list and does **not** include `security`. Quick still tells the agent not to read or print secrets (a line in `core`'s `agentsMd`); there is no blocking hook in Quick. Adding `security` to Quick is a one-line change of `default.quick` in its `module.yaml` (asked as a question in the step 3 report).

### Quick question count (P2)

A question is marked Q only if the answer is used by a Quick module or by the profile suggestion. Quick asks the Q questions of the enabled modules, in batches of at most six per section, then the profile (suggested, confirmed by the user). With `core` alone that is eight: agents, experience, chat language, autonomy, idea, solo/team, language, where it runs. Each further Quick module adds only its own Q questions. Doc 02's "3–5 essentials" becomes "the Q questions of the enabled modules, defaults one Enter away".

### Footprint (P3)

The footprint counts the files a user sees: everything the manifest lists, without the `.yaw/base/` copies (kit bookkeeping, ADR-0003). `core` plus one CLI profile is **at most 12 files** (10 for node-cli and for python-cli), including the manifest, the answers and the scaffold. Complete Quick is "about 12 – 16 files". The "≈ 5–8 files" of doc 02 is replaced by these numbers.

### ADRs without `decisions` (P9)

Quick has no `decisions` module, so APPLY records no ADRs. The proposal (summary, rejected alternatives) stays in `.yaw/answers.yaml#proposal`. When `decisions` is added (`yaw add decisions`, step 5.6) it creates provisional ADRs from `proposal.rejected`.

### `AGENTS.md` budget (M16)

The assembled `AGENTS.md` has a **hard limit of 80 lines in every mode** (`AGENTS_MAX_LINES`). Rendering fails before anything is written if the limit is exceeded; the error names the lines per contributor. A module that needs more puts detail into `docs/spec/` or a skill (doc 04 §2). `module.yaml#agentsMd` stays at 5 lines (schema).

### Interview conventions (doc 03 intro)

- Enter takes the shown default and counts as an answer. `skip` takes the default and the summary lists the question as "default". Questions of a mode that is not asked are defaulted and listed the same way.
- Nothing is written before the user confirms the summary (`--yes` is that confirmation).
- A question missing from an answers file takes its default, also when `yaw init --answers` is used.

## Consequences

- Docs 02 §2 and 04 §1 are updated in the same PR (terminology note, footprint, mode contents).
- `yaw presets` stays reserved for saved setups (step 7); no command is called "preset" for modes.
- If the user wants `security` in Quick, it changes one default and the Quick footprint by the hook registration files (step 4/5.0).
