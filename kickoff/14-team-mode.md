# 14 — Team Mode

Activated by interview question 1.5 = team. Team mode changes defaults and turns several conventions into **enforced rules**. Solo projects are unaffected.

| Topic | Solo | Team |
|---|---|---|
| Task source | local / GitHub / both | **GitHub only** (issues + sub-issues + Project), `TASKS.md` becomes a generated, read-only view |
| Work without issue | allowed | **blocked** |
| Branching | optional | **required**: `<type>/<issue>-<slug>` from fresh `origin/<default>` |
| PR | optional | **required**, must reference an issue, reviews required |
| Session start | task ledger | **fetch/sync + my open tickets + phase of the release plan** |
| Release planning | optional | launch plan with phases and freeze rules |

## 1. Issue model

GitHub-native building blocks, all via `gh` (and `gh api` GraphQL where the CLI has no command):

| Concept | GitHub feature | Notes |
|---|---|---|
| Epic | Issue of type *Epic* with **sub-issues** | Progress roll-up comes from sub-issues |
| Feature / Bug / Chore / Spike | Issue types (org) or `type:*` labels (user repos) | Detected at setup, fallback to labels |
| Release / phase | **Milestone** with due date | One per launch phase (section 4) |
| Planning fields | **GitHub Project** custom fields | `Status`, `Priority` (P0–P3), `Estimate` (XS/S/M/L/XL or points), `Iteration` (sprint), `Start`, `Target` |
| Ownership | Assignees, `CODEOWNERS` | |
| Definition of Ready | Issue form + CI check | type, priority, estimate, milestone, acceptance criteria present |

Generated files:

- `.github/ISSUE_TEMPLATE/{feature,bug,chore,spike,epic}.yml` (issue forms with required priority, estimate, acceptance criteria; layperson help text).
- `.yaw/github.yaml`: project number, field IDs, option IDs (resolved once by `yaw gh setup`, so recipes need no lookups).

Skills and recipes (agent-agnostic, `just gh-*`):

| Recipe / skill | Does |
|---|---|
| `issue-create` | Interview-style issue creation: type, title, user story, acceptance criteria, priority, estimate, milestone, parent epic; adds to Project with fields |
| `issue-triage` | Lists issues failing the Definition of Ready and proposes fixes (estimate, priority, milestone) for confirmation |
| `epic-plan` | Breaks an epic into sub-issues with estimates; checks sum against the milestone's remaining capacity |
| `just task start <#>` | Assign me, Status → In progress, branch from fresh origin, optional worktree, session link |
| `just pr` | Push, open draft PR with `Closes #<n>`, template filled (checks, ADR IDs, migrations) |
| `just task done` | Status → In review; after merge the Project automation moves it to Done |

## 2. Enforcement: no change without issue, no PR without issue

Defence in depth; only the last two layers are binding for every agent and every human.

| Layer | Rule | Applies to |
|---|---|---|
| Agent hook (`PreToolUse` on edit tools, Codex `apply_patch`, Copilot `preToolUse`, Gemini `BeforeTool`, Pi `tool_call`, Hermes `pre_tool_call`) | Deny edits while on the default branch or on a branch without an issue number: *"Run `just task start <#>` first."* | agents |
| Agent hook (`PreToolUse` on shell) | Deny `git commit` / `git push` to the default branch, `--force` to shared branches | agents |
| Git hooks (`lefthook`) | `commit-msg`: requires `#<n>` or `Refs #<n>`; `pre-push`: refuses pushing to the default branch | everyone locally |
| CI required check `pr-policy` | PR links an issue (`closingIssuesReferences` non-empty), linked issue passes Definition of Ready, branch name matches, phase rules (section 4). Phase 1 enforces only "PR links an open issue"; the rest comes in phase 2 | everyone |
| Branch protection / rulesets | PR required, N approvals, required checks (`quality-gate`, `pr-policy`), no force-push, optional linear history | everyone |

`just gh-protect` applies and verifies the rulesets (guarded action, needs repo admin).

## 3. Session start in a team

A `SessionStart` hook (or equivalent per agent) runs `yaw session-start`, which:

1. `git fetch --prune origin`.
2. **Sync policy, safe by default:**
   - on default branch, clean, behind → `git pull --ff-only` automatically;
   - on a feature branch, behind its upstream → `git pull --ff-only` if possible;
   - default branch moved ahead of the feature branch → report "N commits behind main", suggest `just sync` (rebase or merge per team ADR); never automatic;
   - dirty tree or diverged → no automatic action; a lock flag makes the edit guard deny edits until `just sync` resolves it.
3. Shows the user (zero tokens, `systemMessage` or terminal):
   - my open issues sorted by priority and iteration, with estimate and target date;
   - PRs waiting for my review; my PRs with failing checks or requested changes;
   - current milestone/phase, days to the next gate, freeze status.
4. Gives the model a compact version (≤ 10 lines, once per session, configurable off): active issue, branch status, phase rules.

`gh` results are cached for 5 minutes in `~/.yaw/cache/` to keep startup fast; the hook fails open when offline (shows "offline, last sync …").

Agent support: Claude `SessionStart` (runs in background, context reaches the first turn), Codex `SessionStart`, Copilot `sessionStart` (`additionalContext`), Gemini/Antigravity `SessionStart`, Pi `session_start` + `before_agent_start`, Hermes `on_session_start` + `pre_llm_call`. Fallback: `just start` as the documented first command.

## 4. Launch plan and milestone strategy (phase 2)

Source of truth `.yaw/release-plan.yaml`, rendered to `docs/plan/launch-plan.md` and synced to GitHub milestones (`just plan-sync`).

```yaml
release: v1.0
launch: 2027-03-01
phases:
  - { name: discovery,      until: 2026-11-15, allow: [spike, feature, chore, bug] }
  - { name: mvp,            until: 2027-01-10, allow: [feature, chore, bug] }
  - { name: beta,           until: 2027-02-01, allow: [feature, bug, chore], requires: [beta-feedback-triage] }
  - { name: feature-freeze, until: 2027-02-15, allow: [bug, chore, docs], exception_label: freeze-exception }
  - { name: code-freeze,    until: 2027-03-01, allow: [bug], only_priority: [P0, P1], exception_label: release-blocker }
  - { name: launch,         on: 2027-03-01, checklist: docs/plan/launch-checklist.md }
  - { name: post-launch,    until: 2027-03-31, allow: [bug, chore], hotfix_branch: "hotfix/*", focus: stabilisation }
```

What the plan drives:

| Mechanism | Effect |
|---|---|
| `pr-policy` CI check | Rejects PRs whose linked issue type is not allowed in the current phase, unless the exception label was set by someone in `CODEOWNERS`/leads |
| Session start | Shows phase, days left, and the phase rule in one line |
| `release-planner` skill | Creates/adjusts the plan with the user, maps epics to milestones, computes capacity vs. open estimates (simple burndown), flags risks: unestimated issues, P0 count, scope creep after freeze |
| Launch checklist | Generated from enabled modules: privacy checklist (doc 07), backup restore test, performance budgets, store/hosting steps, rollback plan, monitoring, announcement |
| Post-launch | Hotfix flow: `hotfix/<#>` from the release tag, fast-tracked review, back-merge to default branch |

Interview additions (team mode, section 12 of doc 03): team size and roles (leads, reviewers), approvals per PR, estimate unit, priority scheme, iteration length, launch date, phases to use (pick from the template above), merge strategy (squash / rebase / merge), worktrees per task yes/no.

## 5. Shared vs. personal configuration

| Committed (team) | Personal (not committed) |
|---|---|
| `AGENTS.md`, adapters, `.claude/settings.json`, hooks, skills, `.yaw/manifest.json`, `.yaw/github.yaml`, `.yaw/release-plan.yaml`, `.decisions/` | `.claude/settings.local.json`, comfort features, notifications, status line, user profile, session registry, dashboard data, secrets |

Additional team rules:

- Decision records change only via PR; ADR IDs use a collision-safe scheme in team mode (`ADR-<issue#>-<n>` or date-based), plus the uniqueness check in `just check` (blueprint N11).
- The kit version is pinned in the manifest; `yaw update` happens in its own PR so everyone moves together.
- Agent-specific files for agents nobody in the team uses are not generated (agent checkboxes are per project).
