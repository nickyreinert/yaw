# Module rules in AGENTS.md: full wording

`AGENTS.md` has a hard limit of 80 lines (ADR-0009, ADR-0032). A module's `agentsMd` is one dense line where the module has more to say; this page keeps the full rules. The module's `just` recipes and skills carry the details at run time.

## github

- Git and GitHub work goes through `just branch`, `just commit`, `just pr`, `just pr-status` and `just gh-issue`; they keep branch names, footers and PRs uniform.
- Guarded: `gh-init`, `gh-labels`, `gh-protect`, `project-add`, `release` and the first push in `just pr`. They run only when the user types `y` in a terminal; ask the user to run them and never try to work around that.
- There is no recipe to merge, force-push, delete a branch or change repo visibility: the user does those.

## decisions

- Decision retrieval: `just decisions recall "<the task in one line>"` (add `--path <file>` for files you will change); apply matching decisions, weigh notices, cite their IDs in your summary or say none applied.
- Record lasting choices as ADRs and unresolved security / business-logic / privacy risks as notices with `just decisions record ...` (`just decisions` lists the options); change a decision by recording a new one with `--supersedes`.
- `.decisions/*.md` are the truth; after editing one by hand run `just decisions rebuild`.

## sessions

- Before `/clear` or a topic change run the `handoff` skill: it logs the resume point and records the session (`just sessions handoff`).
- `just commit` adds an `Agent-Session` trailer. To find the conversation behind a task, decision, commit or file: `just sessions for <T-012|ADR-0004|hash|path>`; by words: `just sessions find "<words>"`.

## ci

- CI (`.github/workflows/quality-gate.yml`) runs `just check` and a gitleaks scan; its job names `quality-gate` and `secret-scan` are what the branch ruleset requires, so do not rename them.
- Actions are pinned by commit SHA; change them only through the Dependabot pull requests.
