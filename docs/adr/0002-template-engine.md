# ADR-0002: Template engine

- Status: Proposed
- Date: 2026-10-20
- Issue: #8 (Y-1.4); implemented in Y-2.5 (render engine)
- Resolves: `BUILD.md` step 1 "decide by ADR: template engine"

## Context

Modules and profiles render files into projects: Markdown (`AGENTS.md`, `TASKS.md`), `justfile` fragments, CI workflows, shell scripts, config files. The kit has zero runtime dependencies (B rule 3), so a library such as Mustache or EJS is out. The templates must stay readable as the files they produce (no black box).

Collisions matter: `just` interpolates `{{var}}`, GitHub Actions uses `${{ expr }}`, Jinja (Flask scaffolds) uses `{{ }}` and `{% %}`, shell uses `[[ ]]` and `<<EOF`, Markdown is full of backticks.

## Options

| Option | For | Against |
|---|---|---|
| A. Plain JS template functions (`` (ctx) => `…` `` per file) | No engine; full JS power | Every backtick in Markdown/shell must be escaped; logic mixes with content; templates are code, not files |
| B. Tiny built-in renderer over text files | Templates look like the output; small, testable; no code execution from templates | Has to be written (≈ 100 lines) and its syntax learned |
| C. Mustache-style `{{ }}` renderer | Familiar syntax | Collides with `just`, GitHub Actions and Jinja |

## Decision

**Option B**, a tiny renderer in `core/render/` with `<% %>` tags:

| Tag | Meaning |
|---|---|
| `<%= path %>` | Insert a value (`answers.idea.text`, `profile.name`). Missing path = render error naming template and line |
| `<% if path %>` … `<% else %>` … `<% end %>` | Truthy test (non-empty string/list, `true`, non-zero number) |
| `<% each path as name %>` … `<% end %>` | Loop over a list; `name` is in scope inside |
| `<%%` | Literal `<%` |

Rules:

- No expressions, filters, helpers or includes; computed values are prepared in JS before rendering.
- No escaping by default (outputs are code and Markdown, not HTML).
- A line that contains only a block tag (`if`, `else`, `each`, `end`) is removed entirely, so templates keep clean line structure.
- Only files ending in `.tmpl` are rendered (the suffix is dropped); all other files under `templates/` are copied byte for byte.
- Structured outputs (`.claude/settings.json`, `.codex/hooks.json`, `manifest.json`) are built as data and serialised (JSON or the YAML emitter, ADR-0001), never through text templates.

## Consequences

- `{{ }}`, `${{ }}`, `{% %}`, `[[ ]]` and backticks pass through untouched.
- Templates cannot run code, which keeps the render step deterministic and safe to review.
- If a template needs logic beyond `if`/`each`, the logic moves into the module's JS that prepares the context.
