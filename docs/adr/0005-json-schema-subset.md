# ADR-0005: JSON Schema subset and validator

- Status: Proposed
- Date: 2026-10-20
- Issue: #7 (Y-1.3)
- Resolves: S7, schema part (`docs/build/plan.md` §1.6)

## Context

Every YAW file format needs a machine-checkable definition, and errors in hand-written YAML must point to the line. A full JSON Schema implementation is far too large for a zero-dependency kit (B rule 3).

## Decision

Schemas are JSON Schema 2020-12 documents (`core/schema/*.schema.json`) restricted to this subset. The validator is `core/lib/schema.js`.

| Group | Keywords |
|---|---|
| Structure | `$ref` (local `#/…` and other schema files by name: `common.schema.json#/$defs/name`), `$defs` |
| Any type | `type` (string or list: `object`, `array`, `string`, `number`, `integer`, `boolean`, `null`), `enum`, `const` |
| Strings | `minLength`, `maxLength` (Unicode code points), `pattern` (ECMAScript, `u` flag, unanchored) |
| Numbers | `minimum`, `maximum` |
| Arrays | `items` (one schema), `minItems`, `maxItems`, `uniqueItems` |
| Objects | `properties`, `required`, `additionalProperties` (boolean or schema), `patternProperties` |
| Combinators | `allOf`, `anyOf`, `oneOf`, `not` |
| Annotations (ignored) | `$schema`, `$id`, `$comment`, `title`, `description`, `default`, `examples` |

Boolean schemas (`true` / `false`) are supported.

Rules:

- Any other keyword (`format`, `if`, `propertyNames`, `prefixItems`, …) is rejected when the schema is loaded, so a typo cannot silently weaken a schema. Adding a keyword means extending this ADR, the validator and its tests.
- `$ref` targets are resolved once at load time (`checkRefs()`); an unresolved `$ref` is a load error.
- `$id` equals the file name.
- Errors are `{ pointer, line, message }`. `pointer` is a JSON pointer (RFC 6901); `line` comes from the YAML parser's pointer → line map (ADR-0001). Missing properties are reported at the parent object's line. JSON input has `line: null`.
- `anyOf`/`oneOf`: alternatives that failed on their type are ignored; if one alternative is clearly closest (fewest errors), its errors are reported, otherwise one summary error lists each alternative's errors.
- CLI: `node core/schema/validate.js` checks every example in `core/schema/examples/<schema>/`; `node core/schema/validate.js <schema> <file>` checks one file.

## Consequences

- Schemas stay readable by standard JSON Schema tools (the subset is valid 2020-12).
- Cross-field rules that need unsupported keywords (e.g. "option default is one of its choices") are checked in code or tests, not in the schema.
