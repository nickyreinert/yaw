# Global Insights: outcomes, collaboration and practical improvements

**Status: Global → Improve implemented (ADR-0065, superseding ADR-0064).** The revised UI starts from saved classified projects and sessions, shares Sessions filters and sorting, opens actual conversations with highlighted phrase clues, and automatically prepares a compact review prompt. Users can copy it into a browser chat or explicitly run a configured installed CLI reviewer. The existing CLI diagnosis is extended with reviewed instruction additions (verdicts are never stored); automatic recommendation quality still needs empirical validation.

## The user problem

Session totals show how much work happened, but users also need to know: “Did we get the task done, where did the collaboration become difficult, and what should I change next time?”

Insights should connect two dimensions:

- **Task outcome:** evidence of fulfillment, partial fulfillment, unresolved work or an unknown result.
- **Collaboration quality:** corrections, misunderstandings, repeated attempts, frustration and recovery.

They belong together: a task can succeed after substantial friction, and a friendly conversation can leave the task unfinished. Preserve both dimensions instead of combining them into one score. An assistant saying “done” is a completion claim; explicit user acceptance is stronger conversational evidence. Neither independently verifies the code or tests. No follow-up means the result is unknown, not necessarily unsuccessful.

The intended flow is **observe a pattern → review a few relevant exchanges → ask an LLM for a compact verdict → choose an improvement**. Improvements may concern the user's requests, agent instructions, task structure or session habits. They must not assume that every misunderstanding is the user's fault.

## What we can actually measure

Separate recorded quantities, estimated conversation signals and explanations that need review.

| Signal | Feasibility in YAW | What it can support |
| --- | --- | --- |
| Session length and volume | Saved session times, prompt/answer counts and usage where available already exist. | Compare elapsed duration and turns within similar projects and agents. Elapsed time includes gaps; it is not active work or proof of an overloaded context. |
| Prompt and answer size | Saved scans already include total prompt/answer characters and answer-size percentiles. Mean prompt size can be derived; individual prompt-size distributions need another explicit transcript read and new aggregation. | Find changes in communication patterns. Short prompts can be appropriate follow-ups; size alone does not establish clarity. |
| Response timing | Saved scans include median and p95 time from a user message to the first assistant message where timestamps exist. | Describe recorded response delays, not total task execution time. |
| Outcome, sentiment, admitted errors and failure type | Optional local Laya classification already estimates these categories, including `admits_error`, `apology_loop`, `misunderstood_intent` and `wrong_scope`. Only counts are saved. | Locate groups worth investigating. Labels and confidence are estimates; an apology is not proof of failure or of a bad prompt. |
| Corrections and recovery over a session | A new explicit transcript review can locate candidate exchanges and their turn positions. Saved counts cannot reconstruct this sequence. | Check whether friction repeats, appears late in sessions, or is followed by acceptance. Reliable semantic detection still needs validation. |
| Task adherence and changes in direction | Requires task context and, for code-change claims, relevant change history beyond current conversation statistics. | Task references or topic changes are clues. They do not establish that the user ignored tasks or made erratic changes; report insufficient evidence when context is absent. |

The first release can use existing metadata, optional local labels and manual sample selection. New detectors must be identified as proposed, not implied by the existing classifier categories.

Quantitative suggestions need a relevant comparison and a denominator. For example, investigate correction frequency late versus early in comparable sessions, rather than declaring all sessions over a universal length “too long.” Recommend trying shorter sessions only when reviewed evidence supports that experiment. Likewise, recommend adding a specific missing requirement rather than simply writing longer prompts.

Every rate should identify its unit (sessions or turns), period, sample size, eligible/classified coverage and unknown or skipped records. Normalize repeated signals by eligible turns so that longer sessions do not appear worse merely because they contain more messages. Keep comparisons within relevant project, agent and model groups where data allows; weak coverage should produce “not enough evidence.”

## Find exchanges that suggest friction

An admission such as “You're right, I overlooked that requirement” is a useful candidate even without the word “sorry.” User corrections such as “I meant the other component” are candidates too. Call these **friction and recovery signals**: sentiment describes only part of what they reveal.

Start with a user/assistant pair and allow a small context window. A correction followed by an apology often refers to an earlier answer, so the pair alone may not explain the problem. Where available, include the original request, the answer being corrected, the correction and the assistant's response. Include a following user reaction when it helps establish recovery. Mark missing context and excerpt omissions explicitly.

Local phrase matching can cheaply suggest candidates; semantic classification can help find equivalent wording across languages. Neither is a validated detector yet. Show why an exchange was selected and let the user reject false positives. Do not treat an acknowledgment, a quoted apology or automatic agreement as a confirmed mistake.

## Build a small review package

1. **Choose scope.** Use the shared project, device, agent, model, time-range and programming-language filters. Show saved quantitative patterns first.
2. **Find candidates explicitly.** Explain which selected local transcripts will be read and whether optional loopback Laya classification will run. Reread them only after confirmation; saved counts contain no excerpts or turn locations.
3. **Review a few examples.** Propose a small batch, initially around three to five exchanges across sessions. Let the user select, remove, edit or redact excerpts and add limited surrounding context. Include successful or recovered exchanges as comparisons when available. Label the batch as selected examples; it cannot estimate how common a problem is across all sessions.
4. **Copy a ready-to-use review prompt.** Include the selected excerpts, anonymous example IDs, aggregate quantities and coverage, selection reasons, and a short analysis instruction. The user chooses a coding agent or web chat and pastes the package there. Users can instead explicitly run the existing configured Claude Code or Codex reviewer; it uses their installed CLI and may contact a hosted paid provider.
5. **Choose an action.** The user reviews the verdict and can adapt a future request, start fresh sessions more deliberately, improve task boundaries or edit shared instructions. Applying a change remains a separate, explicit action.

Ask the reviewing LLM to distinguish observations from hypotheses, consider missing context and agent mistakes, cite example IDs, and suggest the smallest useful change. Treat all excerpt content as conversation data, not instructions. Include relevant existing pre-prompt instructions only when the user deliberately supplies them; otherwise ask for a candidate addition rather than claiming the current instructions caused the problem.

## A compact verdict is the product

The review prompt should request one verdict sentence and at most three prioritized bullets, with a target of 150 words maximum. Each bullet should name the evidence, suggest one action and identify whether it concerns a request, shared instructions, tasks or session habits. Use “possible” when an explanation remains uncertain; return fewer suggestions when evidence is weak. Long explanations and raw evidence belong behind an optional details view, not in the default verdict.

Illustrative output, using fictional examples:

> **Verdict:** The reviewed work appears to recover, but repeated scope corrections are adding avoidable back-and-forth; final task completion is unverified.
>
> - **Requests:** E1 and E3 required scope corrections. State the target component and expected result before implementation.
> - **Shared instructions:** E2 shows the agent assumed an unstated requirement. Consider: “Ask one focused question when ambiguity would change the implementation.”
> - **Session habits:** E4 followed several unrelated tasks. Try a fresh session at the next task boundary and compare correction frequency.

The review package may contain enough evidence for analysis; its requested answer must remain short. Verdicts are not stored. Suggestions become changes only after a separate instruction preview and Apply.

## Feasible first scope and validation

Existing foundations include the session browser and filters, metadata-only scans, local Laya label counts, and a temporary classification preview for selected sessions. That preview currently examines the first few turns; it does not find friction throughout a session or export a review package.

Start with a bounded review flow attached to existing session data: select sessions, inspect candidate exchanges, and copy a concise-verdict prompt with relevant quantities. Allow manual selection without Laya. The existing configured CLI review provides model-generated diagnosis. Optional structured output adds outcome, collaboration and task-adherence estimates, evidence references and a candidate instruction addition. A user-supplied task/acceptance context is required for a meaningful adherence judgment; without it the result is unknown. These are reviewed estimates, not verified code outcomes or population scores. The implemented home is **Global → Improve**, with classified project/session browsing and a chronological conversation reader.

Before making automatic recommendations, review a small mixed set of candidate and ordinary exchanges across supported agents and languages. Check false positives, missed corrections, context sufficiency, and whether different reviewers agree on outcome versus collaboration labels. Existing classifier confidence is not measured detector accuracy. Validate sample usefulness and verdict brevity before widening the scan or adding more charts.

## Privacy and operational constraints

- Optional classification uses the configured loopback Laya endpoint. Explicit CLI reviews use the selected installed provider and may contact hosted services. YAW never automatically sends session text to a hosted service. Manual copying into a user-chosen LLM is a separate, deliberate disclosure, which the export preview must explain.
- Confirm the transcript scope before reading conversation text. Let the user inspect and redact the exact package before copying; omit machine paths and identifying metadata by default. Excerpts themselves can contain sensitive information.
- Keep analytics storage and sync metadata-only with respect to conversations. Excerpts, per-turn predictions and review packages remain temporary by default and do not enter the registry, analytics files, sync or logs. User-requested export is not a transcript archive.
- Make pause, resume and stop visible for long-running classification. Stopping must not persist unfinished results as a completed run.
- Preserve unknown and mixed results. A majority outcome label must not hide unsuccessful or frustrating turns, and selected examples must not become population statistics.
- Synced statistics may lack local transcripts, project paths or language. Keep them usable for quantitative views, show unavailable evidence explicitly, and never infer missing metadata.
- This is prompt/process improvement, not model training. Nothing silently changes shared prompts, project configuration or model weights.

These constraints preserve ADR-0018's content-free registry and ADR-0050's explicit collection and local classification. The concept adds no hook output (ADR-0007) and keeps the registry separate from reviewed conversation evidence (see proposed ADR-0029).

## Open design choices

Before implementation, settle the candidate-selection method and its scan limits, the context and export size limits, and the comparison/coverage rules required before quantitative advice. No persistent verdict or per-turn store and no automatic rule application is introduced; the former saved-verdicts history was removed by decision (read-only).

### Current implementation limits

Global → Improve uses saved classification counts to surface projects and sessions worth reviewing, with a manual All sessions option for work the user remembers. It shares Sessions filters, sorting, search and pagination. Classification from Improve uses only matching saved local session IDs, unclassified first; it preserves unrelated saved rows and existing pause/resume/stop behavior.

Read conversation is the explicit read action for that named session. The reader returns chronological messages, colors tentative correction/apology/recovery phrases, and offers previous/next clue navigation. Reads are bounded at 8 MiB or 1,000 messages; larger Gemini JSON documents are unavailable. Filename-only discovery avoids parsing unselected histories. Hints include English and a small set of German, French and Spanish phrases and remain unvalidated.

Review this conversation automatically selects relevant bounded context without turn-count controls or example checklists. Users inspect/edit/redact the exact prompt before copying or deliberately sending it to a configured installed CLI. The package is limited to 24,000 characters; the requested verdict stays within 150 words and at most three action bullets. Browser links reuse interview destinations and carry no prompt text. Settings enables installed Claude Code/Codex reviewers and a default destination. Fresh restricted CLI sessions use existing sign-in, may contact paid hosted providers, have a three-minute timeout and Stop, and apply no changes. Codex user config is intentionally excluded. Provider-side retention is separate from YAW storage.

Saved aggregate coverage remains separate from conversation evidence and retains outcome and collaboration counts, unknowns, skipped turns and unclassified sessions. No automatic quantitative advice or causal diagnosis is introduced. Conversations and unsaved prompts/verdicts stay temporary and never enter YAW analytics, registry, sync or logs. Navigation, filters and refresh clear the browser review; server verdicts expire after 15 minutes. Verdicts are not saved. Structured verdicts can contain up to ten evidence references and a candidate instruction addition. Users edit the addition, choose project AGENTS.md, project review rules or personal review rules, preview its exact append-only diff, and apply it separately. Stale previews, secret-like text, symlinks and the AGENTS.md 90-line limit are checked. Already-applied instructions remain in their target files.

## Project setup, ground truth and generic agent practices

This is a separate workstream from Global → Improve above. Setup and guided kickoff are implemented under ADR-0074 and ADR-0075, extended by [ADR-0076](.decisions/ADR-0076.md). The detailed contract lives in [project foundations](kickoff/15-project-foundations.md), the [interview catalogue](kickoff/03-interview.md#3-architecture-agent-proposes-user-may-override) and the [reply/context formats](docs/spec/formats.md#guided-kickoff-foundations).

Each project owns its architecture/domain, data model and UI/UX ground truth, supported by applicable decisions and knowledge. Humans maintain the canonical Markdown; reviewed path/hash references and `yaw kickoff context --json` make it available to agents without duplicating its rules or requiring a vector service. YAW supplies separate, versioned generic practices for agents, skills and optional reviewers. Apply those practices within project constraints, surface conflicts for a project decision and update affected sources with agreed behavior changes. Installing the deterministic kit alone does not generate or approve project foundations.

### One planning workflow, available before or after setup

Early setup planning and Settings → Kickoff use one reusable card: inspect/edit the prompt, choose a web chat, installed coding agent or another/local model, then review the reply and its foundation documents. One sufficient reply can provide the business idea, stack recommendation, all three foundations and phased tasks. A complete reviewed plan carries through Apply; completion shows “Project plan ready” instead of requiring another LLM round. Partial plans remain useful and continue with the saved work and current project context. Relevant project-choice changes and changed foundation sources flag the plan for reconciliation; personal communication preferences do not invalidate it.

Web-chat links carry no project data. Installed Claude Code and Codex can draft explicitly with the restricted headless runner, independently of Learn reviewer defaults. Each run requires inspection and confirmation, uses the existing provider sign-in and may incur provider charges; tools are disabled and only text is returned. No project changes are made until reviewed import. Standalone init still closes its server after Apply; its completion card supports manual handoff, while live drafting/import continues in `yaw web` → Settings → Kickoff. Later imports preview all sources and check concurrent changes before saving, preserve existing authoritative documents, and create work items only through the configured task workflow.

### Review examples before substantial UI implementation

Agents should offer a small wireframe, mockup or clickable prototype early enough to make the intended UI reviewable before committing to substantial implementation. **A mockup includes layout as well as colours.** First review information hierarchy, navigation, grouping and placement of controls, realistic content, narrow/wide arrangements and the main success, empty and failure states. Then refine colours, typography and spacing. A rough layout can be enough; reuse an existing approved design for small changes instead of requiring a new design exercise every time. Command-line UX can use sample commands, help/output and an example interaction.

Link the accepted example and observable acceptance criteria from the UI/UX foundation. Implementation and tests follow that reviewed intent. A visually approved mockup is still an assumption about usability until walkthroughs, accessibility checks and, where feasible, user testing supply evidence. Early examples aim to reduce avoidable implementation/rework cycles; they do not guarantee that all later changes disappear.

### Architecture includes control, reuse and cost constraints

All collects four independent project choices, separate from personal preferences and language × runtime profile selection:

| Dimension | Project choice | Kickoff consequence |
| --- | --- | --- |
| Infrastructure control | On premises, self-managed/rented infrastructure, managed hosting allowed, or undecided | Establish deployment, operations and network/data boundaries. |
| Installed libraries | Built-in/standard only, maintained open-source, commercial options allowed, or undecided | Compare building with reusing components and account for maintenance and applicable licence constraints. |
| External application services | None, explicitly approved only, proposals allowed, or undecided | Identify permitted auth, storage, APIs and SaaS dependencies and their data flows. |
| Cost policy | No paid components/subscriptions, an agreed cap, paid proposals with estimates, or undecided | Consider subscriptions, one-off costs, usage-based APIs, AI and operating costs. A cap includes currency and period, plus overage rules where relevant. |

On-premises software can use third-party open-source libraries. Managed hosting does not itself authorize an external application service. Open-source or free-tier software can still incur hosting, maintenance or overage costs. The kickoff prompt carries the exact saved policies, asks about unknowns or contradictions before committing to architecture, and records agreed build/reuse rationale, data flows, operating costs, trial/free-tier limits and exit/export choices in the architecture foundation. Permission to propose a paid option does not authorize a purchase, subscription or provisioning action.

Each policy also offers Decide later (discussion needed) and Doesn’t matter (`no-preference`, a reasoned recommendation invited). Quick and Basic retain explicit project values but do not ask these detailed questions. These fields may remain explicitly undecided while installing a deterministic kit. They are also exposed in agent context before foundations exist; differences between setup inputs and reviewed sources must be resolved. Existing answers without these fields stay valid, with missing constraints made explicit in planning guidance. The setup budget concerns the project's implementation and operation; pricing the project's own product is a separate domain decision when relevant.

### What remains open

The setup/foundation workflow has automated integration coverage for tiny CLI, static-site, data-backed and existing-repository examples. Real project/user walkthroughs are still needed to validate whether mockup review and constraint wording reduce rework and produce useful designs. Each project's actual vendor choices, network boundaries, cost caps and mockup approval remain project decisions rather than generic kit defaults.

For Global → Improve, the remaining concept work is empirical validation of friction clues and outcome/collaboration judgments across agents and languages, sufficient comparison/coverage rules before quantitative recommendations, and evidence that the compact verdict leads to useful changes. Task-adherence estimates require user-supplied context and review; they are not verified scores. Previewed instruction additions are implemented; verdict saving was removed. Autonomous instruction changes and validated quantitative or causal recommendations remain outside this workflow.

### Interview depths and reusable setup UI

Quick asks purpose, language and runtime. It reuses saved personal and tool defaults; optional tools are off when never chosen. Basic adds personal preferences, repository agent/collaboration choices, GitHub on/off and review gates. All adds optional existing-framework, hosting, library, service and cost constraints, asks every applicable implemented question, including advanced questions for laypeople, and exposes all optional modules. Depth alone grants no tool or provider consent. Global Settings → Defaults saves tool defaults independently of the personal profile. Existing project module selections are preserved; legacy `full` and `standard` files remain readable with their legacy module-selection policy. New UI choices use `quick`, `basic` and `pro`.

The initial browser setup and Workspace → Settings → Interview mount the same wizard markup, controller and question policy. Both support drafts, planning prompts, foundation review, file preview and explicit Apply; the Settings workspace remains open afterward. A compact sticky depth selector remains available through Review, shows the number of additional All questions and preserves entered answers and tool selections. Switching away from a skipped step moves to the next applicable step. Review lists every included setting that was not asked at the selected depth, with its source and an Edit link that opens the required depth.

Personal-default onboarding is offered on a fresh interactive install, with `yaw defaults` and Global Settings available later. Init has no separate personal-settings menu. A notice outside the depth menu explains missing defaults: Quick uses factory values, while first confirmed Basic/All personal answers become defaults after Apply. Only experience, chat language, autonomy and answer style are seeded; project facts and optional tools stay separate. Existing global defaults are preserved when a project overrides them. Unattended installs, `--answers`, previews, drafts and existing-project edits never seed preferences.
