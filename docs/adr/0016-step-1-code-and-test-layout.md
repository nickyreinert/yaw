# ADR-0016: Code, schema and test layout for step 1 (interim)

- Status: Proposed
- Date: 2026-10-20
- Issue: #4 (Y-1)
- Resolves: S5 for the parts step 1 needs (`docs/build/plan.md` §1.6); ADR-0014 (step 2) decides the full kit layout and may supersede this ADR

## Context

Step 1 adds the first code (parser, validator, schemas, tests) before ADR-0014 exists. Doc 01 §2 shows `tests/` at the kit root, `B` rule 7 and step 6 use `test/` (`test/fixtures/<agent>/<event>.json`, `test/profiles/<name>/`).

## Decision

| Path | Content |
|---|---|
| `package.json` | `"type": "module"`, `"private": true`, `"engines": { "node": ">=22.13" }`, `npm test` = `node --test`; no dependencies |
| `core/lib/` | Shared libraries: `yaml.js` (ADR-0001), `schema.js` (ADR-0005), `tasks.js` (TASKS.md), `db.js` (`yaw.db`, ADR-0018) |
| `core/schema/*.schema.json` | One schema per format, `$id` = file name; shared definitions in `common.schema.json` |
| `core/schema/examples/<schema>/` | Example files; the folder name selects the schema |
| `core/schema/validate.js` | Validator CLI over the examples or a single file |
| `test/*.test.js` | Kit tests, found by plain `node --test` |
| `docs/spec/formats.md` | Human-readable reference of all formats |

- Root test folder is `test/` (B rule 7); doc 01 §2 is updated accordingly. Per-module test folders (`modules/<module>/tests/`) are left to ADR-0014.
- Plain ES modules, no build step, no dev dependencies.

## Consequences

- `node --test` with no arguments runs everything; CI (Y-2.2) only needs Node.
- Step 2 builds on `core/lib/` and `core/schema/`; ADR-0014 records any move.
