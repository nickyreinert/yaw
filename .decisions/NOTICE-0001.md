# NOTICE-0001: Portable sync stores user-authored defaults in plaintext destinations

- **Date:** 2026-10-25
- **Category:** Architecture / Formats
- **Kind:** privacy
- **Importance:** high
- **Scope:** `core/lib/data-sync.js`

## Context

Manual sync publishes personal defaults and preset descriptions alongside numeric summaries to a folder/share or private GitHub repository.

## Consideration

No transcript text or credential files are exported, and secret-pattern checks apply, but free-form answers can still contain private text or unrecognized secrets. Destination access control protects plaintext; Git history may retain deleted values. Users must review portable records before sharing. Encryption and remote retention/purge controls are not implemented.
