# ADR-0023: `yaw add <module>`

- Status: Accepted
- Date: 2026-10-21
- Issue: #50 (Y-5.A)
- Resolves: implementation details of doc 02 §1 ("`yaw add <module>` later asks only that module's questions") and doc 04 §1 (dependency violations are shown, not silently fixed) (B rule 10)

## Decision

- **Questions:** only the module's own `questions` (never the base interview). Questions that already have an answer in `.yaw/answers.yaml` are asked again, with the previous answer as the default (`yaw remove` keeps the module's answers, so a re-add shows them). The setup mode of the project (`answers.yaml#mode`) decides which questions are shown, as in `init`; the others take their default (the previous answer if any) and are listed as "default". `when` conditions see the existing answers plus the new ones.
- **Non-interactive:** `--yes` asks nothing and takes every default (listed as "default"). Without a terminal and without `--yes` the command refuses.
- **Dependencies:** every module in `depends` must already be installed. Otherwise the command fails with the missing names and the `yaw add` commands to run; it changes nothing and never installs them.
- **Order:** interview, then a summary (new answers, new files) and a confirmation (skipped by `--yes`), then one write. The new module is rendered first; `answers.yaml` is written only after the render succeeded and restored if reconcile fails.
- **Answers file:** answers that are new or changed are merged into `answers.yaml` (rewritten by the emitter, so comments are dropped, ADR-0001). When nothing is new or changed (no questions, or a re-add with unchanged answers) the file is not touched and stays byte-identical. Its manifest entry (`managed: false`) gets the new hash.
- **Files:** the project is re-rendered with the enabled modules plus the new one and reconciled like `update` (same keep / take / merge handling for existing files, `--strategy`). Manifest entries and bases follow ADR-0003. `yaw remove` is the inverse: it deletes the module's files, fragments and hooks; the user's answers stay in `answers.yaml`.
- **Not done:** no kit-version bump rules beyond `update` (the older-kit check applies), no `proposal.modules` rewrite (it records the proposal, not the current state).

## Consequences

- `applyModules` takes optional new answers; `renderProject` takes an optional answers document. `runInterview` takes `known` answers for `when`.
- A module with only S/F questions asks nothing in a Quick project; its defaults apply.
