# ADR-0001: YAML for human-edited files, JSON for kit-written files; strict YAML subset

- Status: Proposed
- Date: 2026-10-20
- Issue: #5 (Y-1.1), implemented in #6 (Y-1.2)
- Resolves: F1, F2, F3, F4 (`docs/build/plan.md` §1.1); binding decisions BD1, BD2

## Context

YAW reads files that people write by hand (answers, module and profile definitions, presets, `github.yaml`) and files the kit writes itself (manifest, ledger data, hook events). The kit has zero runtime dependencies (B rule 3), so a YAML library is not an option. Full YAML 1.2 is large and has traps (anchors, tags, implicit typing of `no`/`on`). BD1 fixes the subset's outline; this ADR states it precisely.

## Decision

### File formats

| Format | Files |
|---|---|
| YAML (human-edited) | `.yaw/answers.yaml`, `modules/*/module.yaml`, `modules/*/items/*.yaml`, `profiles/*/profile.yaml`, `interview/base.yaml`, `adapters/capabilities.yaml`, `.yaw/config.yaml`, `.yaw/github.yaml`, `~/.yaw/user-profile.yaml`, `~/.yaw/presets/*.yaml`, `.yaw/release-plan.yaml` (phase 2) |
| JSON (kit-written) | `.yaw/manifest.json`, task ledger data, session registry data, normalised hook events, agent settings (`.claude/settings.json`, `.codex/hooks.json`, …) |
| Exceptions (BD2) | `github.yaml` stays YAML although `yaw gh setup` fills in project/field IDs; `taxonomy.json` stays JSON (managed through `yaw decisions`) |

### Accepted YAML subset

1. **Block mappings** `key: value`. Keys are plain or quoted and are always strings (`0.1:` is the string `"0.1"`). Duplicate keys are an error.
2. **Block sequences** `- item`, including compact forms (`- key: value`, `- - item`) and a sequence under a key at the key's own indentation or deeper.
3. **Scalars** on one line: plain, single-quoted (`''` escapes `'`), double-quoted (escapes `\\ \" \/ \b \f \n \r \t \0 \uXXXX`).
4. **Flow collections** `[a, b]` and `{ k: v }`, nestable, may span lines, trailing comma allowed. Flow mapping entries need `key: value`.
5. **Block scalars** `|` (literal) and `>` (folded) with chomping indicators `-` and `+`. A comment may follow the indicator. Indentation is taken from the first non-empty content line.
6. **Comments** `#` at the start of a line or after whitespace.
7. Indentation uses spaces only. An empty document is `null`. A UTF-8 BOM and CRLF line ends are accepted.

### Typing (YAML 1.2 core schema, plain scalars only)

| Plain scalar | Value |
|---|---|
| `null`, `Null`, `NULL`, `~`, empty | `null` |
| `true`, `True`, `TRUE`, `false`, `False`, `FALSE` | boolean |
| `[-+]?[0-9]+`, `0o[0-7]+`, `0x[0-9a-fA-F]+` | integer (must be a safe integer) |
| `[-+]?(\.[0-9]+\|[0-9]+(\.[0-9]*)?)([eE][-+]?[0-9]+)?` | float |
| anything else, e.g. `yes`, `no`, `on`, `off`, `2026-10-20`, `0.3.0` | string |

Quoted scalars and block scalars are always strings. `.inf`, `-.inf` and `.nan` are rejected, because the data model is JSON.

### Rejected features

Each is reported as `<file>:<line>: <message>` (the error object also carries `column`):

- anchors `&a`, aliases `*a`, tags `!t` / `!!str`, merge keys `<<`
- directives `%YAML`, document markers `---` and `...` (no multi-document files, no leading `---`)
- complex keys `? key`, flow collections as keys
- multi-line plain or quoted scalars (use `|` or `>` instead)
- block scalar indentation indicators (`|2`)
- tabs in indentation, reserved indicators `@` and `` ` `` at the start of a plain scalar
- a mapping on the same line as its key (`key: a: b`), single-pair mappings inside flow sequences (`[a: b]`)

### Emitter

- Block style, two-space indentation, sequences indented under their key, key order preserved.
- Strings are written plain when they read back unchanged, as a literal block (`|`, `|-`, `|+`) when they contain line breaks, otherwise double-quoted. Empty collections are written as `[]` / `{}`.
- Every emitted file starts with this header comment:
  `# Written by yaw. Comments are not preserved when yaw rewrites this file (yaw config set and similar commands).`
- Comments are not preserved (BD1). The kit rewrites a YAML file only through explicit commands (`yaw config set`, `yaw gh setup`, `yaw presets …`).
- Guarantee, tested on every example file: `parse(emit(x))` equals `x`, and emitting twice gives the same text.

### API (`core/lib/yaml.js`)

`parse(text, { file })`, `parseDocument(text, { file })` → `{ value, lines }` (`lines` maps JSON pointers to 1-based source lines, used by the schema validator, ADR-0005), `stringify(value, { header })`, `YamlError { file, line, column }`.

## Consequences

- Files are readable and diff-friendly; YAML's surprising cases cannot occur because they are errors.
- Some valid YAML that people paste from elsewhere is rejected; the error names the line and the fix.
- Hand-written comments are lost when the kit rewrites a file; the header warns about this, and rewrites happen only on explicit commands.
