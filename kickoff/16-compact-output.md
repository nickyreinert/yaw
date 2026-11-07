# 16 — Compact Tool Output (token saving)

**Status: concept, not decided.** Working module name: `compact`. Implementing it needs an amendment to ADR-0007 and BUILD.md rule 5, because it adds a new hook kind. Source studied: [rtk-ai/rtk](https://github.com/rtk-ai/rtk) at `bd7f87e` (2026-11-07).

## 1. What rtk does to save tokens

rtk reduces one thing: the bytes of **tool output** the agent reads. It does not change the prompt, the system prompt, the history or what the model writes, except through an optional directive. rtk's own docs say the savings are byte ratios on command output, estimated as `bytes / 4`, and that they shrink at every step on the way to the bill: tool output is one part of input tokens, and input tokens are one part of cost.

| # | Mechanism | How it works |
|---|---|---|
| 1 | Command rewrite | A PreToolUse hook rewrites `git status` to `rtk git status` through `updatedInput`. `rtk` runs the real command, filters stdout/stderr and keeps the exit code. This is rtk's main mechanism; rtk says 16 of 20 agents allow it. |
| 2 | Per-command filters | About 100 Rust modules (git, cargo, pytest, vitest, go test, tsc, docker…) and about 60 TOML line filters (`strip_lines_matching`, `keep_lines_matching`, `replace`, `max_lines`, `tail_lines`, `on_empty`). |
| 3 | Output replacement after the tool runs | A PostToolUse hook returns `updatedToolOutput` for Bash, Read, Grep and WebFetch, using generic methods. It is opt-in (`rtk:posthook`) and, by rtk's table, works on Claude Code, Copilot CLI and a few others. |
| 4 | Recall store | When a cut loses data, the raw output is stored (SQLite, gzip, 30 days, 200 entries) and the output ends with `[full output: rtk recall <hash>]`. |
| 5 | Awareness file | An 8-line block in the agent's instruction file: output is condensed, treat it as complete, batch related commands, bypass only when a result is unusable. It costs tokens on every turn. |
| 6 | Terse directive | Concrete prose rules for the agent's own writing. Off by default. |
| 7 | Proxy daemon | Sits between the agent and the provider API. It strips ANSI codes, progress bars and duplicate lines from tool results already in the conversation, aligns cache breakpoints and routes calls to other models. Separate binary, BUSL-1.1. |
| 8 | Delegation | A whole-file Read over 350 lines goes to a cheaper model instead of the agent's context. Needs an upstream model you supply. |
| 9 | Analytics | Raw and filtered bytes for every call in SQLite. `gain` reports totals, `discover` finds commands in past transcripts that could have been filtered, and `learn` finds pairs where a command failed and the agent fixed it. |

**Filter strategies** (rtk ARCHITECTURE.md): stats extraction (git log becomes counts), failure focus (tests show failures only, passing tests become a count), grouping (lint by rule, grep by file), deduplication (repeated lines become `[xN]`), structure only (JSON becomes keys and types), code filtering (strip comments or bodies), tree compression (ls), progress filtering (keep the last `\r` frame), JSON-mode injection (add `--format json`, then parse), state-machine parsing (pytest) and NDJSON streams (go test).

**Generic methods:** `ansi`, `progress`, `dedup`, `base64-elide`, `cap` (over 300 lines keep the first 50 and last 200, raw copy to recall), `lockfile` (to a `name@version` list), `grep-group`, `web-md` (HTML to Markdown), `minify-json` / TOON.

**Safety rules rtk follows.** These are rules to adopt, not code to copy:

- **Never worse:** if the filtered output is not smaller, emit the raw output.
- **Minimum size:** below 512 bytes, output is left untouched.
- **Fail open:** on any error, return the original output and exit 0.
- **Respect explicit detail:** flags that ask for detail (`--nocapture`, `-v`, `--verbose`) pass through.
- **No invented formats:** the result must look like a shorter version of the real output, without tool-specific headers.
- **Leave diffs and Read content alone by default.** If a Read is converted, a note warns that an Edit `old_string` may no longer match.
- **Say how to recover:** every lossy cut states the recovery path.
- **Deterministic output:** the same input gives the same result. The filtered result is stored in history once, so the prompt cache is not affected.
- **Respect the host's permission rules:** when a deny rule matches, rtk does not rewrite. When no allow rule matches, it rewrites but lets the host ask. Most of `discover/registry.rs` (about 9,000 lines) exists to parse shell compounds well enough for this.

## 2. Licence boundary

- The `rtk` CLI (`src/`, `hooks/`, `src/filters/*.toml`) is Apache-2.0. Copying code or filter files from it requires the licence text and attribution.
- `engine/` (the pipeline, methods and directive texts) and `proxy/` are BUSL-1.1. Using them inside another product is not allowed until 2030-09-09.
- A rebuild therefore means our own implementation of the techniques described here. Do not copy code, method implementations or directive wording from `engine/` or `proxy/`. This is not legal advice.

## 3. What YAW already has

| rtk piece | YAW today | Consequence |
|---|---|---|
| Per-agent hook installer | Adapters, shim and dispatcher (ADR-0006, ADR-0021) for Claude Code, Codex and Copilot | Reuse them; no new installer |
| Awareness file | `agentsMd` fragments per module in AGENTS.md | Awareness is one more fragment |
| Terse directive | `communication` module, `user.length: brief` | Make the "brief" wording more concrete instead of adding a second directive |
| Project commands | Profiles generate `just check/test/lint/build` (ADR-0120) | YAW controls the commands agents are told to run. rtk cannot. |
| Hook output policy | ADR-0007: guard, context, comfort, evaluation. None may rewrite input or replace output. | Needs a new kind |
| Event log | `~/.yaw/logs/hooks.jsonl`, no content (ADR-0018) | Savings numbers fit; output content does not |
| Transcript reader | `sessions` import reads per-session `tokensIn`/`tokensOut`; `session-analysis` streams message text | Basis for measurement and A/B checks. Tool-result sizes are not read yet. |
| Bash guards | `security` PreToolUse deny rules | A command rewrite would interact with them (L3) |

## 4. Concept: module `compact`

Opt-in per project and removable: `yaw add compact`, `yaw remove compact`, or Workspace / Settings. Asked in Basic and All, default off. One multi-choice question, `compact.levers`, selects the levers below. Committed project setting, because every agent in the project should read the same output. `YAW_COMPACT=0` turns it off for one shell.

### L1. Compact project recipes (all agents, no hook)

The generated recipes run each step through a wrapper, working name `yaw run --compact -- <cmd>`:

- **Exit 0:** one line, `ok <step> (<n> lines, <s>s)`. The output itself is dropped.
- **Exit not 0:** output with ANSI codes removed, `\r` progress collapsed to its last frame, three or more identical adjacent lines collapsed, and a head-and-tail cap with a recall hint (L6). The exit code is kept.
- Where a tool has a quieter reporter (for example the `node --test` reporter or `pytest -q`), each profile chooses it, and the profile smoke test verifies it.
- `YAW_VERBOSE=1 just test` prints the raw output.

This works for Gemini too and does not touch permissions: the agent still runs `just test`. Risk: warnings printed by a passing step are hidden. See open decision 2.

### L2. Output compression hook (Claude Code; Copilot CLI unverified)

A new hook kind, `compress`, on PostToolUse with matcher `Bash|Grep|WebFetch`; for Read, it applies to lockfiles only. It returns `updatedToolOutput` in the tool's own output shape. Claude Code ignores a value whose shape does not match for built-in tools (hooks reference, read on 2026-11-07 through a summary, not word for word). Recorded fixtures for each tool are therefore a precondition (BUILD.md rule 7).

- **Methods in v1:** `ansi`, `progress`, `dedup`, `cap` with recall, grep grouping by file, lockfile summary. No per-command parsers.
- **Guards:** the dispatcher enforces "never worse". Output under 512 bytes is skipped, as are commands with detail flags, `git diff|show`, output that already went through `yaw run`, and every Read except lockfiles. The hook fails open.
- **Limit:** PostToolUse fires on success only. Failed tool calls trigger PostToolUseFailure, and its output cannot be replaced, as far as we have read. Whether a Bash command that exits with a non-zero code counts as a failed call is not verified. If it does, L2 never sees failing test output, which is the largest output; L1 covers that case for recipes.

### L3. Command rewrite (deferred)

This is rtk's main mechanism, and the only one that reaches Codex. It is not part of v1:

- **Permission rules:** Claude Code checks permission rules against the input the hook returns. A deny rule `Bash(git push:*)` would not match `yaw run -- git push`. A correct rewrite has to read every settings file and reproduce Claude Code's matching over shell compounds. In rtk, that is the largest and most bug-prone part.
- **Prompts:** with `allow`, the rewrite skips the user's prompt. Without it, commands the user had already allowed start prompting again.
- **Guard order:** the `security` guards run on the original command at the same time, and YAW does not control the order.

Reconsider once L1 and L2 have measurements. If it comes back, limit it to a short allowlist of read-only commands.

### L4. Rules fragment

Two or three lines in AGENTS.md (`tokenCost: low`), rendered only when L1 or L2 is on:

- Use `just <verb>`.
- Output of passing steps is condensed.
- Re-run with `YAW_VERBOSE=1` only when a result is unusable.
- Batch related commands.

### L5. Measurement

Measurement is part of the module, and its first part also works before the module is enabled.

- **Before enabling:** a transcript scan reports tool-result sizes by tool and by the command's first word (git, npm, pytest, Read). It stores sizes and first words only, no content (metadata only, as in ADR-0052). It answers whether compaction is worth enabling for a project. It is shown in Analytics; the CLI name is not decided.
- **After enabling:** `yaw run` and the compress hook write `{tool, method, rawBytes, outBytes}` to `hooks.jsonl`. Tokens are estimated as `bytes / 4` and labelled as estimates.
- **Validation:** compare the same kind of task with the module on and off, using per-session `tokensIn` (already imported) and the number of `YAW_VERBOSE=1` re-runs, which counts filter misses. Byte ratios alone do not prove savings: a lossy cut that causes a re-run costs more than it saved.

### L6. Recall store

Raw output goes to `~/.yaw/recall/<hash>.gz`:

- File mode 0600; at most 200 entries, 30 days and 10 MB per entry.
- Never synced: excluded from data sync.
- Read back with `yaw recall <hash>`.

This would be the first place YAW stores tool-output content, so it needs an ADR and a privacy NOTICE. The alternative is no storage: the cut output ends with a hint to re-run with `YAW_VERBOSE=1`. That stores nothing, but re-runs cost time and are not always repeatable (flaky tests, side effects).

## 5. Changes to existing rules and code

- **ADR-0007 amendment and BUILD.md rule 5:** kind `compress`, PostToolUse only. It may return only `updatedToolOutput`. The dispatcher drops any result that is not smaller than the original; the result may end with one recall line. `tokenCost: none`.
- **`core/schema/module.schema.json`:** add `compress` to the hook `kind` enum.
- **`core/hooks/adapters.js`:** keep `tool_response` in memory for `compress` handlers only, never in the log. Add a PostToolUse branch to `renderOutput` for each agent.
- **`core/schema/hook-event.schema.json`:** optional `rawBytes`, `outBytes`, `method`.
- **Latency:** measured in this container with Node 22.23.4, averaged over 10 runs: bare `node -e ''` takes 30 ms; `yaw hook PostToolUse --module comfort` takes 116–127 ms per call. A compress hook runs on every matching tool call, and each module adds one process per event. It needs a lean entry point that does not load the whole kit. Measure the budget before setting it.

## 6. Out of scope

The proxy daemon (API traffic, cache alignment, model routing), delegation to cheaper models, the 100+ per-tool parsers, a user-editable filter DSL, stripping code bodies from Read, and hook integrity hashes (manifest hashes and `sync-check` already exist).

## 7. Open decisions

1. **Recall store or re-run hint** (L6): privacy against cost.
2. **L1 on success:** drop all output, or keep a warning count or the warning lines?
3. **Default in Basic/All:** off (recommended), or on for L1 only?
4. **Committed or personal:** committed (recommended, so every agent sees the same output), with `YAW_COMPACT=0` as the per-shell opt-out.
5. **L3:** build it at all, and when?

## 8. Verify before implementing

- Record Claude Code PostToolUse payloads and confirm the `updatedToolOutput` shapes. rtk's code assumes these shapes:
  - Bash: `stdout`/`stderr`
  - Read: `file.content` plus `numLines`/`totalLines`
  - Grep: `content` plus `numLines`
  - WebFetch: `result`
- Find out whether a Bash command that exits with a non-zero code fires PostToolUse or PostToolUseFailure.
- Copilot CLI `modifiedResult`: rtk claims support; not verified.
- Codex: by rtk's table, Codex cannot replace tool output, so only L1 and L4 apply there.
- Run the L5 transcript scan on real projects: what share of input tokens comes from tool results.
