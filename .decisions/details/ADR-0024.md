# ADR-0024: `communication` and `standards` rendering details

- Status: Accepted
- Date: 2026-10-21
- Issue: Y-5.1
- Resolves: implementation details of doc 04 (`communication`, `standards`) (B rule 10); applies ADR-0013

## Decision

- **Questions.** `communication` asks 0.3 (`user.length`, Q) and 0.4 to 0.6 (`user.register`, `user.examples`, `user.explain`, S) as inline module questions with `scope: user`; values as in `user-profile.schema.json`. In Quick the S questions take their defaults. `user.expertise` (0.1) and `user.language` / `user.autonomy` stay base questions.
- **AGENTS.md.** `communication` adds a `## Communication` section of five rules (length, register, examples, explanation, expertise) from the answers. Language (0.2) and autonomy (0.7) already live in the `core` frame, so they are not repeated: six content lines in total with the heading. The rule texts live in `core/render/kit.js` (`rules.*`).
- **Output style.** Only with Claude selected and `user.length` not `balanced` or `user.register` not `professional`. Files: `.claude/output-styles/yaw.md` (name `YAW`, `keep-coding-instructions: true`) and `{"outputStyle": "YAW"}` merged into `.claude/settings.json`.
- **Conditional outputs.** A module template (`.tmpl`) that renders to whitespace only produces no file and no shared-file part. This is how the output style, its setting and the team-mode rule skip cleanly, and removal needs no special case.
- **standards.** The baseline and the stack overlay go into `docs/standards.md`, not into `AGENTS.md` (80-line budget, ADR-0009); `AGENTS.md` gets one pointer line. The overlay is `profiles/<p>/standards.md`, inserted as `profileStandards`; more than 20 lines is a render error.

## Consequences

- Quick and Standard installs of a full kit now include both modules; the file count grows by `docs/standards.md` (and the output-style files when non-default).
