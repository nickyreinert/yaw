# ADR-0019: Phase-1 CLI surface and the behaviour of the step-2 commands

- Status: Accepted
- Date: 2026-10-20
- Issues: #23 (Y-2.4), #24 – #29 (Y-2.5 – Y-2.10)
- Resolves: S2, S3 (`docs/build/plan.md` §1.6); fixes the flag names left open by ADR-0003; records the rule-10 details of step 2

## Context

The docs name many `yaw` commands across docs 01–14 but no list (S2), leave the minimal step-2 `init` open (S3), and ADR-0003 left its flag names to Y-2.4. Implementing step 2 also needed small decisions the docs do not cover (B rule 10); they are recorded here so later steps do not drift.

## Decision

### Command list (phase 1, fixed)

| Command | Step | Purpose |
|---|---|---|
| `init` | 2 (minimal), 3 (interview) | collect → propose → confirm → apply → verify (doc 02 §1) |
| `update` | 2 | re-render managed files (ADR-0003) |
| `remove <module>` | 2 | remove a module and exactly its files (ADR-0004) |
| `status` | 2 | modules and files with their state |
| `doctor` | 2 | checks (below) |
| `self-update`, `self-uninstall` | 2 | kit lifecycle (ADR-0006) |
| `help [<command>]`, `--version` | 2 | – |
| `apply` | 3 | the APPLY step alone, from `.yaw/answers.yaml` (doc 02 §1); `init` = full pipeline |
| `add <module>` | 5 (Y-5.A) | add a module, asking only its questions |
| `hook`, `sync`, `agents` | 4 | hook entry point, skill rendering (`--check`), compatibility matrix |
| `config`, `gh`, `decisions`, `sessions`, `session`, `session-start`, `hygiene`, `notify` | 5 | module commands named in docs 11, 12, 14, BD1 |
| `presets` | 7 | saved setups |

Phase-2/3 commands (`ui`, `data`, `eval`, `report`, `remember`, `cache-timer`, `remote`, `profile new`) are not in the phase-1 list. A planned command prints "comes with step N" and exits 1.

### Conventions

- Arguments are parsed with `node:util` `parseArgs` in strict mode. Unknown command or option: message and usage on stderr, exit 1. `yaw` alone, `--help`, `help` print the usage (exit 0).
- Exit codes: 0 success; 1 for every error, refusal, cancelled confirmation, `update`/`remove` that left merge conflicts, and `doctor` with a failed check.
- Project commands run in the current folder (the project root); there is no search upwards.
- Prompts appear only when stdin is a terminal. Without one, `update` behaves like `--yes` (and says so); `remove` and `self-uninstall` require `--yes`.

### `yaw update` (ADR-0003 flags)

`yaw update [--yes] [--strategy keep|take|merge] [--restore <path>]… [--forget <path>]…`. Details beyond ADR-0003:

- An edited file whose content already equals the new render is re-based silently (no question).
- An existing file at a new output path that the manifest does not know (first `init` into a non-empty folder, renamed template): identical content is adopted silently; otherwise "edited, template changed" without a base, i.e. keep / take only; `--strategy merge` then keeps and says why.
- `managed: false`: a template change is reported once with the diff; the manifest hash then moves to the new render, so the next update does not repeat it.
- The diff is `git diff --no-index` labelled `current/<path>` and `new/<path>`; conflict markers are labelled `yours`, `base`, `kit <version>`. A file with conflict markers counts as "conflict" in `status` and fails `doctor` until the markers are gone.
- `--restore` and `--forget` take one path each, may be repeated, and accept only managed files that are missing on disk (anything else is an error before any file is touched).
- `--strategy take` is the confirmation; it overwrites without a second question. Interactive "take" asks once more.

### `yaw remove <module>`

`yaw remove <module> [--yes] [--strategy keep|take|merge]`:

- Shows the plan (files to delete, shared files whose part goes away, files kept as yours), then asks once (or `--yes`).
- Unedited files are deleted, folders left empty are removed, base copies and manifest entries go, the module's key is removed from `manifest.modules`. Shared files are re-rendered without the module (ADR-0004), through the update flow.
- Edited files of the module: interactive → asked one by one; `--yes` → kept, dropped from the manifest and listed as "kept, owned by you"; `--strategy take` → deleted. Non-interactive runs never delete user edits without an explicit flag, as in ADR-0003.
- Dependency and `core` rules: ADR-0004.

### `yaw init` in step 2 (S3)

- Only `yaw init --answers <file> --yes`; without both, it exits 1 and says the interview comes with step 3.
- The answers file must validate (`answers.schema.json`) and contain `user.agents` and `proposal.profiles` (the manifest needs them). It is copied byte for byte to `.yaw/answers.yaml` (comments kept) and recorded as `managed: false`, owner `core`.
- Renders only the `core` stub (`AGENTS.md`); profiles are recorded in the manifest but rendered from step 3. Refuses when `.yaw/manifest.json` exists.

### Template renderer details (ADR-0002)

- `if` and `each` on a missing path are errors, like `<%= %>`; the context is prepared in JS, so every key exists.
- `null` renders as empty text; lists and objects in `<%= %>` are an error; numbers and booleans render with `String()`.
- Answers are nested by question group in the context: `idea.text` is `answers.idea.text`.

### `yaw doctor` and `yaw status`

- `doctor`: Node ≥ 22.13, git, just (warn), `yaw` on `PATH` resolves to this kit (warn), kit version and channel; in a project: manifest valid, kit vs. pin (ADR-0006), modules present in the kit, missing files, conflict markers (fail), base copies present and matching, `just --list` when a `justfile` exists. The project hook shim check is added with the shim in Y-4.2.
- `status`: pinned and installed kit, preset, profiles, agents; per module the file count and the shared files it has parts in; per file path, owner, state (`unedited`, `edited`, `conflict`, `missing`, `owned`) and fragment modules.

## Consequences

- Later steps add commands by filling in a row that already exists; adding a new phase-1 command needs an ADR update.
- The step-2 `init` is deliberately narrow; step 3 replaces it with the full pipeline without changing the files it writes.
