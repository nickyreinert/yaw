# ADR-0003: Hash and merge strategy for `yaw update`

- Status: Accepted
- Date: 2026-10-20
- Issue: #9 (Y-1.5); implemented in Y-2.5 / Y-2.6 / Y-2.7
- Resolves: U2, U3 (`docs/build/plan.md` §1.2)

## Context

`yaw update` re-renders managed files from a new kit version. Files the user edited must not be overwritten; the user chooses keep / take / merge (doc 01 §4). A three-way merge needs the *base*: what the kit wrote last time. The manifest records a hash per file (doc 01 §5) but not the content.

## Decision

### Hash

- `sha256:<hex>` over the file content as written by the kit, with CRLF normalised to LF before hashing (a checkout with `core.autocrlf` must not look like an edit).
- A file is **edited** when the hash of its current content differs from the manifest hash.
- Shared files: each fragment is hashed the same way (`files[].fragments[].hash`); fragment boundaries follow ADR-0004.

### Base storage

- The kit stores the pristine content of every managed file at `.yaw/base/<path>` whenever it writes the file. Its hash equals the manifest hash, so the manifest covers it; it is committed like the manifest, so collaborators and CI have the same base.
- Rejected: re-rendering the old kit tag (needs the old engine and unchanged answers), hidden git objects (opaque, garbage-collected), no base (no real merge).

### Update flow per managed file

| State | Action |
|---|---|
| Unedited, template unchanged | nothing |
| Unedited, template changed | overwrite silently; update base and hash |
| Edited, template unchanged | nothing (the edit stays) |
| Edited, template changed | show `diff -u` (current vs. new) and ask: **keep** (file stays; base and hash move to the new render, so the next update diffs from it), **take** (overwrite after confirmation), **merge** (`git merge-file current base new`) |
| Merge with conflicts | file is written with conflict markers, listed in the summary and by `yaw doctor` until resolved |
| Non-interactive (`--yes`) | keep for edited files, report them; `--strategy keep\|take\|merge` overrides |

After keep or merge the file differs from its manifest hash and stays "edited". `git` is a prerequisite (doc 01 §4), so `git merge-file` needs no extra tool.

### `managed: false`

Files the user owns are never written by `yaw update`; when their template changes, the summary says so and shows the diff. `yaw remove <module>` leaves them in place, lists them as "kept, owned by you" and drops them from the manifest.

### Deleted files

A managed file that is missing is not recreated. `yaw update` reports it; `yaw update --restore <path>` recreates it, `yaw update --forget <path>` drops it from the manifest. Non-interactive: report only.

### Renamed templates

Treated as remove + add: the old path is deleted if unedited, otherwise kept, marked `managed: false` and reported; the new path is written. If a file already exists at the new path, it is handled as "edited, template changed" without a base (keep / take only).

## Consequences

- One extra copy per managed file under `.yaw/base/` (small text files). It is the price for real three-way merges that work on every machine.
- The flow never loses user edits without an explicit "take".
- New CLI surface: only flags on `yaw update` (`--strategy`, `--restore`, `--forget`); Y-2.4 fixes their final names.
- Y-2.6 must test every row of the table above, including conflicts and the non-interactive default.
