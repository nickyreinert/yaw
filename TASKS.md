# Tasks

## Active

## Backlog

- T-001 Deliver tailored profiles for all offered language and destination combinations
  model: sonnet · effort: high
  acceptance: Replace generic basic-profile fallbacks with verified installation, run, test, build and deployment or packaging configuration for each supported destination. Cover environment requirements and verify each profile with an appropriate smoke test. Track remaining combinations explicitly; do not imply that a basic toolchain includes deployment scaffolding.

  progress: 10/26, done: python×serverless → python-vercel (ADR-0101), typescript×self-hosted → node-web (ADR-0102), php×local → php-cli (ADR-0104), typescript×app-store → node-app (ADR-0106), php×serverless → php-serverless (ADR-0107; php-basic removed), swift×local → swift-cli (ADR-0110), swift×self-hosted → swift-web (ADR-0111), swift×app-store → swift-app (ADR-0112; swift-basic removed), rust×local → rust-cli (ADR-0113), rust×self-hosted → rust-web (ADR-0114) (a combination is done when a tailored profile owns the pair, its fixture is smoke-tested and CI runs `yaw init` + `just check`)
  - python: ~~serverless~~ (done) · edge (to consider later: Python Workers are beta, handler not testable outside the runtime; stays on python-basic) · app-store (dropped: no sensible Python app-store path; the interview rejects the pair)
  - typescript: ~~self-hosted~~ (done) · static (keep: Vite + TypeScript build to a static site, differs from html static-site) · ~~app-store~~ (done)
  - php: ~~local~~ (done) · ~~serverless~~ (done: container or Bref option, ADR-0107)
  - kotlin: local · self-hosted · serverless
  - go: local · self-hosted · serverless · app-store
  - java: local · self-hosted · serverless · app-store
  - rust: ~~local~~ (done) · ~~self-hosted~~ (done) · serverless · edge · app-store
  - swift: ~~local~~ (done) · ~~self-hosted~~ (done) · ~~app-store~~ (done: SwiftUI package; the Xcode app target and signing are yours)
  toolchains missing on this machine: go, kotlinc (their profiles cannot be smoke-tested locally; CI only)

## Done → TASKS.archive.md
