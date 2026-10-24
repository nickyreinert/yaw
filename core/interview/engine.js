// CLI interview engine (Y-3.3, doc 02 §3, doc 03 intro).
//
// Questions come in batches of at most 6 per section. Each shows its default in brackets:
//   Enter   takes the default (counts as answered)
//   skip    takes the default and lists the question as "default" in the summary
//   ?       shows the help text
//   w / web (yaw init only) continues in the browser form with the answers so far (#162)
// Questions of a mode that is not asked, and nothing else, are defaulted the same way. The engine only
// returns answers; writing them is the caller's job after the user confirmed.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLAIN } from '../cli/style.js';

export const MAX_BATCH = 6;

const SECTION_TITLES = {
  user: 'About you',
  idea: 'The idea',
  arch: 'Stack',
  quality: 'Quality',
  tasks: 'Tasks',
  team: 'Team',
};

// Q is asked in every mode, S in standard and full, F only in full.
export function asksIn(questionMode, setupMode) {
  if (questionMode === 'Q') return true;
  if (questionMode === 'S') return setupMode === 'standard' || setupMode === 'full';
  return setupMode === 'full';
}

// when: { id: value | [values] } against earlier answers.
export function whenMatches(when, answers) {
  if (!when) return true;
  return Object.entries(when).every(([id, wanted]) => {
    const accepted = Array.isArray(wanted) ? wanted : [wanted];
    const have = answers[id];
    return Array.isArray(have) ? have.some((v) => accepted.includes(v)) : accepted.includes(have);
  });
}

// Consecutive questions of one section form a batch, split at MAX_BATCH.
export function batchesOf(questions) {
  const batches = [];
  for (const q of questions) {
    const section = q.id.split('.')[0];
    const last = batches[batches.length - 1];
    if (last && last.section === section && last.questions.length < MAX_BATCH) last.questions.push(q);
    else batches.push({ section, title: SECTION_TITLES[section] ?? section, questions: [q] });
  }
  return batches;
}

const choiceValue = (c) => (typeof c === 'object' ? c.value : c);
const choiceLabel = (c) => (typeof c === 'object' && c.label ? c.label : String(choiceValue(c)));
const available = (c) => !(typeof c === 'object' && c.phase && c.phase > 1);

export function validAnswer(q, value) {
  const allowed = (v) => (q.choices ?? []).some((c) => available(c) && choiceValue(c) === v);
  switch (q.type) {
    case 'text': return typeof value === 'string';
    case 'boolean': return typeof value === 'boolean';
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'choice': return allowed(value);
    case 'multi': return Array.isArray(value) && new Set(value).size === value.length && value.every(allowed);
    default: return false;
  }
}

function formatDefault(q) {
  const d = q.default;
  if (Array.isArray(d)) return d.join(', ');
  return d === null || d === '' ? '' : String(d);
}

// Parse one reply. -> { value } | { error } | { help: true } | { skip: true }
export function parseReply(q, reply) {
  const text = reply.trim();
  if (text === '?') return { help: true };
  if (text.toLowerCase() === 'skip') return { skip: true };
  if (text === '') return { value: q.default };
  const pick = (token) => {
    const choices = q.choices.filter(available);
    const t = token.trim();
    if (/^[0-9]+$/.test(t) && Number(t) >= 1 && Number(t) <= q.choices.length) {
      const c = q.choices[Number(t) - 1];
      return available(c) ? { value: choiceValue(c) } : { error: `"${choiceLabel(c)}" is not available yet` };
    }
    const hit = choices.find((c) => String(choiceValue(c)).toLowerCase() === t.toLowerCase());
    if (hit) return { value: choiceValue(hit) };
    const later = q.choices.find((c) => !available(c) && String(choiceValue(c)).toLowerCase() === t.toLowerCase());
    return { error: later ? `"${choiceLabel(later)}" is not available yet` : `"${t}" is not one of: ${choices.map((c) => choiceValue(c)).join(', ')}` };
  };
  switch (q.type) {
    case 'text':
      return { value: text };
    case 'choice':
      return pick(text);
    case 'multi': {
      const values = [];
      for (const token of text.split(',')) {
        const r = pick(token);
        if (r.error) return r;
        if (!values.includes(r.value)) values.push(r.value);
      }
      return { value: values };
    }
    case 'boolean':
      if (/^(y|yes|true)$/i.test(text)) return { value: true };
      if (/^(n|no|false)$/i.test(text)) return { value: false };
      return { error: 'answer y or n' };
    case 'number': {
      const n = Number(text);
      return Number.isFinite(n) ? { value: n } : { error: 'answer with a number' };
    }
    default:
      return { error: `unsupported question type "${q.type}"` };
  }
}

function helpText(q, kitRoot) {
  const parts = [];
  if (q.help && kitRoot) {
    const file = join(kitRoot, 'interview', 'help', `${q.help}.md`);
    if (existsSync(file)) parts.push(readFileSync(file, 'utf8').trim());
  }
  if (q.hint) parts.push(q.hint);
  return parts.length > 0 ? parts.join('\n\n') : 'No further help for this question. Enter takes the default, skip lists it as "default".';
}

const isDefault = (q, value) => (Array.isArray(q.default) ? q.default.includes(value) : q.default === value);

// style: plain text unless the prompter colours its terminal (#163); the default choice is green.
function render(q, number, total, expertise, style) {
  const lines = [`  ${style.dim(`${number}/${total}`)} ${style.bold(q.label)}`];
  // Expert: hints are collapsed behind "?" (doc 02 section 4).
  if (q.hint && expertise !== 'expert') lines.push(`      ${style.dim(q.hint)}`);
  // A runtime status (e.g. the GitHub check, #166) is always shown.
  if (q.status) lines.push(`      ${style.yellow(q.status)}`);
  if (q.choices) {
    q.choices.forEach((c, i) => {
      const label = typeof c === 'object' && c.label ? ` - ${c.label}` : '';
      if (!available(c)) {
        lines.push(style.dim(`      ${i + 1}) ${choiceValue(c)}${label} (phase ${c.phase}, not available yet)`));
        return;
      }
      const value = isDefault(q, choiceValue(c)) ? style.green(style.bold(choiceValue(c))) : choiceValue(c);
      lines.push(`      ${style.cyan(`${i + 1})`)} ${value}${label}`);
    });
  }
  return lines.join('\n');
}

// Expertise levels (ADR-0042). The level comes from the answer to user.expertise (or `known`), intermediate until then.
//   layperson     help text of a question is shown before it is asked; F questions take their default (listed as such)
//   intermediate  help on request ("?"); every question of the mode is asked
//   expert        like intermediate, hints collapsed behind "?"
export const EXPERTISE_LEVELS = ['layperson', 'intermediate', 'expert'];
const expertiseOf = (answers) => (EXPERTISE_LEVELS.includes(answers['user.expertise']) ? answers['user.expertise'] : 'intermediate');

// questions: all questions of the enabled modules (base first). mode: quick | standard | full.
// known: answers that already exist; only used to evaluate `when`, never returned.
// allowWeb: "w" or "web" stops the interview (#162) -> { answers so far, defaulted, web: true }; the caller hands over to the form.
// -> { answers, defaulted: string[] }  (answers hold every question whose `when` holds, defaults included)
export async function runInterview({ questions, mode, prompter, kitRoot, known = {}, allowWeb = false }) {
  const answers = {};
  const seen = () => ({ ...known, ...answers }); // `when` may refer to answers given earlier (yaw add)
  const defaulted = [];
  const asked = questions.filter((q) => asksIn(q.mode, mode));
  const askedIds = new Set(asked.map((q) => q.id));
  const total = asked.length;
  let number = 0;
  const batches = batchesOf(asked);
  const ordered = () => {
    // Keep the order of the question list so the answers file does not depend on the order of replies.
    const out = {};
    for (const q of questions) if (Object.hasOwn(answers, q.id)) out[q.id] = answers[q.id];
    return out;
  };
  const options = '? help, skip';
  const style = prompter.style ?? PLAIN;
  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    prompter.show(`\n${style.bold(batch.title)} ${style.dim(`(${b + 1}/${batches.length})`)}\n`);
    for (const q of batch.questions) {
      if (!whenMatches(q.when, seen())) continue;
      const expertise = expertiseOf(seen());
      if (expertise === 'layperson' && q.mode === 'F') {
        answers[q.id] = q.default;
        defaulted.push(q.id);
        continue;
      }
      number++;
      prompter.show(`${render(q, number, total, expertise, style)}\n`);
      if (allowWeb) prompter.show(`      ${style.cyan('w)')} Continue in the browser\n`);
      // Up and down move through the available choices, starting from the default (#163).
      const values = (q.choices ?? []).filter(available).map(choiceValue);
      if (allowWeb) values.push('w');
      const keys = { choices: values, start: values.findIndex((v) => isDefault(q, v)) };
      if (expertise === 'layperson' && q.help) prompter.show(`\n${helpText(q, kitRoot)}\n\n`);
      for (;;) {
        const reply = await prompter.ask(`      [${style.green(formatDefault(q))}] ${style.dim(`(${options})`)} > `, keys);
        if (allowWeb && ['w', 'web'].includes(reply.trim().toLowerCase())) return { answers: ordered(), defaulted, web: true };
        const r = parseReply(q, reply);
        if (r.help) {
          prompter.show(`\n${helpText(q, kitRoot)}\n\n`);
        } else if (r.error) {
          prompter.show(`      ${r.error}\n`);
        } else if (r.skip) {
          answers[q.id] = q.default;
          defaulted.push(q.id);
          break;
        } else {
          answers[q.id] = r.value;
          break;
        }
      }
    }
  }
  // Questions this mode does not ask take their default and are listed as such.
  for (const q of questions) {
    if (askedIds.has(q.id) || !whenMatches(q.when, seen())) continue;
    answers[q.id] = q.default;
    defaulted.push(q.id);
  }
  return { answers: ordered(), defaulted };
}
