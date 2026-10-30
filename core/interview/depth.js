// Shared terminal/browser contract. Old file values remain readable.
export const DEPTHS = [
  { value: 'quick', label: 'Quick', description: 'Agents, purpose, stack and GitHub. Saved defaults for the rest.' },
  { value: 'basic', label: 'Basic', description: 'Quick plus personal preferences, collaboration and review gates.' },
  { value: 'pro', label: 'All', description: 'Every applicable question and optional tool.' },
];
export const depthOf = (mode) => ({ full: 'pro', standard: 'pro', all: 'pro' }[mode] ?? mode);
export const depthLabel = (mode) => DEPTHS.find((depth) => depth.value === depthOf(mode))?.label ?? mode;
export const validDepth = (mode) => ['quick', 'basic', 'pro'].includes(depthOf(mode));
export const RETIRED_ARCHITECTURE = new Set(['arch.framework', 'arch.hosting-control', 'arch.libraries', 'arch.services', 'arch.cost', 'arch.cost-limit']);
export const BASIC_QUESTIONS = new Set(['user.agents', 'idea.team', 'tasks.use-github', 'tasks.mode', 'quality.review-quality', 'quality.review-logic', 'quality.review-ux', 'quality.review-feature', 'quality.review-security', 'quality.review-gate', 'arch.library-strategy', 'arch.docker', 'quality.error-detail', 'quality.log-output', 'quality.documentation', 'quality.unit-tests']);
export function asksAtDepth(q, mode) {
  const depth = depthOf(mode);
  if (RETIRED_ARCHITECTURE.has(q.id)) return false;
  if (!q.id.includes('.')) return depth === 'pro' || q.mode === 'Q' || depth === 'basic' && q.mode === 'S';
  if (depth === 'pro') return true;
  if (q.required || ['user.agents', 'idea.text', 'arch.language', 'arch.runs-on', 'tasks.use-github'].includes(q.id)) return true;
  return depth === 'basic' && BASIC_QUESTIONS.has(q.id);
}
export function defaultQuestion(q) {
  if (/^quality\.review-(quality|logic|ux|feature|security)$/.test(q.id)) return { ...q, default: 'off' };
  if (['tasks.use-github', 'user.knowledge', 'user.dashboard'].includes(q.id)) return { ...q, default: false };
  if (['user.comfort', 'user.evaluation'].includes(q.id)) return { ...q, default: [] };
  return q;
}
// Explicit saved modules win. Fresh optional tools start off at every depth.
export function selectedByPolicy(definitions, { answers = {}, modules = [] } = {}) {
  const byName = new Map(definitions.map((d) => [d.name, d]));
  const chosen = new Set(['core', ...modules]);
  if (answers['tasks.use-github'] === true) chosen.add('github');
  if (['quality', 'logic', 'ux', 'feature', 'security'].some((kind) => answers[`quality.review-${kind}`] && answers[`quality.review-${kind}`] !== 'off')) chosen.add('review');
  const add = (name) => { for (const dep of byName.get(name)?.depends ?? []) if (!chosen.has(dep)) { chosen.add(dep); add(dep); } };
  for (const name of chosen) add(name);
  if (answers['tasks.use-github'] === false) for (const d of definitions) if (d.appliesTo?.usesGitHub === true) chosen.delete(d.name);
  return ['core', ...definitions.map((d) => d.name).filter((name) => name !== 'core' && chosen.has(name))];
}
