# github module (ADR-0027): recipes call `yaw gh <verb>`. Guarded recipes print their plan and need
# a person typing "y" in a terminal. Scripts and agents cannot run them (there is no --yes).
# Nothing here merges, force-pushes, deletes branches or changes the visibility of a repository.
yaw_gh := 'if command -v yaw >/dev/null 2>&1; then yaw "$@"; elif [ -f "${YAW_KIT:-$HOME/.yaw/kit}/bin/yaw" ]; then node "${YAW_KIT:-$HOME/.yaw/kit}/bin/yaw" "$@"; else echo "gh: the YAW kit is not installed"; exit 1; fi'

# GUARDED. Create the GitHub repository (private unless --public), push, create labels.
[positional-arguments]
gh-init *args:
    @set -- gh init "$@"; {{yaw_gh}}

# GUARDED. Create or update the labels listed in .yaw/github.yaml (never deletes).
[positional-arguments]
gh-labels *args:
    @set -- gh labels "$@"; {{yaw_gh}}

# GUARDED. Apply and verify the ruleset for the default branch (needs repo admin). `--verify` only compares, unguarded.
[positional-arguments]
gh-protect *args:
    @set -- gh protect "$@"; {{yaw_gh}}

# Create an issue: native issue type if the repo has it, else the type:* label. just gh-issue feature "title"
[positional-arguments]
gh-issue *args:
    @set -- gh issue "$@"; {{yaw_gh}}

# Branch from the fresh default branch. just branch T-012 invite-flow  (or: just branch 34 login-crash --type fix)
[positional-arguments]
branch *args:
    @set -- gh branch "$@"; {{yaw_gh}}

# Conventional Commit with the task footer; the git hooks run. just commit feat "add invite flow" --scope ui
[positional-arguments]
commit *args:
    @set -- gh commit "$@"; {{yaw_gh}}

# Push the branch and open a draft pull request from the template (the first push is GUARDED).
[positional-arguments]
pr *args:
    @set -- gh pr "$@"; {{yaw_gh}}

# Checks and review state of the pull request of this branch.
[positional-arguments]
pr-status *args:
    @set -- gh pr-status "$@"; {{yaw_gh}}

# GUARDED. Tag and publish a GitHub release from the default branch. just release 0.1.0
[positional-arguments]
release *args:
    @set -- gh release "$@"; {{yaw_gh}}

# GUARDED. Add an issue to the project board (project.number in .yaw/github.yaml). just project-add 34 --status "In progress"
[positional-arguments]
project-add *args:
    @set -- gh project-add "$@"; {{yaw_gh}}
