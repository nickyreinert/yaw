<div align="center">
  <img src="docs/assets/yaw-shark.svg" alt="YAW shark mascot" width="108">

  # YAW

  **Give your coding agents a project they can pick up and understand.**

  YAW sets up shared instructions, repeatable project commands, tasks and optional project memory for Claude Code, Codex and Copilot CLI. It writes ordinary files you can review and edit, then gives you a local dashboard to see the work across sessions.

  [Set up a project](#set-up-once) · [See what it does](#what-you-get) · [Website](website/) · [Full guide](docs/getting-started.md)
</div>

## Why use YAW?

A new agent session should not have to rediscover how to run your project, which tasks matter, or why a decision was made. YAW puts that context in the repository and connects it to the tools you already use. You can start with a small setup and add workflows only when they help.

- **Less repeated setup:** one interview creates shared `AGENTS.md` instructions, selected agent adapters and project-specific `just` commands.
- **A clear next step:** plan an idea with `yaw kickoff`, turn the plan into tasks, and resume from local tasks or GitHub issues.
- **Decisions that survive sessions:** record and retrieve decisions, risks and knowledge instead of relying on a past chat.
- **Visibility across workspaces:** the local dashboard shows projects, sessions, tasks and knowledge, with filters and session profiling when you explicitly collect it.
- **Control of your files:** preview changes before applying them. YAW keeps your edits to managed files during later updates unless you choose otherwise.

YAW is a zero-runtime-dependency Node.js CLI. It runs locally on macOS and Linux, or on Windows through WSL.

## Set up once

Requires **Node.js 22.13+** and **Git**. [`just`](https://just.systems) is recommended for generated project commands.

```sh
curl -fsSL https://raw.githubusercontent.com/nickyreinert/yaw/main/install.sh | bash -s -- --channel main
cd your-project
yaw init
```

This installs the current `main` channel, which includes the features described here. The [full guide](docs/getting-started.md) has the pinned v0.1.0 release install if you prefer a fixed version.

`yaw init` asks about your project, suggests a profile and offers **Quick** or **Full** setup. Review the proposed files before YAW writes them. Prefer a browser form? Run `yaw init --web`, or switch to it during the terminal interview. Setup normally runs the generated `just setup` and `just check` afterward.

Quick gives you shared instructions, basic agent configuration, project commands, local tasks and essential guards. Full adds decisions, session support, comfort features and a code map; GitHub and CI integrations depend on your project choices. You can change those choices later with `yaw edit` or the dashboard's **Workspace / Settings / Interview**, preview the diff, and apply it. `yaw add <module>` and `yaw remove <module>` adjust modules without starting over.

To inspect the installer or follow platform-specific steps, use the [full getting started guide](docs/getting-started.md).

## What you get

| When you need to… | Use… |
| --- | --- |
| Start a project or revise its setup | `yaw init`, `yaw edit`, `yaw status` and `yaw apply`. The dashboard's Settings view also previews and applies interview changes and lets you inspect YAW-written files. |
| Turn an idea into work | `yaw kickoff` creates a project-aware planning prompt; `yaw kickoff import <plan.md>` turns the saved plan into tasks with model and effort hints. |
| Track the next task | `TASKS.md`, GitHub issues or both; `yaw task next` finds the next local task. Optional team mode adds issue-linked commit and PR checks. |
| Keep useful context | Decision records, risk notices and Markdown knowledge can be searched and edited with `yaw knowledge` or in the dashboard. Decision retrieval helps agents find relevant records at task start. |
| Understand past sessions | `yaw sessions scan` explicitly analyzes local Claude Code, Codex and Copilot CLI histories. `yaw sessions analytics` and the dashboard show saved counts, lengths, timing and usage where available. Optional local Laya classification is experimental and separate. |
| Work across projects | `yaw web --background` runs one local dashboard server. Switch YAW workspaces in the sidebar and use global views for projects, sessions and task snapshots. |
| Get notified after a long run | The optional comfort module can send Telegram notifications. Preferences are personal; credentials stay in environment variables. |

Opening `yaw web` reads saved session analysis; transcript collection (**Refresh**) and classification (**Classify**) need an explicit action unless you tick **Auto**, which refreshes but never classifies. The [dashboard guide](docs/workspace-dashboard.md) explains coverage, privacy and controls.

### Optional: classify sessions with Laya

Classification uses [Laya](https://github.com/NandhaKishorM/laya), a local Python model service you install yourself (Python 3.10+; the multilingual checkpoint downloads on first use). YAW never installs or starts it.

```sh
python3 -m venv ~/.laya
~/.laya/bin/python -m pip install "laya[serve]"
LAYA_HOST=127.0.0.1 LAYA_PORT=8000 LAYA_MODELS=multilingual LAYA_DEFAULT_MODEL=multilingual ~/.laya/bin/laya-serve
```

Keep `LAYA_HOST=127.0.0.1`; otherwise Laya listens on your network. Then open **Global → Settings → Classification** in `yaw web` to test the connection and adjust settings, and press **Classify** on a Sessions page (or run `yaw sessions evaluate --days 30`). See [Local Laya classification](docs/workspace-dashboard.md#local-laya-classification-experimental).

## See the setup

<img src="docs/assets/setup-screenshot.png" alt="Current YAW browser setup form with six steps, Quick and Full choices, and a file plan" width="800">

*The local `yaw init --web` form previews the files before you apply them.*

## Keep working

After setup, run `yaw status` to inspect managed files, `yaw apply` to reconcile them with the installed kit, and `yaw web` to open the local dashboard. For day-to-day work, try `yaw kickoff`, `yaw task next` and `yaw sessions analytics`.

- [Website](website/) — standalone static page.
- [Getting started](docs/getting-started.md) — installation, Quick and Full, maintenance and safety details.
- [Workspace dashboard](docs/workspace-dashboard.md) — workspace and global views, session profiling, knowledge and settings.
- [Project concept](KICK-OFF.md) — design goals and technical background.
