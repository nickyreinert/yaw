# YAW — Yet Another Wrapper

YAW is a zero-runtime-dependency Node.js CLI that prepares a repository for coding agents. It renders project instructions, agent settings, reusable setup/check commands and optional modules into ordinary files you can review and edit.

## Requirements and platforms

- Node.js **22.13 or newer**
- Git
- [`just`](https://just.systems) is recommended for project setup and checks. The installer warns if it is missing but does not install it.
- Supported: macOS and Linux. On Windows, use WSL.

## Install

The installer clones the selected YAW tag into `~/.yaw/kit` and links `yaw` into `~/.local/bin`. It never uses `sudo` or installs prerequisites.

Quick install for v0.1.0:

```sh
curl -fsSL https://raw.githubusercontent.com/nickyreinert/yaw/v0.1.0/install.sh | bash -s -- --tag v0.1.0
```

To inspect the installer before running it, download it first:

```sh
curl --fail --silent --show-error --location \
  --output install.sh \
  https://raw.githubusercontent.com/nickyreinert/yaw/v0.1.0/install.sh
less install.sh
```

Installer SHA-256 for v0.1.0:

```text
08c41c65657fd3928f9e399aed6f330d9948e97231cb885c3a3f4dd4957d70ec  install.sh
```

Verify the downloaded file, then run it:

```sh
# macOS
printf '%s  %s\n' '08c41c65657fd3928f9e399aed6f330d9948e97231cb885c3a3f4dd4957d70ec' install.sh | shasum -a 256 -c -
# Linux
printf '%s  %s\n' '08c41c65657fd3928f9e399aed6f330d9948e97231cb885c3a3f4dd4957d70ec' install.sh | sha256sum -c -
bash install.sh --tag v0.1.0
```

If `~/.local/bin` is not already on your `PATH`, add it as directed by the installer, then check the installation:

```sh
yaw --version
yaw doctor
```

## Quick start

From the root of a new project:

```sh
yaw init
```

Answer the interview, review the proposed files and confirm to apply them. YAW asks which language you want to use and where the project will run (your computer, your own server, serverless, edge, static hosting, WordPress, or desktop/mobile). Pairs YAW knows well get a tailored stack; other valid pairs get a basic stack for the language; impossible pairs (for example Rust inside WordPress) cannot be continued. YAW does not install the language; `yaw doctor` tells you what is missing. Then it offers **Quick** or **Full** setup. It normally runs `just setup` and `just check` after applying; use `yaw init --skip-verify` to skip that step explicitly.

Run `yaw init` inside the project folder. YAW refuses your home folder and the file-system root, and asks before writing into a non-empty folder that is not yet a Git repository or YAW project (for example a folder that holds several projects); `--force` overrides both checks.

If you enter new secret values, YAW writes them only to a new mode-0600 `.env` file and skips automatic project verification. Review the project's `justfile` recipes before running them manually; project-controlled recipes could read `.env`. An existing `.env` is not read or overwritten.

For a local browser form instead of terminal questions, run `yaw init --web`. The form is served locally and still requires an explicit confirmation before writing files.
During the terminal interview, every question also shows `w) Continue in the browser`. Type `w` (or `web`), or select it with the arrow keys and press Enter, to carry your answers into the browser without writing project files.

To plan the work, `yaw kickoff` prints a planning prompt for your idea; paste the answer into `docs/plan/kickoff.md` and run `yaw kickoff import docs/plan/kickoff.md` to turn it into tasks with a model tier and reasoning effort each.

`yaw web` opens the local dashboard in any folder without starting setup or writing project files. In an uninitialized folder, first-time setup is an explicit action under Workspace → Settings → Interview, with preview and folder confirmation before writing. The dashboard shows project setup, tasks, decisions and session statistics (`~/.yaw/yaw.db`). `yaw sessions import --dry-run`, then `yaw sessions import`, loads the past sessions of any project folder (also one without YAW) from the local history of Claude Code, Codex and Copilot: times, model and token counts only, never prompt content.

## Quick and Full

**Quick** is the minimal setup: `core`, `communication`, `standards`, `devenv`, `tasks`, `sessions` and minimal `security`. It provides project instructions, basic agent configuration, development commands, session history and security guards without selecting GitHub-specific integrations.

**Full** includes Quick plus `git-hooks`, `decisions`, `comfort`, `code-map` and `review`. The `github` and `ci` modules are selected when the project uses GitHub; the GitHub-specific `team` enforcement module is selected for teams and external reviewers using GitHub. Full can also be customized in the interview. The legacy `standard` name remains an alias for Full.

Git and GitHub are separate choices. Answer **no** to "Use GitHub for the repo?" to use local tasks and Git without GitHub integrations, including team projects with a bare remote in another folder. YAW leaves your Git remotes unchanged. Existing team setups without this answer retain their GitHub defaults.

The browser form (`yaw init --web`, `yaw edit --web`, Workspace → Settings) shows modules as grouped cards with a short example each, plus a compact view for people who already know them.

## Review agents

The `review` module adds four read-only sub-agents: **quality** (readability, naming, duplication, missing tests), **business logic** (the change against your rules and business-logic notices), **UI/UX** (labels, empty and error states, keyboard use, contrast) and **feature fit** (does the change do what the task asked). Each one is off, on request (`just review <kind>`), a hint when work is done, or required before push.

Required reviewers run as a `pre-push` hook (`yaw review gate`) through the agent CLI (Claude Code, Codex or Copilot). With **warn**, you can confirm in the terminal and push anyway; with **block**, the push stops until the findings are fixed. Without a terminal to confirm in (for example when an agent pushes), warn behaves like block, so the agent has to fix the findings first; you can still push yourself. Results are cached per commit. Without a Git repository, reviews run only on request or as a hint; setup offers `git init` for a fresh folder.

The gate hands the prompt to the agent on stdin and runs it read-only: `claude -p` with `--permission-mode dontAsk` and only read and `git diff/log/show` tools, `codex exec --sandbox read-only --ephemeral -`, or `copilot -s --no-ask-user --deny-tool=write`. Set `YAW_REVIEW_AGENT` to pick one.

Each reviewer's prompt, and the reporting rules they share, are separate texts you can edit in `yaw web`: **Global → Settings → Review prompts** is your blueprint for every project (`~/.yaw/review/<kind>.md`); **Settings → Review prompts** in a workspace saves a project version (`.yaw/review/<kind>.md`, committed with the project). The project version wins, then the blueprint, then the kit default. `just review-prompt <kind>` prints the prompt in effect; the review skill and sub-agents read it that way. The read-only rule and the `VERDICT` line are fixed, so an edited prompt cannot turn a reviewer into an editor or break the gate.

## Maintain a project

Run these commands from the project root:

- `yaw status` — inspect enabled modules and generated files.
- `yaw doctor` — check the kit, project manifest and required tools.
- `yaw update` — reconcile managed files with the installed kit.
- `yaw add <module>` / `yaw remove <module>` — add or remove a module and its owned files.

YAW preserves user-owned files and provides reconciliation choices when managed files have been edited.

Adding or removing modules also updates `proposal.modules` in the saved answers, so reusing those answers selects the current modules. Existing answer values are retained. Invalid values for a selected module's questions are rejected before rendering or writing files.
