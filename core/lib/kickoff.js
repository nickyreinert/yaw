// Kickoff guidance (#173): a planning prompt built from the interview answers, and a parser for the plan the
// user pastes back. The plan format is the one the prompt asks for; the parser accepts small deviations.

import { EFFORTS } from './tasks.js';

export const PLAN_FILE = 'docs/plan/kickoff.md';

const TASK_TARGET = {
  local: 'local tasks in TASKS.md',
  both: 'local tasks in TASKS.md, mirrored to GitHub issues',
  github: 'GitHub issues',
};

// answers: the answers of .yaw/answers.yaml; summary: the confirmed proposal summary (profile - description).
// stack (web setup, before the stack is chosen): { languages, hosts } as [{ value, label }]; the prompt then also asks
// for the idea in business words and a stack recommendation, in a format parseKickoffReply understands.
export function kickoffPrompt({ answers = {}, summary = '', tasksMode = 'local', stack = null } = {}) {
  const idea = String(answers['idea.text'] ?? '').trim() || '(describe the idea here)';
  const facts = [
    summary && `- Stack: ${summary}`,
    !stack && answers['arch.language'] && `- Language: ${answers['arch.language']}`,
    !stack && answers['arch.runs-on'] && `- Runs on: ${answers['arch.runs-on']}`,
    answers['idea.team'] && `- Team: ${answers['idea.team']}`,
    `- Work items become ${TASK_TARGET[tasksMode] ?? TASK_TARGET.local}`,
  ].filter(Boolean);
  return [
    'You are a senior software architect. Turn the idea below into a step-by-step build plan for coding agents.',
    '',
    'Idea:',
    idea,
    '',
    'Project facts:',
    ...facts,
    '',
    'Rules for the plan:',
    '- Split the work into 3 to 8 phases, from a thin working slice to the finished product.',
    '- Each phase has a goal, a suggested model tier and a reasoning effort, and 2 to 8 tasks.',
    '- Model tiers: a frontier model (for example opus) for architecture and hard problems, a mid tier (for example sonnet) for normal features, a small model (for example haiku) for routine edits.',
    `- Reasoning effort is one of: ${EFFORTS.join(', ')}.`,
    '- Each task is one small, testable change with a short imperative title (at most 80 characters).',
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
    '## Phase 1: <phase name>',
    'model: <tier> · effort: <effort>',
    'Goal: <one sentence>',
    '',
    '- [ ] <task title>',
    '- [ ] <task title> (model: <tier> · effort: <effort>)',
    '',
    '## Phase 2: <phase name>',
    '...',
  ].join('\n');
}

export function kickoffGuide({ tasksMode = 'local', hasTasks = true } = {}) {
  const target = hasTasks ? TASK_TARGET[tasksMode] ?? TASK_TARGET.local : null;
  return [
    'Copy the prompt below into a chat with a strong model (only if the idea is not confidential); answer its questions until you get the plan.',
    `Save the plan as ${PLAN_FILE} (docs/plan/ holds temporary plans; delete the file when the work is done).`,
    hasTasks
      ? `Check it with yaw kickoff import ${PLAN_FILE} --dry-run, then run it without --dry-run: each task becomes one of the ${target}, with its model tier and effort.`
      : `Turn the plan into tasks: add the tasks module (yaw add tasks), then run yaw kickoff import ${PLAN_FILE}.`,
    'Then start a cheap agent (a small model) and let it work through the tasks in order; switch to the suggested tier when a task asks for it.',
    'Show the prompt again any time: yaw kickoff.',
  ];
}

export class PlanError extends Error {}

const HEADING = /^##\s+(.+?)\s*$/;
const stripFence = (text) => {
  const m = /^\s*```[a-z]*\r?\n([\s\S]*?)\r?\n```\s*$/i.exec(text);
  return m ? m[1] : text;
};
// The answer of the planning chat -> { idea, language, runsOn, tasks, warnings }. Idea and Stack sections are
// optional; the tasks come from the Phase sections like `yaw kickoff import`. stack: { languages, hosts } (the
// accepted values); a value outside the lists is dropped with a warning, never guessed.
export function parseKickoffReply(raw, { languages = [], hosts = [] } = {}) {
  const text = stripFence(String(raw ?? '')).replace(/\r\n/g, '\n');
  const sections = new Map();
  const rest = [];
  let current = null;
  for (const line of text.split('\n')) {
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
  try { tasks = parsePlan(rest.join('\n')); } catch (e) { if (!(e instanceof PlanError)) throw e; warnings.push(e.message); }
  if (idea === '' && language === null && runsOn === null && tasks.length === 0) throw new PlanError('nothing found: the answer needs an "## Idea" section, a "## Stack" section or "## Phase" sections with "- [ ] task" lines');
  return { idea: idea.slice(0, 8000), language, runsOn, tasks, warnings, text };
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
  let fence = false;
  const lines = String(text).split(/\r?\n/);
  lines.forEach((raw, i) => {
    const where = `line ${i + 1}`;
    if (/^\s*```/.test(raw)) fence = !fence;
    if (fence || /^\s*```/.test(raw)) return;
    const h = PHASE.exec(raw);
    if (h && /^(idea|stack)$/i.test(h[1])) { phase = null; current = null; return; }
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
    if (indented) return;
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
