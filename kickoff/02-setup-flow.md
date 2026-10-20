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
| **Quick** | "spin up a short Python project" | Idea, profile confirm, agents, 3–5 essentials | ≈ 5–8 files |
| **Standard** (default) | Most projects | Quick + one screen per enabled module | Core + chosen modules |
| **Full** | Long-lived products, teams | Everything, including governance strictness, budgets, roles | Full scaffold |

Mode changes how many questions are **shown**, never what is possible: every skipped question takes the documented default and is listed in the summary as "default". `yaw add <module>` later asks only that module's questions.

## 3. Two lanes, one schema

Both lanes render the same question schema (`interview/base.yaml` + `modules/*/module.yaml#questions`), so they cannot drift.

### CLI lane

- Prompts in batches per section, defaults in brackets, `?` expands help, `skip` takes the default.
- Non-interactive: `yaw init --answers answers.yaml --yes` (CI, repeat setups).

### Browser-form lane

`yaw init --web` starts a local server and opens the browser. The same server later serves the dashboard (`yaw ui`, doc 13).

- Binds to `127.0.0.1` only, random port, one-time token in the URL, shuts down after apply or 30 min idle. No external assets (works offline, no tracking).
- Single page, left sidebar = sections with completion state, right = **live summary** (profile, modules, files to be generated, est. footprint).
- Modules as toggle cards; unchecking a module hides its questions immediately.
- Each question: label, one-line hint, collapsible "Why this matters" and "Example" blocks (layperson), keyboard-first navigation (expert).
- Design direction picker renders real preview cards (doc 06).
- Secret fields (doc 08) are written straight to `.env` / the OS keychain by the server; they never appear in `answers.yaml` nor in any LLM prompt.
- Buttons: *Save draft*, *Save as preset*, *Show diff of files*, *Apply*. Apply streams the log of the `apply` step.

## 4. Expert vs. layperson

Asked first, stored globally (doc 03, section 0). It switches:

| Aspect | Expert | Layperson |
|---|---|---|
| Help blocks | Collapsed | Expanded on first visit |
| Wording | Technical terms | Plain language + one example |
| Defaults | Shown, rarely explained | Explained in one sentence |
| Questions | All of the chosen mode | Questions with safe defaults auto-answered and listed |

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
