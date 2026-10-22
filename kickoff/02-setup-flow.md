# 02 — Setup Flow

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

**Who proposes when no agent is running?** `yaw init` can run fully without an LLM: it picks the profile by matching the answers against `profiles/*/profile.yaml` (`suggestWhen`) and preselects modules by preset. With Claude Code available, `yaw init --agent claude` hands the answers to a `/kickoff` command that produces the proposal and writes it back into `answers.yaml` (`proposal:` section) for confirmation.

## 2. Modes (lean, not too lean)

| Mode | For | Asks | Typical output |
|---|---|---|---|
| **Quick** | Prototypes, MVPs, "spin up a short Python project": the essential baseline | Idea, profile confirm, agents, and the Q questions of the enabled modules (ADR-0009) | `core` + one CLI profile: 10 files; complete Quick ≈ 12–16 |
| **Full** | Maintained products, teams | The Q, S and F questions of the enabled modules | Quick + the tooling that applies to the project (doc 04 §1, ADR-0032) |

There are two choices (ADR-0032). Standard is merged into Full; `standard` stays a valid value in existing answer files and manifests, with unchanged output, but is no longer offered. Doc 03 question 1.3 pre-selects the choice (prototype or MVP → Quick, long-lived product → Full; built in step 7).

"Mode" (`quick`/`full`, stored as `answers.yaml#mode` and `manifest.json#preset`) is not a "preset": a saved setup is called a preset only in `yaw presets` and `~/.yaw/presets/` (ADR-0009). Files are counted without the `.yaw/base/` copies. Phase-1 contents of the modes: doc 04 §1.

**The mode controls the generated output**, not only the questions shown: Quick renders only its baseline modules; Full adds the modules that apply (for example `github` and `ci` only when the project uses GitHub). Every question a mode does not ask takes the documented default and is listed in the summary as "default".

Quick is a baseline, not a limit: `yaw add <module>` later adds a module and asks only that module's questions (ADR-0023). The mode records the **starting depth** chosen at `yaw init`; adding modules does not change it, and the installed modules are read from the manifest, not from the mode.

## 3. Two lanes, one schema

Both lanes render the same question schema (`interview/base.yaml` + `modules/*/module.yaml#questions`), so they cannot drift.

### CLI lane

- Prompts in batches per section (at most six), defaults in brackets, Enter takes the default, `?` expands help, `skip` takes the default and the summary lists it as "default". Nothing is written before the summary is confirmed (ADR-0009, ADR-0020).
- The first question is the setup depth (Quick or Full; Enter takes Quick), then the questions of the chosen depth for the modules it can select. The module set follows the answers (team, GitHub): the questions of a module that is not selected stay hidden by their `when` (for example the team questions of a solo project). The agent question (0.0) lists Claude Code, Codex and Copilot as selectable and the other agents with "(phase 3, not available yet)", which is the terminal form of greyed out. The expertise level (0.1) changes what is shown from the next question on (section 4).
- Non-interactive: `yaw init --answers answers.yaml --yes` (CI, repeat setups).

### Browser-form lane

`yaw init --web` starts a local server and opens the browser. The same server later serves the dashboard (`yaw ui`, doc 13).

- Binds to `127.0.0.1` only, random port, shuts down after apply or 30 min idle (timer reset by every request; Ctrl+C also stops it). No external assets (works offline, no tracking; `Content-Security-Policy: default-src 'self'`).
- Token (Y-7.3, ADR-0044): the URL carries a one-time start token; the first request with it is answered with a redirect to `/` and an HttpOnly, SameSite=Strict session cookie, and the token is dead. Requests without the cookie are refused. Host must be `127.0.0.1:<port>` or `localhost:<port>` and a present Origin must match (DNS rebinding). Every POST also needs the header `X-YAW-Token` (the page gets the value embedded); GET never changes state. The server logs nothing and writes no file until the apply path (Y-7.5).
- Single page, left sidebar = sections with completion state, right = **live summary** (profile, modules, files to be generated, est. footprint).
- Modules as toggle cards; unchecking a module hides its questions immediately.
- Each question: label, one-line hint, collapsible "Why this matters" and "Example" blocks (layperson), keyboard-first navigation (expert).
- Design direction picker renders real preview cards (doc 06).
- Secret fields (doc 08) are written straight to `.env` / the OS keychain by the server; they never appear in `answers.yaml` nor in any LLM prompt.
- Buttons: *Save draft*, *Save as preset*, *Show diff of files*, *Apply*. Apply streams the log of the `apply` step.

## 4. Expertise levels

Asked after the setup depth and the agents (doc 03, 0.1), stored globally (doc 03, section 0). Three levels, `intermediate` is the default and applies until the question is answered (ADR-0042; the answers and the user profile have always held three values). It switches:

| Aspect | Layperson | Intermediate | Expert |
|---|---|---|---|
| Help blocks | Shown before the question is asked (CLI); expanded on first visit (form) | On request (`?` in the CLI, collapsed in the form) | On request |
| Hints | Shown | Shown | Collapsed behind `?` (CLI) |
| Wording (form) | Plain language + one example | Plain language | Technical terms |
| Defaults (form) | Explained in one sentence | Shown | Shown, rarely explained |
| Questions | F questions take their default and are listed as "default" in the summary; Q and S are asked | All of the chosen mode | All of the chosen mode |

The CLI implements help blocks, hints and questions (Y-7.1); the wording and defaults rows are the form's (Y-7.4).

## 5. Saved setups ("presets") in the user folder

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
