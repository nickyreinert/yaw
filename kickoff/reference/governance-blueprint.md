# Agent Governance Blueprint

> **Status: reference spec.** This is the original blueprint, kept unchanged as the technical source for the `decisions` module (sections D, E, F, K), the gate pattern (H) and the vendor matrix (I). The intake interview (B), bootstrap (L) and stack matrix (M) are **superseded** by [../../KICK-OFF.md](../../KICK-OFF.md) and the documents in [../](../). Do not follow the "How to use" instruction below.

A stack-agnostic, portable concept for running AI coding agents (Claude Code, Codex, GitHub Copilot, Gemini) inside a project with **recorded decisions, automatic recall, enforced quality gates, and review roles**.

It was extracted from a working implementation (TypeScript, Cloudflare Workers, Vercel, GitHub Actions). Nothing here depends on that stack. Part B is an interview that decides the stack-specific parts. Parts C onward are the machinery you copy into a new project.

> **How to use this file in a new project:** put it in the repo (or paste it into an agent) and say: *"Read `agent-governance-blueprint.md`. Run the Part B interview with me first. Do not generate files until I have confirmed the decision summary. Then build the scaffold from Parts C–J."*

---

## Contents

- [A. The idea in one page](#a-the-idea-in-one-page)
- [B. Intake interview (ask before building)](#b-intake-interview-ask-before-building)
- [C. System architecture](#c-system-architecture)
- [D. The decision journal (data model)](#d-the-decision-journal-data-model)
- [E. Embeddings and retrieval](#e-embeddings-and-retrieval)
- [F. Hooks: automatic recall](#f-hooks-automatic-recall)
- [G. Skills and agent roles](#g-skills-and-agent-roles)
- [H. Quality gates](#h-quality-gates)
- [I. Instruction files and multi-agent support](#i-instruction-files-and-multi-agent-support)
- [J. Documentation structure and work ledger](#j-documentation-structure-and-work-ledger)
- [K. Reference implementation (portable code)](#k-reference-implementation-portable-code)
- [L. Bootstrap procedure](#l-bootstrap-procedure)
- [M. Adaptation matrix per stack](#m-adaptation-matrix-per-stack)
- [N. Known weaknesses and upgrades](#n-known-weaknesses-and-upgrades)
- [O. Checklists and prompt templates](#o-checklists-and-prompt-templates)

---

## A. The idea in one page

**Problem.** AI agents are stateless. Each session re-discovers the architecture, re-argues settled decisions, ignores constraints that live in someone's head, and drifts from the intended design. Rules in one big instruction file get ignored as the file grows.

**Solution.** Five cooperating layers:

| # | Layer | Purpose | Enforcement strength |
|---|-------|---------|----------------------|
| 1 | **Instruction file** (`AGENTS.md`) | Short, always-loaded rules and workflow routing | Advisory (model may ignore) |
| 2 | **Decision journal** (Markdown + index with embeddings and metadata) | Durable memory of *why* things are the way they are | Retrieved automatically |
| 3 | **Hooks** | Inject the relevant decisions into every task *before* the model thinks | Deterministic (harness runs it) |
| 4 | **Skills and agent roles** | Packaged procedures (record a decision, review a diff, operate a platform) | On-demand |
| 5 | **Quality gates** (local script + CI + PR template + branch protection) | Block bad changes regardless of what the agent believes | Hard (machine-enforced) |

**Core principles**

1. **Advisory vs. enforced.** Anything that must happen goes into a hook or a gate, not into prose. Prose only describes.
2. **Retrieve, don't preload.** Never dump all decisions into context. Classify the task, retrieve only matches, cite their IDs.
3. **Decisions are immutable records, not wiki pages.** Append new records; supersede, don't rewrite history.
4. **Local and deterministic by default.** Retrieval must work offline without API keys, so hooks never fail because of a network or credentials. (Hosted embeddings are an optional upgrade, see section N.)
5. **One source of truth, many adapters.** Content lives in neutral locations (`AGENTS.md`, `.decisions/`, `.agents/skills/`). Per-vendor files are thin pointers.
6. **Fail open on retrieval, fail closed on gates.** A broken recall hook must not block work, while a failing quality gate must block a merge.
7. **Tests for the governance code itself.** The journal, retrieval and gate scripts are code and get tested.
8. **Review is advisory; the gate is binding.** An LLM review never replaces CI plus a human.

---

## B. Intake interview (ask before building)

The agent must ask these in order, in small batches (3–6 questions each), offering a recommended default where one exists, and must record the answers. Answers become the first ADRs (section D) and parameterize every later part. **Do not skip to scaffolding.**

> Rule for the interviewing agent: if an answer is "don't know", propose a default with trade-offs and mark the resulting ADR as `Status: Provisional`. If an answer has security, cost, or irreversibility implications, ask a follow-up.

### B1. Strategy and purpose

1. What problem does the product solve, and for whom? (one sentence each)
2. What does success look like in 3 months and in 12 months? What is explicitly out of scope?
3. Is this a prototype, an MVP, or a long-lived production system? How long will it be maintained, and by how many people?
4. Who are the stakeholders and who approves changes (solo, small team, external reviewers)?
5. What are the non-negotiables (legal, compliance, privacy, brand, uptime)?
6. What is the budget envelope for hosting, AI usage and tooling, and what happens when it is exceeded?
7. What is the biggest risk you can imagine (data loss, abuse, cost explosion, vendor lock-in, security breach)?

### B2. Product and domain concept

1. Core entities and their lifecycle (e.g. user, order, patch, document).
2. Who are the actors (anonymous, authenticated, admin, machine/agent)? What may each do?
3. Which flows are business-critical, and which "business rules" must never be violated (fairness, pricing, ordering, quotas)?
4. Is there user-generated or untrusted content? If so, is moderation or sanitization needed, and at which boundary?
5. Is any personal data processed? Where is it stored, for how long, and how is it deleted?

### B3. Architecture and technology

1. Language and framework (TypeScript/Node, Python/Flask/FastAPI/Django, PHP/Laravel, Go, Java, other)?
2. Application shape: monolith, modular monolith, services, serverless/edge, static site + API?
3. Data: relational, document, key-value, object storage, search or vector? Which engine? Migration tool? Is the schema allowed to break between deploys?
4. Hosting: Cloudflare, Vercel, AWS (which services), GCP, Azure, self-hosted (Docker, bare metal, Kubernetes), shared PHP hosting?
5. How many deployable units, and how many repositories? Where are the boundaries (public vs. private, frontend vs. backend, history vs. live)?
6. Authentication and authorization model (sessions, JWT, OAuth, API keys, mTLS)?
7. External services (payments, email, AI models, queues, analytics)? Which of them may fail, and what is the fallback?
8. Environments (local, preview, staging, production) and how secrets are provided to each.
9. Observability: logging, metrics, tracing, alerting. Which of them exist on day one?
10. Performance and scale expectations (requests per second, data volume, latency budget).

### B4. Delivery and operations

1. Source control host (GitHub, GitLab, Bitbucket, self-hosted)? Branching model and merge policy?
2. CI system and what must pass before merge (type check, lint, tests, build, migrations, security scan, dry-run deploy)?
3. Deployment path: who or what may deploy, what is automated, what needs explicit human authorization?
4. Migration and rollback policy (forward-only? expand/contract? blue-green?).
5. Release verification (health checks, smoke tests) and recovery steps.

### B5. Agent and governance setup

1. Which coding agents will be used now and later: Claude Code, Codex (CLI/IDE/cloud), GitHub Copilot (IDE, CLI, coding agent), Gemini (CLI/Code Assist), Cursor, others? (Determines which adapter files in section I are generated.)
2. How strictly should agents be gated? Options: *advisory only*, *hooks plus CI* (recommended), *hooks plus CI plus mandatory human review*.
3. Which actions require explicit human authorization (deploy, remote migrations, secrets, force-push, external communication, deleting data)?
4. Is retrieval to remain fully local (recommended) or may it call a hosted embedding API? Is a vector database justified, or will the journal stay small (<500 records)?
5. Decision taxonomy: propose categories and subcategories based on the architecture answers and ask for adjustments. (Section D3.)
6. Which "importance" levels and statuses should exist? (Defaults in D2.)
7. Which roles are needed? Defaults: `change-reviewer` (read-only), `platform-architect` (read-only design review), plus one operator skill per platform in use.
8. Where do plans, specs and the unfinished-work ledger live? (Defaults in section J.)
9. Which language for code, docs and logs? (Default: English.)
10. Cost policy for agents: which model tier for which task (cheap for deterministic or mechanical work, strong for design and security)?

### B6. Confirmation step

Produce a **Decision Summary**: a table of every answer, the chosen default or option, the trade-off accepted and the generated ADR ID. Ask the user to confirm or amend before scaffolding. Then record one ADR per major decision (language/framework, hosting, data, auth, repo boundaries, delivery policy, governance strictness) using the record command from section K.

---

## C. System architecture

```
                        ┌──────────────────────────────┐
  user prompt ────────► │ Agent harness (Claude/Codex/ │
                        │ Copilot/Gemini)              │
                        └──────┬───────────────────────┘
                               │ 1. reads always-on rules
                               ▼
                         AGENTS.md  (+ thin vendor pointers)
                               │
        2. hook fires          │            3. skills on demand
        (UserPromptSubmit)     │
               ▼               ▼                    ▼
   ┌────────────────────┐   ┌────────────────┐   ┌──────────────────────┐
   │ pre-task-context   │   │ model works    │   │ skills / agent roles │
   │  classify → filter │──►│ with injected  │──►│ record ADR, review,  │
   │  → cosine rank     │   │ ADRs + notices │   │ operate platform     │
   └─────────┬──────────┘   └────────────────┘   └──────────┬───────────┘
             │ reads                                         │ writes
             ▼                                               ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │ .decisions/  taxonomy.json · decisions.index.json · ADR-*.md ·   │
   │              NOTICE-*.md   (Markdown = truth, index = derived)  │
   └─────────────────────────────────────────────────────────────────┘
                               │
        4. before merge/deploy ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │ change-review (advisory) → local gate script → CI workflow →     │
   │ PR template → branch protection + human review (binding)        │
   └─────────────────────────────────────────────────────────────────┘
```

### Directory layout (neutral core, vendor adapters)

```
repo/
├── AGENTS.md                         # single source of rules (all agents read this)
├── CLAUDE.md                         # contains only:  @AGENTS.md
├── GEMINI.md                         # contains only:  @AGENTS.md   (or settings context.fileName)
├── .github/
│   ├── copilot-instructions.md       # short pointer + critical rules for Copilot
│   ├── PULL_REQUEST_TEMPLATE.md      # review checklist
│   ├── workflows/quality-gate.yml    # CI gate
│   └── hooks/                        # Copilot agent hooks (if used, verify support)
├── .decisions/
│   ├── taxonomy.json                 # category → subcategory → keywords
│   ├── decisions.index.json          # metadata + embeddings (derived, committed)
│   ├── ADR-0001.md …                 # accepted decisions
│   └── NOTICE-0001.md …              # security / business-logic considerations
├── .agents/skills/<name>/SKILL.md    # neutral skills (Codex and others read this)
├── .claude/
│   ├── settings.json                 # hook registration (Claude Code)
│   ├── hooks/
│   │   ├── pre-task-context.mjs      # retrieval hook
│   │   └── lib/embedding-client.mjs  # local embedding + cosine
│   ├── skills/<name>/{SKILL.md,scripts/}  # Claude skills + executable helpers
│   └── agents/<role>.md              # Claude subagents (read-only reviewers)
├── scripts/check-before-deploy.mjs   # local gate, same commands as CI
├── docs/
│   ├── spec/                         # current-system truth (kept)
│   └── plan/                         # temporary plans (deleted when done)
├── UNFINISHED.md                     # work ledger with resume points
└── tests/                            # includes tests of the governance code
```

**Design note (what the original does, honestly):** executable logic lives under `.claude/` and the neutral `.agents/` wrapper imports it (`.agents/.../pre-task-context.mjs` re-exports `retrieveAdrContext` from `.claude/hooks`). For a new project, prefer a vendor-neutral location for the logic (for example `tools/governance/`) and have each vendor directory point to it. This removes the "Codex depends on `.claude/`" coupling.

---

## D. The decision journal (data model)

### D1. Why Markdown plus index

- **Markdown files are the truth.** Human-readable, diffable, reviewable in PRs, survive any tooling change.
- **The index is derived.** It holds metadata and vectors for fast retrieval, can be rebuilt (`rebuild`) from the Markdown, and is committed so the hook needs no build step.

### D2. Record types and metadata

Two record types, which are deliberately different:

| Type | File | Meaning | Required fields |
|------|------|---------|-----------------|
| **Decision (ADR)** | `ADR-NNNN.md` | An *accepted* decision. The agent must obey it. | summary, category, subcategory, context, decision, consequences |
| **Notice** | `NOTICE-NNNN.md` | A *consideration* (security or business logic) to weigh in future work. **Not** a decision. | summary, kind (`security`\|`business-logic`), category, subcategory, context, consideration |

Index entry (what the original stores):

```json
{
  "id": "ADR-0001",
  "type": "decision",
  "file": "ADR-0001.md",
  "timestamp": "2026-10-10T12:00:00.000Z",
  "category": "Infrastructure",
  "subcategory": "Security",
  "summary": "Use edge AI classification before the commit pipeline.",
  "keywords": ["cloudflare", "workers", "ai", "classifier"],
  "embedding": [0.0079, -0.1267, "… 384 floats …"]
}
```

Metadata present in the original: `id`, `type`, `kind` (notices), `file`, `timestamp`, `category`, `subcategory`, `summary`, `keywords`, `embedding`; the index also carries a `model` tag (`local-hash-ngram-v1`) and a `version`.

**Recommended additions (not in the original, add them in the new project):**

| Field | Values | Use |
|-------|--------|-----|
| `importance` | `critical` \| `high` \| `normal` \| `low` | Ranking boost; `critical` records are injected even at lower similarity; the gate can require citing them. |
| `status` | `proposed` \| `accepted` \| `provisional` \| `superseded` \| `deprecated` | Retrieval ignores `superseded`/`deprecated`. |
| `supersedes` / `supersededBy` | record IDs | Preserves history without deleting. |
| `scope` | glob list, e.g. `["src/api/**"]` | Path-aware retrieval (hook can match edited files, section F). |
| `owner` | name/role | Who to ask. |
| `reviewBy` | date | Time-boxes provisional decisions. |
| `tags` | free list | Supplementary to taxonomy keywords. |
| `embeddingModel` | string | Detect stale vectors after a model change (rebuild trigger). |

Ranking formula suggestion: `score = cosine × importanceWeight` where weights are `critical 1.5, high 1.2, normal 1.0, low 0.8`; a `critical` record in the matched category is always included.

### D3. Taxonomy

`taxonomy.json` is a two-level controlled vocabulary. Each subcategory carries **keywords** that drive classification (section F). Example from the original:

```json
{
  "version": 1,
  "categories": [
    { "name": "Infrastructure", "subcategories": [
      { "name": "Data", "keywords": ["d1", "database", "migration", "schema"] },
      { "name": "Security", "keywords": ["moderation", "classifier", "security", "ai"] }
    ]},
    { "name": "Delivery", "subcategories": [
      { "name": "GitHub", "keywords": ["github", "repository", "branch", "runner"] }
    ]},
    { "name": "Architecture", "subcategories": [
      { "name": "ADR", "keywords": ["adr", "decision", "journal", "retrieval"] }
    ]}
  ]
}
```

**Rules**

- Every record has exactly one category and subcategory; the record command **rejects unknown pairs**. The taxonomy is a gate against uncontrolled sprawl.
- Keep it small (4–8 categories, 2–5 subcategories each). Add a subcategory when you record a decision that does not fit, as a deliberate act.
- Keywords should be lowercase single tokens that people actually put in task descriptions (technology names, domain nouns). Review them whenever retrieval misses.
- **Seed it from the interview**: Strategy → `Product`, Architecture → `Architecture`, Data → `Data`, Hosting → `Delivery/<Platform>`, Security → `Security`, Operations → `Operations`, Governance → `Governance`.

### D4. Record format (canonical Markdown)

```markdown
# ADR-0007: Use forward-only migrations

- **Date:** 2026-10-12
- **Category:** Infrastructure / Data
- **Status:** Accepted
- **Importance:** high            <!-- recommended addition -->

## Context
What forces, constraints and alternatives led here.

## Decision
The decision stated as an imperative the agent can follow.

## Consequences
What becomes easier, what becomes harder, follow-up obligations.
```

Notice format replaces `Status` with `Kind` and ends with `## Consideration`.

Writing guidelines: the **Decision** section is an instruction, not a story; one decision per record; name the alternatives rejected in Context; keep records short (they are injected verbatim into context, so each costs tokens).

### D5. IDs and writes

- Sequential per prefix: `ADR-0001`, `NOTICE-0001`. Next ID = max existing + 1 (computed from the index).
- **Atomic writes**: write `file.tmp`, then `rename` (the original does this for both Markdown and index) so a crash never leaves a half-written index.
- Known limit: concurrent recording from two branches can collide on IDs. Mitigation: record decisions on the main line, or resolve collisions in review (section N).

### D6. When to record what

| Situation | Record |
|-----------|--------|
| Chose a framework, database, hosting, protocol, repo boundary | ADR |
| Chose to *not* do something with lasting effect | ADR |
| Discovered a security risk or abuse path, not yet resolved | Notice (`security`) |
| Discovered a business-rule hazard (fairness, billing, ordering) | Notice (`business-logic`) |
| Temporary workaround | Notice with `reviewBy`, or an item in the work ledger, not an ADR |
| Pure implementation detail | Neither; use a code comment or `docs/spec/` |

---

## E. Embeddings and retrieval

### E1. Why local feature-hashing embeddings

The original deliberately uses a **deterministic local embedding** instead of a model API:

- No API key, no network, no model download, no dependency, so the hook runs anywhere, instantly, including CI and offline.
- Reproducible: the same text always gives the same vector, so tests are exact and diffs are meaningful.
- Good enough for a small curated journal, where the **taxonomy pre-filter does the heavy lifting** and the vector only ranks within the matched category.

Trade-off: it matches **lexical and sub-word similarity**, not true meaning ("remove user data" will not match "GDPR erasure" unless words overlap). Section N describes the upgrade path.

### E2. Algorithm (384-dim signed feature hashing)

1. Lowercase; tokenize with `[a-z0-9]+`; drop tokens of length 1.
2. Build weighted features:
   - word `w:<token>` weight **2**
   - character trigrams of `^token$` as `c:<tri>` weight **0.25**
   - adjacent-word bigrams `b:<a>_<b>` weight **1**
3. Hash each feature with FNV-1a (32-bit); slot = `hash % 384`; sign = top bit of the hash (+1/−1); add `sign × weight` to that slot.
4. L2-normalize. An empty token list yields an empty vector (similarity 0).
5. Similarity = cosine; vectors of unequal length return 0 (guards against model changes).

Code: section K1.

### E3. What gets embedded

- At record time: `summary + context + (decision | consideration)`.
- At rebuild time, for imported Markdown: `summary + full file text`.
- At query time: the user's task text (the full prompt in the hook, or the explicit `--text`).

Consistency tip: make record-time and rebuild-time use the same text recipe, otherwise the same record has two different vectors depending on how it was created (the original has this small inconsistency).

### E4. Retrieval pipeline (two-stage)

```
task text
  → Stage 1 CLASSIFY   keyword match against taxonomy subcategory keywords → ranked (category, subcategory) pairs
  → Stage 2 FILTER     decisions: top pair only
                       notices:   every matched pair
  → Stage 3 RANK       cosine(task, entry.embedding) ≥ 0.12 threshold, sorted desc
  → Stage 4 INJECT     read the matching Markdown files, build additionalContext, require citation of IDs
```

Key behaviours to preserve:

- **No keyword match → no vector work → "no matching decision" message.** It is still injected so the agent explicitly states that no ADR applies. This makes absence visible.
- **Asymmetric scope:** decisions are binding, so only the best category is used (precision). Notices are warnings, so every matching category is used (recall).
- **Legacy fallback:** entries with no vector fall back to lexical overlap (`overlap / entryWords`), so manually imported records still work before `rebuild`.
- **Threshold 0.12** is empirical for this hashing scheme; re-tune with real tasks (section N, evaluation).
- The injected text instructs: *apply matching decisions, consider matching notices, cite IDs in the work summary.* **Citation is the audit trail** that proves the agent consumed the context.

### E5. Index lifecycle

| Event | Action |
|-------|--------|
| New record | `record` command writes Markdown and appends the index entry with vector. |
| Hand-written or imported Markdown | Add an index entry without `embedding`, then run `rebuild`. |
| Embedding algorithm or dimension change | Bump `model`, clear vectors, run `rebuild`. Add a test that fails if `model` and vector length disagree. |
| Taxonomy keyword change | No rebuild needed (classification is query-time). Retest retrieval. |

---

## F. Hooks: automatic recall

### F1. What a hook is

A hook is a command the **harness** runs at a lifecycle event, with event JSON on stdin; stdout can inject context or block the action. Because the harness runs it, it is **deterministic**: it does not depend on the model remembering to do it. This is the main reason the system works.

### F2. The recall hook (Claude Code)

Registration, `.claude/settings.json`:

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [ { "type": "command",
          "command": "node \"${CLAUDE_PROJECT_DIR}/.claude/hooks/pre-task-context.mjs\"",
          "timeout": 5 } ] }
    ]
  }
}
```

Behaviour of the script (section K2):

- Reads `{ prompt, cwd, … }` from stdin.
- Runs the E4 pipeline.
- Prints `{ "hookSpecificOutput": { "hookEventName": "UserPromptSubmit", "additionalContext": "<text>" } }`.
- **Fails open**: any error exits 0 with no output, so a corrupt index never blocks the user.
- Exports `retrieveAdrContext(prompt, cwd)` and only runs `main()` when executed directly (`import.meta.url` guard), so other adapters and tests can reuse the same function.
- Timeout of 5 s; the script must stay fast (pure local file reads and arithmetic).

### F3. Other hook events worth adding (recommendations)

These are *not* in the original; they are the natural hardening steps. Verify event names against current Claude Code docs.

| Event (Claude Code naming) | Use | Strictness |
|---|---|---|
| `SessionStart` | Inject "current work ledger + critical decisions" once per session | Context only |
| `UserPromptSubmit` | **Recall hook** (the original) | Context only |
| `PreToolUse` (matcher `Bash`) | Block destructive or external commands: deploy, remote migration, `git push --force`, `rm -rf`, secret reads, unless authorized | **Blocking** (exit code 2 / deny decision) |
| `PreToolUse` (matcher `Edit\|Write`) | Block edits to protected paths (accepted `.decisions/*.md`, lockfiles, CI) or require a recorded ADR for a given path (use `scope`) | Blocking |
| `PostToolUse` (matcher `Edit\|Write`) | Run formatter or fast lint/typecheck on the changed file | Feedback |
| `Stop` / `SubagentStop` | Refuse to finish while the gate is red, or while the work summary lacks ADR citations | Blocking (returns "continue" with a reason) |
| `PreCompact` | Re-inject critical decisions so they survive context compaction | Context only |

Rule: **keep hooks cheap and idempotent**; anything slower than a second belongs in the gate, not a hook.

### F4. Path-aware recall (upgrade)

Classification by prompt keywords misses decisions that apply to *the file being edited*. Add a `PreToolUse` or `PostToolUse` hook on `Edit|Write` that takes the file path, matches it against each record's `scope` globs, and injects those records. This closes the gap where the prompt says "fix the bug" without any taxonomy keyword.

### F5. Authorizing external mutations

The original handles this in prose ("deploy, remote migrations, secrets, routing changes require explicit user authorization"). A hardened version makes it a `PreToolUse` guard that denies matching commands unless an environment flag or a recorded approval file exists. Put the list of dangerous command patterns in config and justify it with an ADR.

---

## G. Skills and agent roles

### G1. Concepts

- **Skill** = a folder with `SKILL.md` (front matter `name`, `description`, optionally scripts). The `description` is what the agent matches against to decide when to load it; write it as **"Use when …"** with the concrete trigger. The body holds the procedure.
- **Subagent / role** = a separate agent definition with its own tool allow-list and model, used for isolated work (review, design check). Read-only roles get only `Read, Glob, Grep, Bash`.
- **Operator skill** = wraps one platform CLI in a script (e.g. `cloudflare-dev.sh`, `vercel-dev.sh`, `github-repo-manager.sh`) so the agent has *one* sanctioned entry point per platform, with guardrails.

### G2. The skill set in the original

| Skill / role | Type | Trigger | Key rules |
|---|---|---|---|
| `adr-rag-manager` | Memory | Beginning any task; recording a decision | Run retrieval first; apply and cite IDs; record via script with taxonomy pair; embeddings local |
| `change-review` | Read-only review | Before merge/deploy | Business behavior, security, performance, maintainability, migration/deploy safety; findings with severity, location, impact, fix; **advisory only** |
| `platform-architect` | Read-only design review | Before implementation of a design | Repo boundaries, ADR compliance, security moderation, deployment separation; smallest compliant path |
| `infrastructure-engineer` | Implementer | Isolated infra change | Preserves boundaries; narrow scope |
| `cloudflare-dev` | Operator | Worker/D1/Wrangler work | Local first; remote migration/secret/deploy needs explicit authorization; use wrapper script |
| `vercel-dev` | Operator | Domains, routing, env | Authorized operations only |
| `github-repo-manager` | Operator | Repos, Actions, branch protection | Authorized changes only |

Routing is declared in `AGENTS.md` ("Use `$cloudflare-dev` for …"), so the instruction file is the **router** and the skills are the **procedures**.

### G3. Anatomy of a good skill

```markdown
---
name: change-review
description: Review a proposed change for business behavior, security, performance, maintainability, and deployment safety before merge or production deployment.
---

Review the full diff and the affected callers, tests, data access, and configuration. Do not modify files.

- Check <area 1> …
- Check <area 2> …
- Report only actionable findings with severity, file/line, impact, and a concrete fix.
- A review is advisory; merge protection must still require the automated gate and a human.
```

Guidelines: imperative bullets; state what the skill must **not** do; state the output format; keep to ~15 lines (long skills are not followed); put deterministic steps into a script and reference it ("Run `scripts/x.sh`").

### G4. Role definition (Claude subagent)

```markdown
---
name: change-reviewer
description: Reviews changes for behavior, security, performance, maintainability, and deployment safety before merge or production deploy.
tools: Read, Glob, Grep, Bash
model: sonnet
---
Perform a read-only review of the complete diff … Follow `.agents/skills/change-review/SKILL.md`.
- Do not edit files or run deployment, migration, or other remote mutation commands.
- Prioritize concrete regressions over style preferences.
- State explicitly when business or performance claims cannot be verified.
```

The role is a **thin wrapper that points to the neutral skill**, so Claude and Codex share one procedure.

### G5. Model-cost policy

Mechanical or deterministic work: do not delegate, run the CLI. Delegation: narrow outcome, cheapest capable model. Design, security and review: a stronger model. The work ledger (section J) records a suggested model and reasoning effort for each open item.

### G6. Recommended extra roles for a new project

`security-reviewer` (read-only, OWASP-style), `test-writer`, `migration-reviewer` (schema compatibility), `docs-keeper` (spec updated when behavior changes). Add them only when a recurring need appears.

---

## H. Quality gates

### H1. Defense in depth

| Layer | Where | Blocks? | Purpose |
|---|---|---|---|
| 1. Recall hook | Harness | No | Prevent contradicting decisions |
| 2. Guard hooks (`PreToolUse`/`Stop`), *recommended* | Harness | Yes (agent only) | Stop dangerous actions and premature "done" |
| 3. Agent review (`change-review`) | Agent | No (advisory) | Catch logic, security, design issues |
| 4. Local gate script | Dev machine | Yes (deploy scripts) | Same checks as CI, fast feedback |
| 5. CI workflow | CI server | Yes (required check) | Authoritative, cannot be skipped by the agent |
| 6. PR template | Review UI | Social | Forces evidence for behavior, security, performance, migration |
| 7. Branch protection plus human review | Git host | Yes | Final authority |

### H2. One gate script, used locally and in CI

`scripts/check-before-deploy.mjs <target>` runs a fixed list of commands and stops at the first failure. Original checks: typecheck, tests, apply migrations to a **local** database, dry-run the production bundle. CI runs the `all` target, and the deploy scripts run a *focused* target and then deploy:

```json
"check:ci":      "node scripts/check-before-deploy.mjs all",
"deploy":        "node scripts/check-before-deploy.mjs platform && wrangler deploy --config wrangler.jsonc",
"deploy:admin":  "node scripts/check-before-deploy.mjs admin && wrangler deploy --config admin/wrangler.jsonc"
```

Principle: **the deploy command cannot run without its gate**, because the gate is part of the same npm script. The agent is told to use `npm run deploy`, never the raw tool.

### H3. CI workflow

```yaml
name: Quality gate
on: { pull_request: {}, push: { branches: [main] }, merge_group: {} }
permissions: { contents: read }              # least privilege
concurrency: { group: "quality-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}", cancel-in-progress: true }
jobs:
  checks:
    name: type, tests, migrations, bundles    # this exact name is what branch protection requires
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run check:ci
```

Notes: `merge_group` supports merge queues; the job name is a contract with branch protection; the workflow file **cannot** enable branch protection itself, which must be configured in the host settings (document it, and verify with the `github-repo-manager` operator).

### H4. Tests of the governance code

The original has `adr-embedding.test.mjs` and `adr-retrieval.test.mjs`. They:

- Check that a known task retrieves a known ADR (`ADR-0001`) and that unrelated work ("lemon cake") returns "No matching decision".
- Create a **temp journal** (`mkdtemp`, copy `taxonomy.json`, empty index), run the real CLI with `execFileSync`, and assert IDs (`NOTICE-0001`) and query results.
- Test that embeddings need no credentials and are deterministic.

Add: rejects unknown taxonomy pairs, atomic write leaves no `.tmp`, rebuild fills missing vectors, a `superseded` record is not retrieved, an `importance: critical` record is always included, and the hook fails open on a corrupt index.

### H5. Model-behaviour evals (optional)

For AI features inside the product (moderation, classification), keep an eval suite that is opt-in (`MODEL_EVAL=1 vitest run evals`) so normal CI stays deterministic and free, with fakes (`fake-ai.ts`, `fake-d1.ts`, `fake-github.ts`) for the default tests.

### H6. PR template

Sections: change summary; review checklist (business behavior, security, performance, focus and simplicity, backward-compatible database changes, automated checks pass); checks and evidence (commands and results); migration, deployment and recovery ("None" if not applicable). Purpose: make the author state evidence instead of assertions.

### H7. Migration and deployment policy (put it in `docs/spec/`)

Forward-only migrations; additive first (nullable column, new table or index), deploy code compatible with old and new shape, backfill separately, remove obsolete schema in a later release; **never assume rollback**; apply locally first; remote migration, secrets and deployment are external mutations needing explicit authorization; verify health after deploy; document recovery.

---

## I. Instruction files and multi-agent support

### I1. Single source of truth

`AGENTS.md` is the shared instruction file (an open convention read by Codex, Copilot's coding agent, Cursor and others). `CLAUDE.md` contains only `@AGENTS.md` (import syntax), so Claude loads the same file. Edit only `AGENTS.md`.

Keep `AGENTS.md` **short (~50–80 lines)** and structured in these sections (as in the original): *Scope* · *Required Workflows* (the skill router, the review and gate rules, the ADR-first rule) · *Engineering* (conventions, no raw SQL, response contract, secrets in bindings) · *Security and Operations* (validate at boundaries, no destructive actions without authorization) · *Verification and Documentation* · *Repository Workflow*. Detail belongs in `docs/spec/`, and the instruction file points to it.

The key sentence that makes the ADR system work for every agent: **"Before starting any task, use `$adr-rag-manager` to retrieve matching ADR context. Apply matching decisions and cite their IDs in the work summary. State when no matching ADR exists."**

### I2. Capability matrix (verify against current vendor docs; these products change quickly)

The original implements Claude Code (hook) and Codex (manual script). Copilot and Gemini columns are my understanding and were **not** exercised in the original, so verify before relying on them.

| Capability | Claude Code | Codex (CLI/IDE) | GitHub Copilot | Gemini CLI / Code Assist |
|---|---|---|---|---|
| Shared `AGENTS.md` | Via `CLAUDE.md` import | Native | Native (agent and CLI) | Via `GEMINI.md` import or context-file setting |
| Vendor instruction file | `CLAUDE.md` | `AGENTS.md` | `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md` | `GEMINI.md` |
| Skills (`SKILL.md`) | `.claude/skills/` | `.agents/skills/` | Agent skills (recent; check location) | Extensions/skills (version dependent) |
| Subagents / roles | `.claude/agents/*.md` | Limited / config based | Custom agents (`.agent.md`) | Limited |
| Hooks (deterministic) | **Yes**: `.claude/settings.json` | Emerging / config based, check release notes | Available for coding agent/CLI, IDE support varies | Hooks in recent CLI versions, check |
| Prompt-injection hook (`UserPromptSubmit` equivalent) | **Yes** | Probably not; use the manual step | Check | Check |
| CI gate | Agent-independent | Agent-independent | Agent-independent | Agent-independent |

**Because hook support is uneven, the design has a three-tier fallback. The same retrieval function serves all tiers:**

1. **Tier 1 (hook available):** harness runs the script automatically (Claude Code `UserPromptSubmit`). Deterministic.
2. **Tier 2 (no hook, skills or shell available):** the instruction file mandates *"run `node …/pre-task-context.mjs "<task summary>"` before any task"*. The original does this for Codex through `.agents/skills/adr-rag-manager/scripts/pre-task-context.mjs`. Advisory, but works well when the rule is the first one in `AGENTS.md`.
3. **Tier 3 (nothing but instructions):** write the critical decisions' one-line summaries directly into `AGENTS.md` (generated), plus the CI gate as the safety net.

The CI gate and the PR template are the **only** layers that work identically for every agent, so never let them be the weak part.

### I3. Per-vendor adapters (thin pointers)

- **Claude:** `CLAUDE.md` (`@AGENTS.md`), `.claude/settings.json` hook, `.claude/skills/`, `.claude/agents/`.
- **Codex:** `AGENTS.md`, `.agents/skills/<name>/SKILL.md` (same content as Claude's, with neutral paths).
- **Copilot:** `.github/copilot-instructions.md` with about 10 lines: "Follow `AGENTS.md`. Before any task run `node tools/governance/pre-task-context.mjs "<task>"`. Never deploy or mutate remote resources without authorization. Run `npm run check:ci` before proposing a merge." Optional custom agents for reviewer roles, and hooks where supported.
- **Gemini:** `GEMINI.md` containing `@AGENTS.md`, plus hooks in `.gemini/settings.json` if the installed version supports them.

### I4. Keeping duplicates in sync

The original duplicates skill text between `.claude/skills/` and `.agents/skills/`, with slightly different paths, so they drift. Avoid it: generate one from the other (a small script, run in the gate: `node tools/governance/sync-adapters.mjs --check` fails when out of date), or make the vendor copy a one-line pointer to the neutral skill. Add that check to the quality gate.

---

## J. Documentation structure and work ledger

| Location | Content | Lifetime |
|---|---|---|
| `AGENTS.md` | Always-on rules and routing | Permanent, short |
| `.decisions/` | Why (ADRs and notices) | Permanent, append only |
| `docs/spec/` | How the system *currently* works (summary, deployment and migrations, domain specs) | Permanent, updated with behavior |
| `docs/plan/` | Temporary plans for open items | **Deleted when done** |
| `UNFINISHED.md` | Ledger of active items with completed steps and a **cold-start resume point** | Items removed when implemented and validated |
| PR template | Per-change evidence | Per PR |

Linking rules from the original: code comments and `.decisions/` link **only to `docs/spec/`** (never to `docs/plan/`, which disappears). `UNFINISHED.md` rules: every active item gets completed steps, a cold-start resume point (so a fresh agent session can continue), and a **suggested model plus reasoning effort**; remove an item after implementation and validation, then continue with the next unless told to stop.

This is how long-running work survives agent restarts.

---

## K. Reference implementation (portable code)

Language: Node 18+ ESM, no dependencies. In another stack, port the three small modules (about 200 lines in total); the **file formats** are the interface. A Python port is straightforward: FNV hashing, `json`, `argparse`; keep the same JSON layout so tools remain interchangeable.

### K1. `embedding-client.mjs`

```js
/** Purpose: create small, deterministic local embeddings for decision retrieval. */
const dimensions = 384;
const tokenPattern = /[a-z0-9]+/g;

function hashFeature(feature) {
  let hash = 2166136261;                      // FNV-1a offset basis
  for (let i = 0; i < feature.length; i += 1) {
    hash ^= feature.charCodeAt(i);
    hash = Math.imul(hash, 16777619);         // FNV prime
  }
  return hash >>> 0;
}

export function createEmbedding(text) {
  const tokens = (text.toLowerCase().match(tokenPattern) ?? []).filter((t) => t.length > 1);
  if (tokens.length === 0) return [];
  const vector = Array(dimensions).fill(0);
  const features = [];
  for (const token of tokens) {
    features.push([`w:${token}`, 2]);
    const padded = `^${token}$`;
    for (let i = 0; i <= padded.length - 3; i += 1) features.push([`c:${padded.slice(i, i + 3)}`, 0.25]);
  }
  for (let i = 0; i < tokens.length - 1; i += 1) features.push([`b:${tokens[i]}_${tokens[i + 1]}`, 1]);
  for (const [feature, weight] of features) {
    const hash = hashFeature(feature);
    vector[hash % dimensions] += (hash & 0x80000000 ? -1 : 1) * weight;
  }
  const magnitude = Math.sqrt(vector.reduce((s, v) => s + v ** 2, 0));
  return vector.map((v) => v / magnitude);
}

export function cosineSimilarity(a, b) {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, am = 0, bm = 0;
  for (let i = 0; i < a.length; i += 1) { dot += a[i] * b[i]; am += a[i] ** 2; bm += b[i] ** 2; }
  return dot / (Math.sqrt(am) * Math.sqrt(bm));
}
```

### K2. Retrieval hook (`pre-task-context.mjs`), structure

```js
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createEmbedding, cosineSimilarity } from "./lib/embedding-client.mjs";

const semanticThreshold = 0.12;
const readJson = async (p) => JSON.parse(await readFile(p, "utf8"));

async function readEvent() { let v = ""; for await (const c of process.stdin) v += c; return JSON.parse(v); }

// Stage 1: classify by keyword hits against taxonomy subcategories
function classifyTask(prompt, taxonomy) {
  const words = new Set(prompt.toLowerCase().match(/[a-z0-9-]+/g) ?? []);
  return taxonomy.categories
    .flatMap((c) => c.subcategories.map((s) => ({ category: c, subcategory: s })))
    .map((p) => ({ ...p, score: p.subcategory.keywords.filter((k) => words.has(k)).length }))
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score);
}

// Stage 2+3: filter (decisions: best pair; notices: all pairs) then rank by cosine
async function selectContext(prompt, index, dir, embedding, pairs) {
  const best = pairs[0];
  const candidates = index.entries
    .filter((e) => (e.type === "notice" ? pairs : [best]).some(
      (p) => e.category === p.category.name && e.subcategory === p.subcategory.name))
    .map((e) => ({ e, similarity: Array.isArray(e.embedding) ? cosineSimilarity(embedding, e.embedding) : 0 }))
    .filter(({ similarity }) => similarity >= semanticThreshold)
    .sort((a, b) => b.similarity - a.similarity);
  const records = await Promise.all(candidates.map(({ e }) => readFile(join(dir, e.file), "utf8")));
  return { ids: candidates.map(({ e }) => e.id), records };
}

export async function retrieveAdrContext(prompt, cwd) {
  const dir = join(cwd, ".decisions");
  const [index, taxonomy] = await Promise.all([readJson(join(dir, "decisions.index.json")), readJson(join(dir, "taxonomy.json"))]);
  const pairs = classifyTask(prompt, taxonomy);
  const result = pairs.length ? await selectContext(prompt, index, dir, createEmbedding(prompt), pairs) : { ids: [], records: [] };
  return result.ids.length
    ? `Decision and notice retrieval completed before work. Apply matching decisions, consider matching notices, and cite ${result.ids.join(", ")} in the work summary.\n\n${result.records.join("\n\n")}`
    : "Decision and notice retrieval completed before work. No matching decision or notice was found; state this in the work summary.";
}

async function main() {
  const event = await readEvent();
  const additionalContext = await retrieveAdrContext(event.prompt, event.cwd);
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext } }));
}
if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(() => (process.exitCode = 0)); // fail open
```

The original additionally includes the lexical fallback for vector-less legacy entries. Add `importance` weighting and `status` filtering in `selectContext` (section D2).

### K3. Neutral CLI wrapper for tiers 2 and 3

```js
// .agents/skills/adr-rag-manager/scripts/pre-task-context.mjs
import { retrieveAdrContext } from "<path>/pre-task-context.mjs";
const prompt = process.argv.slice(2).join(" ").trim();
if (!prompt) { process.stderr.write("task_summary_required\n"); process.exit(1); }
process.stdout.write(`${await retrieveAdrContext(prompt, process.cwd())}\n`);
```

### K4. Journal CLI (`adr-rag-manager.mjs`), commands

| Command | Arguments | Result |
|---|---|---|
| `record` (decision) | `--category --subcategory --summary --context --decision --consequences` | Writes `ADR-NNNN.md`, appends index entry with vector, prints the ID |
| `record` (notice) | `--type notice --kind security\|business-logic --category --subcategory --summary --context --consideration` | Writes `NOTICE-NNNN.md`, index entry, prints the ID |
| `query` | `--category --subcategory --text [--type decision\|notice\|all]` | JSON list of `{id, file, similarity}` above 0.12, sorted |
| `rebuild` | none | Fills missing vectors for imported records |

Validation rules to keep: reject unknown taxonomy pair; reject empty summary or context; require `decision` and `consequences` for ADRs and `kind` and `consideration` for notices; reject an unknown `--type`; errors go to stderr and exit code 1; atomic temp-file-plus-rename writes; usage in a skill with `$ARGUMENTS` passthrough.

Note the original CLI's argument parser is minimal (`--key value`). Values starting with `--` or missing values are mishandled. Harden it (`node:util parseArgs`) in the new project.

### K5. Index file skeleton

```json
{ "version": 1, "model": "local-hash-ngram-v1", "entries": [] }
```

### K6. Seed ADR example

```markdown
# ADR-0001: Use Workers AI for fast edge classification

- **Date:** 2026-10-10
- **Category:** Infrastructure / Security
- **Status:** Accepted

## Context
The platform needs fast content moderation for submitted patches at the edge.

## Decision
Use a lightweight classification model before the commit pipeline.

## Consequences
- Moderation remains at the edge.
- The classifier only evaluates patch safety and does not rewrite code.
```

---

## L. Bootstrap procedure

Executed by an agent at the start of a new project (or retrofitted). Each step is verifiable.

| Step | Action | Verify |
|---|---|---|
| 0 | Check git status; create a branch | clean tree |
| 1 | **Run the Part B interview**; confirm the Decision Summary | user approval |
| 2 | Create `.decisions/` with `taxonomy.json` (from answers) and an empty index | JSON parses |
| 3 | Copy the K1, K2, K4 modules into `tools/governance/` (or `.claude/…`), adapt language if the stack requires | `node` runs a sample query |
| 4 | Record one ADR per major interview decision (stack, hosting, data, auth, repo layout, delivery policy, governance strictness) | `.decisions/ADR-000N.md` exist, IDs printed |
| 5 | Write `AGENTS.md` (section I1) with the project's skill routing; `CLAUDE.md` and `GEMINI.md` as `@AGENTS.md` | file review |
| 6 | Create adapters for the agents chosen in B5 (section I3) | each agent loads rules (ask it to "list the rules") |
| 7 | Register the hook(s) in `.claude/settings.json` (F2; add F3 guards if strict) | run hook manually: `echo '{"prompt":"…","cwd":"."}' \| node …/pre-task-context.mjs` |
| 8 | Create skills: `adr-rag-manager`, `change-review`, `platform-architect`, plus operator skills for the chosen platforms; roles under `.claude/agents/` | agent lists the skills |
| 9 | Write the gate script with the stack's checks (M) and wire deploy commands to it | `check:ci` (or equivalent) is green |
| 10 | Add the CI workflow, PR template, `docs/spec/deployment-and-migrations.md`, `UNFINISHED.md` | workflow runs on a draft PR |
| 11 | Write governance tests (H4) | tests green |
| 12 | Configure branch protection with the required check name plus human review (document manual host steps) | attempt a direct push to main: rejected |
| 13 | Dry run: give the agent a task that touches a recorded decision; confirm that the ADR ID is injected and cited | citation present |
| 14 | Commit as "chore: governance scaffold" | CI green |

---

## M. Adaptation matrix per stack

The governance layer is identical. Only the following change.

| Aspect | TS + Vercel/Cloudflare (original) | Python (Flask/FastAPI/Django) | PHP (Laravel/Symfony) | Self-hosted / AWS |
|---|---|---|---|---|
| Governance tooling runtime | Node (already present) | Node **or** port to Python (`tools/governance/*.py`); keep the same JSON formats | Node (add as dev tool) or PHP port | Same as the app, or Node in CI only |
| Gate checks | typecheck, `vitest`, local migration, dry-run bundle | `ruff`/`flake8`, `mypy`/`pyright`, `pytest`, `alembic upgrade head` on a temp DB, `pip-audit` | `phpstan`/`psalm`, `phpunit`/`pest`, `php artisan migrate --pretend`, `composer audit` | + IaC validate (`terraform validate/plan`, `cdk synth`), container build, `docker compose config` |
| Deploy wrapper | `npm run deploy` runs gate then `wrangler deploy` | `make deploy` runs the gate, then `gunicorn`/container push | `composer deploy` runs the gate, then deployer/Envoyer | Gate, then `terraform apply` (never auto-approve for the agent) or an Ansible run |
| Operator skills | cloudflare-dev, vercel-dev, github-repo-manager | `db-ops` (migrations), `docker-ops`, `github-repo-manager` | `artisan-ops`, `github-repo-manager` | `aws-ops` (read-only by default), `terraform-ops`, `ssh-ops` (allow-listed hosts) |
| Taxonomy seeds | Infrastructure (Worker API/Data/Security), Delivery (GitHub/Cloudflare/Vercel), Architecture, Security | Backend (API/ORM/Tasks), Data, Delivery (Docker/CI/Host), Security | Backend (Routing/Eloquent/Queues), Data, Delivery, Security | Infrastructure (Network/IAM/Compute), Data, Operations (Backup/Monitoring), Security |
| Dangerous-command guard list | `wrangler deploy`, `wrangler secret`, `d1 migrations apply --remote` | `alembic upgrade` against prod, `docker push`, `flask db …` against prod | `artisan migrate` on prod, `rm -rf storage` | `terraform apply/destroy`, `aws … delete`, `ssh prod`, `kubectl delete` |
| Secrets | Env bindings | `.env` + vault; never committed | `.env`, vault | Secrets manager / SSM |
| Extra gate | Worker bundle size | SAST (`bandit`) | `composer audit`, `phpcs` | IaC scan (`tfsec`/`checkov`), container scan (`trivy`) |

**Rule of thumb:** whatever the stack, the gate must include (1) static analysis, (2) tests, (3) schema migration on a throwaway database, (4) a production-like build or dry run, (5) dependency/vulnerability audit. Name the CI job so branch protection can require it.

---

## N. Known weaknesses and upgrades

Honest limitations of the original, with the recommended fix. Record each chosen fix as an ADR.

| # | Weakness | Impact | Upgrade |
|---|---|---|---|
| 1 | Embeddings are lexical, not semantic | Paraphrases miss | Optional hosted or local model embeddings (`embeddingModel` field); keep hashing as offline fallback; hybrid score (BM25 plus vector) |
| 2 | Classification only by exact keyword hits | No keyword → no retrieval (silent miss) | Add synonyms; always include `critical` records; log "no category matched" for tuning; fall back to global top-k by cosine |
| 3 | Decisions use only the top category | Cross-cutting tasks miss decisions | Use the top 2 pairs when scores are close |
| 4 | No `importance`, `status`, `supersedes` | Can't retire or prioritize | Add per section D2 |
| 5 | Threshold 0.12 untuned | Noise or misses | Build a small retrieval eval set (task → expected IDs), measure precision/recall in CI |
| 6 | Hook only on prompt text | Misses file-scoped decisions | Path-aware hook (F4) |
| 7 | Recall is advisory for non-Claude agents | Skipped steps | Tier 2 plus CI check that PR descriptions cite ADR IDs or "no matching ADR" |
| 8 | Duplicated skill files drift | Divergent rules | Sync script and gate check (I4) |
| 9 | Logic lives under `.claude/` | Vendor coupling | Neutral `tools/governance/` |
| 10 | Record-time vs. rebuild-time embedding text differ | Inconsistent vectors | Single `embeddingText(entry)` function |
| 11 | ID collision across branches | Duplicate ADR numbers | Date-based or random suffix IDs, or CI uniqueness check |
| 12 | Minimal arg parser | Broken edge cases | `parseArgs` |
| 13 | No ADR lifecycle review | Stale decisions | `reviewBy` date and a periodic report in CI |
| 14 | Review skill is advisory and the model may skip it | Unreviewed merges | `Stop` hook plus PR check requiring a "reviewed by" line; human review required by branch protection |
| 15 | Index committed with large vectors | Noisy diffs | Acceptable below ~500 records; beyond that, use SQLite or a vector DB and keep Markdown as truth |

When a vector DB becomes justified: more than a few hundred records, multi-repo shared memory, or semantic recall across languages. Until then, a JSON index is the right amount of machinery.

---

## O. Checklists and prompt templates

### O1. Bootstrap prompt (paste into any agent)

```text
You are setting up the agent governance system described in agent-governance-blueprint.md.
1. Read the whole blueprint.
2. Run the Part B interview with me, in batches of 3-6 questions, offering a recommended
   default for each. Do not generate files yet.
3. Produce the Decision Summary (B6) and wait for my confirmation.
4. Follow Part L step by step. After each step, show the verification result.
5. Record the interview decisions as ADRs using the journal CLI. Select taxonomy pairs from
   the taxonomy you generated.
6. Adapt Part M for my stack. Ask before any external, destructive or deployment action.
7. At the end, list what is enforced (hooks, gate, CI, branch protection) versus advisory.
```

### O2. Task-start protocol (every task)

1. Run retrieval (hook automatic, or the script manually).
2. Apply every returned ADR; weigh every notice.
3. Do the work with the smallest sufficient change.
4. Run the smallest relevant check, then the full gate before merge.
5. Run `change-review` on the full diff; fix actionable findings.
6. Summarize and **cite the ADR/notice IDs, or state that none matched**.
7. If a new lasting decision was made, record it (ADR). If a hazard was found, record a notice.

### O3. "Should this be an ADR?" test

Would a future agent, with no memory of this conversation, make a worse choice without it? Is it hard or expensive to reverse? Does it constrain more than one file? If yes to any, record it.

### O4. Definition of done for the scaffold

- [ ] Interview answers confirmed and recorded as ADRs
- [ ] Taxonomy matches the architecture; keywords reflect real task wording
- [ ] Retrieval returns the right ADR for three sample tasks and "no match" for an unrelated one
- [ ] Hook runs, fails open on a corrupt index, and stays under 1 second
- [ ] Guard hooks (if strict) block a simulated deploy and a force-push
- [ ] One gate script, used by CI and by the deploy scripts
- [ ] CI job name equals the required check in branch protection; a direct push to main is rejected
- [ ] PR template in place; deployment and migration spec written
- [ ] Adapters for every chosen agent verified by asking each to list the rules and run retrieval
- [ ] Governance tests green; adapter-sync check in the gate
- [ ] `UNFINISHED.md` exists with the resume-point rule

### O5. Glossary

- **ADR**: Architecture Decision Record, an accepted decision with context and consequences.
- **Notice**: a recorded consideration (security or business logic) that is not a decision.
- **Taxonomy**: controlled two-level category vocabulary, with keywords for classification.
- **Feature hashing**: embedding by hashing tokens and n-grams into a fixed-size vector, with no trained model.
- **Cosine similarity**: angle-based similarity between two vectors, in [−1, 1].
- **Hook**: harness-executed command at a lifecycle event.
- **Skill**: packaged procedure the agent loads on demand.
- **Gate**: automated check that blocks merge or deploy.
- **Fail open / fail closed**: on error, allow (recall hook) or block (quality gate).
