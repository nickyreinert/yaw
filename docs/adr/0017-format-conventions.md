# ADR-0017: Format conventions (names, agent keys, facts, questions and answers)

- Status: Proposed
- Date: 2026-10-20
- Issues: #10–#17 (Y-1.6 – Y-1.13)
- Resolves: F6, F7, F8 (partly), F10 (`docs/build/plan.md` §1.1)

## Context

The concept docs show example files but leave identifiers and cross-file conventions open: question IDs (`6.1` vs. `ui.direction`), the facts used by `appliesTo` / `suggestWhen` / "if UI", agent keys, where answers live, and some manifest fields. B rule 10: decide the simplest option consistent with the docs.

## Decision

1. **Names.** Modules, profiles, items, skills, subagents and gates: `^[a-z][a-z0-9-]*$`.
2. **Agent keys.** Selections (manifest `agents`, answers `user.agents`, hook events) accept the phase-1 agents `claude`, `codex`, `copilot` (BD8). Compatibility maps (`agents:` in modules, items, questions, `capabilities.yaml`) also accept `gemini`, `antigravity`, `pi`, `hermes`. The Claude Code key is `claude` everywhere (doc 12 §4 updated from `claude-code`). Session IDs are `<agent>:<agent session id>`.
3. **Facts vocabulary** (F7), derived from answers and the proposal, used by `module.yaml#appliesTo`, `default`, and `profile.yaml#suggestWhen`:

   | Fact | Type | Derived from |
   |---|---|---|
   | `hasUI` | boolean | proposal / UI questions (doc 03 §6) |
   | `language` | string, e.g. `python`, `javascript` | 3.1 / proposal |
   | `runsOn` | `local`, `self-hosted`, `docker`, `serverless`, `edge`, `app-store` | 3.2 / proposal |
   | `public` | boolean | 1.2 = public or 7.1 |
   | `storesData` | boolean | 3.3 ≠ none |
   | `hosted` | boolean | `runsOn` ≠ `local` |
   | `team` | boolean | 1.5 = team |
   | `usesGitHub` | boolean | 10.2 |
   | `needsVendors` | boolean | 9.1 not empty |
   | `knowledgeStore` | boolean | 0.9 |

   A condition is an object of facts; all keys must match; a list means "any of". Profile `defaults.modules` may say `auto` = decided by the module's own `appliesTo` / `default`.
4. **Preset defaults.** `module.yaml#default` (and items) is `{ quick, standard, full }`, each `true`, `false`, `"ask"` or a facts condition ("if UI" = `{ hasUI: true }`). The phase-1 contents of Standard and Full are ADR-0009's; this is only the shape.
5. **Question IDs** (F6): `<group>.<name>`, group = doc 03 section (`user`, `idea`, `domain`, `arch`, `delivery`, `quality`, `ui`, `privacy`, `backup`, `vendors`, `tasks`, `governance`, `team`), name in kebab-case; unique across the kit. The doc 03 number goes into `ref` (`"6.1"`). IDs containing `secret`, `token`, `password`, `apikey`, `api-key` or `credential` are invalid.
6. **One question format** for `interview/base.yaml` and modules: `id`, `ref`, `scope` (`project` / `user`), `mode` (`Q`/`S`/`F`), `type` (`text`, `choice`, `multi`, `boolean`, `number`; no secret type), `label`, `hint`, `help` (topic in `interview/help/`), `choices` (value or `{ value, label, note, phase }`), `default` (required), `when` (earlier answers), `agents`. Module questions are **inline** in `module.yaml#questions` (doc 02 §3); doc 04 §2 is updated, its example listed IDs only.
7. **Answers by question ID.** `.yaw/answers.yaml`, presets and `~/.yaw/user-profile.yaml` store `answers: { <question id>: <value> }`. Values are scalars or lists of scalars. `answers.yaml` adds `mode` and the `proposal:` section. Section-0 answers are defaults in the user profile; a project may override them (e.g. `user.agents`).
8. **Manifest.** `kit` is the version without `v` (tag `v<kit>`, BD10). `vendored: true|false` records `--vendor`. `mcpServers: [{ name, module, adr, agents }]`. Each file has `module` (owner) and optional `fragments: [{ module, hash }]` for shared files, provisional until ADR-0004. Module options sit next to `enabled` as in doc 01 §5; `tasks.mode` is `local` / `github` / `both` (BD4).
9. **Hooks in `module.yaml`** are objects `{ name, event, matcher, kind, agents, tokenCost }`; `kind` is the token-free class of B rule 5: `guard`, `context`, `comfort`, `evaluation`.
10. **TASKS.md** (BD4): canonical grammar in `docs/spec/formats.md#task-ledger`. Linked issue in both mode: `T-012 (#34)`. Status: `todo`, `in progress`, `blocked`, `in review`. The generated GitHub view starts with a fixed read-only notice and uses `#123` IDs.
11. **No format version field** in human-edited files; the manifest's `kit` identifies the format generation. Hook events carry `v: 1`; `yaw.db` is versioned by migrations.

## Consequences

- One validator and one answer model serve CLI, form, presets and user profile (CLI ↔ form parity, Y-7.5).
- Adding a phase-3 agent to selections is a one-line schema change.
- Doc 04 §2 and doc 12 §4 examples change slightly (inline questions, `claude`).
