# ADR-0014: Kit repository and test layout

- Status: Proposed
- Date: 2026-10-20
- Issue: #20 (Y-2.1); implemented in #21 (Y-2.2)
- Resolves: S5 (`docs/build/plan.md` §1.6). Supersedes ADR-0016 (interim step-1 layout) once accepted; ADR-0016's table stays valid and is included below.

## Context

Doc 01 §2 shows the kit layout, `test/` for kit tests (ADR-0016), `modules/<module>/tests/`, `profiles/<profile>/tests/` (doc 05 §2) and `examples/<profile>/` sample projects (doc 01 §2, doc 05 §4). `BUILD.md` step 6 names `test/profiles/<name>/` for fixture projects. Plain `node --test` runs **every** `.js` file below any `test/` folder and every `*.test.js` anywhere, so helpers and sample projects would run as kit tests.

## Decision

| Path | Content |
|---|---|
| `install.sh` | installer (ADR-0006) |
| `bin/yaw` | CLI entry, executable Node script without extension |
| `core/cli/` | command table and commands (`main.js`, `commands.js`, `doctor.js`, `self.js`, `prompt.js`) |
| `core/render/` | template renderer (`template.js`, ADR-0002), file access and path guard (`files.js`), shared-file composition (`compose.js`, ADR-0004), kit and module loading (`kit.js`), manifest (`manifest.js`), update flow (`reconcile.js`, ADR-0003), project operations (`project.js`) |
| `core/lib/` | shared libraries (ADR-0016): `yaml.js`, `schema.js`, `tasks.js`, `db.js` |
| `core/schema/` | schemas, examples, `validate.js` (ADR-0016) |
| `modules/<module>/` | `module.yaml`, `templates/` (paths relative to the project; `.tmpl` rendered, other files copied), later `skills/`, `agents/`, `hooks/`, `scripts/`, `tests/` |
| `profiles/<profile>/` | doc 05 §2, incl. `tests/` |
| `examples/<profile>/` | sample projects for the kit CI (doc 01 §2, doc 05 §4); used instead of `test/profiles/<name>/` from `BUILD.md` step 6 |
| `test/*.test.js` | kit tests |
| `test/helpers/` | shared test helpers (plain modules, not tests) |
| `test/fixtures/<agent>/<event>.json` | recorded hook payloads (B rule 7) |
| `.github/workflows/kit-ci.yml` | kit CI (ADR-0008) |
| `docs/adr/`, `docs/spec/`, `docs/build/` | ADRs (until step 5.6, BD7), format reference, build plan |

### Test runner

- `npm test` runs `node --test "test/**/*.test.js" "modules/*/tests/*.test.js" "profiles/*/tests/*.test.js"`: only files named `*.test.js` are tests, wherever they live. Node expands the quoted globs itself (Node ≥ 22), so this works the same in every shell.
- Plain `node --test` without arguments is not the kit's test command (it would also run helpers and, later, the sample projects' own tests).
- Tests create everything they need in temp folders (`os.tmpdir()`); child processes get a clean environment (temp `HOME`, `GIT_CONFIG_NOSYSTEM=1`, fixed git identity), so the developer's git and shell config cannot change results.

## Consequences

- Sample projects live outside `test/`, so their own tests never run as kit tests.
- `BUILD.md` step 6 and the Y-6.x rows say `test/profiles/<name>/`; step 6 uses `examples/<name>/` per this ADR.
- When this ADR is accepted, ADR-0016 is marked "Superseded by ADR-0014".
