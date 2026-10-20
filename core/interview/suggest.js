// Rule-based profile suggestion (Y-3.6, doc 02 §1): no LLM, same input gives the same output.
//
// A profile is a candidate when none of its suggestWhen facts contradicts the known facts and at
// least one matches. The suggestion is the candidate with the most matches; a tie means no suggestion
// (the user chooses). Candidates are ordered by matches, then by name.

import { matchFacts } from './facts.js';

// profiles: [{ name, summary, suggestWhen }] -> { suggestion: name | null, candidates: [{ name, matched }] }
export function suggestProfiles(profiles, facts) {
  const candidates = [];
  for (const p of profiles) {
    const { matched, mismatched } = matchFacts(p.suggestWhen, facts);
    if (mismatched === 0 && matched > 0) candidates.push({ name: p.name, matched });
  }
  candidates.sort((a, b) => b.matched - a.matched || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const suggestion = candidates.length > 0 && (candidates.length === 1 || candidates[0].matched > candidates[1].matched)
    ? candidates[0].name
    : null;
  return { suggestion, candidates };
}
