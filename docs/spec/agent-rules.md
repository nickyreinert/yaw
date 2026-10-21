# Module rules in AGENTS.md: full wording

`AGENTS.md` has a hard limit of 80 lines (ADR-0009, ADR-0032). A module's `agentsMd` is one dense line where the module has more to say; this page keeps the full rules. The module's `just` recipes and skills carry the details at run time.

## github

- Git and GitHub work goes through `just branch`, `just commit`, `just pr`, `just pr-status` and `just gh-issue`; they keep branch names, footers and PRs uniform.
- Guarded: `gh-init`, `gh-labels`, `gh-protect`, `project-add`, `release` and the first push in `just pr`. They run only when the user types `y` in a terminal; ask the user to run them and never try to work around that.
- There is no recipe to merge, force-push, delete a branch or change repo visibility: the user does those.

## decisions

- Decision retrieval: `just decisions recall "<the task in one line>"` (add `--path <file>` for files you will change); apply matching decisions, weigh notices, cite their IDs in your summary or say none applied.
- Record lasting choices as ADRs and unresolved security / business-logic / privacy risks as notices with `just decisions record ...` (`just decisions` lists the options); change a decision by recording a new one with `--supersedes` (supersede, never edit).
- `.decisions/*.md` are the truth; after editing one by hand run `just decisions rebuild`.

## sessions

- Before `/clear` or a topic change run the `handoff` skill: it logs the resume point and records the session (`just sessions handoff`).
- `just commit` adds an `Agent-Session` trailer. To find the conversation behind a task, decision, commit or file: `just sessions for <T-012|ADR-0004|hash|path>`; by words: `just sessions find "<words>"`.

## ci

- CI (`.github/workflows/quality-gate.yml`) runs `just check` and a gitleaks scan; its job names `quality-gate` and `secret-scan` are what the branch ruleset requires, so do not rename them.
- Actions are pinned by commit SHA; change them only through the Dependabot pull requests.

## git-hooks

- Git hooks (lefthook) run `just fmt`, `just lint` and a gitleaks scan of the staged changes on every commit, for every agent and for you; install them once with `just hooks-install`.
- If gitleaks blocks a commit, remove the secret from the staged files (rotate it if it was ever pushed); never bypass the hook with `--no-verify`.

## code-map

- Read `docs/code-map.md` first (or `just map show <area>` for a bounded view), then verify the guidance against the implementation, its callers and its tests, and search wider when the map does not cover the question. The map is coarse: it lists areas, directories, entry points, tests, relationships and ADRs, not symbols.
- After adding, moving or deleting directories run `just map update`, then review the descriptions of the areas it names (no wording change is a valid outcome). `just map check` (part of `just check`, and a pre-commit job with `git-hooks`) is read-only and proves mechanical freshness only, not that the explanations are still true.
- The text outside the `yaw:map` markers is yours and is never rewritten; the local index lives in `~/.yaw/cache/code-map/` and can be deleted at any time.
