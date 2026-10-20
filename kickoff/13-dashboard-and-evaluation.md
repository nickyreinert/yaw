# 13 — Dashboard, Metrics, Session Evaluation

The local HTTP server that serves the setup form (doc 02) also serves a **dashboard**: `yaw ui`. Same rules: `127.0.0.1` only, one-time token, no external assets, all data local.

## 0. Scope: what we actually measure

The main goal is **model quality as the user perceives it**, per model and per agent. Technical metrics are deliberately basic.

| Priority | Metric | Source |
|---|---|---|
| Primary | User satisfied vs. complaining, per turn and per session | tier 1 signals + tier 2 decision model (section 3) |
| Primary | **Error admissions / apologies** by the model ("You're right, I made a mistake", "Sorry, my bad") | assistant message, section 3 |
| Basic | Tokens used (input/output/cache) | OTel, transcripts, hook payloads |
| Basic | Time used (session duration, active time) | hooks, OTel |
| Basic | Incoming prompt length (characters, approx. tokens) | `UserPromptSubmit` (length only, no content stored) |

Everything is grouped by **model id** and agent, so the dashboard answers "which model makes me complain least / apologises least?".

## 1. Views

| View | Shows | Source |
|---|---|---|
| Projects | Every project set up with YAW: path, profiles, modules, kit version, last activity, open tasks, last gate result | `~/.yaw/history.jsonl`, each project's `.yaw/manifest.json` |
| Project | Tasks (ledger), decisions/notices, sessions, gate history, design screenshots | project files, session registry (doc 12) |
| Sessions | Title, agent, duration, task, ADRs cited, commits, **outcome** (section 3), tokens/cost, cache hit ratio, resume command | registry + metrics + evaluation |
| Metrics | Tokens by type (input/output/cache read/cache write), cost estimate, cache hit ratio, active time, tool failure rate, hook durations, gate durations, sessions per day | OTel receiver, transcripts, `just` timings |
| Journal | Chronological feed: task journal lines, ADRs, sessions, releases | all of the above |

## 2. Metrics and profiling sources

| Source | Agent | Data | Cost |
|---|---|---|---|
| **OpenTelemetry** (verified): `CLAUDE_CODE_ENABLE_TELEMETRY=1`, `OTEL_METRICS_EXPORTER=otlp`, `OTEL_LOGS_EXPORTER=otlp`, `OTEL_EXPORTER_OTLP_PROTOCOL=http/json`, endpoint `http://127.0.0.1:<yaw-port>` | Claude Code | `claude_code.token.usage`, `cost.usage`, `active_time.total`, `lines_of_code`, `commit/pull_request.count`; events `user_prompt`, `api_request` (tokens, cache, duration), `tool_result`, `tool_decision`, `hook_execution_complete`, `compaction`, `subagent_completed`; all with `session.id` and `prompt.id` | zero tokens |
| Transcript parsing (fallback) | Claude, Codex | usage blocks per turn | zero tokens |
| Hook events → YAW receiver (`http` hook type or command hook POST) | Copilot, Codex, Gemini/Antigravity | session start/end, tool use, errors, durations | zero tokens |
| Outbound webhooks (signed, verified) | Hermes | `on_session_end`, `post_tool_call`, `subagent_stop`, `post_api_request` usage | zero tokens |
| Extension events | Pi | `after_provider_response`, tool events, session events | zero tokens |
| Hook timings | all | from YAW's own hook wrappers | zero |
| `just` timings | all | duration and result of `check`, `test`, `build`, `deploy` | zero |

The YAW server includes a minimal OTLP/HTTP-JSON receiver (no collector needed). Prompt and response *content* stays off by default (`OTEL_LOG_USER_PROMPTS` unset); YAW only needs counts and IDs. Claude Code ignores OTel variables in project settings, so YAW writes them to user settings (`~/.claude/settings.json` `env`) after asking.

Storage: `~/.yaw/yaw.db` via built-in `node:sqlite` (Node ≥ 22.13, no flag; the experimental warning is suppressed), with retention (default 180 days) and `yaw data export|purge`. Phase 1 creates only the session registry tables; evaluation tables come in phase 2.

## 3. Session evaluation ("was the intent fulfilled?")

Hard requirement: **must not burn model tokens.** Three tiers, user chooses (interview 0.10); default is tier 1 only.

### Tier 1: implicit signals (always free, default on)

The outcome of a turn is judged by what happens *next*, which is a stronger signal than any self-assessment.

| Signal | Captured by | Indicates |
|---|---|---|
| Next prompt is a correction ("no", "wrong", "still broken", "again", "that's not what I asked") | `UserPromptSubmit` (local regex + lexicon, de/en) | not fulfilled |
| Next prompt is a near-duplicate of the previous one (cosine > 0.8) | same, local embedding | re-ask, not fulfilled |
| Frustration markers: caps ratio, `!!!`, profanity, insults | same | frustrated / aggressive |
| Interrupt (turn ended without `Stop`; Codex `Interrupt` event) | hooks | wrong direction |
| `/rewind`, `git revert`/`reset` of the session's commits | hooks, git | rejected work |
| Tool failures, permission denials, `StopFailure` | `PostToolUseFailure`, OTel `tool_decision` | friction |
| `just check` green, task marked done, PR merged | `just`, tasks, GitHub | fulfilled |
| Positive closure ("thanks", "perfect", "works") | `UserPromptSubmit` | fulfilled |
| **Model admits an error / apologises** ("you're right", "my mistake", "I apologize", "sorry, I overlooked", "du hast recht", "mein Fehler", "Entschuldigung") | `Stop` hook `last_assistant_message` (Claude, Codex); transcript or extension/webhook payload for others; local lexicon de/en | previous turn was wrong |

Apology tracking details:

- Counted per turn, aggregated as **apology rate** (admissions per 10 turns) per session, model and agent.
- Linked to the preceding user prompt: admission *after* a complaint (expected) vs. admission *without* a complaint (model self-corrects).
- Follow-up check: did the fix after the admission work (next prompt not a correction, `just check` green)? Repeated admissions on the same task = "apology loop", a strong negative signal.
- **Sycophancy flag:** admission immediately after a user push-back while the model's previous answer was actually correct (gate was green, no code changed afterwards). Detected heuristically; tier 2 can confirm.
- Only counts and matched phrase category are stored, not the message text.

A small rule engine combines them per turn and per session into categories:

- **Outcome:** `fulfilled` · `partially` · `not_fulfilled` · `abandoned` · `unknown`
- **Sentiment:** `positive` · `neutral` · `frustrated` · `aggressive`
- **Model behaviour:** `admits_error` · `apology_loop` · `sycophantic_admission` · `none`
- **Failure reason (if any):** `misunderstood_intent` · `wrong_scope` · `broke_something` · `ignored_rule_or_adr` · `hallucinated_api` · `too_slow` · `tooling_error`

### Tier 2: decision model (optional, zero tokens of the coding agent)

The job is a bounded choice ("which of these 5 outcomes / 4 sentiments / 7 failure reasons?"), not text generation. That is exactly what the new single-pass **decision models** ("System One" models) do: prompt + candidate labels in, one forward pass, **calibrated probability per label** out. No JSON parsing, no hallucinated prose, milliseconds per decision.

| Backend | Type | Fit for YAW | Notes (sources checked 2026-10-20) |
|---|---|---|---|
| **Laya** (Convai Innovations) | open weights, Apache 2.0, ModernBERT/mmBERT encoder, 421M (en) / 322M (multilingual) | **Default local recommendation**: tiny, fast, multilingual (German prompts), our label sets are ≤ 20 | Accuracy drops above ≈ 20 options; fine for our categories |
| **Kev** (Jared Palmer) | open weights, Apache 2.0, Qwen-based 0.8B / 4B / 9B / 27B | Kev-0.8B/4B on Apple Silicon (MLX); serves the Jev-compatible `POST /v1/systemone` API | Kev-4B close to Jev accuracy in third-party tests |
| **WaterSheep** (Samrat Dutta) | open weights, Apache 2.0, ModernBERT-base fine-tune, local server with `POST /v1/systemone`, adds **multi-label** questions | Small like Laya, but speaks the Jev protocol; multi-label fits "which failure reasons apply?" | Max input length 512 tokens (longer turn text is truncated) |
| **SemIf** (formerly OpenJev) | MIT, reads option probabilities from any open model's logits | Experimental: reuse an existing local Qwen/Ollama-class model without a trained head | |
| **Jev** (TypeSafe AI) | hosted API, `POST /v1/systemone`, up to 255 options | Only if the user accepts sending turn text to a third party | Privacy module must approve; off by default |
| Microsoft-Decision-1 | hosted (Foundry, OpenRouter Decisions API) | same as Jev | |
| Generic small LLM via Ollama / OpenAI-compatible endpoint | zero-shot with fixed label set | Fallback when no decision model is installed | Slower, needs output validation |

**User chooses, and can run several side by side.** Jev, Kev and WaterSheep share the same `POST /v1/systemone` protocol, so switching between them is only a base-URL change; Laya, SemIf and Ollama get their own small adapters. The form offers a multi-select (default: one local model). With two or three selected, YAW runs them in parallel on the same turns (`yaw eval compare`), shows agreement and calibration in the dashboard, and the user then keeps the best one or uses majority vote.

Design:

- One internal interface `classify(text, labels, multi=false) → {label: probability}`; adapters for the `systemone` protocol (Jev, Kev, WaterSheep), Laya (Python package or small local server), SemIf, Ollama/OpenAI-compatible, `custom-cmd` (stdin JSON → stdout JSON).
- Runs **detached** after `SessionEnd` (or every N turns) on (prompt, last assistant message, next prompt) triples; several independent questions per turn (outcome, sentiment, failure reason).
- Low confidence (top probability < threshold) → `unknown`; tier 1 signals take precedence when they are explicit (revert, correction).
- Local only by default; hosted backends require the privacy module's explicit approval and are listed in `docs/spec/privacy.md`.
- `yaw eval calibrate`: the user labels ~30 past turns in the dashboard; YAW reports agreement per backend and picks thresholds.

### Tier 3: agent self-report (optional, off by default, small token cost)

- One rule in `AGENTS.md`: end the final message of a task with a trailer `<!-- yaw: outcome=done|partial|blocked conf=0.0-1.0 -->`. Cost ≈ 15 output tokens per task, not per turn.
- The `Stop` hook reads it from `last_assistant_message`; nothing is injected back.
- Self-reports are biased toward "done", so they are shown next to tier 1/2, never alone.

Not used: Claude `type: "prompt"` hooks for evaluation. They call a model on every event (tokens, latency) and are meant for gate decisions, not analytics.

### Hook implementation rules (to keep it token-free)

- Evaluation hooks print **nothing** to stdout and exit 0; they append to a local queue file and detach (`nohup … &` with redirected output).
- Never return `additionalContext` or `systemMessage` from evaluation hooks; async hook output would reach the model on the next turn.
- Fail open: any error is logged to `~/.yaw/logs/`, the session is never affected.

## 4. Using the data

- Session list sorted by "not fulfilled" and "frustrated" → find patterns (ignored ADRs, wrong model tier, too large sessions).
- Feeds back into the kit: frequent `ignored_rule_or_adr` → improve retrieval keywords; frequent `misunderstood_intent` on long sessions → tighten hygiene thresholds; model tier vs. outcome → refine the model policy in task suggestions.
- Optional weekly summary (`yaw report weekly`) as a local Markdown file; no external sending unless the user enables a notification channel for it.
