# 07 — Privacy, Backup/Restore, Environments

## 1. Privacy

Trigger: interview 7.1 (public-facing) or 7.2 (personal data) = yes. Not legal advice; the kit structures the work and flags gaps.

### 1.1 Privacy journal (same decision store)

- New notice kind `privacy` in `.decisions/` (alongside `security`, `business-logic`), plus taxonomy category `Privacy` with subcategories e.g. `Data Inventory`, `Third Parties`, `Tracking`, `Retention`, `User Rights`.
- Privacy-relevant **decisions** are ADRs in that category (e.g. "Use self-hosted fonts", "No analytics", "Delete accounts after 30 days").
- Retrieval works as for other records, so a task like "add newsletter signup" automatically surfaces privacy notices.

### 1.2 Data map (`docs/spec/privacy.md`)

Living table maintained by the agent:

| Data item | Source | Purpose | Legal basis | Storage location | Retention | Deletion path | Shared with |
|---|---|---|---|---|---|---|---|

### 1.3 Privacy gate

| Layer | Check |
|---|---|
| Hook (`PreToolUse` on `Edit\|Write` or dependency install) | Warn + require a privacy notice/ADR when adding: known tracker/analytics domains, external fonts/CDNs, new third-party SDKs, new fields matching PII patterns (email, phone, ip, birth, address, location) |
| `just check` | Scan built output for external requests to non-allow-listed hosts (Playwright network log for web; manifest permissions for Android); fail when a host is not in `docs/spec/privacy.md` |
| Reviewer | `change-reviewer` loads the privacy checklist when the diff touches data models, forms, logging, or third parties |
| Logging rule | No PII in logs; IPs truncated/hashed where logs are kept |

### 1.4 Privacy checklist (generated on demand)

`just privacy-report` compiles the data map + privacy records into `docs/spec/privacy-checklist.md`: what is processed, which pages/texts are needed (DE: imprint, privacy policy, cookie consent only if non-essential cookies), processor agreements per vendor, user-rights flows (export, delete), open notices. Re-run before each release.

## 2. Backup and restore

Ask first (interview 8.x), then suggest. Skip entirely for stateless projects.

### 2.1 Strategy menu

| Strategy | When | Tooling |
|---|---|---|
| **None needed** | Stateless, data lives in git or a managed service with its own backups | Record as ADR |
| **Quick local** | Hobby, single machine | `just backup` → timestamped archive (DB dump + uploads + config without secrets) in `./backups/` or a chosen folder; `just restore <file>` |
| **Scheduled off-site** | Self-hosted with real users | `restic` (or `borg`) to S3-compatible storage / another server; cron/systemd timer template; retention policy (e.g. 7 daily, 4 weekly, 6 monthly) |
| **Provider-managed** | Managed DB (Neon, Supabase, D1, RDS…) | Document provider settings (PITR window), plus periodic logical export for portability |

### 2.2 Non-negotiable

- **A backup only counts if restore is tested.** `just restore --verify` restores the latest backup into a throwaway container/DB and runs a smoke query/test. Part of the scheduled job and of the Full-preset release checklist.
- Backups are encrypted when leaving the machine; keys stored outside the backup target.
- `just restore` against a non-local environment is a guarded action (needs explicit authorisation).

## 3. Environments

Interview 4.1 decides. Not every project needs more than local.

| Setup | Contains | Typical for |
|---|---|---|
| Local only | `just dev` | Scripts, tools, prototypes |
| Local + prod | `.env` per env, guarded `just deploy prod` | Small sites, personal apps |
| Local + staging + prod | Staging mirrors prod config; promotion staging → prod | Apps with users |
| + preview per PR | Platform previews (Vercel, Cloudflare, Netlify) | Frontend-heavy apps |

Generated (environments module):

- `config/environments.yaml`: names, URLs, deploy method, who may deploy, health-check URL.
- `just deploy <env>`: `just check` → deploy → health check → print rollback/recovery steps from `docs/spec/deployment-and-migrations.md`.
- `just db-pull <env>`: copy remote data to local **with anonymisation** when the privacy module is on (links privacy and backup).
- Remote staging is optional; a **local staging** (`just staging`) runs the production build + prod-like config in Docker for projects without a staging server.
