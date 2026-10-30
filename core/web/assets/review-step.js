// Shared, searchable review tree. All content is rendered as text; expansion is user-controlled.
import { el, radioChoices, decisionIcon, moduleIcon, GROUPS } from './setup-cards.js';

const SHORT = {
  'user.agents': 'Agents', 'user.expertise': 'Experience', 'user.language': 'Chat language', 'user.autonomy': 'Autonomy',
  'user.length': 'Answer length', 'user.register': 'Wording', 'user.examples': 'Examples', 'user.explain': 'Explanations',
  'user.comfort': 'Comfort helpers', 'idea.text': 'Purpose', 'idea.team': 'Team', 'tasks.use-github': 'GitHub', 'tasks.mode': 'Task tracking',
  'team.session-context': 'Session context', 'arch.language': 'Language', 'arch.runs-on': 'Runtime', 'arch.framework': 'Framework',
  'arch.library-strategy': 'Build or reuse', 'arch.docker': 'Docker support', 'arch.wrapper': 'Wrapper', 'quality.error-detail': 'User-facing errors', 'quality.log-output': 'Diagnostic logs', 'quality.documentation': 'Internal documentation',
  'arch.hosting-control': 'Hosting', 'arch.libraries': 'Dependencies', 'arch.services': 'Services', 'arch.cost': 'Budget policy', 'arch.cost-limit': 'Budget cap',
};
const ACTION = { create: 'new', update: 'changed', write: 'write', kept: 'kept', missing: 'restore', delete: 'remove' };
const OPEN = new WeakMap();

export function answerText(q, value) {
  if (q.type === 'boolean') return value === false || value === 'false' ? 'No' : 'Yes';
  const label = (v) => radioChoices(q.choices ?? []).find((c) => c.value === String(v))?.label ?? String(v);
  if (q.type === 'multi') return (value ?? []).length ? value.map(label).join(', ') : 'none';
  if (q.type === 'choice') return label(value);
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > 90 ? `${text.slice(0, 87)}…` : text || '—';
}

export function filePurpose(path) {
  if (path === 'AGENTS.md') return 'Agent entry point';
  if (['CLAUDE.md', 'GEMINI.md'].includes(path)) return 'Rules import';
  if (path === 'justfile' || path.endsWith('.just')) return 'Project commands';
  if (path === '.gitignore') return 'Ignored files';
  if (path === '.yaw/answers.yaml') return 'Project choices';
  if (path === '.yaw/manifest.json') return 'Generated file index';
  if (path.endsWith('SKILL.md')) return 'Agent skill';
  if (path.includes('/ISSUE_TEMPLATE/')) return 'Issue form';
  if (path.endsWith('pull_request_template.md')) return 'PR template';
  if (path.endsWith('hooks.json') || path.endsWith('settings.json')) return 'Agent configuration';
  if (path.includes('docs/spec/')) return 'Project specification';
  if (path.includes('docs/standards')) return 'Coding standards';
  if (path.includes('docs/plan/')) return 'Project plan';
  if (path.endsWith('README.md')) return 'Project overview';
  if (path.endsWith('package.json')) return 'Dependencies and scripts';
  if (path.startsWith('src/') || path.startsWith('public/')) return 'Starter code';
  return 'Project file';
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

  const defs = new Map(ctx.modules.map((m) => [m.name, m])), owners = new Map();
  for (const file of preview.files) add(owners, file.module ?? 'core', file);
  for (const name of preview.modules) if (!owners.has(name)) owners.set(name, []);
  const tools = new Map();
  for (const [name, files] of owners) {
    const module = defs.get(name), label = module?.title ?? name.replace(/^profile:/, '');
    const children = files.map((file) => {
      const note = `${filePurpose(file.path)} · ${ACTION[file.action] ?? file.action}`;
      if (!file.excerpt) return record(el('div', { class: 'review-file-row', 'data-review-file': file.path }, decisionIcon('file'), el('code', { text: file.path }), el('small', { class: 'muted', text: note })), `${file.path} ${note}`);
      const item = branch(file.path, `file/${file.path}`, [record(el('pre', { class: 'review-file', text: file.excerpt }), file.excerpt)], 'file', null, note);
      item.node.setAttribute('data-review-file', file.path);
      item.search += ` ${note.toLocaleLowerCase()}`;
      return item;
    });
    const target = name === 'core' ? null : module ? { module: name } : { stack: true };
    add(tools, module?.group ?? 'basics', branch(label, `module/${name}`, children, moduleIcon(name), target, `${files.length} files`));
  }
  const output = [...tools].map(([key, modules]) => branch(GROUPS.find(([id]) => id === key)?.[1] ?? key, `tools/${key}`, modules));
  if (output.length) entries.push(branch('Tools & files', 'tools', output, 'file', null, `${preview.files.length} files`));
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
