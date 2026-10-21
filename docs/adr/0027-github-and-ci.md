# ADR-0027: `github` and `ci` modules

- Status: Proposed
- Date: 2026-10-21
- Issue: Y-5.5 (#55); also closes #109 (gitleaks in the generated project's CI)
- Resolves: implementation details of doc 10 §3–4 and doc 14 §1–2 (B rule 10); applies ADR-0010 (recipe names, branch names), BD10 (CI installs the kit at the manifest tag)

## Decision

### Where the logic lives

- `yaw gh <verb>` (`core/cli/gh.js`, logic in `modules/github/lib/`), called by the recipes in `just/github.just`. Verbs: `init`, `labels`, `protect`, `branch`, `commit`, `pr`, `pr-status`, `release`, `project-add`, `issue`. Recipes: `gh-init`, `gh-labels`, `gh-protect`, `gh-issue`, `branch`, `commit`, `pr`, `pr-status`, `release`, `project-add` (ADR-0010 naming). `issues-sync` of doc 10 stays `just task sync` (Y-5.3).
- `gh` and `git` are called with argument arrays, never through a shell. `gh` is injectable; tests use a stand-in plus real git against a local bare "origin". The `gh` shapes in the tests are invented (live fixtures: issue #107).
- `defaultGh` moved to `core/lib/gh.js` (adds `input` for `gh api --input -`); `modules/tasks/lib/github.js` re-exports it.

### Guarded actions (security)

- **Guarded:** `init` (creates a remote), `labels` (only when something would change), `protect` (rulesets), `project-add`, `release` (tag + release), and `pr` when the branch has no upstream yet (first push). **Authorisation** = the plan is printed, then stdin and stdout must both be a terminal and the user types `y`. Anything else (pipe, CI, agent shell) exits 1 with "a person must run it in a terminal". **`--yes` does not exist** for these verbs (passing it is an error), and there is no environment switch. This is the security property; it is stricter than doc 10's "per the autonomy setting", which does not relax it. Decided by the user (option 1) after review showed that prefix rules cannot stop an agent from passing `--yes`.
- **Extra prompt only:** for Claude the module also adds `permissions.ask` entries to `.claude/settings.json` (`yaw gh` in any argument order, also by path and as `node .../bin/yaw gh`, the guarded `just` recipes, and the raw `gh pr merge`, `gh repo create/edit/delete`, `gh label ...`, `gh release create`, `gh api --method`). They are a convenience prompt, not a guard: they are prefix rules and do not match `just -f justfile ...`, `bash -c`, `env yaw gh` and similar forms. The security property does not depend on them. Codex and Copilot get the `AGENTS.md` rule only (matrix: `partial`). No hook is added (nothing to keep token-free). A test keeps the list of guarded verbs equal to the `authorise` call sites.
- **Known limit:** the TTY check stops scripts and agents that run commands without a terminal. An agent that gets a pseudo-terminal (some Codex setups, issue #113) could still answer the prompt; raw `gh` calls are not covered (issue #112).
- **There is no verb for merging, force-pushing, deleting branches, or changing the visibility of an existing repository.** `init --public` creates a public repo only with the explicit flag and shows "PUBLIC (anyone on the internet can read it)" in the plan. Pushes never force and use an explicit `refs/heads/<b>:refs/heads/<b>` refspec; `commit` never passes `--no-verify` (the git hooks of the git-hooks module run). A test greps the code for these flags.
- Nothing in a template, `yaw init/add/update/remove` or a hook calls `gh` (tested with a logging `gh` on the PATH).
- Label names are passed to `gh` after `--`. Inputs are validated before they reach git or gh: task ids (`T-NNN`, `#n`, by task mode), slugs (`[a-z0-9-]`, 40 characters), commit types and scopes, repository and owner names, versions (semver), check names. The task id of a branch comes from the branch name; for `T-NNN` in "both" mode the issue number is read from `TASKS.md` and only taken when it parses and is a positive safe integer (a hand-edited file is not trusted further).
- Files read by the recipes (`.yaw/github.yaml`, `.github/pull_request_template.md`, `TASKS.md`) go through `resolveInside` and must be regular files: a symbolic link, also one that stays inside the project, is refused (archive-path lesson of Y-5.3).

### Issue types: native with label fallback

- `nativeIssueTypes()` asks GraphQL (`repository.issueTypes`). Organisation repositories return their types; user repositories and any failure return an empty set. Per type: `gh-issue feature "title"` uses the native type (REST `type=Feature`) when it exists, else the label `type:feature`. `gh-labels` does not create `type:*` labels for types that exist natively. Nothing is persisted (`issueTypes` in `github.yaml` stays optional): the answer can change when an organisation adds a type.

### `.yaw/github.yaml`

- Rendered by the module: the label set (`type:`, `priority:`, `estimate:`, `status:`, the ones the `tasks` view reads in ADR-0010) and `rules` (approvals 0 solo, 1 team; `requireIssue` in team mode; `requiredChecks: [quality-gate, secret-scan]`). Colours are quoted because `5319E7` is a YAML number. `repo` is **no longer required** by `github.schema.json`: it is read from GitHub (`gh repo view`) instead of being written by a recipe, which would turn a managed file into an edited one on every setup. The project IDs of doc 14 (`yaw gh setup`) are not cached: `project-add` resolves the project and the `Status` option each time (one extra call, no stale IDs).

### Rulesets (`gh-protect`)

- One ruleset `yaw-default-branch` on `~DEFAULT_BRANCH`: no deletion, no force push, pull request required (N approvals), required checks, optional linear history; no bypass actors. It is created or updated by name and read back; a mismatch is an error. It refuses to require `quality-gate` / `secret-scan` when `.github/workflows/quality-gate.yml` is missing (a check nobody reports blocks every PR). Needs repo admin; private repositories need a plan that supports rulesets (the error from GitHub is shown). Y-5.9 adds `pr-policy` to `requiredChecks`.

### `branch`, `commit`, `pr`, `release`

- `branch <id> <slug>`: `<type>/<id>-<slug>` (ADR-0010), from a fresh `origin/<default>` (fetch first; if the fetch fails it says so and uses the last known), no upstream set; id form follows the task mode (`T-NNN` local/both, `#n` github/team).
- `commit <type> "subject"`: `type(scope): subject` plus footer `Refs T-012` / `Refs #34` (satisfies the commit-msg rule of doc 14 §2); task from the branch or `--task`. Commits what is staged.
- `pr`: draft pull request (`--ready` to skip), title = first commit of the branch, body = `.github/pull_request_template.md` with the commit list and `Closes #n` (issue branches, and T-ids linked in "both" mode) or `Refs T-012`. If a PR for the branch is open, the push updates it and its description is **not** rewritten (no overwriting of hand edits). Refuses on the default branch.
- `release <version>`: from the up-to-date, clean default branch; annotated tag, push of the tag, `gh release create --verify-tag --generate-notes` (pre-release for `-rc` versions). No changelog file (release-please is a later option).

### PR template placement

- Doc 04 lists the PR template under `ci`; it is in the `github` module, because `just pr` fills it and `github` can be used without `ci`. Doc 04 is updated.

### `ci` module

- `.github/workflows/quality-gate.yml` (rendered from a template plus the profile's `ci/check.yml`), jobs `quality-gate` (name is the contract with the ruleset) and `secret-scan`; triggers pull_request, push to main/master, manual; `permissions: contents: read`; concurrency (cancels only for pull requests); timeouts; checkouts without persisted credentials.
- **Profile fragments** (`profileCi`): `checkout`, `just setup`, `just check` are dropped from the fragment and supplied by the workflow; identical toolchain steps of several profiles are kept once; a Node step (22.13, the kit's floor) is added when the profile has none, because the kit needs Node. Fragments stay text so the pin comments survive.
- **Kit install (BD10):** a step reads `kit` from `.yaw/manifest.json`, refuses anything that is not `[0-9A-Za-z.+-]`, clones `v<kit>` and runs `install.sh --tag v<kit>`, then puts `~/.local/bin` on the PATH. A vendored kit (`vendored: true`) installs nothing. `vars.YAW_REPO` overrides the repository URL (default `https://github.com/nickyreinert/yaw.git`; until that repository is public, a generated project's CI cannot clone it, so set the variable or vendor). The step is run for real against a local kit repository in the tests.
- **Pinned actions:** every `uses:` is a full commit SHA with a version comment (checkout 4.4.0, setup-node 4.4.0, setup-just 2.0.0, setup-uv 5.4.2; same majors as before, SHAs resolved with the GitHub API). The two profile fragments were changed accordingly. Dependabot (`github-actions`, weekly) keeps them current; a test requires 40-hex pins. The kit's own `kit-ci.yml` still uses floating tags (ADR-0020 plans pinning before v0.1; not part of this step).
- **gitleaks (issue #109):** job `secret-scan` scans the whole history (`fetch-depth: 0`, `gitleaks git --redact`). The binary is downloaded from the release URL and checked with the pinned SHA-256 of the 8.30.1 `linux_x64` archive before it is unpacked (pattern of ADR-0026; same hash as `kit-ci.yml`). A new version means a new version number and hash together.
- Dependabot ecosystems per profile (doc 10 §4) are not done: the two profiles have no dependencies. The ADR/notice-ID PR check needs the `decisions` module (Y-5.6).

## Not in this step (filed as `later`)

- Issue forms `.github/ISSUE_TEMPLATE/*.yml`, the `issue-create`, `issue-triage`, `epic-plan` skills, Status field on `task start/done`, epics to milestones in `task sync`, Dependabot per profile ecosystem.

## Consequences

- Standard and Full presets get both modules (`default`); Quick does not (doc 04). Team mode gets `approvals: 1`, `requireIssue: true` in `github.yaml`; enforcement is Y-5.9.
- Removal deletes the module files and its fragments (`justfile` import, `AGENTS.md` block, the `permissions.ask` entries); `ci` must be removed before `github` (dependency). A `.github/workflows/` folder left empty is pruned. `answers.yaml` is untouched. Labels, rulesets and repositories already created on GitHub are not touched by removal.
