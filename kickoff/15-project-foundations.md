# 15 — Quick Interview and Project Foundations

**Status: work packages 1–4 implemented.** This resolves both items in [KICK-OFF.md](../KICK-OFF.md). Docs [02](02-setup-flow.md) and [03](03-interview.md) describe the current interview. Guided kickoff adds reviewed foundations; installing the deterministic baseline alone creates none.

Decision records: **Accepted** [ADR-0079](../.decisions/ADR-0079.md) supersedes ADR-0074 for personal-default onboarding and the Quick/Basic/All preference policy; **Accepted** [ADR-0075](../.decisions/ADR-0075.md) supersedes ADR-0073 for foundations and the two scopes of agent guidance.

## 1. Quick asks about this project

Quick reduces repeated preference questions and the depth of planning. It must still establish enough project facts to make a sound proposal.

| Information | Quick behavior |
|---|---|
| Experience, chat language, answer style, explanation depth, autonomy | Reuse saved personal settings, otherwise documented defaults; show their source in the summary. Offer an optional settings edit without making it part of the interview. |
| Supported coding agents | Basic and All confirm the agents for this repository; Quick reuses an existing choice or the factory selection. This is a project choice even though its current answer key is `user.agents`. |
| Purpose, intended users and main task | Ask for a short description. Extract facts already supplied and ask only for missing essentials. |
| Architecture/runtime and language/stack | Ask about requirements and constraints, or offer a reasoned proposal to confirm. Never silently copy these from personal preferences or a previous project. |
| Data, human interaction and important constraints | Establish whether the project stores or changes meaningful data, how it is used, and any constraint that changes the proposal. A short follow-up is enough when the idea supplies most of this. |
| Team, task storage and enabled modules | Basic and All ask project choices needed for the selected setup; Quick reuses defaults. Keep conditional questions conditional. |
| Detailed capacity estimates, schema evolution, secondary flows and alternatives | Defer to Full or later work unless they affect an essential choice now. |

“I don't know” is a valid reply to a project question. An agent should offer the simplest fitting option, explain the relevant trade-off and ask for confirmation. With no agent, the deterministic lane can explain supported choices and collect a selection, or save an incomplete draft for later guidance. It must not invent an architecture from a generic JavaScript/local default.

The review identifies answered, reused, defaulted and proposed values; the terminal also marks accepted saved project defaults as confirmed proposals. Essential unresolved project choices prevent Apply. Noninteractive setup needs explicit project facts or a previously confirmed project proposal; `--yes` is permission to apply, not evidence that a missing fact is known. This reproducible lane uses the file's personal values or documented defaults, without an implicit machine-profile merge (ADR-0019). Imported setups prefill project choices for review instead of establishing facts about a new project.

### Personal onboarding and precedence

The first question on a fresh interactive installation offers personal-default setup. `yaw defaults` and Global Settings → Defaults review them later. Init has no `u` onboarding entry. If defaults are absent, a coloured notice explains that Quick uses factory values while first confirmed Basic/All personal answers establish defaults after Apply. Only experience, chat language, autonomy and answer style are included. Agents, architecture and optional tools remain separate. CI/unattended installs and update reruns do not prompt.

For personal values, use an explicit project override first, then the saved user profile, then the documented default. When editing an existing project, keep its saved values unless the user changes them. Changing a global preference affects future setups and does not rewrite existing repositories.

Reading an existing profile never grants permission to replace it. First-default seeding follows the init notice and confirmed Basic/All answers; explicit global preference changes and project preset saving remain separate actions. No new background profile writes or consent to external model use are implied. The exact onboarding command and answer metadata belong in the implementation design.

**Implemented:** both lanes reuse personal settings and leave missing essentials unresolved; the browser can save an incomplete draft. Invalid/unreadable profiles give a generic warning and remain untouched. Terminal Enter confirms a supplied project default; browser step review or an explicit review action confirms imported/planning choices. Answer provenance is transient review data. Explicit `yaw edit user` and browser section editing can change project overrides without changing depth or global settings.

## 2. Three foundations, scaled to the job

There are two scopes. **Project ground truth** belongs to each project: its architecture/domain, data model and UI/UX, supported by applicable decisions and knowledge. Humans maintain readable sources; `.yaw/foundations.json` registers their authoritative paths and review hashes, and `yaw kickoff context --json` makes their references and bounded content available to LLM tools. It does not duplicate rules or require vector embeddings. **Generic YAW practices** are versioned kit guidance for agents, skills and optional reviewers. Apply them within the project's constraints; surface a conflict for a project decision rather than silently replacing an explicit rule. Existing hooks keep their current behavior and output budget.

Use the business idea and, where relevant, business model to establish three connected project foundations. These are a useful organization for YAW, not a complete software-engineering lifecycle. Requirements, testing, operation, security and maintenance still matter: [SWEBOK](https://www.computer.org/education/bodies-of-knowledge/software-engineering/resources/) treats these as distinct knowledge areas. Our proposal groups the project facts needed to begin, while existing modules handle applicable tooling.

| Document in the target project | Owns | Minimum useful contents |
|---|---|---|
| `docs/spec/architecture.md` | Purpose, domain behavior and system boundaries | Problem and users; desired outcome and a testable success example; relevant business constraints; scope and non-goals; main business rules; components and external systems; runtime/stack; important security, performance and operational constraints; links to the other foundations and applicable ADRs. |
| `docs/spec/data-model.md` | Meaning, ownership and lifecycle of data | Important entities or input/output contracts; relationships and invariants; source of truth and who may read/change it; persistence choice and rationale; relevant retention/deletion, compatibility and schema-evolution expectations. |
| `docs/spec/ui-ux.md` | How people accomplish tasks | Users and their main tasks; primary flow and information hierarchy; important empty/error/success states; accessibility and interaction constraints; visual direction where applicable; observable review criteria. |

Create these when the user chooses guided project kickoff, in Quick or Full. Installing the Quick baseline alone does not generate three empty documents or make an LLM mandatory. For a small script, each foundation may be a few bullets. Full expands only the parts justified by complexity and risk; no minimum page count, mandatory UML or database diagram.

No meaningful persistence means an explicit “No persistent application data” with the relevant input/output and file-safety rules, not a fabricated database design. CLI tools still have a user experience: command names, help, output, errors and safe interaction. A machine-only library or service can mark the human-interface foundation not applicable, with a reason and a link to its API contract. Do not invent screens for it.

Existing repositories reuse their established equivalent documents. The kickoff summary lists the authoritative paths; do not create a parallel set that disagrees with them. A concise pointer from `AGENTS.md` makes the foundations discoverable within its existing line budget (ADR-0009).

Architecture inputs now distinguish infrastructure control (`arch.hosting-control`), installed libraries (`arch.libraries`), external application services (`arch.services`) and cost policy (`arch.cost`, plus `arch.cost-limit` when capped). On premises and third-party libraries are compatible choices. Managed hosting, external APIs and paid dependencies each need their own agreement. Unknown choices stay explicit; the planning prompt asks about missing constraints and conflicts rather than assuming permission. Architecture records the agreed build/reuse rationale, data flows, operating/maintenance costs, free-tier/trial/overage limits and exit options. A permitted paid proposal is not purchase or provisioning approval.

### A proportionate example

For a local photo-renaming script:

- **Architecture and domain:** one local command; rename photos according to the agreed filename rule; leave original files intact when a target name collides; no cloud service or user accounts.
- **Data model:** input paths and available photo timestamps, output-name mapping and collision invariant; no application database. Decide whether a saved undo mapping is needed rather than assuming one.
- **UI/UX:** preview proposed renames, explain collisions, confirm before changing files and report the result. Review with a small realistic folder, including missing timestamps and duplicate target names.

This is enough to start a thin working slice. The documents grow when a requirement or observed problem warrants more detail.

## 3. Kickoff produces an agreed baseline before tasks

1. **Collect:** reuse personal settings and establish project facts. Treat a business model as relevant constraints, such as billing or ownership, rather than requiring every project to write a business plan.
2. **Propose:** draft the three foundations together. Distinguish supplied facts, recommended decisions and unresolved assumptions. Reuse established documents and link shared concepts instead of copying their definitions.
3. **Review:** show a short connected summary: what the product does, where it runs, what data it owns, how its users complete the main task and which important choices remain open. The user can edit any foundation. Resolve choices that block a sound first implementation; record other uncertainty with an owner or follow-up task.
4. **Plan:** derive a thin working slice and small tasks from the reviewed baseline. Each task links the relevant foundation sections and gives observable acceptance criteria. Test domain rules, data invariants and user outcomes at the appropriate level.
5. **Implement and learn:** validate the slice, then revise the affected foundation when evidence or an agreed requirement changes it. Repeat for the next slice.

The three documents become the agreed specification once reviewed; their existence alone is not evidence of correctness or user validation. A suggested design remains an assumption until tested with its users. Keep the phase/task plan in `docs/plan/kickoff.md` as it is today; foundations are maintained project documentation and must not disappear when that temporary plan is removed.

The deterministic setup lane remains usable without generated foundations. The user may write or review them manually, or return to guided kickoff later. Planning guidance must state which facts are missing rather than presenting an unreviewed model output as agreed ground truth.

## 4. Optional guided UI/UX work

Offer an optional design-guidance prompt within kickoff, usable with a configured local model or copied to a user-chosen external agent. Manual drafting follows the same questions. It consumes the idea, project constraints and the draft foundations, then proposes concrete flows and review criteria for this product. It does not merely select a visual style or enable tools.

Keep the prompt and a short principle checklist versioned with the kit. Maintainers review changes against the cited sources and representative project examples. Record the kit/prompt version used for a draft; an update may offer a review but must not overwrite an accepted project foundation. Read only user-selected project material; preview the exact package before external use and keep secrets out of it.

The guidance should:

- Offer a small example before substantial UI implementation: a rough wireframe, screen mockup or clickable prototype. **Layout is part of the mockup**, including content hierarchy, navigation, grouping and placement of controls, realistic content, responsive arrangements and key states. Review structure and the main flow before colour, typography and spacing. Link the accepted example and criteria from `ui-ux.md`; reuse existing approved examples where appropriate. CLI flows can use sample commands/help/output.
- Start from real users, their tasks and existing evidence. Label invented personas and untested assumptions. Ask for the most consequential missing information rather than a long generic questionnaire. [GOV.UK's user-needs guidance](https://www.gov.uk/service-manual/user-research/start-by-learning-user-needs) recommends testing ideas with likely users and treating suggestions without user evidence as assumptions.
- Walk through the main task with realistic content, including failure and recovery. Explain choices in terms of the user's goal, necessary steps, clear feedback, understandable language and prevention of costly mistakes. Propose one small prototype or walkthrough to test the riskiest assumption. [GOV.UK's Service Standard](https://www.gov.uk/service-manual/service-standard/point-1-understand-user-needs) emphasizes understanding the problem and testing assumptions early with prototypes.
- Include accessibility from the first flow: meaningful structure and labels, keyboard/focus behavior, understandable errors, contrast and relevant input alternatives. For web interfaces, use the project's applicable criteria from the [W3C WCAG 2.2 quick reference](https://www.w3.org/WAI/WCAG22/quickref/); use platform guidance for native interfaces. A checklist or automated scan does not establish full conformance.
- Finish with a short proposed addition or revision to `ui-ux.md`, links to affected domain/data rules and a few testable review criteria. Flag conflicts for review. Offer visual directions only after the main interaction is understood.

The output is a candidate design and a way to review it. Human walkthroughs, prototypes and, where feasible, user testing provide evidence that the design works. The visual direction, tokens, screenshots and opt-in checks in doc 06 implement and test applicable parts of the foundation; enabling them does not replace design work.

## 5. Keep the foundations consistent during development

The project owner or its existing reviewer approves changes to intended behavior. Agents consult the relevant foundations at task start and update affected sections in the same change as implementation. Link lasting rationale to ADRs when decision memory is enabled; otherwise keep the rationale beside the choice. Do not require a new module to maintain a small project's documents.

Give each shared rule one authoritative home: architecture owns domain behavior, the data model owns representation/lifecycle invariants, and UI/UX owns interaction behavior. Other documents link to it. For example, booking eligibility is a domain rule, a uniqueness constraint enforces its stored representation, and the booking flow explains the user-visible rejection. They must describe the same outcome.

When a rule changes, review the affected component, stored data, interaction and acceptance criteria together. If documents, code or ADRs disagree, identify the conflict and resolve it with the responsible reviewer; do not silently rewrite the agreed specification to match the implementation. A changed business rule may require a schema migration, revised error flow and updated tests in the same task.

Review only what changed and its dependencies. Ordinary refactoring need not rewrite all three foundations. Link checks can catch broken references; project tests can check observable behavior; human review must still assess whether the documents agree. No new per-prompt context injection or recurring model review is proposed (ADR-0007).

## 6. Work packages

The user selected work packages 1 and 2 together, then 3 and 4 with the two-scope clarification:

1. [x] Update docs 02 and 03 with the agreed Quick/personal boundary, provenance and confirmation rules. Specify optional personal onboarding and preserve existing consent and project overrides. Keep the language × runtime profile mapping (ADR-0054).
2. [x] Implement the same behavior in terminal and browser, covering fresh installs, missing/partial saved profiles, existing-project edits, loaded presets, browser handoff and noninteractive use. Verify that unresolved essential project choices cannot reach Apply.
3. [x] Extend kickoff guidance and its versioned prompt to draft/review the foundations before tasks. Format 1 supports fenced drafts or existing paths, requires explicit review and refuses overwrites; legacy phase/task plans remain usable.
4. [x] Connect reviewed paths through `yaw kickoff context` (text/JSON), the core agent instruction, optional reviewer context/skill and `yaw kickoff ux`. Integration fixtures cover a tiny CLI, static site, data-backed app and existing repository, source changes and user-owned file preservation. These verify the workflow, not product design quality or user validation.

ADR-0074 originally amended the interview selection, expertise timing and personal-profile reuse portions of ADR-0009, ADR-0042 and ADR-0043. ADR-0079 now defines installer onboarding and first confirmed personal defaults; their other rules remain intact. ADR-0075 records foundation import, authority and context behavior. The exact bundle, index and task metadata formats are documented in [formats.md](../docs/spec/formats.md#guided-kickoff-foundations). Kit practices and kickoff guidance are versioned in `core/lib/foundations.js` and `core/lib/kickoff.js`; maintainers review changes with the cited guidance and representative workflow fixtures. Reviewer PASS caching remains per commit (ADR-0056); run an on-request review again when relevant context outside that commit changes.

The subsequent mockup/layout and project architecture-constraint additions are recorded in ADR-0076. Generic practices and kickoff prompt revision 2 keep bundle format 1 compatible.

### Updated depth policy

Quick asks essential project and architecture choices and reuses saved settings. Basic adds personal preferences, repository agents, collaboration, GitHub on/off and review gates. All asks every applicable implemented question. Optional tools start off when never selected; Global Settings can save explicit tool defaults. Initial setup and Settings → Interview reuse one wizard/controller, including foundation review and Apply. Legacy depths and existing project module selections remain readable.
