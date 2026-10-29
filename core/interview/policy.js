// Pure interview rules shared by the terminal, server and browser (ADR-0072).
import { asksAtDepth } from './depth.js';
export const PERSONAL_PREFERENCES = ['user.expertise', 'user.language', 'user.autonomy', 'user.length', 'user.register', 'user.examples', 'user.explain'];
export const isPreference = (q) => PERSONAL_PREFERENCES.includes(typeof q === 'string' ? q : q.id);
export function orderSetupQuestions(questions) {
  const rank = (q) => q.id.startsWith('user.') && (isPreference(q) || q.id === 'user.agents') ? 0 : q.id.startsWith('idea.') ? 1 : q.id.startsWith('arch.') ? 2 : 3;
  return [...questions].sort((a, b) => rank(a) - rank(b));
}
export const isPersonal = (q) => q.scope === 'user' && q.id !== 'user.agents';
export const asksIn = (q, mode) => q.reviewSelected || isPersonal(q) && q.reviewPersonal ? true : isPreference(q) && mode === 'basic' ? true : asksAtDepth(q, mode);
export const resolved = (q, value) => !q.required || (typeof value === 'string' && value.trim().length > 0);
export const missingAnswers = (questions, answers) => questions.filter((q) => !resolved(q, answers[q.id])).map((q) => q.id);
export const sourceOf = (q, used) => used ? 'answered' : q.defaultSource ?? 'documented default';

// Deployment context, independent of language. Every offered language supports external dependencies.
export const HOSTED_RUNTIMES = ['self-hosted', 'serverless', 'edge', 'static'];
export function runtimeContext(answers = {}) {
  const hosting = HOSTED_RUNTIMES.includes(answers['arch.runs-on']);
  const paidComponents = hosting || ['commercial-allowed', 'no-preference'].includes(answers['arch.libraries'])
    || ['approved-only', 'allowed', 'no-preference'].includes(answers['arch.services']);
  return { hosting, paidComponents };
}
export function architectureApplies(id, answers = {}) {
  const context = runtimeContext(answers);
  if (id === 'arch.hosting-control') return context.hosting;
  if (id === 'arch.cost') return context.paidComponents;
  if (id === 'arch.cost-limit') return context.paidComponents && answers['arch.cost'] === 'capped';
  return true;
}
export function questionApplies(q, answers = {}) {
  return architectureApplies(q.id, answers) && Object.entries(q.when ?? {}).every(([id, wanted]) => {
    const accepted = Array.isArray(wanted) ? wanted : [wanted];
    return Array.isArray(answers[id]) ? answers[id].some((v) => accepted.includes(v)) : accepted.includes(answers[id]);
  });
}
export const applicableArchitectureAnswers = (answers = {}) => Object.fromEntries(Object.entries(answers).filter(([id]) => architectureApplies(id, answers)));
