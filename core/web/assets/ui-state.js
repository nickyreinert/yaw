// Pure browser state helpers; also tested without a DOM.
import { asksIn, isPersonal, isPreference } from '../../interview/policy.js';
import { selectedByPolicy } from '../../interview/depth.js';
export { asksIn };
export const choiceValue = (c) => typeof c === 'object' ? c.value : c;
// The value stays visible (as in the terminal) unless the label already starts with it: "edge — code on a CDN ...".
export const choiceLabel = (c) => {
  if (typeof c !== 'object') return String(c);
  if (!c.label) return String(c.value);
  return c.label.toLowerCase().startsWith(String(c.value).toLowerCase()) ? c.label : `${c.value} — ${c.label}`;
};
export const available = (c) => !(typeof c === 'object' && c.phase > 1);
// Interview is opt-in within workspace Settings, never a path segment.
export function settingsRoute(page, tab, query = '') {
  const params = new URLSearchParams(query);
  if (page === 'settings') {
    if (tab === 'interview') params.set('interview', '');
    else params.delete('interview');
  }
  const suffix = params.toString().replace(/(^|&)interview=(?=&|$)/, '$1interview');
  return `${page}${tab && !['interview', 'project'].includes(tab) ? `/${tab}` : ''}${suffix ? `?${suffix}` : ''}`;
}
export const settingsPresentation = (tab, params = new URLSearchParams()) =>
  tab === 'interview' || params.has('interview') ? 'interview' : 'settings';
export function installDialogCancellation(dialog) {
  const cancel = (event) => {
    event.preventDefault();
    if (dialog.open) dialog.close('cancel');
  };
  dialog.addEventListener('cancel', cancel);
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') cancel(event);
  });
}
export function matches(when, answers) {
  return !when || Object.entries(when).every(([key, wanted]) => {
    const values = Array.isArray(wanted) ? wanted : [wanted];
    return Array.isArray(answers[key]) ? answers[key].some((v) => values.includes(v)) : values.includes(answers[key]);
  });
}
export function effectiveAnswers(questions, given, mode) {
  const answers = {};
  for (const asked of [true, false]) for (const q of questions) {
    if (asksIn(q, mode) !== asked || !matches(q.when, answers)) continue;
    const use = Object.hasOwn(given, q.id);
    answers[q.id] = use ? given[q.id] : q.default;
  }
  return answers;
}
export function visibleQuestions(questions, given, mode, modules) {
  const selected = questions.filter((q) => modules.includes(q.owner) || isPreference(q) && asksIn(q, mode) || ['pro', 'all'].includes(mode) && asksIn(q, mode));
  const answers = effectiveAnswers(selected, given, mode);
  return selected.filter((q) => !q.editHidden && asksIn(q, mode) && matches(q.when, answers));
}
export function defaultModules(definitions, questions, given, mode) {
  const a = effectiveAnswers(questions, given, mode);
  if (['quick', 'basic', 'pro', 'all'].includes(mode)) return selectedByPolicy(definitions, { answers: a, modules: definitions.filter((d) => d.savedDefault).map((d) => d.name) });
  const facts = { team: ['team', 'external-reviewers'].includes(a['idea.team']), usesGitHub: a['tasks.use-github'] !== false };
  if (a['arch.language'] && a['arch.language'] !== 'auto') facts.language = a['arch.language'];
  if (a['arch.runs-on'] && a['arch.runs-on'] !== 'auto') {
    facts.runsOn = a['arch.runs-on'];
    facts.hosted = facts.runsOn !== 'local';
  }
  if (a['idea.audience']) facts.public = a['idea.audience'] === 'public';
  const matchFacts = (condition) => {
    let matched = 0, mismatched = 0;
    for (const [key, wanted] of Object.entries(condition ?? {})) {
      if (!Object.hasOwn(facts, key)) continue;
      if ((Array.isArray(wanted) ? wanted : [wanted]).includes(facts[key])) matched++;
      else mismatched++;
    }
    return { matched, mismatched };
  };
  return definitions.filter((d) => {
    if (matchFacts(d.appliesTo).mismatched) return false;
    const rule = d.defaults[mode];
    return rule === true || (rule && typeof rule === 'object' && !matchFacts(rule).mismatched && matchFacts(rule).matched);
  }).map((d) => d.name);
}
export function toggleModules(definitions, selected, name, enabled) {
  const defs = new Map(definitions.map((d) => [d.name, d]));
  const next = new Set(selected);
  const add = (n) => {
    if (next.has(n)) return;
    next.add(n);
    for (const dep of defs.get(n).depends ?? []) add(dep);
  };
  if (enabled) add(name);
  else {
    next.delete(name);
    let changed;
    do {
      changed = false;
      for (const n of next) if (defs.get(n).depends.some((d) => !next.has(d))) {
        next.delete(n);
        changed = true;
      }
    } while (changed);
  }
  return definitions.map((d) => d.name).filter((n) => next.has(n));
}
