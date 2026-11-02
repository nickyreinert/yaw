# YAW — Yet Another Wrapper

YAW is a zero-runtime-dependency Node.js CLI that prepares a repository for coding agents. It renders project instructions, agent settings, reusable setup/check commands and optional modules into ordinary files you can review and edit.

## Requirements and platforms

- Node.js **22.13 or newer**
- Git
- [`just`](https://just.systems) is recommended for project setup and checks. The installer warns if it is missing but does not install it.
- Supported: macOS and Linux. On Windows, use WSL.

## Install

The installer clones the selected YAW tag into `~/.yaw/kit` and links `yaw` into `~/.local/bin`. It never uses `sudo` or installs prerequisites. On a fresh interactive install, its first question offers personal-default setup. You can skip it and run `yaw defaults` or use Global Settings → Defaults later; unattended installs and update reruns do not prompt.

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

Answer the interview, review the proposed files and confirm to apply them. YAW asks which language you want to use and where the project will run (your computer, your own server, serverless, edge, static hosting, WordPress, or desktop/mobile). Pairs YAW knows well get a tailored stack; other valid pairs get a basic stack for the language; impossible pairs (for example Rust inside WordPress) cannot be continued. YAW does not install the language; `yaw doctor` tells you what is missing. Choose **Quick**, **Basic** or **All** interview depth first. It normally runs `just setup` and `just check` after applying; use `yaw init --skip-verify` to skip that step explicitly.

Run `yaw init` inside the project folder. YAW refuses your home folder and the file-system root, and asks before writing into a non-empty folder that is not yet a Git repository or YAW project (for example a folder that holds several projects); `--force` overrides both checks.

If you enter new secret values, YAW writes them only to a new mode-0600 `.env` file and skips automatic project verification. Review the project's `justfile` recipes before running them manually; project-controlled recipes could read `.env`. An existing `.env` is not read or overwritten.

For a local browser form instead of terminal questions, run `yaw init --web`. The form is served locally and still requires an explicit confirmation before writing files.
During the terminal interview, every question also shows `w) Continue in the browser`. Type `w` (or `web`), or select it with the arrow keys and press Enter, to carry your answers into the browser without writing project files.

To plan the work, `yaw kickoff` prints a versioned prompt to draft and review architecture/domain, data-model and UI/UX foundations before tasks. Use it manually or with your chosen local/external model. Save the answer as `docs/plan/kickoff.md`, preview with `yaw kickoff import docs/plan/kickoff.md --dry-run`, then import with `--reviewed` after reviewing all three documents. Existing documentation can be reused, or replaced by a reviewed `update` whose diff the preview shows. Tasks retain spec references, observable acceptance criteria and model/effort hints. Legacy task-only plans remain accepted without `--reviewed`.

Already have a bigger concept in another chat? `yaw kickoff concept` writes a prompt for that chat to `.yaw/concept-prompt.md` (git-ignored; `--stdout` prints it instead). The chat adapts the concept to your setup and answers with one block for your coding agent: paste it there, and the agent writes the three documents in the project. Nothing goes back to YAW. The end of `yaw init` (terminal or browser) and Settings → Kickoff offer the same prompt, next to the prompt that lets your coding agent write the documents from your setup alone.

`yaw kickoff context` (also `--json`) shows project-owned ground truth separately from generic YAW practices. Agents and optional reviewers consult both; conflicts need a project decision. `yaw kickoff ux` prints an optional user/task walkthrough prompt with that context. See [formats](spec/formats.md#guided-kickoff-foundations) for source registration and review details.

`yaw web` opens the local dashboard in any folder without starting setup or writing project files. In an uninitialized folder, first-time setup is an explicit action under Workspace → Settings → Interview, with preview and folder confirmation before writing. The dashboard shows project setup, tasks, decisions and session statistics (`~/.yaw/yaw.db`). `yaw sessions import --dry-run`, then `yaw sessions import`, loads the past sessions of any project folder (also one without YAW) from the local history of Claude Code, Codex and Copilot: times, model and token counts only, never prompt content.

The optional planning prompt includes links to external AI chats alongside Copy prompt. You can also use your coding agent or a local model. Opening a link sends no prompt; paste it yourself, then review the proposed foundations and plan before importing them.

## Quick, Basic and All

**Quick** asks purpose, language and runtime. Personal settings and optional tools reuse saved defaults; optional tools start off if never chosen. A new Quick setup installs core instructions and project commands for the selected profile.

**Basic** adds personal preferences, collaboration and review gates. **All** asks every applicable implemented question and exposes every optional module. All asks advanced questions for all expertise levels. Neither depth enables every tool by itself.

Personal defaults concern experience level, chat language, autonomy and answer style. Quick uses saved values or factory defaults; Basic and All offer them for project-specific overrides. When none exist, init shows a notice outside its menu: the first confirmed Basic/All personal answers become defaults after Apply. Existing defaults remain unchanged by later project overrides; edit them explicitly with `yaw defaults` or Global Settings.

Save future-project tool defaults under Global Settings → Defaults. They are separate from personal preferences. Existing project modules remain selected; legacy `full` and `standard` answer files stay readable with their legacy module policy. Confirmed explicit module proposals continue to work unchanged.

Initial browser setup and Workspace → Settings → Interview use the same reusable wizard, including drafts, planning, foundations, preview and Apply. Settings remains open after applying.

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
