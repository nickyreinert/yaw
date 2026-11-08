# NOTICE-0002: The recall store keeps raw tool output in plaintext on the local machine

- **Date:** 2026-11-08
- **Category:** Modules / Comfort
- **Kind:** privacy
- **Status:** Proposed
- **Importance:** high
- **Scope:** `modules/compact/lib/recall.js`

## Context

With the compact recall lever on, the full output of a shortened command is stored in ~/.yaw/recall. This is the first YAW feature that stores tool-output content.

## Consideration

Command output can contain secrets, personal data and proprietary code, and the store keeps it unredacted. Gzip is compression, not protection. Entries are kept for up to 30 days, at most 200. Files are private to the user account (0600 in a 0700 directory, no symbolic links) but readable by anyone with access to that account, its backups or the disk. The store is never included in data sync, exports or the hub. Turning the lever off stops storing; deleting ~/.yaw/recall removes what was stored. Not implemented: encryption, secret redaction before storing, a command to purge entries. See ADR-0133.

## References

- spec: kickoff/16-compact-output.md
