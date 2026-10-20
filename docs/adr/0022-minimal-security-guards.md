# ADR-0022: Minimal `security` module: guard rules and their limits

- Status: Proposed
- Date: 2026-10-20
- Issue: #48 (Y-5.0)
- Resolves: implementation details of BD6 (B rule 10); extends ADR-0020 (`guards.yaml` shape) and ADR-0009 (Quick footprint)

## Context

BD6: phase-1 `security` denies reading `.env*` and secret files and guards `rm -rf`, force push and prod deploy; it is the blocking hook that proves step 4. ADR-0009 put it into Quick (`default.quick: true`). Doc 04 §3: guard hooks deny patterns from `modules/security/guards.yaml` plus `profiles/<p>/guards.yaml`; prefer Claude `permissions.deny` where a static rule suffices. Doc 08 §3: secrets never pass through the model. ADR-0020 left the `guards.yaml` schema to this module.

## Decision

### `guards.yaml` (`core/schema/guards.schema.json`)

```yaml
guards:       # destructive commands: regex on the shell command line
  - { id, pattern, reason }
secretFiles:  # secret files: regex on a file name (last path segment)
  - { id, pattern, reason }
secretAllow:  # names that look secret but are not; checked first
  - { id, pattern }
```

Profiles keep the ADR-0020 shape (`guards` only) and may add the other two lists. Patterns are JavaScript regular expressions; the files are validated on every load.

### Rules shipped in `modules/security/guards.yaml`

| id | Blocks | Not blocked (examples) |
|---|---|---|
| `rm-rf` | `rm` with a recursive **and** a force flag in one command (`-rf`, `-fr`, `-r -f`, `--recursive --force`), also `sudo rm`, `git rm` | `rm -r dir`, `rm -f file` |
| `force-push` | `git push` with `--force`, `--force-with-lease`, `--force-if-includes`, a short flag group containing `f`, or a `+refspec` | `git push -u origin x`, `--follow-tags` |
| `prod-deploy` | `deploy` followed by the word `prod`/`production` in the same command (`just deploy prod`, `deploy:production`, `--env production`, `--prod`), `vercel … --prod` | `just deploy staging` |
| `dotenv` | file names `.env`, `.env.<anything>`, `.env*` | `.env.example`, `.sample`, `.template`, `.dist`, `.defaults` (`secretAllow`), `.envrc` |
| `private-key` | `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`, `id_rsa`/`id_dsa`/`id_ecdsa`/`id_ed25519` | `id_ed25519.pub` |
| `credentials` | `.netrc`, `.pgpass`, `.pypirc`, `credentials`, `credentials.json`, `secret(s).yaml/yml/json/toml` | – |

Doc 04 §3 said "`rm -rf` outside the repo"; BD6 says `rm -rf`. The guard blocks every `rm -rf`: a path check in a regex is unreliable (`$VAR`, `~`, `..`), and `rm -r` without `-f` still works for the agent. Doc 04 is updated.

### Hooks

- `guard-secret-read` (`PreToolUse`, matcher `Read|Edit|MultiEdit|Grep|Bash`; Codex: `Bash|apply_patch`): denies when a path of the tool input (`file_path`, `path`, `notebook_path`, Grep `glob`, apply_patch file headers) or a word of the shell command names a secret file. Write is not matched (it does not read; Claude needs a Read before overwriting an existing file).
- `guard-destructive` (`PreToolUse`, matcher `Bash`): denies a command that matches a `guards` rule of the module or of the project's profile (e.g. `npm publish`, release-tag push).
- Deny reason: `YAW security (<id>): <reason> <what to do>`, one line. Nothing is printed for an allowed call (ADR-0007).
- **Authorisation** means the user runs the command themselves (e.g. Claude's `!` shell prefix, or a terminal). There is no allow-once mechanism in phase 1 (`permissionDecision: ask` would change the UX; BD6 and Y-5.0 say deny).

### Static backstop

`security` contributes `permissions.deny` to `.claude/settings.json`: `Read(**/.env)`, `Read(**/.env.local)`, `Read(**/.env.*.local)`, `Read(**/.env.production)`, `Read(**/*.pem)`, `Read(**/*.key)`, `Read(**/id_rsa)`, `Read(**/id_ed25519)`. It works in Claude even when the hook fails open (no kit, no Node). It is narrower than the hook on purpose: Claude's deny rules override allows, so `Read(**/.env.*)` would also block `.env.example`. The `**/` form follows the gitignore-style matching of Claude permission rules (documented); the exact rules are not verified in a live session.

### Limits (stated, not hidden)

The guards are a seat belt against mistakes, not a sandbox. Not caught: obfuscated commands (`r''m`, variables, `eval`, base64), scripts that read secrets themselves, `grep -r` over a folder that contains `.env`, `find … -delete`, deploys whose command line does not name production, any command run outside the agent. Copying a template to `.env` (`cp .env.example .env`) is blocked because the target is named; the user runs it.

### Module facts

- `default: { quick: true, standard: true, full: true }` (ADR-0009). `depends: [standards]` as in doc 04 §1; `standards` arrives in 5.1, and dependencies are enforced only on removal (`yaw remove standards` will refuse while `security` is enabled).
- `agents`: Claude native, Codex native (trust via `/hooks`), Copilot partial (deny shape from the docs, not verified live). `tokenCost: none`.
- **Quick footprint re-counted** (ADR-0009 consequence): core + security + node-cli is **12 files** for Claude only (+ `.claude/settings.json`, `.yaw/bin/yaw-hook`), **13** with Codex (+ `.codex/hooks.json`); `.yaw/base/` not counted.

## Consequences

- Every rule has a test for Claude, Codex and Copilot (`modules/security/tests/security.test.js`), plus allow cases that must stay silent.
- A false positive costs one round trip: the agent sees the reason and asks the user. A rule that annoys can be narrowed in `guards.yaml` by a PR to the kit.
- `yaw remove security` leaves no residue (tested): the settings files and the shim disappear when no other module contributes to them.
