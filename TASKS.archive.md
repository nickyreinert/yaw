# Archive

- T-006 Stop sync exclusions deleting files — done 2026-11-08
  model: opus · effort: high
  done: `localKnowledge` in core/lib/data-sync.js reports Markdown files that exist but cannot be synced (over 128 KiB, unreadable, linked, non-regular, empty, secret-looking or past the 1000-file cap) as `excluded`; `mergeRecords` skips those keys, so they are never published as tombstones, never deleted or overwritten locally and keep their merge base. Folder sync (`runSync`) and the hub client (`syncHub`) both return `excluded`. Once a file is portable again, concurrent edits surface as a conflict. Tests in test/data-sync.test.js and test/remote-control.test.js. The data-sync.js and data-sync.test.js part landed in commit 8971c64 (committed together with T-017). Suite: 1075 passed / 9 failed / 85 skipped (none in sync or remote tests).

- T-010 Harden hook logs — done 2026-11-08
  model: sonnet · effort: high
  done: `appendLog` in core/hooks/dispatch.js keeps `~/.yaw/logs` a real 0700 directory and opens log files with O_NOFOLLOW|O_NONBLOCK as 0600 regular files of the current user (symlinks, FIFOs and foreign owners are skipped, logging stays fail-open); loose modes left by older versions are tightened; rotation renames the verified file to `<file>.1` and reopens a new 0600 file. Tests in test/hook-logs.test.js. Offline suite: 9 failed, none from this change (2 hook tests, test/hooks.test.js and test/silent-hooks.test.js, also fail on HEAD).

- T-014 Reject malformed LAN responses safely — done 2026-11-08
  model: sonnet · effort: medium
  done: `core/remote/lan.js:lanFetch` builds bodyless statuses (1xx/204/205/304) without a body and rejects through the promise on response-construction errors, interrupted or aborted responses. Regression: `test/lan-fetch.test.js`.

- T-007 Preserve analytics when history is unavailable — done 2026-11-08
  model: sonnet · effort: high
  done: `collectAnalysis` in core/lib/session-analysis.js no longer drops saved rows the scan did not find (deleted/moved file, missing or disabled source, discovery limit). They keep their metrics and classifications; in-scope local rows not rediscovered are counted as `missing` and `scanSummary` reports them. Tests in test/session-analysis.test.js. Suite: 1073 passed / 10 failed / 85 skipped (none in session-analysis; test/analytics-filters.test.js failed under load but passes alone).

- T-023 Publish personal YAML updates atomically — done 2026-11-08
  model: sonnet · effort: high
  done: `write()` in core/lib/user-store.js publishes a private 0600 temp file in the target directory by rename (replace) or link (exclusive); profile, preset, user data and seeded defaults use it, new presets and renames never replace a concurrent save (preset names retry with the next suffix). Tests in test/user-store.test.js. Offline suite: 1072 passed / 11 failed (none in user-store).

- T-019 Isolate recipe tests from installed YAW — done 2026-11-08
  model: sonnet · effort: medium
  done: `pathWithout()` in test/helpers/fixtures.js gives code-map, GitHub and composition tests the host PATH minus `yaw` (and `gh`), so kit-absent cases cannot run an installed CLI; `just` recipes were not run here (just not installed), github-status tests already used explicit stubs.

- T-035 Fix Classification opening error — done 2026-11-08
  model: low tier (Luna/Haiku) · effort: medium
  acceptance: opening Classification in Global Settings does not throw "Cannot access 'link' before initialization"; regression test opens the view.
  done: in `core/web/assets/global-settings-view.js`, the Laya setup card declared `const link` for the GitHub anchor in the same function scope as the imported `link()` helper used by step 4, so the call ran in the temporal dead zone. Renamed the anchor to `docs`. Regression test `test/global-classification-view.test.js` renders the tab with a minimal DOM stub; it failed with the reported error before the fix and passes after. Code fix landed in 8971c64 (staged with another agent's T-017 commit); this commit adds the test and the TASKS entries.

- T-046 Load CLI command modules on demand (compact output, latency plan step 1) — done 2026-11-08
  model: sonnet · effort: low
  acceptance: `core/cli/main.js` loads command handlers and the hook dispatcher with `import()` when used, so a hook call does not load every command first. The full offline test suite shows the same failures before and after.
  done: commit 7204b07, on main (332b364). Measured on Node 22.23.4 in a Linux container, 20-run averages: `yaw hook` 127 → 67 ms, `yaw --version` 114 → 54 ms. Offline suite after the merge: 1055 passed, 4 failed, 85 skipped; the 4 failures also fail without the change.

- T-004 Tell users which third-party tools a stack needs
  model: sonnet · effort: medium
  acceptance: Every arch stack requiring third-party tools (e.g. AWS CLI) tells the user while selecting it and at the end of setup, with copy-paste install commands per platform. Profiles declare them in an optional `tools` list (ADR-0116); proof: php-serverless (bref), rust-serverless (lambda), node-app (tauri). Add the remaining profiles' tools as they are tailored.
  closed: python-vercel (node) and android-kotlin (adb) added; no other profile needs one.

- T-001 Deliver tailored profiles for all offered language and destination combinations
  model: sonnet · effort: high
  acceptance: Replace generic basic-profile fallbacks with verified installation, run, test, build and deployment or packaging configuration for each supported destination. Cover environment requirements and verify each profile with an appropriate smoke test. Track remaining combinations explicitly; do not imply that a basic toolchain includes deployment scaffolding.

  progress: 21/26, done: python×serverless → python-vercel (ADR-0101), typescript×self-hosted → node-web (ADR-0102), php×local → php-cli (ADR-0104), typescript×app-store → node-app (ADR-0106), php×serverless → php-serverless (ADR-0107; php-basic removed), swift×local → swift-cli (ADR-0110), swift×self-hosted → swift-web (ADR-0111), swift×app-store → swift-app (ADR-0112; swift-basic removed), rust×local → rust-cli (ADR-0113), rust×self-hosted → rust-web (ADR-0114), rust×serverless → rust-serverless (ADR-0115: container or Lambda option), kotlin×local → kotlin-cli (ADR-0117; kotlin-basic removed), kotlin×self-hosted → kotlin-web (ADR-0118), kotlin×serverless → kotlin-serverless (ADR-0119: container or Lambda option), go×local → go-cli (ADR-0121), go×self-hosted → go-web (ADR-0122), go×serverless → go-serverless (ADR-0123: container or Lambda option), java×local → java-cli (ADR-0125), java×self-hosted → java-web (ADR-0126), java×serverless → java-serverless (ADR-0127: container or Lambda option), typescript×static → node-static (ADR-0128; node-basic removed) (a combination is done when a tailored profile owns the pair, its fixture is smoke-tested and CI runs `yaw init` + `just check`)
  - python: ~~serverless~~ (done) · edge (to consider later: Python Workers are beta, handler not testable outside the runtime; stays on python-basic) · app-store (dropped: no sensible Python app-store path; the interview rejects the pair)
  - typescript: ~~self-hosted~~ (done) · ~~static~~ (done: Vite + TypeScript build to dist/, ADR-0128) · ~~app-store~~ (done)
  - php: ~~local~~ (done) · ~~serverless~~ (done: container or Bref option, ADR-0107)
  - kotlin: ~~local~~ (done) · ~~self-hosted~~ (done) · ~~serverless~~ (done: container or Lambda option) · app-store (android-kotlin)
  - go: ~~local~~ (done) · ~~self-hosted~~ (done; chi not offered) · ~~serverless~~ (done: container or Lambda option) · app-store (to consider later: gomobile needs the Android SDK or Xcode and Wails a frontend toolchain plus webkit, neither gateable offline; stays on go-basic)
  - java: ~~local~~ (done) · ~~self-hosted~~ (done) · ~~serverless~~ (done: container or Lambda option) · app-store (to consider later: an Android app needs the Android SDK, which the gate cannot run offline; stays on java-basic)
  - rust: ~~local~~ (done) · ~~self-hosted~~ (done) · ~~serverless~~ (done: container or Lambda option) · edge (to consider later: workers-rs builds only with the wasm32 target and worker-build, absent on this machine, so the build cannot be gated offline; type-checks natively; stays on rust-basic; the rust-basic CI job installs no wasm32 target because nothing in its gate builds for it, so add the target together with the worker-build step) · app-store (to consider later: Tauri is covered by node-app; stays on rust-basic)
  - swift: ~~local~~ (done) · ~~self-hosted~~ (done) · ~~app-store~~ (done: SwiftUI package; the Xcode app target and signing are yours)
  toolchains missing on this machine: none required beyond what is listed. The Go profiles were smoke-tested locally with a temporary Go 1.27.3 (Dockerfiles and Lambda deployment unverified; go 1.22 minimum not run). The Kotlin profiles are smoke-tested locally with JDK 21 and Gradle; JDK 17 is checked in CI only.
  closed: remaining exotic pairs (python edge/app-store, go/java/rust app-store, rust edge) dropped; they stay on their basic profiles.

- T-005 Tests must not leak yaw-* temp dirs
  model: sonnet · effort: low
  acceptance: Every temp dir a test creates is removed when the test process exits, also after failures and for smoke tests; test/helpers/fixtures.js `tmp` registers dirs and removes them on exit, other test files use it. Proof: yaw-* count in $TMPDIR is unchanged after running test files.
  done: helper in place and verified (5 files, count unchanged). Dirs left by earlier runs are not cleaned.

- T-003 Profile options: let a profile offer a choice that selects its scaffold, starting with TypeScript x app-store
  model: sonnet · effort: high
  acceptance: No profile-option mechanism exists yet (profile.yaml comments only mention it). Design it (ADR): option in profile.yaml, question in the interview and browser form, answer stored, render picks the matching scaffold variant, a pair still picks exactly one profile. First use: TypeScript x app-store with the most common frameworks (Capacitor, Expo/React Native, Electron, Tauri); the user decides in the interview. A framework is a library, so the interview must say that it overrides "prefer built-in" for this choice. Each variant needs a smoke-tested gate that runs without Xcode, the Android SDK or signing. Needs the web UI updated; coordinate with other work in core/web.
  done: ADR-0105 (options in profile.yaml -> question arch.<profile>-<option>, scaffold variants/<choice>/), ADR-0106 (node-app: capacitor, expo, electron, tauri; smoke-tested per variant, CI matrix).

- T-002 Rename the language id "javascript" to "typescript"
  model: sonnet · effort: medium
  acceptance: The UI card says TypeScript but the stored id is javascript. Rename the id in interview/base.yaml, every profile.yaml, examples, tests and docs; keep reading old answers files and saved presets that say javascript (map to typescript). Do before more TypeScript profiles are added.
  done: ADR-0103; id is typescript everywhere, core/interview/legacy.js reads old javascript answers, presets, API input and plan replies.

- T-017 Keep Git sync off the HTTP event loop — done 2026-11-08
  model: sonnet · effort: high
  done: `runSync` in core/lib/data-sync.js is now a generator (`syncSteps`) driven synchronously by `runSync` (CLI, tests) or asynchronously by `runSyncAsync` (cancellable process-group `commandAsync`). The web `sync-run` action starts a background job (409 while one runs); `GET /api/sync-job` reports status/step/result and `sync-cancel` aborts it, killing the Git/gh process tree and releasing the locks. The Sync settings page polls the job and offers Cancel. Tests in test/data-sync.test.js cover event-loop ticks during a blocked `gh`, concurrent reads, cancellation and process cleanup.
