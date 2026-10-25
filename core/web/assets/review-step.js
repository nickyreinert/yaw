// Review step: the answers and what YAW adds as bullet lists, each with a jump to where it is configured, and a
// file preview per module. DOM only through createElement (CSP: no innerHTML). Preview text is shown as text nodes.
import { el, radioChoices } from './setup-cards.js';

const SHORT = {
  'user.agents': 'Agents', 'user.expertise': 'Experience', 'user.language': 'Chat language', 'user.autonomy': 'Asks before acting',
  'user.length': 'Answer length', 'user.register': 'Wording', 'user.examples': 'Examples', 'user.explain': 'Explanations',
  'user.comfort': 'Comfort helpers', 'idea.text': 'Idea', 'idea.team': 'Team', 'tasks.use-github': 'GitHub', 'tasks.mode': 'Task tracking',
  'team.session-context': 'Issue at session start',
};
const ACTION = { create: 'new', update: 'changed', write: 'written', kept: 'kept', missing: 'restored', delete: 'removed' };

export function answerText(q, value) {
  if (q.type === 'boolean') return value === false || value === 'false' ? 'No' : 'Yes';
  const label = (v) => radioChoices(q.choices ?? []).find((c) => c.value === String(v))?.label ?? String(v);
  if (q.type === 'multi') return (value ?? []).length ? value.map(label).join(', ') : 'none';
  if (q.type === 'choice') return label(value);
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > 90 ? `${text.slice(0, 87)}…` : text || '—';
}

const editButton = (what, onclick) => el('button', { type: 'button', class: 'link', 'aria-label': `Edit ${what}`, onclick, text: 'Edit' });

// ctx: { preview, modules (catalog), questions, jump({ module } | { question } | { stack: true }) }
export function renderReview(root, ctx) {
  const { preview } = ctx;
  const byId = new Map(ctx.questions.map((q) => [q.id, q]));
  const count = (...actions) => preview.files.filter((f) => actions.includes(f.action)).length;

  const answers = el('ul', { class: 'review-list' });
  answers.append(el('li', {}, el('span', {}, el('strong', { text: 'Stack' }), ` ${preview.profile}`), editButton('stack', () => ctx.jump({ stack: true }))));
  for (const id of preview.visible) {
    const q = byId.get(id);
    if (!q || id.startsWith('arch.') || id.startsWith('quality.review-')) continue;
    const label = SHORT[id] ?? q.label.replace(/\?$/, '');
    answers.append(el('li', {}, el('span', {}, el('strong', { text: label }), ` ${answerText(q, preview.answers[id])}`), editButton(label, () => ctx.jump({ question: id }))));
  }

  const defs = new Map(ctx.modules.map((m) => [m.name, m]));
  const list = el('ul', { class: 'review-modules' });
  for (const name of preview.modules) {
    const m = defs.get(name);
    if (!m) continue;
    const files = preview.files.filter((f) => f.module === name);
    const bullets = m.adds?.length ? m.adds : [m.what ?? m.description];
    const item = el('li', { class: 'review-module' },
      el('div', { class: 'review-head' }, el('strong', { text: m.title ?? name }), name === 'core' ? el('span', { class: 'pill', text: 'required' }) : editButton(m.title ?? name, () => ctx.jump({ module: name }))),
      el('ul', { class: 'review-adds' }, ...bullets.map((b) => el('li', { text: b }))));
    if (files.length) {
      item.append(el('details', { class: 'review-files' }, el('summary', { text: `${files.length} file${files.length === 1 ? '' : 's'}` }),
        ...files.map((f) => f.excerpt
          ? el('details', { class: 'review-file' }, el('summary', {}, el('code', { text: f.path }), el('span', { class: 'small muted', text: ` ${ACTION[f.action] ?? f.action}` })), el('pre', { text: f.excerpt }))
          : el('p', { class: 'review-file' }, el('code', { text: f.path }), el('span', { class: 'small muted', text: ` ${ACTION[f.action] ?? f.action}` })))));
    }
    list.append(item);
  }
  root.replaceChildren(
    el('p', { class: 'small muted', text: `${count('create', 'update', 'write', 'missing')} files written · ${count('kept')} kept as they are` }),
    el('h3', { text: 'Your answers' }), answers,
    el('h3', { text: 'What YAW adds' }), list);
}
