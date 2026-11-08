# Engineering practices

## Behavior and maintenance

- Unit tests are optional: the Quality reviewer must not require a unit-test suite or report its absence as findings.
- Test changed behavior, boundaries, failure paths and security-sensitive checks; add regression tests for bugs. Report what could not be tested.
- Keep user-facing errors concise, actionable and consistent. Never swallow errors silently; keep stack traces out of public errors. Use structured console logs (stdout/stderr), no log files unless the platform requires them; redact secrets and personal data.
- Keep setup, public contracts, non-obvious decisions and recovery instructions current; docs/code-map.md describes what each part of the code does, so do not restate the file layout elsewhere. Follow the stack formatter, linter and type checks; validate external inputs and use parameterized queries.

## Dependencies and runtime

- Use just as the command wrapper for installation, running, checks and builds.
- Prefer standard-library features; justify external dependencies. Do not invent cryptography or authentication.
- Docker is not required: keep development and checks usable without it.

Run `just check` before reporting completion.
