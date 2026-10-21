# ADR-0004: Shared-file composition and fragment ownership; just `import` vs. `mod`; `core` removability

- Status: Accepted
- Date: 2026-10-20
- Issue: #20 (Y-2.1); implemented in #24 (Y-2.5) and #26 (Y-2.7)
- Resolves: U1, U6, M6 (`docs/build/plan.md` §1.2, §1.5)

## Context

Several modules write into the same files: `AGENTS.md` (every module's `agentsMd`), the root `justfile`, `.gitignore`, the PR template, the agent settings that register hooks (`.claude/settings.json`, `.codex/hooks.json`). `yaw remove <module>` must delete exactly what a module added (B rule 4, doc 01 §5), and `yaw update` must not lose user edits (ADR-0003). ADR-0017 left `files[].fragments` provisional until this ADR. Doc 01 §6 composes the `justfile` with flat `import`, doc 05 §3 namespaces several profiles (`just api::test`). B rule 4 asks for every module to be removable; doc 04 marks `core` as "always".

## Options

| Option | For | Against |
|---|---|---|
| A. Patch fragments in place (insert/delete marked regions in the user's file) | Edits outside the region survive without a merge | Second merge mechanism next to ADR-0003; fragile when the user moves or edits markers |
| B. One owner renders the whole file from all modules' parts; the result goes through the normal update flow | One mechanism (ADR-0003) for every change; deterministic; removal is "re-render without the module" | A user edit in a shared file needs keep/take/merge when a module is added or removed |
| C. No shared files (every module writes its own file, agents read many files) | No composition at all | Agents read one `AGENTS.md`; settings files are single files by vendor design |

## Decision

**Option B.**

### Shared files

- The kit lists the shared paths and how they compose (`core/render/compose.js`): `AGENTS.md` and `.github/pull_request_template.md` (Markdown), `justfile` and `.gitignore` (lines), `.claude/settings.json` and `.codex/hooks.json` (JSON). A path not on the list may be written by only one module; two writers are a render error.
- In phase 1 the **owner of every shared file is `core`**. The manifest entry has `module: core`; every other contributing module appears in `files[].fragments` with the hash of its part (ADR-0003 hash rule).
- Parts: a module contributes through a template at the shared path (`templates/AGENTS.md`, `templates/.claude/settings.json`) and, for `AGENTS.md`, through `module.yaml#agentsMd`.
- Order is fixed: the owner first, then the other modules by name. The same modules and answers always give the same bytes.
- Text composition: the owner's template is the frame, unwrapped. Every other part, including the owner's own `agentsMd`, sits in a block named after its module:
  - Markdown: `<!-- yaw:<module> -->` … `<!-- /yaw:<module> -->`
  - lines (`justfile`, `.gitignore`): `# yaw:<module>` … `# /yaw:<module>`
  - Blocks are separated by one empty line; a file without parts is not written (and is deleted on recomposition if unedited).
- JSON composition: parts are parsed as data and merged; objects merge key by key, lists concatenate (this is how hook registrations add up), equal scalars are fine, different scalars for the same key are a render error naming both modules. Output is `JSON.stringify(…, null, 2)` plus a newline.
- Every change of the parts (module added, removed, updated) re-renders the whole file, and ADR-0003 decides what happens: unedited files change silently; edited files get keep / take / merge. Fragments are bookkeeping for `yaw status`, `yaw remove` and `yaw doctor`; they are not patched separately.
- **Unregistering hooks** is the same mechanism: a module's hook entries are its part of the settings file, so removing the module re-renders the settings without them.

### `just`: `import` vs. `mod`

- The root `justfile` is a shared file owned by `core`. A module or profile that has recipes ships its own owned file `just/<name>.just` and contributes one line to the root file: `import 'just/<name>.just'` (flat, doc 01 §6).
- With **one** profile, the profile's file implements the uniform verbs directly.
- With **several** profiles (Y-6.8), each profile is a namespaced `mod <profile> 'just/<profile>.just'` and `core`'s frame defines the uniform verbs, each calling the verb of every profile (doc 05 §3: `just api::test`).
- Module recipes must not reuse the uniform verbs of doc 01 §6. A collision is a `just` parse error, caught by `just --list` in `yaw doctor` and `just check`.

### Profiles

Files rendered from a profile are owned by `core` in the manifest (a profile is not a module and is not removed on its own in phase 1; a different profile is an answers change followed by `yaw apply`, step 3).

### `core` removability

- `core` is removable, as the **last** module: `yaw remove core` refuses while other modules are enabled ("remove … first"), because every module depends on it.
- Removing `core` removes YAW from the project: all managed files, `.yaw/base/` and `.yaw/manifest.json`. Files owned by the user (`managed: false`, e.g. `.yaw/answers.yaml`) stay and are listed as "kept, owned by you" (ADR-0003). Edited managed files are handled as in ADR-0019 (kept unless confirmed or `--strategy take`).
- Other modules: `yaw remove` refuses while an enabled module lists the target in `depends`.

## Consequences

- The manifest's `fragments` field is final (no longer provisional, ADR-0017 §8).
- A user who edits `AGENTS.md` and later adds or removes a module sees one keep / take / merge question for `AGENTS.md`; `merge` usually applies cleanly because the change is confined to one marked block.
- Adding a new shared path is a one-line change in `compose.js` plus this ADR.
- Removing a module whose part sits in an edited shared file with `--yes` keeps the user's file, so the module's marked block can remain; the report says so and `merge` (or a hand edit) removes it.
