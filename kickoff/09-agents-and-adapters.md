# 09 — Agents and Adapters

## 1. Principle

- **Neutral source, thin adapters.** All customisation is authored once in the kit (`modules/*/skills|agents|hooks`) in a neutral format and rendered per agent.
- **`AGENTS.md` is the entry point** for every agent. Claude Code does not read it natively, so `CLAUDE.md` contains `@AGENTS.md`; Gemini gets `GEMINI.md` with `@AGENTS.md` (or `context.fileName` setting).
- **Claude Code first**: full depth (hooks, subagents, skills, permissions, output styles). Others get what their tooling supports; the gaps are covered by the three-tier fallback and by the agent-independent gates (git hooks, `just check`, CI, branch protection).

## 2. Verified capability matrix (checked against vendor docs on 2026-10-20)

| Capability | Claude Code | Codex (CLI/IDE) | Gemini CLI | Copilot (CLI / cloud agent) |
|---|---|---|---|---|
| Rules file | `CLAUDE.md` → `@AGENTS.md` | `AGENTS.md` native | `GEMINI.md` → `@AGENTS.md` | `AGENTS.md` + `.github/copilot-instructions.md` |
| Skills (`SKILL.md`, open standard) | `.claude/skills/` | `.agents/skills/` (cwd up to repo root), `~/.agents/skills` | `.gemini/skills/` and `.agents/skills/` (alias); workspace must be trusted | `.github/skills`, `.claude/skills`, `.agents/skills`, `~/.copilot/skills`, `~/.agents/skills` |
| Hooks | `.claude/settings.json`, plugin `hooks/hooks.json`, skill/agent frontmatter | `.codex/hooks.json` or `[hooks]` in `config.toml`; plugin hooks; **must be trusted** via `/hooks` | `.gemini/settings.json`; extensions | `.github/hooks/*.json`, `~/.copilot/hooks/*.json`, **also reads `.claude/settings.json` hooks** and accepts Claude PascalCase event names/matchers |
| Prompt-time context injection | `UserPromptSubmit` → `additionalContext` | `UserPromptSubmit` → `additionalContext` | `BeforeAgent` | **No** for `userPromptSubmitted` (command hook output dropped); `userPromptTransformed` can rewrite model-facing content; `sessionStart` accepts `additionalContext` |
| Session start / end | `SessionStart` / `SessionEnd` | `SessionStart` / `SessionEnd` | `SessionStart` / `SessionEnd` | `sessionStart` / `sessionEnd` |
| Block tool call | `PreToolUse` (`permissionDecision: deny`) | `PreToolUse` (same shape) | `BeforeTool` | `preToolUse` |
| End-of-turn check | `Stop` (`decision: block` continues) | `Stop` (same) | `AfterAgent` | `agentStop` |
| Notification event | `Notification` (`idle_prompt`, `permission_prompt`, …) + `terminalSequence` | – (use `Stop`) | `Notification` | `notification` (CLI only; `agent_idle`, `permission_prompt`, …) |
| Async hooks | `async: true` (output still delivered to model next turn) | `async: true` (same caveat) | sync only | sync (keep < 5 s); `notification` is fire-and-forget |
| Hook types | command, http, mcp_tool, prompt, agent | command, mcp_tool | command | command, http, prompt (`sessionStart` only) |
| Subagents / roles | `.claude/agents/*.md` | subagents (Start/Stop events) | subagents, remote subagents | custom agents `.agent.md` |
| Plugin / bundle format | Claude plugin + marketplace | Codex plugin (`.codex-plugin/plugin.json`; sets `CLAUDE_PLUGIN_ROOT` for compat) | Extensions (prompts, MCP, commands, hooks, subagents, skills) | skills via `gh skill`; hooks/agents per repo |
| Remote from phone | Remote Control (Claude app), Channels (Telegram/Discord/iMessage, research preview), mobile push | Codex cloud / ChatGPT app (verify) | – | cloud agent via GitHub (issues/PRs) |
| Telemetry | OpenTelemetry (metrics, events, traces beta) | OpenTelemetry via `[otel]` in **user** `~/.codex/config.toml` (`exporter = otlp-http`, `protocol = json`, `metrics_exporter`, `trace_exporter`, `log_user_prompt` opt-in); ignored in project config; `analytics.enabled = false` also disables custom OTLP metrics | OpenTelemetry telemetry (docs page exists; verify fields) | hooks → YAW receiver (`sessionStart/End`, `postToolUse`, `http` hook type) |

### Additional agents (checked 2026-10-20)

| Capability | Antigravity CLI (Google) | Pi (earendil-works) | Hermes Agent (Nous Research) |
|---|---|---|---|
| What it is | Successor of Gemini CLI for consumer plans (`agy`); keeps Skills, Hooks, Subagents; extensions become plugins (`agy plugin import gemini`) | Minimal, extensible coding harness, any model provider | Self-improving general agent, any provider, built-in messaging gateway (Telegram, WhatsApp, Signal, Slack, Discord, Email), cron, memory |
| Rules file | `AGENTS.md` and `GEMINI.md` (workspace), `~/.gemini/GEMINI.md` (global) | `AGENTS.md` | `AGENTS.md` / context files |
| Skills | `.agents/skills/` (workspace), `~/.gemini/antigravity-cli/skills/` (global) | `.agents/skills/`, `~/.agents/skills/` + own dirs | agentskills.io compatible, `~/.hermes/skills/`, self-created skills |
| Hooks | `hooks.json` inside an Antigravity **plugin** (`plugin.json`, `hooks.json`, `skills/`, `agents/`, `rules/`, `mcp_config.json`); `/hooks` lists them; event schema: verify | TypeScript **extensions**: `before_agent_start` (context), `tool_call` (block/modify), `session_start/shutdown`, `agent_settled`, `cache_warming_decision` | **Shell hooks** in `config.yaml` with Claude-compatible JSON (`pre_llm_call` context, `pre_tool_call` block, exit 2), plugin hooks, **outbound webhooks** (signed) |
| Subagents | yes (async, `/agents`) | no (by design; via packages) | yes (`delegate_task`) |
| Remote from phone | `/remote-control` | via RPC/SDK | native (gateway) |
| Hook scope | plugin (user-level install), settings `~/.gemini/antigravity-cli/settings.json` incl. `permissions.allow/deny` | user + project extensions | per profile (user-level), not per repo |
| MCP | `.agents/mcp_config.json` (workspace), key `serverUrl` | `mcp.json`, extension API | config |
| Telemetry | vendor telemetry only (`enableTelemetry`); no OTel export documented → YAW hook events | extension events | outbound webhooks |
| YAW role | adapter like Gemini | adapter: one generated extension wraps YAW hooks | adapter only (coding agent); remote control stays with YAW's own `yaw-tg` bridge |

Notes:

- Gemini CLI stopped serving Google AI Pro/Ultra and free users on 2026-06-18 and was replaced by **Antigravity CLI**; it stays available for Gemini Code Assist Standard/Enterprise and paid API keys. The form therefore offers *Gemini CLI (enterprise / API key)* and *Antigravity CLI* as separate checkboxes. Phase 1 adapters: Claude, Codex, Copilot; Gemini CLI and Antigravity follow in phase 3.
- **Multiple agents per project are supported**: the agent selection is multi-select; all selected adapters are generated from the same neutral sources and can be used side by side (e.g. Claude for design work, Codex for refactors, Gemini for reviews).
- Hook schemas of Claude and Codex are nearly identical (same event names, `hookSpecificOutput`, exit code 2); Copilot and Hermes also accept Claude-style JSON. Gemini/Antigravity and Pi use different event models, so their adapters translate one neutral hook definition.
- Skills: author once in `.agents/skills/`; Codex, Copilot, Gemini CLI, Antigravity CLI and Pi read it directly. Claude reads `.claude/skills/`, so the adapter generates (or symlinks) it. Hermes: install into its skills dir via `yaw sync`. Antigravity hooks ship as a generated YAW plugin (`agy plugin install <path>`).

## 3. Compatibility attribute (internal data model)

Every customisation item (hook, skill, subagent, setting, comfort feature) and every interview question carries an `agents` map. The form only offers what the selected agents support, shows the fallback for partial support, and greys out the rest with the reason.

```yaml
# modules/comfort/items/session-hygiene.yaml
id: session-hygiene
title: Session hygiene hints
tokenCost: none            # none | low | medium: model tokens consumed per turn
agents:
  claude:  { support: native,   via: "UserPromptSubmit + systemMessage" }
  codex:   { support: native,   via: "UserPromptSubmit + systemMessage" }
  gemini:  { support: partial,  via: "BeforeAgent", note: "no user-only message; verify" }
  copilot: { support: fallback, via: "yaw hygiene (manual)" }
lastVerified: 2026-10-20
```

Values: `native` (hook/feature exists) · `partial` (works with limits, note shown) · `fallback` (tier 2: rule in `AGENTS.md` or manual `yaw`/`just` command) · `none` (hidden, reason shown). `adapters/capabilities.yaml` holds the per-agent defaults; items override. `yaw doctor` warns when `lastVerified` is older than 90 days.

**Drift prevention:** adapter files are generated, never hand-copied; `yaw sync --check` runs in `just check` and fails when a rendered adapter differs from its source.

## 4. Claude Code distribution: plugin + project files

Two complementary channels:

1. **Kit plugin** (user-level, via a plugin marketplace in the kit repo): generic, project-independent customisation, e.g. `/kickoff`, `/task-next`, `/adr-record`, `change-reviewer`, `visual-reviewer`, GitHub skills. Updated with `yaw self-update` / plugin update.
2. **Project files** (`.claude/` in the repo): project-specific settings, hook registration, permissions, project skills (design direction, domain checklist). Committed, so collaborators and CI get the same behaviour.

Rule of thumb: if it reads project data only through `just`/files and has no project-specific content, it belongs in the plugin; otherwise in the project.

Verified plugin capabilities: a Claude plugin (`.claude-plugin/plugin.json`, all fields optional except `name`) bundles skills, commands, agents, `hooks/hooks.json`, MCP and LSP servers, output styles, monitors, `bin/` executables on PATH, and `channels`. `userConfig` prompts the user on enable; `sensitive: true` values go to the OS credential store (useful for notification and channel tokens, doc 08). `claude plugin validate --strict` belongs in the kit CI. Codex plugins use a similar layout (`.codex-plugin/plugin.json`, `hooks/hooks.json`), so one plugin source can render both.

## 5. Subagent roster (opt-in by module)

| Role | Module | Tools | Model tier |
|---|---|---|---|
| `change-reviewer` | quality-code | read-only + `just` checks | strong |
| `security-reviewer` | security (Full) | read-only | strong |
| `visual-reviewer` | ui-design | read-only + screenshots | strong, multimodal |
| `platform-architect` | decisions (Full) | read-only | strong |
| `test-writer` | quality-code (Full) | edit tests only | mid |
| `docs-keeper` | standards (Full) | edit `docs/spec/` only | cheap |

Standard preset: only `change-reviewer` (+ `visual-reviewer` if UI). More roles only when a recurring need appears.

## 6. MCP vs. scripts

Default to **scripts behind `just`** (deterministic, agent-agnostic, testable). Use MCP servers where they add interactive capability scripts cannot (e.g. Playwright MCP for exploratory UI checks, GitHub MCP for rich queries). Each enabled MCP server is listed in the manifest and recorded as an ADR.
