# 11 — Comfort Features

Optional add-ons that make daily work smoother. Same rules as modules: opt-in, listed in the manifest, removable, each one a separate checkbox in the form (interview 0.8). Grouped as module `comfort`, plus the larger `remote` add-on.

| Feature | Value | Model tokens | Default | Phase |
|---|---|---|---|---|
| Session hygiene | Keeps context clean, cheaper and sharper answers | **none** (local script, user-only message) | on (Standard), personal, can be switched off (ADR-0013) | 1 |
| Status line | Always-visible task, context size, cache warm/cold | **none** | on if Claude | 1 |
| Notifications | Walk away safely, get pinged on "done" / "needs input" | **none** | off, asked | 1 |
| Cache-warmth reminder | Avoid paying for a cold prompt cache after a break | **none** | off, asked | 2 |
| Remote dev loop (own Telegram wrapper) | Steer the agent from the phone, get builds onto the phone | normal turns only | off, explicit | 3 |

**Token rule for all comfort features:** they run as local scripts and talk to the *user* (`systemMessage`, `terminalSequence`, status line, notification), never to the *model* (`additionalContext`, plain stdout on `UserPromptSubmit`/`SessionStart`). Anything model-visible costs tokens on every turn and is therefore forbidden for comfort features. Async hooks are not a loophole: Claude Code and Codex deliver an async hook's `additionalContext`/`systemMessage` to the model on the next turn, so background work prints nothing and detaches.

Verified against Claude Code and Codex hook docs on 2026-10-20 (events, `session_id`, `transcript_path`, `last_assistant_message`, `systemMessage`, `terminalSequence`). Per-agent support is declared with the compatibility attribute (doc 09).

## 1. Session hygiene

Problem: one endless session, growing context, mixed topics, degrading answers.

**Mechanism (`UserPromptSubmit` hook, Claude Code):**

1. Keep a small state file per session: `~/.yaw/state/sessions/<session_id>.json` with start time, prompt count, active task ID, and a rolling **topic vector** (local embedding of recent prompts, same code as the decision journal).
2. On each prompt compute:
   - **drift** = 1 − cosine(prompt, topic vector), smoothed over the last 2 prompts to avoid false alarms on one-off questions;
   - **size** = transcript file size / prompt count;
   - **age** = time since session start;
   - **task switch** = prompt mentions a different `T-NNN` or a different branch is checked out.
3. If a threshold is crossed, emit a short **user-visible message** (`systemMessage`), never block:
   > "This looks like a new topic (drift 0.71, 48 prompts, 2 h). Suggest: `/handoff` then `/clear`."
4. Thresholds in the personal `~/.yaw/comfort.yaml` (never committed; ADR-0030); cooldown so the hint appears at most once per 20 prompts. `yaw hygiene off` silences it for this project until `yaw hygiene on` (`--all`: every project); a CLI call cannot know the session id.

**Make clearing cheap:** `/handoff` (skill) writes the journal line and resume point into `TASKS.md` and records the session in the registry (doc 12). After `/clear` the `SessionStart` hook (matcher `clear`) re-injects the active task, so nothing is lost. This is what turns "start a new session" from painful into a habit. (The re-injection is the only model-visible part: a few lines, once per session, and only if the tasks module is on.)

Other agents: Codex has the same `UserPromptSubmit` + `systemMessage`; Gemini (`BeforeAgent`) and Copilot get the tier-2 rule in `AGENTS.md` ("suggest `/handoff` when the topic changes") plus `yaw hygiene` as a manual command.

## 1a. Status line (Claude Code)

A status line script (zero tokens) shows: active task `T-012`, context tokens, prompt-cache state (warm, minutes left / cold) from the status line `prompt_cache` data, hygiene warning badge, gate status of the last `just check` (recorded from the agent's own `just check` Bash calls, Claude only; ADR-0030). In a team repository the committed `.claude/settings.json` does not carry it; `yaw statusline --snippet` prints the setting for `.claude/settings.local.json`. It is the quietest form of all comfort hints and the first thing to enable.

## 2. Notifications

Triggers: `Stop` (turn finished), `Notification` with `permission_prompt` / `idle_prompt` (agent waits for you), `StopFailure` (rate limit, API error), long-running `just check`/deploy finished. Only notify when the run took longer than N minutes (default 3) to avoid spam.

| Channel | Setup effort | Notes |
|---|---|---|
| Desktop / terminal notification | none | Claude hook returns `terminalSequence` (OSC 9/777), works in iTerm2, Ghostty, WezTerm, Kitty |
| **Claude mobile push** | none if using Remote Control | Native: `/config` → push when actions required / when Claude decides |
| **ntfy** (ntfy.sh or self-hosted) | very low, no account | Recommended default for phone outside Remote Control; topic name acts as a password, use a long random one or self-host with auth |
| Telegram bot | low | Same `yaw-tg send` wrapper as the remote dev loop (§4.1); bot token via the secret flow (doc 08) |
| Pushover | low, one-time paid app | Reliable, priority levels |
| Email | medium | Via an email vendor from the catalogue |
| WhatsApp | high | Business API, Meta approval, costs; not recommended |

Payload: project, task ID, status (done / needs input / failed), duration, one-line summary. **No code, no diffs, no secrets** in notifications (privacy default). One `yaw notify` script, all channels behind it; configured in the personal `~/.yaw/comfort.yaml` (`notify:` block; ADR-0030). Phase 1 has the terminal and ntfy channels; the others and a per-project override come later.

## 3. Prompt-cache warmth reminder

Verified facts (Claude Code docs, 2026-10-20):

- Two TTLs: **5 min** and **1 h**. Default on a Claude subscription within plan usage: 1 h for the main conversation, 5 min for subagents and helpers. API key, cloud provider, or usage credits: 5 min. Override with `promptCacheTtl` / `CLAUDE_CODE_PROMPT_CACHE_TTL` (`5m`/`1h`).
- Claude Code already helps: idle compaction shortly before a 1 h cache expires (`idleCompaction`), `/usage` shows "Prompt cache (main)" warm/cold, the status line exposes `prompt_cache`, `SessionStart` on resume reports `prompt_cache_likely_expired` and `estimated_cache_write_usd`, and `PreModelSwitch` reports `prompt_cache_warm`.

Design (only adds what is missing, zero tokens):

- The `Stop` hook starts a detached timer (`yaw cache-timer <session_id> <ttl>`); the next `UserPromptSubmit` cancels it. TTL is read from settings, not guessed.
- At TTL minus ≈ 60 s (or ≈ 5 min for 1 h) it sends a notification: *"Cache cools in 1 min (context ≈ 120k tokens). Continue, or `/handoff` + `/clear`."*
- Below a context threshold (default 30k tokens) no reminder.
- On resume, the `SessionStart` hook turns `estimated_cache_write_usd` into a one-line user message ("Resuming re-caches ≈ 180k tokens, ≈ $1.14; consider `/handoff` + new session").

Deliberately **no automatic keep-alive ping**: each ping costs a cache read, may run while the user never returns, and needs prompts injected into an interactive session. Session hygiene is the better lever. Revisit if dashboard data (doc 13) shows otherwise.

## 4. Remote dev loop (add-on `remote`, phase 3)

Goal: from the phone, tell the agent "build it and put it on my phone" / "show me the web app", and get the result back in the chat. It is effectively **remote command execution on your machine**, so it ships separately with strict defaults.

### 4.1 Transport: own Telegram wrapper (`yaw-tg`), agent-agnostic

Primary transport is **YAW's own small Python wrapper around `python-telegram-bot`** (proven in practice, sends text, photos and files). It does not depend on any vendor feature, so the same bridge works for every selected agent.

```
Telegram ⇄ yaw-tg (local daemon, outbound long polling, no open port)
             ├─ inbound: allow-listed message → agent headless run in the task worktree
             │           (claude -p --resume <id> | codex exec | gemini -p | copilot -p | pi -p …)
             ├─ outbound: yaw-tg send "text" | --photo file | --file file   (used by hooks, skills, just recipes)
             └─ approvals: guarded actions ask via inline buttons, answer flows back to the run
```

| Piece | Form | Used by |
|---|---|---|
| `yaw-tg send` CLI | Python script in the kit, own venv via `uv`, token from keychain/`.env` | notifications (doc 11 §2), `just device-screenshot`, `just preview-share`, `Stop`/`Notification` hooks |
| `yaw-tg serve` daemon | same package, started with `yaw remote start` (tmux/launchd) | inbound commands: `/status`, `/tasks`, `/run <#> <instruction>`, `/approve`, `/deny`, `/stop`, `/handoff` |
| `telegram` skill | `SKILL.md`: "to report back or send a screenshot, run `yaw-tg send …`" | all agents (agent decides when to send) |
| Hook adapter | per agent (`Stop`, `Notification`, `agentStop`, …) calls `yaw-tg send` | automatic "done / needs input" messages |

Note on runtime: the core kit stays Node, zero-deps; `yaw-tg` is an **optional Python add-on** installed only with the `remote` module (`uv tool install` from the kit, pinned).

Optional alternatives (not required, never relied on): Claude Code Remote Control + Claude app, or Claude's official Telegram channel plugin. Both can be enabled in addition when the user is on Claude, but the YAW bridge remains the reference path.

### 4.2 Dev-loop recipes (agent-agnostic, behind `just`)

| Recipe | Does | Returned to chat |
|---|---|---|
| `just device-pair` | One-time Android wireless debugging pairing (`adb pair <ip:port> <code>`, Android 11+) | status |
| `just device-install` | `./gradlew installDebug`, `adb -s $DEVICE install -r`, launch main activity | "installed v1.4.2-debug on Pixel 8" |
| `just device-screenshot` | `adb exec-out screencap -p` → `.artifacts/` → `yaw-tg send --photo` | image |
| `just device-log` | `adb logcat` filtered to the app, last N lines | text snippet |
| `just preview` | Production build + local server (profile-specific) | – |
| `just preview-share` | Expose `preview` to the phone: LAN URL (same Wi-Fi, default) or Tailscale (private tailnet, recommended) or Cloudflare quick tunnel (public, time-limited, explicit opt-in) | URL + screenshot |

The agent's flow for "build and show me": `just check` → `just device-install` / `just preview-share` → `just device-screenshot` / Playwright screenshot → reply with summary + URL/image.

### 4.3 Security requirements (all mandatory)

- Sender allowlist (channel pairing / Telegram user IDs); everything else silently dropped.
- Remote sessions start with a restricted permission profile: no prod deploy, no secret reads, no push to `main`, no `--dangerously-skip-permissions`; guarded actions need confirmation via permission relay or Remote Control.
- Work in a separate git worktree (`--spawn worktree`); results come back as summary + PR link + preview URL, not raw file contents.
- ADB over Wi-Fi only on a trusted LAN; `just device-unpair` turns it off; never on public Wi-Fi.
- Preview sharing: LAN or Tailscale by default; public tunnels need explicit opt-in per run, expire, and never use prod data or secrets.
- Kill switch (`/stop` or `yaw remote stop`), audit log `~/.yaw/remote/audit.log`.
- Channel and bot tokens via the secret flow (plugin `userConfig` with `sensitive: true` stores them in the OS keychain).
