# Engineering practices

## Behavior and maintenance

- Unit tests are optional: the Quality reviewer must not require a unit-test suite or report its absence as findings.
- Test changed behavior, boundaries, failure paths and security-sensitive checks; add regression tests for bugs. Report what could not be tested.
- Keep user-facing errors concise, actionable and consistent. Never swallow errors silently; keep stack traces out of public errors. Use structured console logs (stdout/stderr), no log files unless the platform requires them; redact secrets and personal data.
- Keep setup, public contracts, non-obvious decisions and recovery instructions current; docs/code-map.md describes what each part of the code does, so do not restate the file layout elsewhere. Follow the stack formatter, linter and type checks; validate external inputs and use parameterized queries.
- Write small, focused units with clear names; no dead code or speculative abstraction; comment only what the code cannot say.
- Avoid N+1 queries; bound loops and queries and paginate; cache only where measured; keep assets within a size budget.
- Use Conventional Commits and small pull requests.

## Dependencies and runtime

- Use just as the command wrapper for installation, running, checks and builds.
- Prefer standard-library features; justify external dependencies. Do not invent cryptography or authentication.
- Docker is not required: keep development and checks usable without it.

## Stack rules

- Node >= 22.13, ES modules (`"type": "module"`), only Node built-ins; add a dependency only with a written reason.
- Tests use `node:test` and `node:assert/strict`; run them with `just test`, never with a global runner.
- Tests create files in `os.tmpdir()` and clean up; no network, no real home directory.
- Read files with explicit encodings; fail with a message that names the file and the reason.
- CLI: parse arguments with `node:util` `parseArgs`; exit 0 on success, 1 on error; errors go to stderr.
- Do not swallow errors (`catch {}`); handle `ENOENT` and similar codes explicitly.
- Shell scripts pass `shellcheck`; `just lint` runs it when it is installed.
- Releases are git tags (`v<version>`), published only with the user's approval.

Run `just check` before reporting completion.
