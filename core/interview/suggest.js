// The stack (ADR-0054): language x runs-on picks exactly one profile. No LLM, no scoring: every pair
// belongs to at most one profile (profile.yaml `stack`); a pair without a profile is not covered by this kit, not necessarily impossible.

const covers = (p, language, runsOn) => Boolean(p.stack?.language?.includes(language) && p.stack?.runsOn?.includes(runsOn));

// -> profile | null
export function profileForStack(profiles, language, runsOn) {
  return profiles.find((p) => covers(p, language, runsOn)) ?? null;
}

// Hosting targets covered by this kit for a language, in the order of `hosts` (the arch.runs-on choices). -> [runsOn]
export function hostsFor(profiles, language, hosts) {
  return hosts.filter((h) => profiles.some((p) => covers(p, language, h)));
}

// The profile for answers (arch.language, arch.runs-on). -> { profile: name | null, reason }
export function stackProfile(profiles, answers = {}) {
  const language = answers['arch.language'];
  const runsOn = answers['arch.runs-on'];
  if (typeof language !== 'string' || typeof runsOn !== 'string') return { profile: null, reason: 'choose a language and where it runs' };
  const hit = profileForStack(profiles, language, runsOn);
  if (hit) return { profile: hit.name, reason: `${hit.stack.basic ? 'basic' : 'tailored'} stack for ${language} on ${runsOn}` };
  const fits = profiles.flatMap((p) => (p.stack?.language?.includes(language) ? p.stack.runsOn : []));
  return { profile: null, reason: fits.length ? `no YAW profile for ${language} on ${runsOn}; choose ${[...new Set(fits)].join(', ')}` : `no YAW profile for ${language}` };
}
