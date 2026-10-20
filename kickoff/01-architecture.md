# 01 — Architecture

## 1. Three layers

| Layer | What | Where it lives | Changes |
|---|---|---|---|
| **Core** | Stack-independent machinery: decision journal, task ledger, GitHub scripts, review subagents, baseline standards, hooks, setup CLI and form | Kit repo `core/` + `modules/` | Built once, versioned |
| **Profiles** | Stack building blocks: `just` recipes, gate commands, dev environment, guard patterns, taxonomy seeds, visual-check method, stack standards | Kit repo `profiles/` | Grows by adding a folder |
| **Project** | Interview answers, architecture proposal, ADRs, taxonomy, domain rules, design direction, `AGENTS.md` | The target repo | Generated per project, then owned by the project |

The project layer is the only one that depends on the idea. Core and profiles are reused unchanged, which keeps every project consistent and updatable.

## 2. Kit repository layout

```
yaw/
├── install.sh                      # bootstrap: clone/update into ~/.yaw/kit, link the CLI
├── bin/yaw                         # CLI entry (Node ≥ 22, zero deps)
├── core/
│   ├── cli/                        # init, apply, status, update, add, remove, doctor
│   ├── form/                       # local browser UI: setup form + dashboard (doc 13), OTLP receiver
│   ├── render/                     # template rendering, manifest, file hashing
│   └── schema/                     # answers.schema.json, module.schema.json, profile.schema.json
├── interview/
│   ├── base.yaml                   # questions every setup asks (idea, audience, mode)
│   └── help/                       # collapsible explanations, one file per topic
├── modules/<module>/               # see doc 04
│   ├── module.yaml                 # name, description, default, depends, questions, outputs
│   ├── templates/                  # files rendered into the project
│   ├── skills/  agents/  hooks/    # neutral sources for customisation
│   ├── scripts/                    # deterministic helpers called by just recipes
│   └── tests/
├── profiles/<profile>/             # see doc 05
├── design/directions/<direction>/  # see doc 06
├── vendors/<vendor>.yaml           # see doc 08
├── adapters/{claude,codex,copilot}/          # see doc 09; gemini, antigravity, pi, hermes in phase 3
├── examples/<profile>/             # sample projects, used by the kit's own CI
└── tests/
```

## 3. Footprint in a target project

Only what the user selected. Quick preset example (Python script, local tasks, no GitHub):

```
my-tool/
├── AGENTS.md                # short rules + routing (generated, user-editable)
├── CLAUDE.md                # @AGENTS.md
├── justfile                 # uniform verbs
├── TASKS.md                 # if tasks module enabled
├── .yaw/
│   ├── manifest.json        # kit version, profile(s), modules, file list + hashes (machine-written)
│   └── answers.yaml         # interview answers (no secrets, user-editable)
└── <project code>
```

Full preset adds `.decisions/`, `.claude/` (settings, hooks, agents, skills), `.github/`, `design/`, `docs/spec/`, `docs/plan/`, `.env.example`, dev environment files.

Rule: **governance logic is not copied into the project** when the kit is installed globally; hooks call `~/.yaw/kit/...` through a thin project-local shim that **fails open** when the kit is missing. Option `--vendor` copies the logic into `.yaw/lib/` for portable repos (CI, collaborators without the kit). Choice is recorded in the manifest.

## 4. Install and update

```bash
curl -fsSL https://raw.githubusercontent.com/nickyreinert/yaw/main/install.sh | bash
```

`install.sh` must:

1. Check prerequisites (`git`, `node ≥ 22.13`, `just`); offer install commands, never install silently.
2. Clone into `~/.yaw/kit` (or `git fetch` + checkout the chosen tag if present).
3. Pin to the **latest release tag** by default; `--tag <tag>` for a specific one (CI uses the tag pinned in `manifest.json`); `--channel main` for bleeding edge.
4. Link `yaw` into `~/.local/bin` (or print the PATH line to add).
5. Print what it did and how to uninstall (`yaw self-uninstall`).

Safety: the README also shows the "download, read, then run" variant and the SHA256 of the script per release. No `sudo`.

Update flows:

| Command | Effect |
|---|---|
| `yaw self-update` | Fetch new tag, show changelog, switch |
| `yaw update` (in a project) | Re-render managed files from the new kit version. Files whose hash differs from the manifest (user-edited) are **not overwritten**; a diff is shown and the user chooses keep / take / merge |
| `yaw doctor` | Check kit version, manifest consistency, hook shim reachability, `just --list` |

## 5. Manifest (transparency contract)

File format rule: **YAML for files humans write or edit, JSON for files the kit writes.** The manifest is kit-written, so it is `.yaw/manifest.json`; `yaw status` is the human view.

```json
{
  "kit": "0.3.0",
  "profiles": ["python-web", "static-site"],
  "preset": "standard",
  "agents": ["claude", "codex"],
  "modules": {
    "decisions": { "enabled": true },
    "tasks": { "enabled": true, "mode": "both" },
    "ui-design": { "enabled": false }
  },
  "files": [
    { "path": "AGENTS.md", "module": "core", "hash": "sha256:…", "managed": true }
  ]
}
```

`managed` turns `false` once the user takes ownership of a file.

`yaw status` prints modules and files in a table. `yaw remove <module>` deletes exactly the listed files (after confirmation) and un-registers its hooks. Nothing is generated that is not in the manifest.

## 6. The `just` interface

Every profile implements the same verbs; skills, hooks and CI call only these. Unsupported verbs print a clear "not applicable for this profile" and exit 0.

| Verb | Meaning |
|---|---|
| `just setup` | One-command local setup (deps, `.env` from example, dev DB, seed) |
| `just dev` | Run locally (with hot reload where available) |
| `just fmt` / `just lint` / `just typecheck` | Static checks |
| `just test` | Tests |
| `just check` | Full gate (same as CI) |
| `just build` | Production build or dry run |
| `just screenshot` | Visual capture (web: Playwright; Android: emulator/Paparazzi) |
| `just preview` / `just preview-share` | Production build served locally / exposed to the phone (LAN, Tailscale, opt-in tunnel) |
| `just device-pair` / `device-install` / `device-screenshot` / `device-log` | Android device loop over ADB (Wi-Fi) |
| `just audit` | Dependency/vulnerability/secret scan |
| `just db-migrate` / `just db-reset` | Local schema operations |
| `just backup` / `just restore` | See doc 07 |
| `just deploy <env>` | Runs `check` first; guarded (needs authorisation) |
| `just task …` / `just gh …` | Task ledger and GitHub helpers (doc 10) |

Why `just`: one small binary, cross-platform, readable syntax, `just --list` self-documents, recipes can be written in any shell or language. Composition: the generated `justfile` imports profile and module fragments (`import 'just/python.just'`), so removing a module removes its recipes.
