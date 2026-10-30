# Tasks

## Active

## Backlog

- T-005 Tests must not leak yaw-* temp dirs
  model: sonnet · effort: low
  acceptance: Every temp dir a test creates is removed when the test process exits, also after failures and for smoke tests; test/helpers/fixtures.js `tmp` registers dirs and removes them on exit, other test files use it. Proof: yaw-* count in $TMPDIR is unchanged after running test files.
  done: helper in place and verified (5 files, count unchanged). Dirs left by earlier runs are not cleaned.

- T-004 Tell users which third-party tools a stack needs
  model: sonnet · effort: medium
  acceptance: Every arch stack requiring third-party tools (e.g. AWS CLI) tells the user while selecting it and at the end of setup, with copy-paste install commands per platform. Profiles declare them in an optional `tools` list (ADR-0116); proof: php-serverless (bref), rust-serverless (lambda), node-app (tauri). Add the remaining profiles' tools as they are tailored.

- T-001 Deliver tailored profiles for all offered language and destination combinations
  model: sonnet · effort: high
  acceptance: Replace generic basic-profile fallbacks with verified installation, run, test, build and deployment or packaging configuration for each supported destination. Cover environment requirements and verify each profile with an appropriate smoke test. Track remaining combinations explicitly; do not imply that a basic toolchain includes deployment scaffolding.

  progress: 17/26, done: python×serverless → python-vercel (ADR-0101), typescript×self-hosted → node-web (ADR-0102), php×local → php-cli (ADR-0104), typescript×app-store → node-app (ADR-0106), php×serverless → php-serverless (ADR-0107; php-basic removed), swift×local → swift-cli (ADR-0110), swift×self-hosted → swift-web (ADR-0111), swift×app-store → swift-app (ADR-0112; swift-basic removed), rust×local → rust-cli (ADR-0113), rust×self-hosted → rust-web (ADR-0114), rust×serverless → rust-serverless (ADR-0115: container or Lambda option), kotlin×local → kotlin-cli (ADR-0117; kotlin-basic removed), kotlin×self-hosted → kotlin-web (ADR-0118), kotlin×serverless → kotlin-serverless (ADR-0119: container or Lambda option), go×local → go-cli (ADR-0121), go×self-hosted → go-web (ADR-0122), go×serverless → go-serverless (ADR-0123: container or Lambda option) (a combination is done when a tailored profile owns the pair, its fixture is smoke-tested and CI runs `yaw init` + `just check`)
  - python: ~~serverless~~ (done) · edge (to consider later: Python Workers are beta, handler not testable outside the runtime; stays on python-basic) · app-store (dropped: no sensible Python app-store path; the interview rejects the pair)
  - typescript: ~~self-hosted~~ (done) · static (keep: Vite + TypeScript build to a static site, differs from html static-site) · ~~app-store~~ (done)
  - php: ~~local~~ (done) · ~~serverless~~ (done: container or Bref option, ADR-0107)
  - kotlin: ~~local~~ (done) · ~~self-hosted~~ (done) · ~~serverless~~ (done: container or Lambda option) · app-store (android-kotlin)
  - go: ~~local~~ (done) · ~~self-hosted~~ (done; chi not offered) · ~~serverless~~ (done: container or Lambda option) · app-store (to consider later: gomobile needs the Android SDK or Xcode and Wails a frontend toolchain plus webkit, neither gateable offline; stays on go-basic)
  - java: local · self-hosted · serverless · app-store
  - rust: ~~local~~ (done) · ~~self-hosted~~ (done) · ~~serverless~~ (done: container or Lambda option) · edge (to consider later: workers-rs builds only with the wasm32 target and worker-build, absent on this machine, so the build cannot be gated offline; type-checks natively; stays on rust-basic; the rust-basic CI job installs no wasm32 target because nothing in its gate builds for it, so add the target together with the worker-build step) · app-store (to consider later: Tauri is covered by node-app; stays on rust-basic)
  - swift: ~~local~~ (done) · ~~self-hosted~~ (done) · ~~app-store~~ (done: SwiftUI package; the Xcode app target and signing are yours)
  toolchains missing on this machine: none required beyond what is listed. The Go profiles were smoke-tested locally with a temporary Go 1.27.3 (Dockerfiles and Lambda deployment unverified; go 1.22 minimum not run). The Kotlin profiles are smoke-tested locally with JDK 21 and Gradle; JDK 17 is checked in CI only.

## Done → TASKS.archive.md
