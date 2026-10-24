<div align="center">
  <img src="website/assets/yaw-shark.svg" alt="YAW's friendly shark mascot" width="108">

  # YAW

  **A better starting point for coding agents.**

  Turn a project folder into a workspace with clear instructions, repeatable commands and the tools your agents need. Review the proposed files before YAW writes them.

  [Get started](#get-started) · [See the setup](#see-the-setup) · [Full guide](docs/getting-started.md)
</div>

## Why YAW?

Coding agents work better when the project tells them how to work. YAW gives each session a shared starting point and gives you control over what goes into the repo.

- **A clear handoff:** project instructions in `AGENTS.md`, plus adapters for the agents you select.
- **A useful dev loop:** reusable `just` commands for setup and checks.
- **Only what you need:** choose Quick or Full, then add or remove modules as the project grows.
- **Inspectable files:** see the proposed setup before applying it; keep your edits when updating managed files.
- **Continuity:** tasks and optional decision records help work survive the next session.

YAW is a zero-runtime-dependency Node.js CLI. It works locally on macOS and Linux, or on Windows through WSL.

## See the setup

<img src="website/assets/setup-preview.svg" alt="Illustrated preview of the local YAW setup form, with setup choices and a live summary" width="800">

*Illustrated preview of `yaw init --web`. The form runs locally and shows the files before you apply them.*

The terminal flow is just as direct: `yaw init` asks about the project, suggests a profile, lets you choose Quick or Full, and reviews the files before writing them. You can continue the terminal interview in the browser at any question.

## Get started

Requires **Node.js 22.13+** and **Git**. [`just`](https://just.systems) is recommended for the generated project commands.

```sh
curl -fsSL https://raw.githubusercontent.com/nickyreinert/yaw/v0.1.0/install.sh | bash -s -- --tag v0.1.0
cd your-project
yaw init
```

Prefer to inspect the installer first? The [full guide](docs/getting-started.md) has download and checksum steps, platform notes, and the complete command reference.

After setup, use `yaw status` to see what YAW manages, `yaw update` to reconcile it, and `yaw web` for the local project dashboard.

## Explore

- [Launch page](website/) — standalone static site, ready to move to its own repository.
- [Full getting started guide](docs/getting-started.md) — installation, Quick and Full, maintenance and safety details.
- [Project concept](KICK-OFF.md) — design goals and technical background.
