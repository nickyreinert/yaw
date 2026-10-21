# 10 — Tasks and GitHub

## 1. Task strategy (user chooses)

| Mode | Source of truth | GitHub use |
|---|---|---|
| **Local only** | `TASKS.md` | none (git may still be on GitHub) |
| **GitHub only** | Issues + milestones + optional Project board | `TASKS.md` is a generated read-only view; `just task next` reads from GitHub |
| **Both (local-first)** | `TASKS.md` | `just task sync` mirrors tasks to issues (one-way, with IDs linked); epics → milestones; status → Project field |

IDs: local only `T-NNN`; GitHub only and team mode use issue numbers (`#123`); both uses `T-NNN` with the linked issue number.

Version management (releases, tags, changelog) is independent of the task mode.

**Team mode (doc 14) forces "GitHub only"** with issue types, sub-issues, Project fields (priority, estimate, iteration, dates) and milestones per launch phase; `TASKS.md` then becomes a generated read-only view of *my* open issues for the session start.

## 2. `TASKS.md`: the first stop of every session

Small, scannable. Detail lives elsewhere and is linked.

```markdown
# Tasks

## Active
### T-012 Online invite flow — in progress (60 %)
- **Brief:** Host creates 9-digit token, guest joins with token + name.
- **Model / effort:** strong / high
- **Spec:** docs/plan/invite-flow.md · Issue #34 · ADR-0004
- **Resume point:** Signaling server done and tested; next: guest join screen (`src/ui/join.ts`).
- **Journal:**
  - 2026-10-19 server token generation + expiry, tests green
  - 2026-10-20 WebRTC handshake via PeerJS, manual test OK

## Backlog
- T-013 Prop mode: book → shield — small / cheap · docs/plan/props.md
- T-014 Sound effects — small / cheap

## Done → TASKS.archive.md
```

Rules (in `AGENTS.md` via the tasks module):

- Start of session: read *Active*; continue from the resume point unless told otherwise.
- Every active task has: brief, model/effort suggestion, link to spec/plan/issue, resume point, dated journal.
- On stop: append journal line, update resume point and percentage (`just task log T-012 "text" --resume "next step" --progress 60`). The Claude and Codex `Stop` hook reminds the user (user-visible only, never a block: BUILD.md rule 5); tier-2 rule for the model and for Copilot (ADR-0010).
- Done = implemented + `just check` green + reviewed; then move a one-line entry to `TASKS.archive.md` and delete the plan file in `docs/plan/` (spec updates go to `docs/spec/`).
- IDs `T-NNN`, stable across sync; GitHub issue number stored next to it.

`just task` helpers: `list`, `next`, `start T-012`, `log T-012 "text"`, `done T-012`, `new "title"`, `sync` (ADR-0010: in GitHub mode they take issue numbers and journal lines are issue comments; the view `TASKS.md` is git-ignored).

## 3. GitHub scripts (github module)

All via `gh` CLI, wrapped as `just gh-*` recipes; agents use these instead of ad-hoc commands.

| Recipe | Does | Guarded |
|---|---|---|
| `gh-init` | Create repo (public/private), push, set default branch, labels, PR template | yes (creates remote) |
| `gh-labels` | Create or update the labels of `.yaw/github.yaml` (never deletes; no `type:*` label where the repo has the native issue type) | yes |
| `gh-issue <type> "title"` | Create an issue: native issue type if the repo has it, else the `type:*` label (doc 14 §1) | no |
| `gh-protect` | Apply branch protection: required check name from CI, PR review count, no force-push; verifies afterwards | yes |
| `branch <T-id> <slug>` | `feat/T-012-invite-flow` from up-to-date main | no |
| `commit` | Conventional Commit with task ID footer; runs git hooks | no |
| `pr` | Push branch, open/update PR with template filled (summary, checks run, ADR IDs, migration notes) | push yes (first time) |
| `pr-status` | CI status + review state | no |
| `release <version>` | Changelog, tag, GitHub release (or release-please if chosen) | yes |
| `issues-sync` | Task sync (mode "both"): `just task sync` (ADR-0010) | yes |
| `project-add` | Add issue to Project board, set status field | yes |

Guarded = needs explicit authorisation: the plan is printed, then a person types `y` in a terminal; there is no `--yes` and no way for a script or agent to answer (ADR-0027; stricter than the autonomy setting, which does not relax it). There is no recipe for any of the "Never" actions below, nor for merging. Never: force-push to shared branches, deleting remote branches with open PRs, changing repo visibility, without explicit confirmation.

## 4. CI module

- One workflow `quality-gate.yml`: checkout → toolchain from profile `ci/check.yml` → `just check`. Job name is the contract with branch protection.
- Least-privilege `permissions`, concurrency cancel, timeout.
- Optional: PR check that the description cites ADR/notice IDs or "no matching record" (when decisions module is on).
- Dependabot config: `github-actions` (the actions are pinned by SHA); per profile ecosystem later (ADR-0027).
- Job `secret-scan`: gitleaks over the history, binary pinned and SHA-256 verified (ADR-0027).
- The kit is installed at the tag in `.yaw/manifest.json` before `just setup` (BD10).
