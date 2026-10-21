# ADR-0013: Personal vs. committed configuration; hygiene opt-out

- Status: Proposed
- Date: 2026-10-21
- Issue: Y-5.1
- Resolves: M7, M14 (B rule 10); extends doc 14 §5

## Context

Doc 14 §5 splits configuration into committed (team) and personal (not committed) but leaves open how modules decide, and what happens to the user profile (communication style) in a team repository, where every generated file is shared. M14: session hygiene is "on (Standard), uncheckable" in doc 11.

## Decision

Only what Y-5.1 needs is decided now; the rest stays for Y-5.8 / Y-5.9.

- **Classification.** The user profile answers (`user.*` except `user.agents`: length, register, examples, explain, expertise, comfort, ...) are personal. Project rules (language of code and commits, standards, guards, tasks) are committed.
- **Rule for `communication` (Y-5.1).** In solo projects the profile is rendered into `AGENTS.md` and, when length or register differ from the default, into the Claude output style (`.claude/output-styles/yaw.md` plus `outputStyle` in `.claude/settings.json`). When the project mode is team or external-reviewers (`idea.team` is not `solo`), the module **writes nothing**: no `AGENTS.md` section, no output style, no setting. Committed files must not carry one person's style. The module stays installed (its answers are kept), the project-level language rule stays in `core`.
- **Where personal style goes in a team.** Nowhere in the repository: the user keeps it in their own agent configuration. A kit-written, git-ignored `.claude/settings.local.json` is not introduced now (it would need manifest and ignore handling); Y-5.8 decides it for comfort features.
- **Hygiene opt-out (M14).** Hygiene is on by default in Standard and Full but is a personal setting that can be switched off (`user.comfort` without `hygiene`, `yaw hygiene off`). "Uncheckable" in doc 11 is dropped. Implementation and the exact command are Y-5.8.

## Consequences

- `templateContext` exposes `team` (boolean) so templates can apply the rule.
- Y-5.8 must keep comfort configuration out of committed files and honour the opt-out; Y-5.9 (team mode) may revisit the output-style rule.
- Doc 04 §1 `communication` and doc 14 §5 gain a one-line note pointing here.
