# 08 — External Vendors and Secrets

## 1. Flow

1. **Ask** (interview 9.1): services the user already knows they need.
2. **Suggest** (9.2): the agent matches the proposal against `vendors/*.yaml`, filtered by budget preference (free tier / paid OK / self-hosted), and offers 1–3 options per need with a one-line trade-off.
3. **Decide** per service: set up now / later / skip. Each chosen service becomes an ADR (category `Integrations`).
4. **Onboard**: guided steps to obtain keys, then the secret flow (section 3).
5. **Verify**: `just vendors-check` runs each vendor's harmless verify command (e.g. list domains, ping endpoint).

Services marked "later" become tasks in the ledger with the onboarding steps attached.

## 2. Vendor catalogue entry

```yaml
# vendors/resend.yaml
name: Resend
category: email
summary: Transactional email API, simple SDKs.
pricing: { freeTier: "limited monthly emails", paid: true, lastVerified: 2026-10 }
selfHostedAlternative: postal
privacy: { region: [us, eu], dpa: true }
signup: https://resend.com/signup
steps:
  - Create an account and verify your sending domain (DNS records).
  - Create an API key with "sending access" only.
secrets:
  - name: RESEND_API_KEY
    scope: [local, staging, prod]
verify: just vendor-check resend
profiles: [python-web, node-ts-vercel, cloudflare-workers, php-web]
```

Categories to seed: hosting, database, object storage, email, auth, payments, error tracking, analytics (privacy-friendly first), AI/LLM, maps, search, CI/CD, domains/DNS.

Pricing and free tiers change: every entry has `lastVerified`; the agent states the date and links the pricing page instead of quoting numbers as fact. Entries older than 6 months are flagged in `yaw doctor`.

## 3. Secret handling

| Rule | Implementation |
|---|---|
| Secrets never pass through the LLM | Agent prints *where* to get the key and *which command to run*; the user enters the value in the terminal prompt or the browser form, which writes it directly |
| Local storage | `.env` (git-ignored) generated from `.env.example`; optional OS keychain via `just secret-set NAME` |
| Remote storage | Wrapped per target: `gh secret set`, `vercel env add`, `wrangler secret put`, server `.env` via SSH; each wrapper is a guarded action |
| No leaks | `gitleaks` in git hooks and `just audit`; `.env*` in `.gitignore`; Claude Code `permissions.deny` for reading `.env*` |
| Inventory | `docs/spec/secrets.md` lists names, purpose, environments, rotation note; never values |
| Rotation | `just secret-rotate NAME` prints vendor steps and updates all environments in order |

Saved setups (`~/.yaw/`, Y-7.2, ADR-0043): never hold secrets. A save is refused as a whole when an answer key contains a secret-type word (token, password, secret, apikey, credential) or a value matches the `secretValues` rules of `modules/security/guards.yaml` (token prefixes, private key blocks, JWT, bearer tokens, URL with password, `name=value` and `"name": "value"` for secret-like names, case-insensitive) or the `secretFiles` rules as a bare file name (`.env`). The message names key and rule, never the value, and the interview summary hides such a value. A secret typed into an answer is already in the project: `.yaw/answers.yaml`, `AGENTS.md` and `.yaw/base/AGENTS.md`; the message says so. Pattern rules miss bare random strings; secret entry is the secret flow below.

The guided onboarding in the CLI lane uses a hidden input prompt; in the form lane, a password field posted only to the local server.
