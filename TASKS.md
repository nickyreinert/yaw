# Tasks

## Active

## Backlog

- T-001 Deliver tailored profiles for all offered language and destination combinations
  model: sonnet · effort: high
  acceptance: Replace generic basic-profile fallbacks with verified installation, run, test, build and deployment or packaging configuration for each supported destination. Cover environment requirements and verify each profile with an appropriate smoke test. Track remaining combinations explicitly; do not imply that a basic toolchain includes deployment scaffolding.

  progress: 2/26, done: python×serverless → python-vercel (ADR-0101), javascript×self-hosted → node-web (ADR-0102) (a combination is done when a tailored profile owns the pair, its fixture is smoke-tested and CI runs `yaw init` + `just check`)
  - python: ~~serverless~~ (done) · edge (to consider later: Python Workers are beta, handler not testable outside the runtime; stays on python-basic) · app-store (dropped: no sensible Python app-store path; the interview rejects the pair)
  - javascript (labelled TypeScript in the UI): ~~self-hosted~~ (done) · static (keep: Vite + TypeScript build to a static site, differs from html static-site) · app-store (blocked by T-003)
  - php: local · serverless
  - kotlin: local · self-hosted · serverless
  - go: local · self-hosted · serverless · app-store (dropped: no sensible Python app-store path; the interview rejects the pair)
  - java: local · self-hosted · serverless · app-store (dropped: no sensible Python app-store path; the interview rejects the pair)
  - rust: local · self-hosted · serverless · edge · app-store (dropped: no sensible Python app-store path; the interview rejects the pair)
  - swift: local · self-hosted · app-store (dropped: no sensible Python app-store path; the interview rejects the pair)
  toolchains missing on this machine: go, kotlinc (their profiles cannot be smoke-tested locally; CI only)

- T-002 Rename the language id "javascript" to "typescript"
  model: sonnet · effort: medium
  acceptance: The UI card says TypeScript but the stored id is javascript. Rename the id in interview/base.yaml, every profile.yaml, examples, tests and docs; keep reading old answers files and saved presets that say javascript (map to typescript). Do before more TypeScript profiles are added.

- T-003 Profile options: let a profile offer a choice that selects its scaffold, starting with TypeScript x app-store
  model: sonnet · effort: high
  acceptance: No profile-option mechanism exists yet (profile.yaml comments only mention it). Design it (ADR): option in profile.yaml, question in the interview and browser form, answer stored, render picks the matching scaffold variant, a pair still picks exactly one profile. First use: TypeScript x app-store with the most common frameworks (Capacitor, Expo/React Native, Electron, Tauri); the user decides in the interview. A framework is a library, so the interview must say that it overrides "prefer built-in" for this choice. Each variant needs a smoke-tested gate that runs without Xcode, the Android SDK or signing. Needs the web UI updated; coordinate with other work in core/web.

## Done → TASKS.archive.md
