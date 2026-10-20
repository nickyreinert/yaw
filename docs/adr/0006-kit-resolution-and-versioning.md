# ADR-0006: Kit resolution, hook shim, versioning, pre-tag install

- Status: Accepted
- Date: 2026-10-20
- Issue: #20 (Y-2.1); implemented in #22 (Y-2.3), #27 (Y-2.8); hook shim in Y-4.2
- Resolves: U4, H7, S4 (`docs/build/plan.md` §1.2, §1.4, §1.6); records BD10

## Context

Doc 01 §3–§4: one global kit in `~/.yaw/kit`, the `yaw` CLI linked into `~/.local/bin`, hooks call the kit through a thin project-local shim that fails open, `--vendor` copies the logic into `.yaw/lib/`. Doc 14 §5 pins the kit version in the manifest. Open were: how the CLI and hooks find the kit, what happens when the global kit differs from the project pin (U4), the shim format (H7), and how to install before the first release tag (S4). BD10 fixed the CI part.

## Decision

### Install location and CLI

- The kit lives at `~/.yaw/kit` (a git clone). `install.sh` links `~/.local/bin/yaw` → `~/.yaw/kit/bin/yaw` (symlink). An existing `~/.local/bin/yaw` that is not this link is left alone with a warning. If `~/.local/bin` is not on `PATH`, `install.sh` prints the `export PATH=…` line; it never edits shell profiles. No `sudo`.
- `bin/yaw` finds the kit from its own real path, so any checkout runs as a kit (`./bin/yaw` in a development clone).
- Kit source: `YAW_REPO` (git URL or local path), default `https://github.com/nickyreinert/yaw.git`.

### Versions and channels

- The kit version is `package.json#version`; a release is the git tag `v<version>`; the manifest `kit` field is the version without `v` (ADR-0017 §8).
- `install.sh` and `yaw self-update` pick, in this order: `--tag <tag>` (with or without `v`), `--channel main` (`origin/main`), the channel used last time, the latest `v*` tag. The kit clone is checked out detached; the channel (`tag` or `main`) is stored in the clone's git config (`yaw.channel`), so it disappears with the kit.
- **Pre-tag install** (before v0.1.0): without a tag, `install.sh` stops with "no release tag yet; run install.sh --channel main". Local development uses `YAW_REPO=<path> install.sh --channel main` or `./bin/yaw` directly.
- `yaw self-update` and `yaw self-uninstall` act only on the kit at `~/.yaw/kit` that `install.sh` created (`yaw.channel` set); they refuse in a development checkout and when the kit clone has local changes.

### Global kit vs. project pin (U4)

- One global kit at a time; no per-version kit folders.
- The manifest records the kit version that last wrote the project (`init`, `update`, `remove`). Hooks always run with the installed kit (they fail open anyway).
- Installed kit **newer** than the pin: `yaw doctor` warns ("run yaw update"; in team mode in its own PR, doc 14 §5). Installed kit **older** than the pin: commands that write the project (`update`, `remove`) refuse and point to `yaw self-update`; `yaw doctor` reports a failure.

### CI (BD10)

CI installs exactly the pinned tag: `install.sh --tag v<kit>` with `<kit>` read from `.yaw/manifest.json` (workflow written in Y-5.5). `--vendor` stays optional for repos whose collaborators do not have the kit.

### Hook shim (built in Y-4.2)

- Location: `.yaw/bin/yaw-hook`, a POSIX `sh` script owned by `core`, committed, recorded in the manifest. Agent settings call it by a project-relative path; the exact command string per agent is fixed in Y-4.3 – Y-4.5.
- Behaviour: use `.yaw/lib/` when the project is vendored (`vendored: true`), else `${YAW_KIT:-$HOME/.yaw/kit}`; if `node` or the kit's `bin/yaw` is missing, exit 0 with no output (fail open); otherwise `exec node "<kit>/bin/yaw" hook "$@"`. It does not depend on `yaw` being on `PATH`.
- `YAW_KIT` exists so this repo's own hooks can run its working tree (dogfooding).

## Consequences

- Every machine runs one kit; a project can lag behind it, never run ahead of it.
- The installer stays a single bash script with no state outside the kit clone and the link.
- Switching channels or tags is a `git checkout` in `~/.yaw/kit`, so it is fast and offline once fetched.
