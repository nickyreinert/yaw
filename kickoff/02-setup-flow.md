# 02 — Setup Flow

Quick separates personal settings from project choices as described below and in [doc 15 §1](15-project-foundations.md#1-quick-asks-about-this-project). Optional guided kickoff drafts and reviews the three project foundations described there before deriving tasks (ADR-0075).

## 1. Pipeline

```
 agents to support (checkboxes) + idea (free text)
   │
   ▼
 COLLECT   CLI lane or browser-form lane → .yaw/answers.yaml       (deterministic)
   │
   ▼
 PROPOSE   agent reads idea + answers → architecture proposal,       (LLM)
           profile(s), modules, vendors, design direction
   │
   ▼
 CONFIRM   decision summary shown in the same lane; user edits,      (user)
           unchecks modules, accepts
   │
   ▼
 APPLY     yaw apply → render files, register hooks, write            (deterministic)
           manifest, record ADRs, create TASKS / GitHub items
   │
   ▼
 VERIFY    just setup && just check, hook dry run, agent lists rules  (deterministic)
```

The LLM only proposes. Collection and application are scripts, so the result is reproducible and inspectable.

**Who proposes when no agent is running?** `yaw init` can run fully without an LLM: the stack answers (language and where it runs) pick exactly one profile from `profiles/*/profile.yaml` (`stack`, ADR-0054), tailored or basic, and modules are preselected by preset. With Claude Code available, `yaw init --agent claude` hands the answers to a `/kickoff` command that produces the proposal and writes it back into `answers.yaml` (`proposal:` section) for confirmation.

## 2. Modes (lean, not too lean)

| Mode | For | Asks | Typical output |
|---|---|---|---|
| **Quick** | Prototypes, MVPs, "spin up a short Python project": the essential baseline | Project idea, agents, explicit language/runtime, and project Q questions of enabled modules; personal values are reused | The existing baseline modules and one selected profile; a purpose README is included |
| **Full** | Maintained products, teams | The Q, S and F questions of the enabled modules | Quick + the tooling that applies to the project (doc 04 §1, ADR-0032) |

There are two choices (ADR-0032). Standard is merged into Full; `standard` stays a valid value in existing answer files and manifests, with unchanged output, but is no longer offered. Doc 03 question 1.3 pre-selects the choice (prototype or MVP → Quick, long-lived product → Full; built in step 7).

"Mode" (`quick`/`full`, stored as `answers.yaml#mode` and `manifest.json#preset`) is not a "preset": a saved setup is called a preset only in `yaw presets` and `~/.yaw/presets/` (ADR-0009). Files are counted without the `.yaw/base/` copies. Phase-1 contents of the modes: doc 04 §1.

**The mode controls the generated output**, not only the questions shown: Quick renders only its baseline modules; Full adds the modules that apply (for example `github` and `ci` only when the project uses GitHub). Unasked personal questions use explicit project values, saved personal settings, then documented defaults. Other unasked questions take their documented defaults. The summary identifies answered, saved personal setting, documented default, proposed and confirmed proposal values. Essential unanswered project facts stay unresolved.

Quick must establish purpose, language and where the project runs. The idea prompt asks for users, their main task and important data/interface constraints. Language and runtime start unselected. An uncertain answer opens help or guided planning; it never silently chooses JavaScript/local. Planning recommendations and imported project choices must be reviewed and confirmed before Apply. No new baseline module, dependency or hook output is added.

Quick is a baseline, not a limit: `yaw add <module>` later adds a module and asks only that module's questions (ADR-0023). The mode records the **starting depth** chosen at `yaw init`; adding modules does not change it, and the installed modules are read from the manifest, not from the mode.

### Reviewing an existing setup

`yaw apply` re-renders managed files from saved answers and the installed kit; `yaw update` remains an alias with the same `--yes`, `--strategy`, `--restore` and `--forget` flags.

`yaw edit` reruns the interview using saved answers as defaults. Choose terminal or browser at entry, use `w` during a question or at profile selection, or run `yaw edit --web` directly. `yaw edit user` reviews one section; multiple sections or individual question IDs such as `yaw edit idea.text` are accepted. `yaw edit --list` lists sections. Unrelated answers are preserved, and both lanes preview before asking to apply changes. User-owned and user-edited files are kept; missing managed files are not restored implicitly.

Full editing can change setup depth, profiles and agents. Installed modules remain selected unless explicitly changed in the full browser editor; changing depth alone in the CLI does not add modules. Section editing cannot change depth, profiles or module selection. Verification runs after apply unless `--skip-verify` is supplied. If another process changes saved answers or the manifest while editing, reopen the editor rather than overwriting that change. This edits `.yaw/answers.yaml`, not the deferred knowledge-namespace config schema.

## 3. Two lanes, one schema

Both lanes render the same question schema (`interview/base.yaml` + `modules/*/module.yaml#questions`), so they cannot drift.

Before either lane starts, the target folder is checked (#168): the home folder and the file-system root are refused unless `--force` is given; a non-empty folder without `.git` or `.yaw` (the `--answers` file does not count) needs a confirmation, which `--yes` gives with a warning on stderr. Without a terminal, the browser lane refuses such a folder unless forced.

The idea goes into `README.md` (#171): without a README, init writes one (`# Project idea`, the idea text, a pointer to YAW) and records it as your file (`managed: false`, so `remove` keeps it). An existing README gets one marked `## Idea` section (`<!-- yaw:idea -->`) appended; your text is not touched, and a README that already holds the idea or the markers is left alone. An empty idea writes nothing.

### CLI lane

- Prompts in batches per section (at most six), defaults in brackets, Enter takes a valid default, `?` expands help, and `skip` takes a default only for an optional question. Essential purpose/language/runtime answers cannot be skipped or left empty. Enter on a saved project choice explicitly confirms it. A separate `w) Continue in the browser` entry appears at the setup depth and every question. Handoff carries reused personal settings, answers so far and unreviewed imported project choices. Project files are written only after confirmation; Save draft and personal-settings saves have their own explicit actions.
- On a terminal the interview uses plain ANSI colour, no dependencies and no emoji (#163): bold titles, cyan option keys, dimmed hints, the default option in green. The up and down arrow keys put the next or previous choice on the input line, starting from the default; typing, `?`, `skip` and `web` work as before. `NO_COLOR`, `TERM=dumb` and non-TTY output give the plain text.
- The first question is setup depth (Quick or Full; Enter takes Quick), with optional `u) Review and save personal settings` and the existing preset/browser entries. Quick then asks repository agents and project questions of its modules. It reuses personal values, including expertise, from the first project question. Full retains its deeper interview and personal review, using saved personal values as defaults. Conditional module questions remain hidden when irrelevant. Agent choices still come from the phase-aware catalogue.
- The initial menu also offers `p) Load a previous setup`. Choose a previously saved preset (number, name, or arrow keys), or `b` to return. Its saved depth and answers become the interview defaults; Enter keeps an answer and typing replaces it. Review the previous idea before confirming. Loading uses the same validation as browser prefill, copies no project files or secrets, changes no saved preset, and does not grant consent to save again. Browser handoff keeps saved answers that have not yet been reviewed. If no presets were saved, the CLI explains the save offer and the existing `yaw init --answers /path/to/project/.yaw/answers.yaml` alternative.
- Non-interactive: `yaw init --answers answers.yaml --yes` (CI, repeat setups). Supply purpose plus a valid language/runtime pair, or a confirmed project proposal with known profiles. A `proposed` proposal is refused; `--yes` does not supply missing facts. This reproducible lane uses the file's personal values or documented defaults, never implicitly merges a machine's profile, and preserves a supplied confirmed proposal file byte for byte (ADR-0019).

### Browser-form lane

`yaw init --web` starts a local server and opens the browser. The same server later serves the dashboard (`yaw ui`, doc 13).

`yaw web` opens the dashboard in any folder and never starts setup or writes project files. In an uninitialized folder, first-time setup is available through Workspace → Settings → Interview; the existing folder confirmation still applies before writing. For an always-available local process, use `yaw web --background`; it returns to the shell and disables idle shutdown. Run `yaw web` from the same folder to reopen the process with a fresh one-time login link, or `yaw web --stop` to stop it. Foreground servers still stop on Ctrl+C or after 30 idle minutes.

Each server uses a distinct cookie name, avoiding collisions between tabs for different YAW instances. Cookies still travel to other servers on the same loopback host; only run trusted local servers. A consumed one-time link works again only when the browser already has that server's valid session. Otherwise run `yaw web` for a new login link. Background credentials and the browser launcher are private files under `~/.yaw/web/` (0700 directory, 0600 files); stop removes them. Private `.log` files there retain server errors for diagnosis. This is a user process, not a boot service: after a reboot start it again.

- Binds to `127.0.0.1` only, random port, shuts down after apply or 30 min idle (timer reset by authenticated requests; Ctrl+C also stops it). No external assets (works offline, no tracking; `Content-Security-Policy: default-src 'self'`).
- Token (Y-7.3, ADR-0044): the URL carries a one-time start token. Browser navigation sets an HttpOnly, SameSite=Strict session cookie on a minimal same-origin login page, then a same-origin script replaces the URL with `/`. This avoids excluding the Strict cookie on a redirect chain from the private launcher file; the token is dead and leaves the address/history. Non-browser clients receive a 303 redirect. Requests without the cookie are refused. Host must be `127.0.0.1:<port>` or `localhost:<port>` and a present Origin must match (DNS rebinding). Every POST also needs the header `X-YAW-Token` (the page gets the value embedded); GET never changes project or saved-setup state. Only the one-time browser link is printed to the terminal; no answers or request bodies are logged.
- Single page, left sidebar = sections with completion state, right = **live summary** (profile, modules, files to be generated, est. footprint).
- Modules as toggle cards; unchecking a module hides its questions immediately.
- Each question: label, one-line hint, collapsible "Why this matters" and "Example" blocks (layperson), keyboard-first navigation (expert).
- Design direction picker renders real preview cards (doc 06).
- Secret entry (Y-7.6, ADR-0045) is separate from setup answers: the CLI uses hidden terminal input and the form uses password fields in the Apply confirmation. Values are written only to a new mode-0600 `.env`; existing `.env` files are never read or overwritten. Secret-like answers are still rejected before preview, diff, saving or apply, without echoing their values. The diff never reads existing secret files.
- Buttons: *Save draft*, *Save as preset*, *Show diff of files*, *Apply*. Apply streams the log of the `apply` step.

Y-7.4 implementation:

- Start with Quick or Full, then New, a saved user profile, an answers-only preset / previous-project snapshot, or a local draft. Loading is read-only and never grants consent to save. A saved `standard` mode remains compatible; selecting Full explicitly migrates the form to Full.
- Questions and help come from the interview schema and module definitions. Only implemented modules have questions; future catalogue sections and secret onboarding are not fabricated. Phase-3 agents remain disabled. Layperson help/examples expand, expert hints collapse, and F questions use defaults for laypeople.
- New setups automatically reuse a valid saved personal profile. An absent or partial profile uses documented defaults; an invalid/unreadable profile gives a generic warning and remains untouched. Quick hides personal questions, with an optional project-level review checkbox and a link to Global Settings for future-project defaults. Full retains the deeper review. Existing projects keep their saved settings.
- Purpose, language and runtime remain unresolved until supplied. Incomplete preview lists what is needed; *Save draft* can keep that progress, while *Apply*, *Save preset* and file diff require resolved essentials. Loaded drafts/presets and planning recommendations carry pending project choices. Continuing through their project/stack steps, editing those choices, or confirming the choices in the review resolves them. The server independently refuses Apply while essentials are missing or pending confirmation.
- The profile selector is editable; leaving it on "Suggest from answers" needs a unique rule-based match before saving or applying. Module toggles enable dependencies and disabling a dependency also disables its dependents, including their questions.
- *Save draft* explicitly writes `.yaw/draft.yaml` with mode 0600, not the canonical answers or a manifest. Restart `yaw init --web` and choose "Resume project draft" to continue.
- *Save as preset* asks for consent on every save (unchecked initially); saving the user profile is a separate unchecked option. Apply never saves either automatically.
- The live summary renders the real output plan: profile, modules, answer/default table, file paths and estimated rendered bytes excluding base copies and manifest. Existing module outputs are marked "kept unchanged", matching noninteractive init reconciliation; *Show diff* shows only actual text changes (including canonical answers), without scratch files or secret-file reads. Manifest/base copies are identified as apply-time bookkeeping. Module-selection answers such as the GitHub opt-out remain in saved answers even when they disable their owning module.
- Apply requires a separate confirmation and writes via `initProject`. It runs the CLI's `just setup && just check` only if no new secret value was saved; with new secrets, verification is skipped so project-controlled recipes cannot read them automatically (ADR-0046). `yaw init --web --skip-verify` explicitly disables verification. The NDJSON log distinguishes verification failure from success; files remain on disk after a failure. The server stops after the completed stream, and idle shutdown is suspended while apply runs.
- Secret fields are offered only for names in the effective `.env.example`, remain outside browser setup state, and are sent only in the confirmed Apply request. Values are single-line, limited to 8192 characters, and never enter answers, drafts, presets, history, logs or responses. Empty fields are skipped; if `.env` already exists, it is left untouched and the values are not saved.
- JSON POST bodies are limited to 256 KiB; answer text is limited to 8192 characters. Invalid input gets explicit errors. `--web` cannot be combined with `--answers` or `--yes`; the browser provides the confirmation. If the OS cannot open a browser, open the printed link manually.

## 4. Expertise levels

Quick reuses expertise from the saved profile or the documented `intermediate` default, so help depth applies from the first project question. Full and optional personal onboarding/review can ask it explicitly. Three levels remain unchanged (ADR-0042); saving globally is a separate opt-in (doc 03 §0). It switches:

| Aspect | Layperson | Intermediate | Expert |
|---|---|---|---|
| Help blocks | Shown before the question is asked (CLI); expanded on first visit (form) | On request (`?` in the CLI, collapsed in the form) | On request |
| Hints | Shown | Shown | Collapsed behind `?` (CLI) |
| Wording (form) | Plain language + one example | Plain language | Technical terms |
| Defaults (form) | Explained in one sentence | Shown | Shown, rarely explained |
| Questions | F questions take their default and are listed as "default" in the summary; Q and S are asked | All of the chosen mode | All of the chosen mode |

The CLI implements help blocks, hints and questions (Y-7.1); the wording and defaults rows are the form's (Y-7.4).

## 5. Saved setups ("presets") in the user folder

Personal onboarding is optional: choose `u` from the terminal setup-depth menu, or Global Settings → Defaults in the browser. It reviews the implemented personal questions and asks separately before saving. Skipping it creates no profile and does not add personal questions to Quick. Reading a profile grants no consent to save it or a project preset. Project overrides win; edits keep existing project values, and global changes affect future setups only.

Opt-in at first run: *"May the kit store your preferences and past setups in `~/.yaw/`?"*

```
~/.yaw/
├── kit/                     # the cloned kit
├── user-profile.yaml        # communication style, language, expertise, default agents
├── presets/
│   ├── my-flask-default.yaml
│   └── 2026-10-20-stick-hands.yaml   # snapshot of a past project's answers
└── history.jsonl            # project path, date, kit version, preset used
```

- Start screen: *New*, *From preset*, *From previous project*. The chosen setup prefills the form; everything stays editable.
- Presets contain answers only, never secrets, never generated files.
- `yaw presets list|show|delete`; the folder is plain YAML, so users can edit or version it themselves.
- Y-7.2 (ADR-0043): the CLI asks after the interview and the confirmed write, for every setup, default no (`yaw init --answers` never asks and never writes). Two questions: save the setup as a preset plus a `history.jsonl` line `{path, date, kit, preset}`, and save the profile (`user.*` answers, `user-profile.yaml`). A no writes nothing and is not remembered; there is no standing yes. The preset is named `YYYY-MM-DD-<folder>` (all answers, mode, source). Files are 0600, folders 0700. If an answer looks like a secret, or the existing profile is unreadable or invalid, nothing is saved and the run goes on. `yaw presets delete <name>` asks (default no) or needs `--yes`. Prefilling an interview from the profile or a preset is the start screen of the form (Y-7.3/7.4).
- #173: after the next steps, the terminal interview asks "Do you want guidance to kick off?" (default no; never with `--answers`). Yes prints the kickoff steps and a planning prompt with the idea, stack and task store; `yaw kickoff` prints the same any time. The plan goes to `docs/plan/kickoff.md`; `yaw kickoff import <plan.md> [--dry-run]` adds one task per `- [ ]` item under a `## Phase` heading, with the phase or task `model: <tier> · effort: <level>`, through `yaw task new` (local, both or GitHub), and skips titles already in `TASKS.md`.
