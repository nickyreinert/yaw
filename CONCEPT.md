# Global Insights: session outcomes and improvement

**Status: concept only.** This document captures a future direction; it does not authorize or describe an implemented Learning/Improvement section.

## The user problem

Global session statistics can show how much work happened, how long it took, and the current experimental outcome labels. Those totals do not explain what made a session go well or badly. A user should be able to move from a pattern in the aggregate data to the relevant part of a session, understand the evidence, and decide whether it suggests a reusable improvement.

For example: “Sessions in this project using Python often end as partially fulfilled; the frustrated turns tend to follow prompts where the requested scope was unclear.” The interface should help investigate that hypothesis, not state that the prompt caused the outcome.

## Possible information architecture

Keep **Sessions** as the operational browser for session volume, timing, usage, and individual records. Give outcome analysis more prominence than the existing Outcomes table by introducing a dedicated **Global → Insights** area (preferred over “Learning,” which can imply model training). It could feature:

- outcome and sentiment distributions with sample counts and coverage;
- trends over time and cross-analytics such as outcome by programming language, agent, model, device, project, session length, and prompt count;
- filters shared by the overview and session browser, including programming language;
- links from an aggregate to the sessions that contributed to it;
- a session explanation view that relates the prompt leading into a turn to the assistant response and the predicted outcome, sentiment, behaviour, or failure label.

The current outcome charts and table can remain useful entry points in Sessions, while Insights becomes the place for asking “what patterns should I investigate?”

## Evidence and review

Existing evaluations save aggregate label counts, not conversation text or per-turn evidence. A future explanation view therefore needs an explicit, user-initiated review of a selected local session. It should send only the selected session's eligible turns to the configured loopback Laya service, show short prompt/response excerpts alongside label, confidence, and the applied threshold, and avoid saving excerpts or predictions by default. The user must be told what will be read and sent before the review begins.

Low-confidence predictions should be clearly marked as unknown, and every aggregate should show its classified-session/turn coverage. Outcomes are model estimates, not ground truth. A session may contain both successful and frustrating turns; a majority label must not conceal that variation. Correlations across filters are evidence for exploration, not proof of cause.

## From observations to suggestions

Insights could eventually help draft suggestions for Global Settings—for example, a candidate prompt guideline that asks for acceptance criteria when a pattern repeatedly appears alongside misunderstood intent. Suggestions should cite the aggregate and reviewed examples that motivated them. The user should be able to edit, dismiss, or explicitly save a suggestion; nothing should silently change shared prompts or project configuration.

This is prompt/process improvement, not training Laya's model weights. Saved corrections, automated rules, and model training are out of scope unless separately designed and approved.

## Privacy and operational constraints

- Keep inference local to the configured loopback Laya endpoint; never send session text to a hosted service.
- Keep explicit confirmation before reading session text. Make pause, resume, and stop controls visible for long-running classification.
- Stopping a classification must not persist partial results as if the run completed.
- Keep stored analytics metadata-only by default. Any future persisted per-turn labels need a separate data-retention decision and clear deletion controls.
- Synced statistics may not include project paths or project language; report missing metadata as unknown rather than inferring it.
- Preserve device, project, agent, model, time-range, and programming-language filters consistently across metrics, charts, and tables.

## Decisions for a later design

Before building Insights, decide how reviewed turn-level results are retained (if at all), how to handle edits or corrections, which outcome summaries are useful without implying causation, how to make coverage and confidence understandable, and whether suggestions belong in Global Settings or a separate review flow. Validate the proposed name and navigation with users before adding a new section.
