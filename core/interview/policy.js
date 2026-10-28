// Pure interview rules shared by the terminal, server and browser (ADR-0072).
import { asksAtDepth } from './depth.js';
export const PERSONAL_PREFERENCES = ['user.expertise', 'user.language', 'user.autonomy', 'user.length', 'user.register', 'user.examples', 'user.explain'];
export const isPreference = (q) => PERSONAL_PREFERENCES.includes(typeof q === 'string' ? q : q.id);
export const isPersonal = (q) => q.scope === 'user' && q.id !== 'user.agents';
export const asksIn = (q, mode) => q.reviewSelected || isPersonal(q) && q.reviewPersonal ? true : isPreference(q) && mode === 'basic' ? true : asksAtDepth(q, mode);
export const resolved = (q, value) => !q.required || (typeof value === 'string' && value.trim().length > 0);
export const missingAnswers = (questions, answers) => questions.filter((q) => !resolved(q, answers[q.id])).map((q) => q.id);
export const sourceOf = (q, used) => used ? 'answered' : q.defaultSource ?? 'documented default';
