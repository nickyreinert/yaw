<div align="center">
  <img src="docs/assets/yaw-shark.svg" alt="YAW's friendly shark mascot" width="108">

  # YAW

  **The workspace around your coding agents.**

  Set up a project, turn an idea into tasks, carry decisions across sessions, and see the work in a local dashboard. YAW writes reviewable files and works with Claude Code, Codex and Copilot CLI.

  [Get started](#get-started) · [Explore the features](#what-yaw-does) · [Launch page](website/) · [Full guide](docs/getting-started.md)
</div>

## Why YAW?

Coding agents work better when the project tells them how to work and where to resume. YAW connects that shared context with planning, task tracking, session history and optional comfort features. Start with Quick, or choose Full and tailor the modules.

- **Agent-aware setup:** shared `AGENTS.md` instructions and adapters for the agents you select. Support varies by feature and agent.
- **Files you control:** preview the proposal before applying it. YAW preserves your edits when updating managed files.
- **A repeatable dev loop:** generated `just` commands for setup and checks, with optional hooks, skills, code maps and GitHub workflows.
- **Continuity:** local or GitHub tasks, decisions, handoffs and session links help the next session pick up the work.

YAW is a zero-runtime-dependency Node.js CLI. It works locally on macOS and Linux, or on Windows through WSL.

## What YAW does

| Need | YAW feature |
| --- | --- |
| Turn an idea into work | `yaw kickoff` prints a project-aware planning prompt. Save the plan and use `yaw kickoff import <plan.md>` to create tasks with model and effort hints. |
| Track tasks your way | Keep `TASKS.md` locally, use GitHub issues, or link both. Optional team mode checks issue links in commits and pull requests; GitHub issue forms and planning skills provide structure. |
| Remember decisions and knowledge | Record decisions and risks, recall relevant records at task start, and browse project and personal Markdown knowledge in a read-only local dashboard. |
| Understand agent sessions | Explicitly scan local Claude Code, Codex and Copilot CLI history, then review session counts, lengths and timing. Optional local Laya classification groups outcomes and failure types; it is experimental and requires your own local service. |
| Know when attention is needed | Optional comfort hooks can send Telegram notifications after long runs. Personal preferences live outside the repo; bot credentials stay in your environment. |
| Resume across agents | A session registry, handoff skill and links from tasks, decisions, commits and files help find earlier work. |

Run `yaw web` for the local dashboard. Its overview stays scoped to the current workspace; global projects, sessions and tasks have separate views. Opening it reads saved results. Transcript scanning and Laya classification require explicit actions unless you choose the refresh-on-load scan setting. See the [dashboard guide](docs/workspace-dashboard.md) for coverage, privacy and setup details.

## See the setup

<img src="docs/assets/setup-screenshot.png" alt="YAW's local browser setup form showing Quick and Full setup, project sections, and a live summary" width="800">

*The actual `yaw init --web` form. It runs locally and previews files before you apply them.*

The terminal flow is just as direct: `yaw init` asks about the project, suggests a profile, lets you choose Quick or Full, and reviews the files before writing them. You can continue the terminal interview in the browser at any question.

## Get started

Requires **Node.js 22.13+** and **Git**. [`just`](https://just.systems) is recommended for the generated project commands.

```sh
curl -fsSL https://raw.githubusercontent.com/nickyreinert/yaw/v0.1.0/install.sh | bash -s -- --tag v0.1.0
cd your-project
yaw init
```

Prefer to inspect the installer first? The [full guide](docs/getting-started.md) has download and checksum steps, platform notes, and the complete command reference.

After setup, use `yaw status` to see what YAW manages, `yaw apply` to reconcile it (`yaw update` remains an alias), and `yaw web` for the local dashboard. Run `yaw edit` to review saved answers in the terminal or browser, `yaw edit --web` to open the editor directly, or `yaw edit user` to review one interview section (`yaw edit --list` lists sections).

For day-to-day work, try `yaw kickoff`, `yaw task next`, and `yaw sessions analytics`. Add modules later with `yaw add <module>`; the [full guide](docs/getting-started.md) explains Quick, Full and maintenance.

## Explore

- [Launch page](website/) — standalone static site, ready to move to its own repository.
- [Full getting started guide](docs/getting-started.md) — installation, Quick and Full, maintenance and safety details.
- [Workspace dashboard](docs/workspace-dashboard.md) — workspace/global views, explicit session analytics, local Laya classification and Telegram settings.
- [Project concept](KICK-OFF.md) — design goals and technical background.
