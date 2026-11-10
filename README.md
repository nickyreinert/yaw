<div align="center">
  <img src="docs/assets/yaw-shark.svg" alt="YAW shark mascot" width="108">

  # YAW

  Since agentic coding is a thing, I am struggeling with keeping my coding agent instructions organized and consistent across many different projects, coding agents and even development systems.

  This is not only about one file of pre-prompt instructions containing coding style and communication preferences. It's about different languages, frameworks and architectures, skills, hooks and worflows, simple pet projects and complex production setups. And on top I regularly switch between Claude, Codex and Copilot CLI, working on MacOs on weekdays, Linux on weekends and having a coding assistant on a headless server at times. It grew out of hand.

  So I built YAW. The idea behind YAW: It's agent agnostic, customizable and nimble.

  YAW comes with a default set of instructions, skills and workflows. Everything I believe you need for simple pet projects, where velocity matters, and complex production setups, where scrutiny and reliability are crucial.

  [Set up a project](#set-up-once) · [See what it does](#what-you-get) · [Website](website/) · [Full guide](docs/getting-started.md)
</div>

## Why use YAW?

It does not matter if you are a layperson or an experienced developer. If you 

- work on multiple projects,
- want to prevent coding-agent lock-in or
- work with different languages, frameworks and architectures,

you may find **YAW** helpful. 

## How does YAW work?

- **init** YAW guides you through an interview, on the command line or in the browser. It creates one global entry point that most common coding agents understands: `AGENTS.md`. You select your preferred adapters and project-specific settings.

- **kick-off** The init process ends with an optional kick-off prompt for an agent of your choice. It turns your loose idea into milestones, steps and groundwork for the project.

- **knowledge** Important decisions and vital knowledge are recorded and made accessible across sessions, ensuring continuity and context for your projects.

- **supervising** YAW offers a dashboard with a lot of information to discover about your current project but also across all projects and coding agent sessions. 

## Installation

YAW is a near-zero-runtime-dependency. It requires **Node.js**, **git** and **just** for running commands. YAW runs locally on **macOS** and **Linux**, or on **Windows** through WSL.

```sh
curl -fsSL https://raw.githubusercontent.com/nickyreinert/yaw/main/install.sh | bash -s -- --channel main
```

Why **Node.js**? For ...

Why **git**? For installation...

Why **just**? As a simple wrapper for commands and a more comfortable alternative to bash scripts.

## Most important Commands

### `yaw init`

- initialises a new project by asking a couple of questions about language, framework and more
- guides you through setting up project defaults and modules
- the setup process differentiates between three levels of depth: **quick**, **basic**, and **all**, which determine how detailed the interview and configuration steps are
 - **quick** takes your configured personal defaults and just ask for project specific details (language, framework, ...)
 - **basic** same as quick plus collaboration options and review gates
 - **all** the whole package (see ## Core Features)
- you can switch to the web-based interface anytime
- will not write anything until you review and confirm 
- you can run the web interface right away with `yaw init --web`

#TODO: default and presets are mixed and hard to understand in the webui and probably busines logic - needs to be fixed: we need to find a proper combination of the depht (quick, basic, all) and presets/default



### associated just commands

- `just setup` to configure the project after initialization
- `just check` to verify the project setup
- `just apply` to apply the configuration and changes 


### `yaw kickoff`

#TODO: the CLI command returns 6 steps - drop them, too much prose. add arguments to store the kick off prompt in docs/plan/kickoff.md right away, which is default behavior, or print the prompt to stdout, lets rething step 4 (yaw kcikf import?) what does it evne mean? how does it work? meaningless? what happens there? 

- the finished init-process provides you a kick-off prompt, if you missed it, this commands prints the prompt again
- this prompt tells a coding agent to create the following grounding truth documents: 
 - `docs/spec/architecture.md` 
 - `docs/spec/data-model.md`#
 - `docs/spec/ui-ux.md`

- this is optional, you may not need it for you small click-mockup, but it may come in handy for larger projects or more complex setups

### associated just commands

- `just kickoff` to generate the kick-off prompt and grounding truth documents
- `just plan` to view or edit the kick-off plan stored in `docs/plan/kickoff.md`
#TODO: again: i dont understand why we import a kick off plan? its the other way around usually
- `just import` to import an existing kick-off plan into the project

### `yaw add`

- if you later decide that you need more functionality, you can add modules with this command

#TODO add list-modules argument, allow to filter for all modules, installed modules, and not-installed modules
- undecided what modules exists? Run `yaw list-modules` to see available options 
- also supports the web interface with `yaw add --web`

### associated just commands

- `just add <module>` to add a new module to the project
- `just list-modules` to see available modules and their status

### `yaw remove`

- the opposite of `yaw add`, this command removes modules from the project
- also supports the web interface with `yaw remove --web`

### associated just commands

- `just remove <module>` to remove a module from the project
- `just list-modules` to see available modules and their status

## `yaw task``

- this is an optional module, that helps you keep track of tasks and issues
- you may not need to run it manually and just trust your coding agent to add tasks and issues to the project
- tasks and issues are tracked in `TASKS.md` and optionally in GitHub issues

### associated just commands

- `just task` to manage tasks and issues in the project
- `just task next` to find the next local task
- `just task list` to list all tasks and issues in the project
- `just task add <task>` to add a new task to the project
- `just task done <task>` to mark a task as completed
- `just task remove <task>` to remove a task from the project
- `just task edit <task>` to edit an existing task in the project

## Core Features

The setup process allows you to choose between quick, basic an all. Each level allows you to choose from the core features listed below. 

_**Level** indicates the setup depth at which the feature is available for configuration: quick, basic, or all_

#### Supported Coding Agents
**Level** quick, basic, all

[...]

#### Conversation Styles
**Level** all

#### Collaboration and Task Management
**Level** basic, all

#### Languages, Frameworks and Architecture
**Level** quick, basic, all

#### Coding Practices
**Level** basic, all

#### Quality Assurance
**Level** basic, all

- contains sub agents, that will be triggered on specific events. They will review changes and warn or block them based on different criteria:

- Quality Gate
- Business Logic
- UI/UX
- Security

#### Comfort and Hygiene
**Level** all

- session hygiene
- status updates

## Meta Features

The following features are not necessarily required for coding and therefore not part of the init process. They can enhance your workflow and project management.

### Analytics

### Supervision

You can tell YAW to scan your previous coding agent sessions and classify them. This follows two purposes: You measure the agents and models performance and you can learn how to better prompt them in the future.

This feature requires the classification model **Laya**. It runs locally only and does not require much computational resources. It classifies conversations into success and failure categories. 
#### Install Laya

**Laya** requires Python 3.10 or higher and the necessary Python packages specified in its installation instructions.

```sh
python3 -m venv ~/.laya
~/.laya/bin/python -m pip install "laya[serve]"
LAYA_HOST=127.0.0.1 LAYA_PORT=8000 LAYA_MODELS=multilingual LAYA_DEFAULT_MODEL=multilingual ~/.laya/bin/laya-serve
```

Keep `LAYA_HOST=127.0.0.1`; otherwise Laya listens on your network. Then open **Global → Settings → Profiling** in `yaw web` to test the connection and adjust settings, and press **Classify** in Global → Profiling or on a Sessions page (or run `yaw sessions evaluate --days 30`). See [Local Laya classification](docs/workspace-dashboard.md#local-laya-classification-experimental).

### Server-Mode

### Notifications

### Learn from your sessions

## See the setup

<img src="docs/assets/setup-screenshot.png" alt="Current YAW browser setup form with six steps, Quick, Basic and All choices, and a file plan" width="800">

*The local `yaw init --web` form previews the files before you apply them.*

