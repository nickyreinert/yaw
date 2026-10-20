# ADR-0008: Runtime floor, platforms and development tools

- Status: Accepted
- Date: 2026-10-20
- Issue: #20 (Y-2.1); CI in #21 (Y-2.2)
- Resolves: H9, H10, S7 (dev tools) (`docs/build/plan.md` §1.4, §1.6); records BD11

## Context

BD11 fixed the outline: macOS and Linux for v0.1, Windows only via WSL, Node ≥ 22.13 (`node:sqlite` without a flag), CI on Node 22 and 24, the `node:sqlite` ExperimentalWarning suppressed. B rule 3 allows dev-only tooling when an ADR lists it.

## Decision

### Runtime (what users need)

| Tool | Version | Used for | Missing |
|---|---|---|---|
| Node.js | ≥ 22.13 | the kit (`bin/yaw`, hooks); `node:sqlite` for `~/.yaw/yaw.db` | `install.sh` stops with a hint; `yaw doctor` fails |
| git | any current (≥ 2.28) | install and self-update (clone, fetch, tags), `git merge-file` and `git diff --no-index` for `yaw update` (ADR-0003) | `install.sh` stops with a hint; `yaw doctor` fails |
| just | any current | projects' uniform verbs (doc 01 §6) | `install.sh` prints a hint and continues; `yaw doctor` warns |
| bash | 3.2 or newer | `install.sh` only (macOS ships 3.2: no associative arrays, `mapfile`, `${var,,}`) | – |

- `install.sh` checks and prints install commands; it never installs anything and never uses `sudo` (doc 01 §4).
- The `node:sqlite` warning is filtered by `loadSqlite()` (ADR-0018), not by `--no-warnings`.
- Zero runtime dependencies: only Node built-ins; no `npm install` step for users.

### Platforms

- v0.1 supports macOS and Linux. Windows is supported through WSL only; no native Windows paths, shells or line endings are handled beyond the CRLF hash rule of ADR-0003.

### Development tools (kit repo only)

| Tool | Where | Why |
|---|---|---|
| `node --test` | local + CI | test runner (built in) |
| `shellcheck` | CI (`kit-ci` job `shellcheck`); optional locally | every `*.sh` in the repo must pass with default settings |
| GitHub Actions `actions/checkout@v4`, `actions/setup-node@v4` | CI | runners |

No npm dev dependencies.

### CI matrix

- `kit-ci` runs `npm test` and `npm run validate` on `ubuntu-latest` and `macos-latest` with Node `22.13` (the floor) and `24`.
- `install.sh` end-to-end runs once more inside the `node:22.13-bookworm` container (clean Debian, Y-2.3).

## Consequences

- Testing the floor version catches use of newer Node APIs early.
- Contributors without `shellcheck` still pass `npm test`; CI enforces the lint.
- macOS runners cost more CI minutes in a private repo; the matrix keeps them because macOS is a supported platform.
