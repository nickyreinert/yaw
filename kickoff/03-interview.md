# 03 — Interview Catalogue

Legend: **Q** shown in Quick, **S** in Standard, **F** only in Full. `→` = module or artefact the answer drives. Questions of a disabled module are never asked. Every question has a default; "don't know" takes it and marks the resulting ADR `Provisional`.

Rules for the interviewer (CLI, form, or agent):

- Batches of 3–6 questions; recommend a default with a one-line trade-off.
- Ask a follow-up when an answer has security, cost, privacy or irreversibility impact.
- Never ask for secrets in chat; route them to the secret flow (doc 08).

## 0. User profile (global, asked once, stored in `~/.yaw/user-profile.yaml`)

| # | Question | Options (default **bold**) | Mode | → |
|---|---|---|---|---|
| 0.0 | **Which coding agents should this setup support?** (first screen, multi-select, per project; global default remembered) | **Claude Code** / Codex / Copilot / Gemini CLI (enterprise / API key) / Antigravity CLI / Pi / Hermes (phase 1: Claude Code, Codex, Copilot; others phase 3) | Q | adapters, which customisation is generated, capability hints |
| 0.1 | Your experience with software development? | layperson / **intermediate** / expert | Q | help depth, wording |
| 0.2 | Language for chat with the agent? | **de** / en / … | Q | communication |
| 0.3 | Answer length? | brief & on point / **balanced** / extensive | Q | communication |
| 0.4 | Register? | plain words / **professional** / technical / scientific | S | communication |
| 0.5 | Examples and analogies? | **when helpful** / always / never | S | communication |
| 0.6 | Should the agent explain *why* it chose something? | one line / **short paragraph** / only on request | S | communication |
| 0.7 | Autonomy: how often should the agent ask before acting? | ask often / **ask on risky or ambiguous steps** / act and report | Q | permissions, AGENTS.md |
| 0.8 | Comfort features, each a separate checkbox with its token cost shown: session hygiene, status line, notifications (channel), cache reminder | **hygiene + status line on**, others off; all zero model tokens | S | doc 11 |
| 0.9 | Global knowledge store: use it? where? | **yes, `~/.yaw/knowledge/`** / custom path / no | S | doc 12 |
| 0.10 | Session evaluation | **implicit signals only (free)** / + local decision model(s), multi-select: Laya, WaterSheep, Kev, SemIf, Ollama-compatible / + hosted decision model (Jev, needs privacy approval) / + agent self-report (≈ 15 tokens per task) / off | S | doc 13 |
| 0.11 | Dashboard and local metrics (OTel to `127.0.0.1`) | **yes** / no | S | doc 13 |
| 0.12 | Remote dev loop from the phone | **no** / YAW Telegram bridge (`yaw-tg`, all agents) / + Claude Remote Control (optional extra) | F | doc 11 §4 |

After 0.0 the form shows a short capability note per selected agent (from `adapters/capabilities.yaml`), e.g. "Codex: no automatic recall hook; the rule-based fallback is used". Unsupported features are greyed out with the reason, not hidden.

Project-level overrides (S): language of code identifiers, comments, commit messages, docs, UI texts (default: English for code/commits/docs).

## 1. Idea and purpose

| # | Question | Mode | → |
|---|---|---|---|
| 1.1 | Describe the idea in a few sentences. (free text) | Q | proposal |
| 1.2 | Who uses it? (me only / a known group / the public) | Q | privacy, security, scale |
| 1.3 | Prototype, MVP, or long-lived product? | Q | preset, gate strictness |
| 1.4 | What does success look like in 3 and 12 months? What is out of scope? | F | ADRs, tasks |
| 1.5 | Solo or team? Who approves changes? (solo / team / external reviewers) | Q | **team mode (doc 14)**, review policy, branch protection |
| 1.6 | Budget envelope (hosting, AI, tools): free only / small monthly / flexible | S | vendors, hosting |
| 1.7 | Biggest risk you can imagine? | F | notices |

## 2. Product and domain

| # | Question | Mode | → |
|---|---|---|---|
| 2.1 | Core things the product handles (e.g. users, orders, posts) | S | data model, taxonomy |
| 2.2 | Who may do what? (anonymous, logged in, admin, machine) | S | auth, security review |
| 2.3 | Rules that must never be broken (pricing, fairness, ordering, limits) | S | business-logic notices + reviewer checklist |
| 2.4 | User-generated or untrusted content? | S | security, moderation |

## 3. Architecture (agent proposes, user may override)

| # | Question | Mode | → |
|---|---|---|---|
| 3.1 | Preferred or required language/framework? (or "you choose") | Q | profile |
| 3.2 | Where should it run? (my machine only / self-hosted server / serverless/edge / app store / "you choose") | Q | profile, environments |
| 3.3 | Does it store data? What kind? (none / files / relational / key-value / search) | S | data ADR, backup |
| 3.4 | Login needed? Which kind? | S | auth ADR |
| 3.5 | Expected load and latency needs (tiny / moderate / high) | F | performance budget |
| 3.6 | Repositories: one / several (frontend, backend, public vs. private) | F | repo ADR |

The proposal shows: chosen profile(s), shape (monolith, static + API, …), data, hosting, and two rejected alternatives with one-line reasons.

## 4. Environments and delivery (→ doc 07, doc 10)

| # | Question | Mode |
|---|---|---|
| 4.1 | Environments needed: local only / local + prod / local + staging + prod / + preview per PR | S |
| 4.2 | Who or what may deploy? Which steps need your explicit OK? | S |
| 4.3 | Migration policy (forward-only expand/contract is the default) | F |
| 4.4 | Observability on day one: none / logs / logs + errors / + metrics | F |

## 5. Quality and standards (→ doc 04)

| # | Question | Mode |
|---|---|---|
| 5.1 | Gate strictness: advisory / **hooks + CI** / hooks + CI + mandatory human review | Q |
| 5.2 | Which gates: code quality, security, performance, business logic, UI/visual, accessibility (checkboxes, defaults per profile) | S |
| 5.3 | Test expectation: smoke only / **core logic covered** / coverage threshold n % | S |
| 5.4 | Performance budgets (page weight, LCP, API p95, app start) – defaults per profile | F |

## 6. UI and design (→ doc 06, only if the product has a UI)

| # | Question | Mode |
|---|---|---|
| 6.1 | Pick a design direction (preview cards) or "surprise me with 3 options" | Q |
| 6.2 | Existing brand? (logo, colours, fonts) | S |
| 6.3 | Light, dark, or both | S |
| 6.4 | Density (airy / balanced / compact) and motion (none / subtle / expressive) | S |
| 6.5 | Accessibility level (default: WCAG 2.2 AA) | S |
| 6.6 | Reference sites or apps you like (URLs or names) | F |

## 7. Privacy (→ doc 07)

| # | Question | Mode |
|---|---|---|
| 7.1 | Is it public-facing? | Q |
| 7.2 | Does it process personal data (names, emails, IPs, location, photos, health…)? | Q |
| 7.3 | Where are users located (EU/DE implies GDPR, imprint/privacy page)? | S |
| 7.4 | Analytics / tracking wanted? (none / privacy-friendly / full) | S |
| 7.5 | Retention and deletion expectations | F |

## 8. Backup and restore (→ doc 07, only if data is stored)

| # | Question (layperson wording) | Mode |
|---|---|---|
| 8.1 | What data would hurt to lose? (database, uploads, config) | S |
| 8.2 | How much data may you lose at most? (a day / an hour / nothing) | S |
| 8.3 | How long may it be down after a disaster? | F |
| 8.4 | Where may backups live? (local disk / another server / cloud storage) | S |

## 9. External services (→ doc 08)

| # | Question | Mode |
|---|---|---|
| 9.1 | Services you already know you need (email, payments, AI, maps, auth, storage…) | S |
| 9.2 | Should the agent suggest services? Preference: free tier / paid OK / self-hosted | S |
| 9.3 | For each chosen service: set up keys now, later, or skip | S |

## 10. Tasks and GitHub (→ doc 10)

| # | Question | Mode |
|---|---|---|
| 10.1 | Task tracking: **local only** / GitHub only / both (local-first) | Q |
| 10.2 | Use GitHub for the repo? Create it now? Public or private? | Q |
| 10.3 | Branch model: trunk + short branches (default) / git-flow | F |
| 10.4 | Use milestones/epics and a GitHub Project board? | S |

## 11. Agents and governance (→ doc 04, doc 09)

| # | Question | Mode |
|---|---|---|
| 11.1 | Modules (checklist with preset defaults, each uncheckable) | Q |
| 11.2 | Actions that always need your OK (deploy, remote migration, secrets, force-push, deleting data, external messages) | S |
| 11.3 | Model policy: cheap model for mechanical tasks, strong for design/security (default) / always strongest | F |
| 11.4 | Decision taxonomy: accept proposed categories or adjust | F |

## 12. Team mode (only if 1.5 = team, → doc 14)

| # | Question | Default | Mode |
|---|---|---|---|
| 12.1 | Team size, leads, reviewers (GitHub handles) | – | Q |
| 12.2 | Approvals per PR | 1 | Q |
| 12.3 | Issue types: GitHub issue types (org) or labels | auto-detect | S |
| 12.4 | Priority scheme | P0–P3 | S |
| 12.5 | Estimate unit | T-shirt XS–XL / story points | S |
| 12.6 | Iteration length | 2 weeks / none | S |
| 12.7 | Launch date and phases (pick from template: discovery, MVP, beta, feature freeze, code freeze, launch, post-launch) | template | S |
| 12.8 | Merge strategy | squash | F |
| 12.9 | One git worktree per task (parallel agents) | no | F |
| 12.10 | Sync policy at session start | fast-forward when safe, else block edits until `just sync` | F |

## 13. Confirmation

Decision summary table: question, answer or default, trade-off, generated artefact/ADR. Plus the file list the apply step will create. The user confirms or edits; nothing is written before.
