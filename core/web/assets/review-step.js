// Shared, searchable review tree. All content is rendered as text; expansion is user-controlled.
import { el, radioChoices, decisionIcon } from './setup-cards.js';

import { fileTreeEntries } from './project-tree.js';
export { filePurpose } from './project-tree.js';

const SHORT = {
  'user.agents': 'Agents', 'user.expertise': 'Experience', 'user.language': 'Chat language', 'user.autonomy': 'Frequency',
  'user.length': 'Depth', 'user.explain': 'Response',
  'user.comfort': 'Comfort helpers', 'idea.text': 'Purpose', 'idea.team': 'Team', 'tasks.use-github': 'GitHub', 'tasks.mode': 'Task tracking',
  'team.session-context': 'Session context', 'arch.language': 'Language', 'arch.runs-on': 'Runtime', 'arch.framework': 'Framework',
  'arch.library-strategy': 'Build or reuse', 'arch.docker': 'Docker support', 'arch.wrapper': 'Wrapper',
  'arch.hosting-control': 'Hosting', 'arch.libraries': 'Dependencies', 'arch.services': 'Services', 'arch.cost': 'Budget policy', 'arch.cost-limit': 'Budget cap',
};
const OPEN = new WeakMap();

export function answerText(q, value) {
  if (q.type === 'boolean') return value === false || value === 'false' ? 'No' : 'Yes';
  const label = (v) => radioChoices(q.choices ?? []).find((c) => c.value === String(v))?.label ?? String(v);
  if (q.type === 'multi') return (value ?? []).length ? value.map(label).join(', ') : 'none';
  if (q.type === 'choice') return label(value);
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > 90 ? `${text.slice(0, 87)}…` : text || '—';
}

const editButton = (what, onclick) => el('button', { type: 'button', class: 'review-edit', 'aria-label': `Edit ${what}`, title: `Edit ${what}`,
  onclick: (event) => { event.preventDefault(); event.stopPropagation(); onclick(); } }, decisionIcon('edit'));
const sectionOf = (id) => id.startsWith('user.') ? 'agents' : /^(idea|arch)\./.test(id) ? 'project' : 'workflow';
const sections = [['project', 'Project', 'box'], ['agents', 'Agents & preferences', 'users'], ['workflow', 'Workflow', 'branch']];
const subgroupOf = (id) => id === 'user.agents' ? 'Coding agents' : id.startsWith('user.') ? 'Preferences' : id.startsWith('idea.') ? 'Purpose & team'
  : ['arch.language', 'arch.runs-on'].includes(id) ? 'Stack' : id.startsWith('arch.') ? 'Architecture' : id.startsWith('quality.') ? 'Reviews' : 'Repository & tasks';

export function renderReview(root, ctx) {
  const { preview } = ctx;
  let state = OPEN.get(root);
  if (!state) { state = { query: '', expanded: new Set() }; OPEN.set(root, state); }
  const record = (node, search, children = [], key = null) => ({ node, search: search.toLocaleLowerCase(), children, key });
  const leaf = (label, value, source, target, search = '') => record(el('div', { class: 'review-item' },
    el('div', { class: 'review-value' }, el('strong', { text: label }), el('span', { text: value }), source ? el('small', { class: 'muted', text: source }) : null),
    target ? editButton(label, () => ctx.jump(target)) : null), `${label} ${value} ${source ?? ''} ${search}`);
  const branch = (label, key, children, icon = 'box', target = null, note = '') => {
    const summary = el('summary', { class: 'review-summary' }, typeof icon === 'string' ? decisionIcon(icon) : icon,
      el('span', { class: 'review-branch-label', text: label }), el('small', { class: 'review-count', text: note || String(children.length) }),
      target ? editButton(label, () => ctx.jump(target)) : null);
    const node = el('details', { class: 'review-branch', 'data-review-key': key }, summary,
      el('div', { class: 'review-children' }, ...children.map((child) => child.node)));
    summary.addEventListener('click', (event) => {
      if (event.defaultPrevented || state.query) return;
      if (node.open) state.expanded.delete(key); else state.expanded.add(key);
    });
    return record(node, label, children, key);
  };

  const asked = new Set(preview.visible), groups = new Map(sections.map(([key]) => [key, new Map()])), defaults = new Map();
  const add = (map, title, row) => { if (!map.has(title)) map.set(title, []); map.get(title).push(row); };
  add(groups.get('project'), 'Stack', leaf('Profile', preview.profile ?? '—', '', { stack: true }));
  for (const q of ctx.questions) {
    if (!Object.hasOwn(preview.answers, q.id)) continue;
    const label = SHORT[q.id] ?? q.label.replace(/\?| \(comma-separated\)/g, '');
    const target = q.editHidden ? null : q.id.startsWith('arch.') ? { stack: true } : { question: q.id };
    const row = leaf(label, answerText(q, preview.answers[q.id]), preview.sources?.[q.id] ?? (asked.has(q.id) ? 'answered' : 'default'), target, `${q.id} ${JSON.stringify(preview.answers[q.id])}`);
    if (asked.has(q.id)) add(groups.get(sectionOf(q.id)), subgroupOf(q.id), row);
    else add(defaults, sections.find(([key]) => key === sectionOf(q.id))[1], row);
  }
  if (ctx.plan?.tasks || ctx.plan?.idea || ctx.plan?.foundations?.length) {
    add(groups.get('project'), 'Plan', leaf('Tasks', `${ctx.plan.tasks ?? 0} · docs/plan/kickoff.md`, '', { plan: true }));
    for (const document of ctx.plan.foundations ?? []) add(groups.get('project'), 'Plan', leaf(document.kind, document.path, 'reviewed', { plan: true }));
  }
  const entries = sections.map(([key, title, icon]) => branch(title, key,
    [...groups.get(key)].map(([name, rows]) => branch(name, `${key}/${name}`, rows, icon)), icon)).filter((entry) => entry.children.length);

  const moduleRows = preview.modules.filter((name) => name !== 'core').map((name) => {
    const module = ctx.modules.find((entry) => entry.name === name);
    return leaf(module?.title ?? name, 'Enabled', '', { module: name });
  });
  const output = fileTreeEntries(preview.files, { onExpand: (key, open) => {
    if (state.query) return;
    if (open) state.expanded.add(key); else state.expanded.delete(key);
  } });
  if (output.length) entries.push(branch('Project structure', 'tools', output, 'folder', null, `${preview.files.length} files`));
  if (moduleRows.length) entries.push(branch('Enabled tools', 'modules', moduleRows, 'box'));
  if (defaults.size) entries.push(branch('Saved & default settings', 'defaults', [...defaults].map(([title, rows]) => branch(title, `defaults/${title}`, rows, 'book')), 'book'));

  const input = el('input', { type: 'search', maxlength: 100, placeholder: 'Search choices and files…', 'aria-label': 'Search review' }); input.value = state.query;
  const empty = el('p', { class: 'small muted', text: 'No matches', role: 'status', hidden: true });
  const filter = () => {
    const query = state.query.trim().toLocaleLowerCase();
    const visit = (entry, inherited = false) => {
      const own = Boolean(query && entry.search.includes(query)), matched = inherited || own;
      const childMatches = entry.children.map((child) => visit(child, matched));
      const visible = !query || matched || childMatches.some(Boolean);
      entry.node.hidden = !visible;
      if (entry.key) entry.node.open = query ? visible : state.expanded.has(entry.key);
      return visible;
    };
    empty.hidden = entries.map((entry) => visit(entry)).some(Boolean);
  };
  input.addEventListener('input', () => { state.query = input.value; filter(); });
  const needed = (preview.unresolved ?? []).map((id) => SHORT[id] ?? ctx.questions.find((q) => q.id === id)?.label ?? id);
  root.replaceChildren(el('div', { class: 'review-search' }, input),
    ...(needed.length ? [el('p', { class: 'warn', role: 'status', text: `Still needed: ${needed.join(', ')}` })] : []),
    ...(ctx.confirmProposal && preview.unresolved?.some((id) => preview.sources?.[id] === 'proposed — needs confirmation')
      ? [el('button', { type: 'button', text: 'Confirm proposed choices', onclick: ctx.confirmProposal })] : []),
    el('p', { class: 'small muted', text: `${preview.files.length} files · ${preview.files.filter((file) => file.action === 'kept').length} kept` }),
    el('div', { class: 'review-tree' }, ...entries.map((entry) => entry.node)), empty);
  filter();
}
