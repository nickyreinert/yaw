# 10 — Tasks and GitHub

## 1. Task strategy (user chooses)

| Mode | Source of truth | GitHub use |
|---|---|---|
| **Local only** | `TASKS.md` | none (git may still be on GitHub) |
| **GitHub only** | Issues + milestones + optional Project board | `TASKS.md` is a generated read-only view; `just task next` reads from GitHub |
| **Both (local-first)** | `TASKS.md` | `just task sync` mirrors tasks to issues (one-way, with IDs linked); epics → milestones; status → Project field |

IDs: local only `T-NNN`; GitHub only and GitHub-backed team mode use issue numbers (`#123`); both uses `T-NNN` with the linked issue number. Teams without GitHub use local task IDs.

Version management (releases, tags, changelog) is independent of the task mode.

**Teams using GitHub force "GitHub only"**; `TASKS.md` becomes a generated read-only view of *my* open issues for the session start. Teams answering no to GitHub instead keep a local ledger, including when their Git remote is a repository in another folder (ADR-0047). With `project.number` configured, GitHub-mode `start` and `done` propose guarded Status updates to In progress and In review. Explicit `epics` mappings enable guarded milestone synchronization during `task sync` in GitHub and both modes. Without these settings there are no new remote calls. Local and both-mode `start`/`done` remain local-only.

Only `yaw:journal` comments authored by the repository owner are imported into the generated journal and resume point; a matching marker from another or missing author is not trusted. Organizational repositories do not treat ordinary members as the repository owner. The generated view is ignored as `/TASKS.md`, not every nested ledger; an edited view retained on module removal keeps that ignore as user-owned configuration.

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
| `gh-protect` | Apply branch protection: required check name from CI, PR review count, no force-push; verifies afterwards. `--verify` only compares (team mode adds `pr-policy`, ADR-0031) | yes (`--verify`: no) |
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
- Dependabot config: `github-actions` plus each profile's declared `dependencyEcosystems` (`npm`, `pip`, `composer`, `gradle`), including development dependencies. Dependency-free `node-cli` adds no package ecosystem. Composed profiles use their profile subdirectory, not `/`. If a profile gains dependencies, update its metadata; existing custom manifests are not automatically scanned or installed.

### Optional task workflow configuration

```yaml
project: { number: 1 }
epics:
  - { issue: 42, milestone: "v0.2.0" }
```

`just task start #42` / `done #42` resolve the configured Project's actual Status options before making any changes. They preview the update and require a user typing `y` in a terminal; refusal also prevents the associated assignment/comment. `done` means In review, not issue closure. Project automation after merge remains user-configured; missing options or insufficient token scope are reported, not ignored.

`just task sync` previews missing milestone creation and assignments for explicitly mapped epics and their direct native sub-issues. It accepts a native Epic type or `type:epic`, paginates milestone/child reads, refuses cross-repository children and conflicting mappings, and skips unchanged assignments. Titles are not inferred, nested descendants are not traversed, and no new release date is invented. Existing milestone assignments may be replaced only as shown in the confirmation plan. Partial API failures are explicit; rerun after checking what succeeded. No hooks perform these writes.

The forms require planning answers in the issue body. GitHub does not turn dropdown answers into labels, assign the named milestone or set Project fields automatically; the `issue-create` and `issue-triage` skills guide those confirmed updates.
- Job `secret-scan`: gitleaks over the history, binary pinned and SHA-256 verified (ADR-0027).
- The kit is installed at the tag in `.yaw/manifest.json` before `just setup` (BD10).
