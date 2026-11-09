import { readUserData, writeUserData } from './user-store.js';
import { collectQuestions, hasModule, loadModule } from '../render/kit.js';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defaultQuestion } from '../interview/depth.js';
import { validAnswer } from '../interview/engine.js';

const FILE = 'setup-defaults.json';
const allowed = (q) => q.id.startsWith('quality.review-') || ['tasks.use-github', 'tasks.mode', 'idea.team', 'compact.levers'].includes(q.id);
export function setupDefaults({ env, kitRoot }, input = readUserData(env, FILE) ?? {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || (input.version !== undefined && input.version !== 1)) throw new Error('Invalid setup defaults');
  const names = readdirSync(join(kitRoot, 'modules')).filter((name) => hasModule(kitRoot, name));
  const questions = collectQuestions(kitRoot, names).filter(allowed).map(defaultQuestion);
  const modules = input.modules ?? [];
  const answers = input.answers ?? {};
  if (!Array.isArray(modules) || new Set(modules).size !== modules.length || modules.some((name) => !names.includes(name)) ||
      !answers || typeof answers !== 'object' || Array.isArray(answers) || Object.entries(answers).some(([id, value]) => !questions.some((q) => q.id === id && validAnswer(q, value)))) throw new Error('Invalid setup defaults');
  const availableModules = names.filter((name) => name !== 'core');
  const catalog = availableModules.map((name) => {
    const m = loadModule(kitRoot, name);
    return { name, title: m.title ?? name, group: m.group ?? 'basics', short: m.short ?? m.description,
      what: m.what ?? m.description, adds: m.adds ?? [], depends: m.depends ?? [] };
  });
  return { modules, answers, questions, availableModules, catalog };
}
export function saveSetupDefaults(ctx, input) {
  const result = setupDefaults(ctx, input);
  writeUserData(ctx.env, FILE, { version: 1, modules: result.modules, answers: result.answers });
  return result;
}
export function loadSetupDefaults(ctx) {
  try { return { ...setupDefaults(ctx), warning: null }; }
  catch { return { ...setupDefaults(ctx, {}), warning: 'Saved tool defaults are unreadable or invalid; optional tools start off. The saved file was left untouched.' }; }
}
