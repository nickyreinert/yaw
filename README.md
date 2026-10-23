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

Answer the interview, review the proposed files and confirm to apply them. YAW suggests a project profile and offers **Quick** or **Full** setup. It normally runs `just setup` and `just check` after applying; use `yaw init --skip-verify` to skip that step explicitly.

If you enter new secret values, YAW writes them only to a new mode-0600 `.env` file and skips automatic project verification. Review the project's `justfile` recipes before running them manually; project-controlled recipes could read `.env`. An existing `.env` is not read or overwritten.

For a local browser form instead of terminal questions, run `yaw init --web`. The form is served locally and still requires an explicit confirmation before writing files.

After setup, `yaw web` opens a local, read-only dashboard with the project setup, tasks, decisions and session statistics (`~/.yaw/yaw.db`).

## Quick and Full

**Quick** is the minimal setup: `core`, `communication`, `standards`, `devenv`, `tasks` and minimal `security`. It provides project instructions, basic agent configuration, development commands and security guards without selecting GitHub-specific integrations.

**Full** includes Quick plus `git-hooks`, `decisions`, `sessions`, `comfort` and `code-map`. The `github` and `ci` modules are selected when the project uses GitHub; the GitHub-specific `team` enforcement module is selected for teams and external reviewers using GitHub. Full can also be customized in the interview. The legacy `standard` name remains an alias for Full.

Git and GitHub are separate choices. Answer **no** to "Use GitHub for the repo?" to use local tasks and Git without GitHub integrations, including team projects with a bare remote in another folder. YAW leaves your Git remotes unchanged. Existing team setups without this answer retain their GitHub defaults.

## Maintain a project

Run these commands from the project root:

- `yaw status` — inspect enabled modules and generated files.
- `yaw doctor` — check the kit, project manifest and required tools.
- `yaw update` — reconcile managed files with the installed kit.
- `yaw add <module>` / `yaw remove <module>` — add or remove a module and its owned files.

YAW preserves user-owned files and provides reconciliation choices when managed files have been edited.

Adding or removing modules also updates `proposal.modules` in the saved answers, so reusing those answers selects the current modules. Existing answer values are retained. Invalid values for a selected module's questions are rejected before rendering or writing files.
