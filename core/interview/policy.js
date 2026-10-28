// Pure interview rules shared by the terminal, server and browser (ADR-0072).
import { asksAtDepth } from './depth.js';
export const isPersonal = (q) => q.scope === 'user' && q.id !== 'user.agents';
export const asksIn = (q, mode) => isPersonal(q) && q.reviewPersonal ? true : asksAtDepth(q, mode);
export const resolved = (q, value) => !q.required || (typeof value === 'string' && value.trim().length > 0);
export const missingAnswers = (questions, answers) => questions.filter((q) => !resolved(q, answers[q.id])).map((q) => q.id);
export const sourceOf = (q, used) => used ? 'answered' : q.defaultSource ?? 'documented default';
