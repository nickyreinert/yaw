# 17 — Session Classification v2 (exchanges, two subjects, 1–5 scales)

**Status: concept, 2026-11-10.** Replaces the label set and storage of the current local Laya classification (`core/lib/session-analysis.js`, ADR-0050, ADR-0068). The decision record for this spec is proposed; implementing it supersedes ADR-0068. Laya facts marked *(verify)* come from the Laya README summary and must be confirmed against a running `laya-serve` before implementation (section 12).

## 1. Why

The current pipeline sends one state per user turn (`prompt`, `answer`, `nextPrompt`, optional previous pair) with four questions and saves only label counts per session. Defects:

| # | Defect | Effect |
|---|---|---|
| D1 | `sentiment` does not say whose sentiment; the state mixes request, reply and reaction. Insights shows it as "How did the user react?" and counts it as user frustration. | Frustration numbers are not about the user. |
| D2 | Only `outcome` has criteria; for `sentiment`, `behaviour`, `failure` each criterion is the label name (`wrong_scope` → "wrong scope"). | Weak zero-shot signal; Laya itself says it is "a fast base to specialise, not a zero-shot decision engine". |
| D3 | `apology_loop`, `too_slow` span turns or need timing; `tooling_error` needs tool results, which `textOf` drops. | Labels that cannot be detected from the state. |
| D4 | The 0.65 threshold is applied to uncalibrated probabilities; the multilingual checkpoint ships without fitted temperatures. | The threshold has no measured meaning. |
| D5 | Only counts are saved. | No drill-down to the exchange that went wrong, no session verdict, no trend. |
| D6 | `messageOf` treats every Claude `type: "user"` line with text as a user prompt, including `isMeta` lines, `<command-name>` wrappers and `<local-command-stdout>` output (all present in real transcripts). | Non-human text is classified as prompts and reactions; it also skews `prompts` and `promptChars` metrics. |
| D7 | Categories, labels and criteria are hardcoded and invisible; only one shared prompt sentence is editable. | The user cannot see or tune what is measured. |

D6 is a bug in the existing reader and is fixed first, independent of the rest (T1).

## 2. Goals and non-goals

Goals:

- Classify per **exchange**, roll up per session, keep per-exchange results (labels and scores, no text).
- Judge the **assistant reply** and the **user reaction** separately, with separate states.
- Use **1–5 scales** where a degree matters (adherence, frustration), choice labels where a kind matters, yes/no tags for frustration markers.
- Make every category, label, level description and instruction visible and editable in Settings.
- Let the user calibrate on their own labelled exchanges.

Non-goals:

- User-defined categories (the category set is fixed; texts are editable).
- New backends (Ollama, hosted judges). The single Laya adapter stays; the request builder stays isolated so a second backend can be added later.
- Automatic or hook-driven classification. Classification stays explicit and confirmed (ADR-0050).
- Verifying task success. All results remain conversation estimates.

## 3. Unit of analysis

**Exchange** = one human user prompt → all assistant messages until the next human prompt → that next human prompt (the **reaction**).

- Human prompt: a user message with text that is not a tool result and not system-generated. Claude: exclude `isMeta: true`, `isCompactSummary: true`, messages whose text is only `<command-name>…`, `<command-message>…`, `<command-args>…`, `<local-command-stdout>…` or `<local-command-stderr>…` wrappers (verify the full list against fixtures). Interrupt markers (`[Request interrupted by user…]`) are not prompts; they become a signal on the exchange they interrupt (section 6).
- The last exchange has no reaction: the user-side questions are not asked; `verdict = none`.
- An exchange without assistant text is skipped (as today).
- Exchanges are numbered from 1 in transcript order; the index plus a per-exchange fingerprint (sha256 of prompt, answer and reaction text) identifies it.

## 4. Taxonomy (fixed set, editable texts)

Two Laya calls per exchange, one per subject. Each call is one state and several questions in one forward pass.

### 4.1 Assistant reply

State: `{ previousPrompt?, previousAnswer?, prompt, answer }`. The reaction is **not** included, so the user's response cannot leak into the judgement of the reply.

| Key | Type | Labels / levels (default descriptions are the editable criteria) |
|---|---|---|
| `adherence` | scale 1–5 (higher = better) + `not_applicable` | 5 does exactly what was asked · 4 does it with a minor deviation · 3 does part of it · 2 mostly does something else · 1 ignores the request or refuses without reason · `not_applicable` the prompt is not a request (chat, question about something else) |
| `scope` | choice | `as_requested` · `too_narrow` (leaves out asked-for parts) · `too_broad` (changes or adds what was not asked) · `not_applicable` |
| `admission` | choice | `none` · `admits_error` (names its own earlier mistake and corrects it) · `apology_without_fix` (apologises or agrees without a concrete correction) |

Dropped: `sycophantic_admission` (needs to know the earlier answer was right; not visible in text), `apology_loop` (derived per session, section 7).

### 4.2 User reaction

State: `{ prompt, answerTail, reaction }`. `prompt` and `answerTail` are context; `answerTail` is the last 1,500 bytes of the reply, labelled as an excerpt in the field name and instructions. The full reply is not needed to judge the reaction, and this keeps long replies from causing a skip (an explicit, named excerpt, not silent truncation).

| Key | Type | Labels / levels |
|---|---|---|
| `verdict` | choice | `accepted` (confirms success or accepts the result) · `partial` (accepts some, names a remaining gap) · `corrected` (says it is wrong, asks for a fix) · `abandoned` (cancels or gives up) · `new_topic` (moves on without a verdict) · `unknown` |
| `frustration` | scale 1–5 (higher = worse) | 1 positive or appreciative · 2 neutral · 3 impatient or terse correction · 4 clearly frustrated (complains, repeats) · 5 hostile (insults, profanity, shouting) |
| `complaint` | choice | `none` · `misunderstood_intent` · `wrong_scope` · `broke_something` · `ignored_instruction` · `invented_fact_or_api` · `incomplete` · `other` |
| tags | yes/no per tag (`noul`) | `repeats_request` · `cites_ignored_instruction` · `stops_or_reverts` · `profanity_or_shouting` · `sarcasm` |

Rules: the ADR-0068 whole-message phrase rules keep working and map `fulfilled → accepted`, `not_fulfilled → corrected`, `abandoned → abandoned`; bare thanks stays `unknown`. `complaint` counts in roll-ups only when `verdict ∈ {partial, corrected, abandoned}`.

Dropped: `too_slow` (response time already exists in metrics), `tooling_error` (counted deterministically, section 6), `aggressive` as a label (it is level 5).

Option budget: assistant call 13 options, user call 21 options + 5 yes/no. Laya's options share the token budget *(verify that this fits at the default `max_len` and `head_max_len`)*.

## 5. Scales from choice probabilities

Laya's `score` type is its weakest primitive (README: SST-5 0.372) and the multilingual checkpoint has position bias on it *(verify)*. Scales are therefore asked as 5-level `choice` questions with one description per level, and the score is derived:

- `score = Σ k · p_k` over levels 1–5, with probabilities renormalised over the five levels (excluding `not_applicable`).
- `mass = max over k of (p_k + p_{k+1})`, the highest probability on two adjacent levels. Spread across neighbouring levels is normal for an ordinal question; spread across distant levels is not.
- `unknown` when `not_applicable` has the highest probability, when Laya sets `abstain` *(verify)*, or when `mass` < the category threshold.
- Stored: `score` (one decimal), `mass`, and the top level.

All scales run 1–5. Direction is stated per category (adherence: higher = better; frustration: higher = worse) and shown in the UI.

## 6. Deterministic signals (no model)

Facts from the transcript, recorded per exchange and preferred over model estimates where they overlap:

| Signal | Source (Claude; others when their format is known) |
|---|---|
| `interrupted` | `[Request interrupted by user…]` user text after the reply |
| `tool_denied` | a `tool_result` whose text starts with the "doesn't want to proceed with this tool use" message |
| `tool_errors` | count of `tool_result` blocks with `is_error: true` inside the reply |
| `responseMs` | already measured; kept per exchange |
| phrase verdict | ADR-0068 rules (section 4.2) |

`interrupted` or `tool_denied` also sets the `stops_or_reverts` tag to yes with `source: signal`.

## 7. Session roll-up (computed, no model call)

| Field | Definition |
|---|---|
| `finalVerdict` | verdict of the last exchange whose verdict is not `new_topic`, `unknown` or `none` |
| `success` (1–5) | mean of mapped verdicts: accepted 5, partial 3, corrected 2, abandoned 1; others excluded. A heuristic; `null` without verdicts. |
| `acceptance` | accepted / exchanges with a mapped verdict |
| `adherence` | mean adherence score over known exchanges |
| `frustrationPeak`, `frustrationMean` | max and mean frustration score over known exchanges |
| `escalation` | true when frustration rises over two consecutive exchanges and ends ≥ 4 |
| `apologyLoop` | true when two or more consecutive exchanges have `admission ≠ none` |
| `counts` | per category label counts and per tag yes counts (the `counts` shape Insights uses today) |
| `unknown` | per category: model, low confidence, no reaction (extends `outcomeUnknown`) |

Insights moves from label counts to these fields: frustration = exchanges with frustration ≥ 4; corrections = admissions; unresolved = verdicts partial/corrected/abandoned; friction = any of these, a non-`none` complaint, `escalation` or `apologyLoop`.

## 8. Storage and privacy

`row.evaluation` gets `schema: 2`:

```json
{
  "schema": 2, "backend": "laya-multilingual", "taxonomy": "<sha256 of the effective texts>", "calibration": "<id or null>",
  "evaluated": "2026-11-10T12:00:00Z", "classified": 41, "skipped": 2,
  "exchanges": [
    { "i": 3, "fp": "<sha256>", "assistant": { "adherence": { "score": 4.2, "mass": 0.81, "level": 4 }, "scope": { "label": "as_requested", "p": 0.77 }, "admission": { "label": "none", "p": 0.9 } },
      "user": { "verdict": { "label": "corrected", "p": 0.71, "source": "model" }, "frustration": { "score": 3.6, "mass": 0.7, "level": 4 }, "complaint": { "label": "ignored_instruction", "p": 0.68 }, "tags": ["repeats_request"] },
      "signals": { "interrupted": false, "toolDenied": false, "toolErrors": 1, "responseMs": 48000 } }
  ],
  "session": { "finalVerdict": "accepted", "success": 3.8, "acceptance": 0.6, "adherence": 4.1, "frustrationPeak": 4.3, "frustrationMean": 2.4, "escalation": false, "apologyLoop": false, "counts": {}, "unknown": {} }
}
```

- No message text, excerpts or model prose are saved. New compared with today: exchange indices and fingerprints are saved. This changes the CONCEPT.md statement "saved counts contain no excerpts or turn locations" and needs the decision record.
- Sync (`session-rows.js`) exports `session` and `counts` only, never `exchanges`, so turn locations stay on the device.
- Size: about 300 bytes per exchange; a 300-exchange session adds about 90 KB to `session-analysis.json`. Acceptable; revisit if the file exceeds a few MB.

## 9. User control (Global → Settings → Classification)

New **Categories** section below the existing settings:

- Grouped by subject (Assistant reply, User reaction, Signals). Each category shows its key, type (scale / choice / tag), direction for scales, labels or levels, and calibration status.
- Editable per category: the instruction text, each label or level description, the threshold. **Reset** restores the defaults for that category.
- Signals are listed read-only with their source, so the user sees what is not model-based.
- The existing shared prompt guidance stays and is prefixed to every question, as today.
- The **taxonomy hash** covers every effective text. When it differs from a stored result, Insights marks that session "classified with older criteria" and offers Reclassify; nothing is reclassified automatically.
- **Try on saved sessions** (existing preview) shows per exchange: both subjects side by side, scores with mass, labels with probability, tags, signals, and the source of each value (`model`, `rule`, `signal`).

Saved in `~/.yaw/web-preferences.json` next to the current classifier settings; only changed texts are stored, defaults live in code. Validation: 1–1,000 characters per description, 1–2,000 per instruction, threshold 0.5–0.99.

## 10. Calibration

- The conversation reader (Global → Improve) and the preview offer **Label this exchange**: verdict, frustration level 1–5, adherence level 1–5 (the categories that matter most; others optional).
- Labels are saved in `~/.yaw/classification-labels.json` as `{ session id, exchange index, fingerprint, labels }`, no text. A label whose fingerprint no longer matches the transcript is ignored.
- **Calibrate** runs Laya on the labelled exchanges and fits one temperature per question by grid search (T from 0.5 to 5 in 0.25 steps, minimum negative log-likelihood), in JS. Applied as `p'_k ∝ p_k^(1/T)`, which equals temperature scaling on the logits because `log p_k` differs from the logit only by a constant.
- Reported per category: n, and for choice accuracy plus a confusion table; for scales mean absolute error and within-1 rate; for tags precision and recall. Before/after calibration side by side.
- A category counts as calibrated from 30 labels. Uncalibrated categories are marked "uncalibrated" wherever their numbers are shown.
- Laya's own `fit`/calibrate functions are Python-side *(verify whether `laya-serve` exposes them)*; the JS fit keeps YAW zero-dependency either way.

## 11. Migration and compatibility

- Schema 1 rows (`counts` without `schema`) stay readable and are shown as "legacy classification" in Insights, excluded from v2 charts, with Reclassify offered (as ADR-0068 keeps legacy results until explicit reclassification).
- `yaw sessions evaluate` keeps its flags and writes schema 2.
- The ADR-0068 phrase rules, loopback-only endpoint, confirmation prompt, Pause/Resume/Stop and "no partial results saved" behaviour stay unchanged.
- Two Laya calls per exchange roughly double run time. If `/v1/systemone/batch` accepts different questions per state *(verify)*, both calls can be merged.

## 12. Verify before implementation

With a local `laya-serve` (multilingual), record fixtures under `test/fixtures/laya/`:

1. Exact request and response JSON of `POST /v1/systemone` for `choice` with criteria and for `noul`; presence of `probabilities`, `abstain`, `answer_confidence`, `usage.truncated`, `routing.model`.
2. Whether the user call (21 options + 5 yes/no) fits at default `max_len`/`head_max_len` without `truncated_questions`.
3. Whether `/v1/systemone/batch` allows different questions per state.
4. Whether calibration is reachable over HTTP.
5. Claude transcript markers for D6 and section 6 against real lines (`isMeta`, command wrappers, interrupt text, denied tool result).

Report deviations to the user before T3 starts.

## 13. Tasks

| ID | Task | Model · effort |
|---|---|---|
| T1 | Fix D6: exclude non-human Claude user lines in `messageOf`/`readTurns`; regression test with recorded lines. Independent of the rest. | Sonnet · medium |
| T2 | Section 12 verification and Laya fixtures. | Sonnet · medium |
| T3 | Exchange builder, two states, taxonomy defaults, request builder, choice/scale/tag parsing, signals (sections 3–6). | Sonnet · high |
| T4 | Roll-up, schema 2 storage, sync export limit, legacy handling (sections 7, 8, 11). | Sonnet · high |
| T5 | Settings Categories section, taxonomy hash, preview per exchange (section 9). | Sonnet · medium |
| T6 | Insights on v2 fields (section 7). | Sonnet · medium |
| T7 | Labelling, temperature fit, agreement report (section 10). | Sonnet · high |
| T8 | Docs: `docs/workspace-dashboard.md`, CONCEPT.md privacy line, ADR superseding ADR-0068. | Sonnet · low |

## 14. Open questions

- Should `scope` move into `adherence` level descriptions to save options, if section 12.2 shows budget pressure?
- Is 1,500 bytes of `answerTail` enough context for `complaint`? Check on labelled data during T7.
- Codex, Copilot and Gemini equivalents for the section 6 signals and the D6 filter are unknown; they get model-only results until their formats are recorded.
