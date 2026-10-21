// Derived facts (ADR-0017 §3) and the rule that matches a facts condition.
// Used for profile suggestion (suggestWhen) and module selection (appliesTo, default).

// Facts from answers. Only facts with a source in the asked questions are derived; "auto" and
// unanswered questions leave a fact unknown (never guessed).
export function deriveFacts(answers = {}) {
  const facts = {};
  const language = answers['arch.language'];
  if (typeof language === 'string' && language !== 'auto') facts.language = language;
  const runsOn = answers['arch.runs-on'];
  if (typeof runsOn === 'string' && runsOn !== 'auto') {
    facts.runsOn = runsOn;
    facts.hosted = runsOn !== 'local';
  }
  if (typeof answers['idea.audience'] === 'string') facts.public = answers['idea.audience'] === 'public';
  if (typeof answers['idea.team'] === 'string') facts.team = answers['idea.team'] === 'team';
  // GitHub is used unless the user says otherwise; a team project always uses it (ADR-0032).
  if (facts.team === true) facts.usesGitHub = true;
  else if (typeof answers['tasks.use-github'] === 'boolean') facts.usesGitHub = answers['tasks.use-github'];
  return facts;
}

// condition: { fact: value | [values] }. A fact that is unknown counts for neither side.
// -> { matched, mismatched }
export function matchFacts(condition = {}, facts = {}) {
  let matched = 0;
  let mismatched = 0;
  for (const [key, wanted] of Object.entries(condition)) {
    if (!Object.hasOwn(facts, key)) continue;
    const accepted = Array.isArray(wanted) ? wanted : [wanted];
    if (accepted.includes(facts[key])) matched++;
    else mismatched++;
  }
  return { matched, mismatched };
}
