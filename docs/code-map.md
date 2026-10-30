---
areas:
  - id: claude
    title: .claude
    paths:
      - .claude/**
  - id: codex
    title: .codex
    paths:
      - .codex/**
  - id: decisions
    title: .decisions
    paths:
      - .decisions/**
  - id: github
    title: .github
    paths:
      - .github/**
  - id: vscode
    title: .vscode
    paths:
      - .vscode/**
  - id: adapters
    title: adapters
    paths:
      - adapters/**
  - id: bin
    title: bin
    paths:
      - bin/**
  - id: core
    title: core
    paths:
      - core/**
  - id: docs
    title: docs
    paths:
      - docs/**
  - id: examples
    title: examples
    paths:
      - examples/**
  - id: interview
    title: interview
    paths:
      - interview/**
  - id: just
    title: just
    paths:
      - just/**
  - id: kickoff
    title: kickoff
    paths:
      - kickoff/**
  - id: modules
    title: modules
    paths:
      - modules/**
  - id: profiles
    title: profiles
    paths:
      - profiles/**
  - id: test
    title: test
    paths:
      - test/**
  - id: website
    title: website
    paths:
      - website/**
  - id: root
    title: Top-level files
    paths:
      - "*"
---
# Code map

<!-- yaw:map:begin overview -->
| Area | Title | Paths | Entry points | Tests |
|---|---|---|---|---|
| `claude` | .claude | `.claude/**` | - | - |
| `codex` | .codex | `.codex/**` | - | - |
| `decisions` | .decisions | `.decisions/**` | - | - |
| `github` | .github | `.github/**` | - | - |
| `vscode` | .vscode | `.vscode/**` | - | - |
| `adapters` | adapters | `adapters/**` | - | - |
| `bin` | bin | `bin/**` | - | - |
| `core` | core | `core/**` | - | - |
| `docs` | docs | `docs/**` | - | - |
| `examples` | examples | `examples/**` | - | - |
| `interview` | interview | `interview/**` | - | - |
| `just` | just | `just/**` | - | - |
| `kickoff` | kickoff | `kickoff/**` | - | - |
| `modules` | modules | `modules/**` | - | - |
| `profiles` | profiles | `profiles/**` | - | - |
| `test` | test | `test/**` | - | - |
| `website` | website | `website/**` | - | - |
| `root` | Top-level files | `*` | - | - |
<!-- yaw:map:end overview -->

The text outside the `yaw:map` blocks is yours: `yaw map update` rewrites only the blocks.

## .claude

Describe this area's responsibility.

<!-- yaw:map:begin area-claude -->
- Paths: `.claude/**`
- Entry points: -
- Tests: -
- Relates to: -
- ADRs: -
- Directories:
  - `.claude/`
<!-- yaw:map:end area-claude -->

## .codex

Describe this area's responsibility.

<!-- yaw:map:begin area-codex -->
- Paths: `.codex/**`
- Entry points: -
- Tests: -
- Relates to: -
- ADRs: -
- Directories:
  - `.codex/`
<!-- yaw:map:end area-codex -->

## .decisions

Describe this area's responsibility.

<!-- yaw:map:begin area-decisions -->
- Paths: `.decisions/**`
- Entry points: -
- Tests: -
- Relates to: -
- ADRs: -
- Directories:
  - `.decisions/`
  - `.decisions/details/`
<!-- yaw:map:end area-decisions -->

## .github

Describe this area's responsibility.

<!-- yaw:map:begin area-github -->
- Paths: `.github/**`
- Entry points: -
- Tests: -
- Relates to: -
- ADRs: -
- Directories:
  - `.github/`
  - `.github/workflows/`
<!-- yaw:map:end area-github -->

## .vscode

Describe this area's responsibility.

<!-- yaw:map:begin area-vscode -->
- Paths: `.vscode/**`
- Entry points: -
- Tests: -
- Relates to: -
- ADRs: -
- Directories:
  - `.vscode/`
<!-- yaw:map:end area-vscode -->

## adapters

Agent configuration templates and optional execution-provider packages. `remote-claude` pins the Claude SDK separately from the dependency-free core.

<!-- yaw:map:begin area-adapters -->
- Paths: `adapters/**`
- Entry points: -
- Tests: -
- Relates to: -
- ADRs: -
- Directories:
  - `adapters/`
  - `adapters/remote-claude/`
<!-- yaw:map:end area-adapters -->

## bin

Describe this area's responsibility.

<!-- yaw:map:begin area-bin -->
- Paths: `bin/**`
- Entry points: -
- Tests: -
- Relates to: -
- ADRs: -
- Directories:
  - `bin/`
<!-- yaw:map:end area-bin -->

## core

CLI commands, setup rendering, shared libraries and browser applications. `remote` contains opt-in LAN host/client services, portable sync, managed project provisioning, native Claude process monitoring and host-only Telegram interviews. The earlier SDK supervisor remains a compatibility path. Execution metadata stays separate from session analytics.

<!-- yaw:map:begin area-core -->
- Paths: `core/**`
- Entry points: -
- Tests: -
- Relates to: -
- ADRs: -
- Directories:
  - `core/`
  - `core/cli/`
  - `core/hooks/`
  - `core/interview/`
  - `core/lib/`
  - `core/remote/`
  - `core/render/`
  - `core/schema/`
  - `core/web/`
<!-- yaw:map:end area-core -->

## docs

Describe this area's responsibility.

<!-- yaw:map:begin area-docs -->
- Paths: `docs/**`
- Entry points: -
- Tests: -
- Relates to: -
- ADRs: -
- Directories:
  - `docs/`
  - `docs/assets/`
  - `docs/build/`
  - `docs/spec/`
<!-- yaw:map:end area-docs -->

## examples

Describe this area's responsibility.

<!-- yaw:map:begin area-examples -->
- Paths: `examples/**`
- Entry points: -
- Tests: -
- Relates to: -
- ADRs: -
- Directories:
  - `examples/`
  - `examples/android-kotlin/`
  - `examples/cloudflare-workers/`
  - `examples/composed/`
  - `examples/node-app/`
  - `examples/node-app-electron/`
  - `examples/node-app-tauri/`
  - `examples/node-cli/`
  - `examples/node-ts-vercel/`
  - `examples/node-web/`
  - `examples/php-cli/`
  - `examples/php-serverless/`
  - `examples/php-serverless-bref/`
  - `examples/php-web/`
  - `examples/python-cli/`
  - `examples/python-vercel/`
  - `examples/python-web/`
  - `examples/rust-cli/`
  - `examples/rust-web/`
  - `examples/static-site/`
  - `examples/swift-app/`
  - `examples/swift-cli/`
  - `examples/swift-web/`
  - `examples/wordpress-plugin/`
<!-- yaw:map:end area-examples -->

## interview

Describe this area's responsibility.

<!-- yaw:map:begin area-interview -->
- Paths: `interview/**`
- Entry points: -
- Tests: -
- Relates to: -
- ADRs: -
- Directories:
  - `interview/`
  - `interview/help/`
<!-- yaw:map:end area-interview -->

## just

Describe this area's responsibility.

<!-- yaw:map:begin area-just -->
- Paths: `just/**`
- Entry points: -
- Tests: -
- Relates to: -
- ADRs: -
- Directories:
  - `just/`
<!-- yaw:map:end area-just -->

## kickoff

Describe this area's responsibility.

<!-- yaw:map:begin area-kickoff -->
- Paths: `kickoff/**`
- Entry points: -
- Tests: -
- Relates to: -
- ADRs: -
- Directories:
  - `kickoff/`
  - `kickoff/reference/`
<!-- yaw:map:end area-kickoff -->

## modules

Composable setup features and their templates, agent instructions, hooks and tests. Core supplies the shared engineering baseline; review supplies the read-only quality, logic, UI/UX, feature and security reviewers.

<!-- yaw:map:begin area-modules -->
- Paths: `modules/**`
- Entry points: -
- Tests: -
- Relates to: -
- ADRs: -
- Directories:
  - `modules/`
  - `modules/ci/`
  - `modules/code-map/`
  - `modules/comfort/`
  - `modules/communication/`
  - `modules/core/`
  - `modules/decisions/`
  - `modules/devenv/`
  - `modules/git-hooks/`
  - `modules/github/`
  - `modules/review/`
  - `modules/security/`
  - `modules/sessions/`
  - `modules/standards/`
  - `modules/tasks/`
  - `modules/team/`
<!-- yaw:map:end area-modules -->

## profiles

Describe this area's responsibility.

<!-- yaw:map:begin area-profiles -->
- Paths: `profiles/**`
- Entry points: -
- Tests: -
- Relates to: -
- ADRs: -
- Directories:
  - `profiles/`
  - `profiles/android-kotlin/`
  - `profiles/cloudflare-workers/`
  - `profiles/go-basic/`
  - `profiles/java-basic/`
  - `profiles/kotlin-basic/`
  - `profiles/node-app/`
  - `profiles/node-basic/`
  - `profiles/node-cli/`
  - `profiles/node-ts-vercel/`
  - `profiles/node-web/`
  - `profiles/php-cli/`
  - `profiles/php-serverless/`
  - `profiles/php-web/`
  - `profiles/python-basic/`
  - `profiles/python-cli/`
  - `profiles/python-vercel/`
  - `profiles/python-web/`
  - `profiles/rust-basic/`
  - `profiles/rust-cli/`
  - `profiles/rust-web/`
  - `profiles/static-site/`
  - `profiles/swift-app/`
  - `profiles/swift-cli/`
  - `profiles/swift-web/`
  - `profiles/wordpress-plugin/`
<!-- yaw:map:end area-profiles -->

## test

Describe this area's responsibility.

<!-- yaw:map:begin area-test -->
- Paths: `test/**`
- Entry points: -
- Tests: -
- Relates to: -
- ADRs: -
- Directories:
  - `test/`
  - `test/fixtures/`
  - `test/helpers/`
  - `test/profiles/`
<!-- yaw:map:end area-test -->

## website

Describe this area's responsibility.

<!-- yaw:map:begin area-website -->
- Paths: `website/**`
- Entry points: -
- Tests: -
- Relates to: -
- ADRs: -
- Directories:
  - `website/`
  - `website/assets/`
<!-- yaw:map:end area-website -->

## Top-level files

Describe this area's responsibility.

<!-- yaw:map:begin area-root -->
- Paths: `*`
- Entry points: -
- Tests: -
- Relates to: -
- ADRs: -
- Directories:
  - `./`
<!-- yaw:map:end area-root -->
