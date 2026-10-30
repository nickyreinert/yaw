# Tasks

## Active

## Backlog

- T-001 Deliver tailored profiles for all offered language and destination combinations
  model: sonnet · effort: high
  acceptance: Replace generic basic-profile fallbacks with verified installation, run, test, build and deployment or packaging configuration for each supported destination. Cover environment requirements and verify each profile with an appropriate smoke test. Track remaining combinations explicitly; do not imply that a basic toolchain includes deployment scaffolding.

  progress: 1/26, done: python×serverless → python-vercel, ADR-0101 (a combination is done when a tailored profile owns the pair, its fixture is smoke-tested and CI runs `yaw init` + `just check`)
  - python: ~~serverless~~ (done) · edge (to consider later: Python Workers are beta, handler not testable outside the runtime; stays on python-basic) · app-store (dropped: no sensible Python app-store path; the interview rejects the pair)
  - javascript: self-hosted · static · app-store (dropped: no sensible Python app-store path; the interview rejects the pair)
  - php: local · serverless
  - kotlin: local · self-hosted · serverless
  - go: local · self-hosted · serverless · app-store (dropped: no sensible Python app-store path; the interview rejects the pair)
  - java: local · self-hosted · serverless · app-store (dropped: no sensible Python app-store path; the interview rejects the pair)
  - rust: local · self-hosted · serverless · edge · app-store (dropped: no sensible Python app-store path; the interview rejects the pair)
  - swift: local · self-hosted · app-store (dropped: no sensible Python app-store path; the interview rejects the pair)
  toolchains missing on this machine: go, kotlinc (their profiles cannot be smoke-tested locally; CI only)

## Done → TASKS.archive.md
