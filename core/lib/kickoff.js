// Kickoff guidance (#173): a planning prompt built from the interview answers, and a parser for the plan the
// user pastes back. The plan format is the one the prompt asks for; the parser accepts small deviations.

import { EFFORTS } from './tasks.js';
import { constraintFacts, FOUNDATION_PATHS, PRACTICES, PRACTICES_VERSION } from './foundations.js';

export const PLAN_FILE = 'docs/plan/kickoff.md';

const TASK_TARGET = {
  local: 'local tasks in TASKS.md',
  both: 'local tasks in TASKS.md, mirrored to GitHub issues',
  github: 'GitHub issues',
};

// answers: the answers of .yaw/answers.yaml; summary: the confirmed proposal summary (profile - description).
// stack (web setup, before the stack is chosen): { languages, hosts } as [{ value, label }]; the prompt then also asks
// for the idea in business words and a stack recommendation, in a format parseKickoffReply understands.
export function kickoffPrompt({ answers = {}, summary = '', tasksMode = 'local', hasTasks = true, stack = null } = {}) {
  const idea = String(answers['idea.text'] ?? '').trim() || '(describe the idea here)';
  const facts = [
    summary && `- Stack: ${summary}`,
    !stack && answers['arch.language'] && `- Language: ${answers['arch.language']}`,
    !stack && answers['arch.runs-on'] && `- Runs on: ${answers['arch.runs-on']}`,
    answers['arch.framework'] && `- Required framework / existing stack: ${answers['arch.framework']}`,
    answers['idea.team'] && `- Team: ${answers['idea.team']}`,
    ...constraintFacts(answers),
    hasTasks ? `- Work items become ${TASK_TARGET[tasksMode] ?? TASK_TARGET.local}` : '- Tasks are not enabled; keep work items in the reviewed plan until the tasks module is explicitly added.',
  ].filter(Boolean);
  return [
    `YAW guided kickoff prompt, version ${PRACTICES_VERSION}. Draft project foundations, review them with me, then derive a build plan for coding agents.`,
    PRACTICES,
    '',
    'Idea:',
    idea,
    '',
    'Project facts:',
    ...facts,
    '',
    'Rules for the plan:',
    '- First ask for existing authoritative architecture/domain, data model, UI/UX documents, relevant decisions and selected knowledge. Reuse their paths; do not create competing specifications. Read only material I select. Preview exactly what I would copy to another model; exclude secrets.',
    '- Draft architecture (purpose, users, domain rules, boundaries, runtime, constraints), data-model (contracts, ownership, invariants, access, lifecycle, compatibility), and ui-ux (main tasks, flows, realistic content, empty/error/recovery states, accessibility, observable review criteria). Link shared concepts rather than duplicating rules.',
    '- Treat hosting control, libraries, external application services and cost as separate project constraints. Self-hosting can use third-party open-source libraries; an open-source component can still require paid hosting or operations. Respect on-premises/network and data boundaries independently of the runtime profile. Ask about unknowns and conflicts before committing to an architecture. "No preference" invites a recommendation with rationale; "undecided" needs discussion. Neither authorizes a purchase or provisioning.',
    '- Compare build versus reuse within those constraints. For external or paid components, explain data flows, maintenance, applicable license constraints, recurring and one-off costs, free-tier limits, trial expiry, overage and an exit/export option. A missing budget cap needs clarification; never infer a subscription, credit-card, purchase or provisioning approval. Record agreed choices and rationale in the architecture foundation.',
    '- Label supplied facts, recommendations, untested assumptions and unresolved choices. Review the connected foundations with me before planning; resolve blocking choices and give remaining uncertainty an owner or follow-up task. A model draft alone is not agreed ground truth.',
    '- Scale to the project: a tiny CLI needs only a few bullets and command/error UX; no persistence needs an explicit reason and input/output rules; a machine-only API may mark human UI not applicable and link its contract. Do not fabricate screens or storage.',
    '- Offer an optional UX walkthrough: start with user evidence, test the main task including failure with realistic content, consider applicable accessibility criteria, and propose a small prototype or user validation for the riskiest assumption. Visual direction follows interaction needs. Guidance: https://www.gov.uk/service-manual/user-research/start-by-learning-user-needs and https://www.w3.org/WAI/WCAG22/quickref/ .',
    '- Before substantial UI implementation, offer a small example to review: a rough wireframe, screen mockup or clickable prototype. Mockups cover layout as well as colours: content hierarchy, navigation, placement and grouping of controls, realistic content, narrow/wide arrangements and important interaction states. Review structure and the main flow before polishing colour, typography and spacing. Link the accepted example from ui-ux.md and derive implementation criteria from it; visual approval alone does not prove usability or accessibility. For CLI UX, example help/output and a sample interaction can serve the same purpose.',
    '- Split the work into 3 to 8 phases, from a thin working slice to the finished product.',
    '- Each phase has a goal, a suggested model tier and a reasoning effort, and 2 to 8 tasks.',
    '- Model tiers: a frontier model (for example opus) for architecture and hard problems, a mid tier (for example sonnet) for normal features, a small model (for example haiku) for routine edits.',
    `- Reasoning effort is one of: ${EFFORTS.join(', ')}.`,
    '- Each task is one small, testable change with a short imperative title (at most 80 characters).',
    '- Under every task include spec: <authoritative path#section> and acceptance: <observable outcome>. Use only reviewed foundation paths. Keep foundation documents after the temporary plan is removed.',
    '- Fence each new foundation as Markdown; use four or more backticks around a document containing triple-backtick code examples.',
    '- A task may override the phase model when it is clearly easier or harder.',
    '- Ask me questions first if the idea is too vague to plan.',
    ...(stack ? [
      '- Recommend exactly one stack for this idea: the simplest one that fits. Use only the values below.',
      '',
      `Languages: ${stack.languages.map((l) => `${l.value} (${l.label})`).join('; ')}`,
      `Runs on: ${stack.hosts.map((h) => `${h.value} (${h.label})`).join('; ')}`,
    ] : []),
    '',
    'Answer with Markdown in exactly this format and nothing else:',
    '',
    '# Plan: <project name>',
    'kickoff-format: 1',
    '',
    ...(stack ? [
      '## Idea',
      '<3 to 6 sentences in plain business words: what it is, who it is for, which problem it solves>',
      '',
      '## Stack',
      'language: <one language value from the list>',
      'runs-on: <one runs-on value from the list>',
      'why: <one sentence>',
      '',
    ] : []),
    ...Object.entries(FOUNDATION_PATHS).flatMap(([kind, path]) => [
      `## Foundation: ${kind}`, `path: ${path}`, 'action: create', '```markdown',
      `# ${kind}`, '<reviewed project-specific rules; distinguish assumptions and link decisions>', '```', '',
    ]),
    'For an established document use action: reuse and its actual path, with no fenced content.',
    '',
    '## Phase 1: <phase name>',
    'model: <tier> · effort: <effort>',
    'Goal: <one sentence>',
    '',
    '- [ ] <task title>',
    '  spec: docs/spec/architecture.md#section',
    '  acceptance: <observable outcome>',
    '- [ ] <task title> (model: <tier> · effort: <effort>)',
    '  spec: docs/spec/ui-ux.md#section',
    '  acceptance: <observable outcome>',
    '',
    '## Phase 2: <phase name>',
    '...',
  ].join('\n');
}

export function kickoffGuide({ tasksMode = 'local', hasTasks = true } = {}) {
  const target = hasTasks ? TASK_TARGET[tasksMode] ?? TASK_TARGET.local : null;
  return [
    'Use the prompt manually, with your configured local model, or copy it into your chosen chat (only if the idea is not confidential). Review the exact material before sharing it; nothing is sent automatically.',
    'Review the three project foundations and any reused documents before accepting the plan. Generic YAW practices guide the work within these project rules; surface conflicts for a decision.',
    `Save the plan as ${PLAN_FILE} (docs/plan/ holds temporary plans; delete the file when the work is done).`,
    hasTasks
      ? `Check it with yaw kickoff import ${PLAN_FILE} --dry-run, then run it with --reviewed after reviewing the documents: each task becomes one of the ${target}, with its model tier and effort.`
      : `Review and import the foundations: yaw kickoff import ${PLAN_FILE} --dry-run, then --reviewed. To create tasks, add the tasks module (yaw add tasks) and import again.`,
    'Then start a cheap agent (a small model) and let it work through the tasks in order; switch to the suggested tier when a task asks for it.',
    'Show the prompt again any time: yaw kickoff.',
  ];
}

export class PlanError extends Error {}

const HEADING = /^##\s+(.+?)\s*$/;
const openFence = (line) => {
  const m = /^\s*(`{3,}|~{3,})[^`~]*$/.exec(line);
  return m ? { char: m[1][0], length: m[1].length } : null;
};
const closesFence = (line, fence) => new RegExp(`^\\s*${fence.char}{${fence.length},}\\s*$`).test(line);
const stripFence = (text) => {
  const lines = text.trim().split(/\r?\n/);
  const fence = openFence(lines[0]);
  return fence && lines.length > 1 && closesFence(lines.at(-1), fence) ? lines.slice(1, -1).join('\n') : text;
};

// Foundation bodies are fenced so their headings and bullet rules can never become tasks.
export function parseFoundations(text) {
  const marker = /^kickoff-format:\s*(\S+)\s*$/m.exec(text);
  const hasSections = /^## Foundation:/m.test(text);
  if (!marker && !hasSections) return [];
  if (marker?.[1] !== '1') throw new PlanError('Foundations require kickoff-format: 1.');
  const documents = [];
  let current = null, fence = null, body = [];
  for (const raw of text.split('\n')) {
    if (fence) {
      if (closesFence(raw, fence)) { fence = null; if (current) current.text = body.join('\n'); body = []; }
      else if (current) body.push(raw);
      continue;
    }
    const opening = openFence(raw);
    if (opening) {
      if (current?.text !== undefined) throw new PlanError('Only one Markdown body per foundation.');
      fence = opening; continue;
    }
    const heading = HEADING.exec(raw);
    if (heading) {
      const kind = /^Foundation:\s*(\S+)\s*$/.exec(heading[1])?.[1];
      current = kind ? { kind } : null;
      if (current) documents.push(current);
      continue;
    }
    if (!current) continue;
    const field = /^(path|action):\s*(.+?)\s*$/.exec(raw);
    if (field) { if (current[field[1]] !== undefined) throw new PlanError('Duplicate foundation field.'); current[field[1]] = field[2]; }
  }
  if (fence || documents.length !== 3 || new Set(documents.map((d) => d.kind)).size !== 3 ||
      documents.some((d) => !Object.hasOwn(FOUNDATION_PATHS, d.kind) || !d.path || !['create', 'reuse'].includes(d.action) ||
        (d.action === 'create' ? !d.text?.trim() : d.text !== undefined))) throw new PlanError('Provide all three foundations with a path and action: create (fenced Markdown) or reuse (no body).');
  return documents;
}
// The answer of the planning chat -> { idea, language, runsOn, tasks, warnings }. Idea and Stack sections are
// optional; the tasks come from the Phase sections like `yaw kickoff import`. stack: { languages, hosts } (the
// accepted values); a value outside the lists is dropped with a warning, never guessed.
export function parseKickoffReply(raw, { languages = [], hosts = [] } = {}) {
  const text = stripFence(String(raw ?? '')).replace(/\r\n/g, '\n');
  const foundations = parseFoundations(text);
  const sections = new Map();
  const rest = [];
  let current = null;
  let fence = null;
  for (const line of text.split('\n')) {
    if (fence) { rest.push(line); if (closesFence(line, fence)) fence = null; continue; }
    const opening = openFence(line);
    if (opening) { fence = opening; rest.push(line); continue; }
    const h = HEADING.exec(line);
    if (h && /^(idea|stack)$/i.test(h[1])) { current = h[1].toLowerCase(); sections.set(current, []); continue; }
    if (h) current = null;
    if (current) sections.get(current).push(line); else rest.push(line);
  }
  const warnings = [];
  const idea = (sections.get('idea') ?? []).join('\n').trim();
  const value = (list, given) => {
    const g = String(given ?? '').trim().toLowerCase();
    return list.find((x) => x.value.toLowerCase() === g)?.value ?? list.find((x) => g !== '' && x.label.toLowerCase().startsWith(g))?.value ?? null;
  };
  const stackLines = sections.get('stack') ?? [];
  const field = (...names) => stackLines.map((l) => /^[-*\s]*([a-z -_]+?)\s*:\s*(.+?)\s*$/i.exec(l)).find((m) => m && names.includes(m[1].toLowerCase().replace(/[ _]/g, '-')))?.[2];
  let language = null;
  let runsOn = null;
  if (stackLines.length > 0) {
    language = value(languages, field('language'));
    runsOn = value(hosts, field('runs-on', 'runs', 'hosting'));
    if (language === null) warnings.push('No usable language in the Stack section; choose it in step 4.');
    if (runsOn === null) warnings.push('No usable "runs-on" value in the Stack section; choose it in step 4.');
  }
  let tasks = [];
  try { tasks = parsePlan(rest.join('\n')); } catch (e) { if (!(e instanceof PlanError) || !e.message.startsWith('no tasks found')) throw e; warnings.push(e.message); }
  if (foundations.length) {
    for (const t of tasks) {
      if (!t.spec || !t.acceptance || !foundations.some((d) => t.spec.split('#')[0] === d.path)) throw new PlanError(`Task "${t.title}" needs spec: <foundation path#section> and acceptance: <observable outcome>.`);
    }
  }
  if (idea === '' && language === null && runsOn === null && tasks.length === 0 && !foundations.length) throw new PlanError('nothing found: the answer needs an "## Idea" section, a "## Stack" section or "## Phase" sections with "- [ ] task" lines');
  return { idea: idea.slice(0, 8000), language, runsOn, tasks, foundations, warnings, text };
}

const PHASE = /^##\s+(.+?)\s*$/;
const MODEL = /^model:\s*([^·,;()]+?)\s*(?:[·,;]\s*effort:\s*(\S+?))?\s*$/i;
const TASK = /^[-*]\s+(?:\[([ xX])\]\s+)?(.+?)\s*$/;
const TASK_MODEL = /\s*\(\s*(model:[^)]*)\)\s*$/i;

function model(text, where) {
  const m = MODEL.exec(text.trim());
  if (!m) return null;
  const tier = m[1].trim();
  const effort = m[2]?.toLowerCase();
  if (effort !== undefined && !EFFORTS.includes(effort)) throw new PlanError(`${where}: effort "${m[2]}" must be one of ${EFFORTS.join(', ')}`);
  return { model: tier, ...(effort ? { effort } : {}) };
}

// Plan Markdown -> [{ phase, title, model?, effort? }]; tasks outside a phase, in code blocks or checked
// as done ([x]) are ignored. An indented model line belongs to the task right above it.
export function parsePlan(text) {
  const tasks = [];
  let phase = null;
  let current = null;
  let fence = null;
  const lines = String(text).split(/\r?\n/);
  lines.forEach((raw, i) => {
    const where = `line ${i + 1}`;
    if (fence) { if (closesFence(raw, fence)) fence = null; return; }
    const opening = openFence(raw);
    if (opening) { fence = opening; return; }
    const h = PHASE.exec(raw);
    if (h && /^(idea|stack|foundation:.*)$/i.test(h[1])) { phase = null; current = null; return; }
    if (h) {
      phase = { name: h[1].replace(/^phase\s+\d+\s*[:.-]\s*/i, '').trim(), hint: {} };
      current = null;
      return;
    }
    if (!phase) return;
    const indented = /^\s+/.test(raw);
    const line = raw.trim();
    const hint = model(line, where);
    if (hint) {
      if (!indented) phase.hint = hint;
      else if (current) Object.assign(current, hint);
      return;
    }
    if (indented) {
      const field = /^(spec|acceptance):\s*(.+)$/.exec(line);
      if (current && field) current[field[1]] = field[2].trim();
      return;
    }
    const t = TASK.exec(line);
    current = null;
    if (!t || /x/i.test(t[1] ?? '')) return;
    let title = t[2];
    let own = {};
    const tm = TASK_MODEL.exec(title);
    if (tm) {
      own = model(tm[1], where) ?? {};
      title = title.slice(0, tm.index);
    }
    title = title.replace(/\s+/g, ' ').trim();
    if (title === '') return;
    current = { phase: phase.name, title, ...phase.hint, ...own };
    tasks.push(current);
  });
  if (tasks.length === 0) throw new PlanError('no tasks found; the plan needs "## Phase" headings with "- [ ] task" lines');
  return tasks;
}
