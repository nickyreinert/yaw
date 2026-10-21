# ADR-0010: Task and record IDs per mode, branch names, recipe naming, journal lines in GitHub mode; `tasks` module details

- Status: Proposed
- Date: 2026-10-21
- Issue: Y-5.3
- Resolves: M3, M4, M5, M11, M13 (`docs/build/plan.md` §1.5); applies BD4; extends ADR-0007

## Context

BD4 fixed where tasks live per mode and which IDs they use. Left open: branch names, recipe naming, the ADR ID scheme, where journal lines go when `TASKS.md` is a read-only view (M13), and the details of the `tasks` module (Y-5.3): what a Stop hook may do under BUILD.md rule 5, how a one-way idempotent sync works, what `just task` does in each mode.

## Decision

### IDs and names (M3, M4, M5, M11)

| Mode | Source | Task ID | Branch (Y-5.5 `just branch`) | ADR ID (Y-5.6) |
|---|---|---|---|---|
| local | `TASKS.md` | `T-NNN` | `<type>/T-012-<slug>` | `ADR-NNNN`, sequential |
| both | `TASKS.md`, mirrored to issues | `T-NNN` + `(#34)` | `<type>/T-012-<slug>` | `ADR-NNNN`, sequential |
| github, team | issues; `TASKS.md` generated | `#34` | `<type>/34-<slug>` (doc 14 §2) | solo `ADR-NNNN`; team `ADR-<issue#>-<n>` |

- `<type>` is the Conventional Commit type (`feat`, `fix`, `chore`, `docs`, ...). The branch carries the ID of the mode, so both the hook of Y-5.9 and `pr-policy` can read the issue from it (in both mode via the `(#n)` link in `TASKS.md`).
- `TASKS.md` is a generated, read-only view whenever tasks are GitHub-only (M3). Team mode (`idea.team` is not `solo`) forces `github`; the question `tasks.mode` is then not asked.
- Recipes (M5): `just task <verb>` for the ledger (this module); `just gh-*` for repository setup and `just branch`, `just commit`, `just pr` for the GitHub module (Y-5.5). Module recipes never reuse the uniform verbs (ADR-0004).

### `just task` and `yaw task`

- One recipe `task *args` (flat `import 'just/tasks.just'`, `[positional-arguments]` so quoted text survives) calls `yaw task "$@"`, using `yaw` on the PATH or the kit (`$YAW_KIT`, default `~/.yaw/kit`) like `sync-check`. The logic lives in `modules/tasks/lib/`; `core/cli/tasks.js` only loads it from the kit.
- Verbs: `list`, `next`, `start <id>`, `log <id> "text" [--resume "next step"] [--progress n]`, `done <id>`, `new "title"`, `sync`. `--resume` and `--progress` are additions to doc 10 so that the Stop rule (journal line, resume point, percentage) is one command.
- Local and both: `TASKS.md` is edited through the parsed ledger (`core/lib/tasks.js`, canonical rendering), so a hand-written file is normalised to the canonical form on the first command. `new` appends to the backlog with the next `T-NNN` (archive IDs count, so IDs are never reused); `start` moves a backlog item to Active (note becomes the model hint, resume point "Started; nothing logged yet."); `log` appends a dated journal line (local date); `done` removes the task from Active and appends `- T-012 (#34) Title — done YYYY-MM-DD` to `TASKS.archive.md` (created on demand). Deleting the plan file in `docs/plan/` stays a manual step; the command does not touch other files.
- GitHub mode: every verb talks to GitHub through `gh` and rewrites the view. `list`/`next` refresh the view first and fall back to the last view, with a note on stderr, when `gh` fails (offline). `start #n` assigns the user (`--add-assignee @me`). `new` creates an issue and prints `#n`. `done #n` posts a "ready for review" journal comment; the PR (`Closes #n`, Y-5.5) closes the issue. Branch creation and Project fields are not part of Y-5.3: `just branch` (Y-5.5) and the Status field (`project-add`, Y-5.5) own them, and Y-5.9 extends `start` for team mode.

### GitHub only: the view

- Active = open issues assigned to me (`gh issue list --assignee @me`). Status comes from a `status:in-progress|in-review|blocked|todo` label when present, else "in progress". Brief = first non-empty line of the body (clipped to 160 characters); spec = the milestone title; resume point and journal come from the journal comments (below).
- Backlog = the other open issues, ordered by `priority:P0..P3` label then number, at most 30 lines; note = `P2 · S` from the `priority:` and `estimate:` labels. Labels are only read; creating them is Y-5.5.
- `TASKS.md` is git-ignored in this mode (a per-person view that would otherwise cause merge noise) and `yaw remove tasks` keeps it once it differs from the kit's version, like any edited managed file.

### Journal lines when `TASKS.md` is read-only (M13)

- Journal lines and the resume point are issue comments that start with `<!-- yaw:journal -->`, then `YYYY-MM-DD text`, optionally a blank line and `Resume point: text`. `just task log #34 "text" --resume "..."` posts one; the view shows the last three lines and the latest resume point. `--progress` is ignored (sub-issue roll-up covers it, doc 14 §1).
- The Stop reminder is off in this mode: it would need the network.

### Both: one-way, idempotent sync

- `just task sync` reads all issues once (`gh issue list --state all --json number,title,state,body`) and then, per task: no `(#n)` and no issue with the marker `<!-- yaw:task T-012 -->` → `gh issue create`, number written to `TASKS.md`; marker found but no number (number lost) → re-linked; title or body differs → `gh issue edit`; issue closed but the task is open → `gh issue reopen`; archived task whose issue is open → `gh issue close`. A number whose issue is not found is reported and never recreated.
- The body is generated from the task (marker, brief, model, spec, resume point, progress, note, a "mirrored, edit in TASKS.md" line). Changes on GitHub are overwritten (one way). A second run with unchanged tasks makes no write call.
- Epics → milestones and status → Project field (doc 10 §1) wait for the GitHub module (Y-5.5): they need labels, milestones and `.yaw/github.yaml` that do not exist yet.
- Tests replay recorded `gh issue list --json` output (`modules/tasks/tests/fixtures/gh/`; the shape was taken from the project's own repository, the content is invented) through a stateful stand-in that follows `create`, `edit`, `close` and `reopen`.

### Hooks and token cost (BUILD.md rule 5)

- **SessionStart `session-start-task`, kind `context`, `tokenCost: low`.** The only model-visible output: up to three active tasks (id, title, status, percent, resume point clipped to 200 characters) and one instruction line, at most 10 lines (policy cap). No matcher, so it also runs on `resume`, `clear` and `compact` and on Codex, whose matcher translation (ADR-0021) would drop `clear`. Silent when nothing is active or the ledger does not parse.
- **Stop `stop-resume-point`, kind `comfort`, `tokenCost: none`.** Doc 10 says a Claude Stop hook "enforces" the resume point. A Stop block (`decision: block` with a reason) is read by the model, which BUILD.md rule 5 forbids outside SessionStart, so enforcement is the comfort form: a synchronous `systemMessage` for the user ("no journal line for today on T-012; just task log ..."), never `additionalContext`, never a block. The model learns the duty from the `AGENTS.md` rule (tier 2). The reminder fires when an active task has no journal line dated today, once per session and task (state in `~/.yaw/state/tasks-stop.json`, outside the project, last 50 sessions). Claude and Codex show it; Copilot has no user message on Stop (`support: none`).
- The ADR-0018 result `block` for Stop is therefore unused by this module.

### Files and installation

- Templates: `TASKS.md` (canonical empty ledger for the mode, so a fresh project has a valid file), `just/tasks.just`, a `justfile` part (`import`), an `AGENTS.md` section of at most six lines per mode, a `.gitignore` part in GitHub mode.
- The manifest records the effective mode in `modules.tasks.mode` (schema from ADR-0017); hooks and `yaw task` read it. It follows `answers.yaml` on `yaw update`. Switching mode later means editing `tasks.mode` in `answers.yaml` and running `yaw update`; an edited `TASKS.md` then goes through the usual keep / take / merge choice.
- Quick footprint: `TASKS.md` and `just/tasks.just` are new, so Quick is 16 files for Claude and 17 with Codex (ADR-0009 said "about 12 to 16").
- `yaw task` joins the command list of ADR-0019.

## Consequences

- Removal deletes `TASKS.md` when it is still the kit's version; a ledger with real tasks is kept and leaves the manifest. `TASKS.archive.md` and `~/.yaw/state/` are user data and kit state, never removed by `yaw remove`. The answer `tasks.mode` stays in `answers.yaml`; a re-add shows it as the default.
- Y-5.5 adds `just branch`, status labels and Project fields; Y-5.6 applies the ADR ID scheme; Y-5.7 reads the active task for session titles; Y-5.9 extends `start` and the session-start sync.
- Y-5.5 details (guarded actions, `just branch/commit/pr`, issue types, rulesets, `quality-gate.yml`): ADR-0027.
