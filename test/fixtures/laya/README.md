# Laya fixtures (classification v2, spec section 12)

Recorded 2026-11-10 against a local `laya-serve` (multilingual, revision 85cc74dd, device mps), `POST /v1/systemone`.
States are made up; no transcript text. Each file holds `request`, `status` and `response`. Files with `-maxlen8192`
send YAW's `max_len`; the others use the server default. Both gave identical answers.

| File | Call |
|---|---|
| `assistant-call*.json` | assistant subject: `adherence` (5 levels + `not_applicable`), `scope`, `admission` = 13 options |
| `user-call*.json` | user subject: `verdict`, `frustration` (5 levels), `complaint` = 19 options, plus 5 `noul` tags |
| `user-call-long*.json` | the user call with a ~4.6 KB state (5,382 input tokens) |

## Findings

1. Response shape. A `choice` answer has `choice`, `probabilities` (one per option), `confidence`, `answer_confidence`,
   `x_jev_confidence`. A `noul` answer has `noul` (probability of yes) and no `probabilities`. There is no `abstain`
   field. `usage.truncated`, `usage.truncated_questions` and `routing.model` are present.
2. Budget. Both calls fit without truncation, also the long state, with and without `max_len: 8192`.
3. Batch. `/v1/systemone/batch` takes `states` plus one shared `questions` object: the assistant and user calls cannot
   be merged, but all exchanges of one subject in a session can go in one batch request.
4. Calibration. Only `/health`, `/v1/systemone` and `/v1/systemone/batch` exist; calibration is not reachable over HTTP.
5. Quality (zero-shot, these three cases):
   - A correct, complete answer got `adherence` 2 (p 0.53–0.58).
   - A shouted, repeated correction ("I SAID ONLY rename x!!! Revert the refactor, again.") got `frustration` 3 and
     `profanity_or_shouting` no (p 0.01–0.03).
   - With a long prompt and reply, "That is not what I asked, please revert." got `verdict` new_topic (p 0.97),
     `complaint` none (p 0.99), `stops_or_reverts` no: the reaction is lost in the long state, with high confidence.
   - Sending `state` as a JSON object instead of a string changed `scope` and `admission` to the right labels;
     one question per call gave the same answers as all questions in one call.
