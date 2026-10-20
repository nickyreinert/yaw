# ADR-0020: `yaw init` vertical slice: profiles, interview and pipeline details

- Status: Proposed
- Date: 2026-10-20
- Issues: #32 – #38 (Y-3.2 – Y-3.8)
- Resolves: implementation details of step 3 that the docs leave open (B rule 10); extends ADR-0004, ADR-0014, ADR-0019

## Context

Step 3 renders profiles, runs an interview and verifies the result. The docs name the parts (doc 05 §2) but not how a profile's files reach the project, who owns them, what a scaffold is allowed to do, or what `init` does without a terminal. These are the decisions taken.

## Decision

### Profile files (extends ADR-0004)

| Profile part | Becomes | Notes |
|---|---|---|
| `just/<p>.just` | `just/<p>.just` | owner `core`, managed; the `justfile` gets `import 'just/<p>.just'` as a part named after the profile |
| `gitignore` | part of `.gitignore` | block `# yaw:<p>` |
| `scaffold/**` | same path in the project | `managed: false` from the start (your code), no base copy, written once at `init`, never by `update` |
| `standards.md`, `guards.yaml`, `ci/check.yml` | nothing yet | read by `standards` (5.1), `security` (5.0), `ci` (5.5) |

- A profile is not a module, but its parts in shared files are recorded in `files[].fragments` under the profile's name; the owner stays `core`.
- The scaffold is skipped entirely when any of its paths already exists ("skipped when repo has code", doc 05 §2). Existing files are never recorded in the manifest.
- Scaffold files are plain copies, not templates, with fixed names (`app`): the same answers give the same bytes whatever the folder is called.
- `update` renders the profiles of `manifest.profiles`; a profile that left the kit is reported like a missing module. `remove core` deletes the profile files and keeps the scaffold ("kept, owned by you").
- One profile per project until composition exists (Y-6.8); several are refused.
- Profile `options` (doc 05 §2) are not offered in step 3: `profile.yaml` of both profiles omits them and the rendered files are the defaults (pyright for Python; no `--checkJs` for Node). They come with the full interview (step 7).
- `guards.yaml` is `guards: [{ id, pattern (regular expression), reason }]`; the security module (5.0) owns the schema and may change it.

### Uniform verbs

Each profile defines exactly the verbs of doc 01 §6 that are not module recipes: `setup dev fmt lint typecheck test check build screenshot preview preview-share audit db-migrate db-reset backup restore deploy`. Verbs that do not apply print `<verb>: not applicable …` and exit 0. `check` is `lint typecheck test audit`. `backup` and `restore` are listed because doc 01 §6 lists them; the `backup` module (phase 2) will replace the stubs.

- node-cli: `lint` is `node --check` on every `.js`/`.mjs` plus `shellcheck` on `*.sh` when it is installed (a note otherwise); `test` is `npm test` (the scaffold's script is `node --test`); `audit` runs `npm audit` only when dependencies exist.
- python-cli: `uv sync`, `ruff`, `pyright`, `pytest`, `pip-audit`; `setup` and `audit` need the network.

### Rule-based suggestion (Y-3.6)

Facts come from answers only where a question exists (`deriveFacts`): `language`, `runsOn`, `hosted` from the stack questions, `public` and `team` when asked; `auto` and unanswered stay unknown. A profile is a candidate when none of its `suggestWhen` facts contradicts a known fact and at least one matches. The suggestion is the candidate with the most matches; a tie or no candidate means no suggestion and the user chooses (interview) or the answers file must name the profile (`proposal.profiles`). Same input, same output; candidates are ordered by matches, then name.

### `yaw init` (extends ADR-0019)

- `yaw init` on a terminal runs the Quick interview; `yaw init --answers <file>` reads answers; `--yes` confirms without asking; `--skip-verify` skips the last step. Without a terminal: `--answers` is required, and `--answers` needs `--yes`.
- Order: collect → profile and modules → summary (decisions, answers with "(default)", files) → confirm → apply → verify. Rendering happens before the confirmation question, so a template error or a budget violation stops before anything is written.
- An answers file with `proposal` is copied byte for byte (ADR-0019). Without `proposal` the profile is suggested and `.yaw/answers.yaml` is written with the proposal added (status `confirmed`, summary from the profile) by the emitter, so with its "comments not preserved" header. The interview writes the same.
- Modules: `proposal.modules` if present, else the modules whose `default[mode]` holds; modules the kit does not have yet are skipped with a note; `core` is always included.
- Verify runs `just setup`, then `just check`, in the project folder with the caller's environment and streams their output. If either fails, or `just` is missing, the files stay, the message says what to do and the exit code is 1.
- Questions missing from the answers get their default in the template context, so a template never fails on a missing answer.

### Interview files

`interview/base.yaml` holds the base questions (new question `arch.language`, doc 03 3.1); `interview/help/<topic>.md` holds help for `?`. Both live at the kit root (doc 02 §3). A reply to a closed input stream is an error, never a silent exit.

### Examples and CI

`examples/<profile>/answers.yaml` is the input of the smoke test per profile (ADR-0014): `yaw init`, then `just setup && just check`, in a temp folder (`test/profiles.test.js`). The tests skip with a reason when `just` (or, for python-cli, `uv` or the network, `YAW_TEST_OFFLINE`) is missing. Kit CI installs `just` and `uv` with the setup actions `extractions/setup-just` and `astral-sh/setup-uv`; these two actions and the `ci/check.yml` fragments are unverified until the first CI run. Pin both actions (and the others in `kit-ci.yml` and the fragments) by commit SHA before v0.1.

### Dogfooding (Y-3.8)

This repo runs `yaw init` with `node-cli` from the checkout (kit = project). Existing files win: `package.json`, `.gitignore` are the repo's own; no scaffold is added. ADRs stay in `docs/adr/` (BD7).

## Consequences

- Adding a profile is: a folder with the parts above, an `examples/<name>/answers.yaml`, and its name in `test/profiles.test.js`.
- A project created before a profile part is added to the kit picks it up through `yaw update`; scaffold changes never reach existing projects.
- The kit CI needs network access for the python-cli smoke test.
