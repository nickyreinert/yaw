# ADR-0025: `devenv` module

- Status: Accepted
- Date: 2026-10-21
- Issue: Y-5.2
- Resolves: implementation details of doc 04 (`devenv`) and doc 05 §2 (`devenv/` in a profile) (B rule 10)

## Decision

- **No questions.** The module asks nothing; whether containers are used is the profile's advice, not a per-project question (a project that wants Docker picks a profile that has it).
- **`just setup` / `just dev` stay profile verbs** (doc 01 §6). The module adds no recipes (module recipes must not reuse the uniform verbs, ADR-0004). The `setup` recipe of each profile copies `.env.example` to `.env` when `.env.example` exists and `.env` does not; it never overwrites `.env` and never prints values. Without the module there is no `.env.example`, so the line does nothing.
- **`.env.example`** is always written: a short header plus `profiles/<p>/env.example` (variable names and harmless defaults, optional, joined over profiles). Profiles `node-cli` and `python-cli` need no variables and ship none.
- **Git ignore.** The module adds `.env`, `.env.*` and `!.env.example` to `.gitignore` (shared file, fragment `devenv`). Reading `.env*` is already denied by the `security` module; nothing is duplicated.
- **Container files only when the profile advises them.** "Advises" means the profile folder has `devenv/Dockerfile`, `devenv/compose.yaml` and/or `devenv/devcontainer.json`. They render to `Dockerfile`, `compose.yaml` and `.devcontainer/devcontainer.json`, owned by `devenv`; a missing file produces nothing (ADR-0024 conditional outputs). Two profiles that ship the same file are a render error. No current profile ships them; the Step 6 profiles do (doc 05 §1).
- **Agents.** One `AGENTS.md` line (setup, run, `.env` rule) for Claude, Codex and Copilot; no hooks, so nothing to keep token-free.
- **Quick footprint** grows by `.env.example` (one file; `.gitignore` already existed).

## Consequences

- `templateContext` gets `devenv.{env,dockerfile,compose,devcontainer}` (`profileDevenv` in `core/render/kit.js`).
- Existing projects get the changed `setup` recipe through `yaw update` (managed file).
