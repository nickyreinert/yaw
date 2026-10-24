// Text-node rendering only. Registry and Markdown content are never parsed as HTML or executed.
const $ = (id) => document.getElementById(id);
export function el(tag, text, cls) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (cls) node.className = cls;
  return node;
}
export function table(headers, rows) {
  const wrap = el('div', null, 'table-scroll'), t = el('table');
  const head = t.createTHead().insertRow();
  for (const h of headers) { const th = el('th', h); th.scope = 'col'; head.append(th); }
  const body = t.createTBody();
  for (const row of rows) { const tr = body.insertRow(); for (const value of row) tr.append(el('td', value ?? '—')); }
  wrap.append(t); return wrap;
}
const fmt = (n) => Number(n ?? 0).toLocaleString();
const countLabel = (n, word) => `${fmt(n)} ${word}${n === 1 ? '' : 's'}`;
const duration = (n) => n === null ? '—' : n >= 60 ? `${Math.floor(n / 60)}h ${n % 60}m` : `${n}m`;
const date = (s) => Number.isFinite(Date.parse(s)) ? new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const money = (n) => n === null ? '—' : `$${Number(n).toFixed(2)}`;
function card(title, text = '', cls = '') {
  const node = el('article', null, `card ${cls}`); node.append(el('h2', title));
  if (text) node.append(el('p', text)); return node;
}
function command(text) { return el('pre', text, 'command'); }
function button(text, fn, cls) { const b = el('button', text, cls); b.type = 'button'; b.addEventListener('click', fn); return b; }
function metric(label, value, note) {
  const node = el('div', null, 'metric'); node.append(el('span', label, 'eyebrow'), el('strong', value));
  if (note) node.append(el('span', note, 'muted')); return node;
}
function action(text, view, primary = false) { return button(text, () => showView(view), primary ? 'primary' : ''); }
function activityChart(rows) {
  const wrap = el('div', null, 'activity-chart'), NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg'); svg.setAttribute('viewBox', '0 0 800 75'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Sessions started by day, UTC');
  const days = rows.slice(-30), max = Math.max(1, ...days.map((r) => r.sessions));
  const width = 800 / Math.max(days.length, 1);
  days.forEach((r, i) => {
    const rect = document.createElementNS(NS, 'rect'), title = document.createElementNS(NS, 'title');
    const height = 64 * r.sessions / max;
    rect.setAttribute('x', i * width + 2); rect.setAttribute('y', 70 - height); rect.setAttribute('width', Math.max(1, width - 4)); rect.setAttribute('height', height); rect.setAttribute('rx', '3');
    title.textContent = `${r.day}: ${r.sessions}`; rect.append(title); svg.append(rect);
  });
  wrap.append(svg);
  const labels = el('div', null, 'chart-labels'); labels.append(el('span', days[0]?.day || 'No activity'), el('span', days.at(-1)?.day || '')); wrap.append(labels); return wrap;
}
let active = 'overview', data, requestId = 0, group = 'sessions', sort = 'started', direction = 'desc', sessionPage = 1;
let knowledgePage = 1, knowledgeKey = '', knowledgeRequest = 0, searchTimer, knowledgeLoaded = false;
const setup = document.body.dataset.mode === 'setup';
const views = ['overview', 'setup', 'profiling', 'maintenance', 'tasks', 'knowledge'];
export function showView(name, focus = true) {
  if (name === 'decisions') name = 'knowledge';
  if (!views.includes(name) || name === 'setup' && !setup) name = 'overview';
  active = name;
  document.querySelectorAll('[data-view]').forEach((node) => { node.hidden = node.dataset.view !== name; });
  document.querySelectorAll('[data-route]').forEach((node) => {
    if (node.dataset.route === name) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current');
  });
  $('breadcrumb').textContent = { overview: 'Overview', setup: 'Project setup', profiling: 'Sessions', maintenance: 'Maintenance', tasks: 'Tasks', knowledge: 'Knowledge' }[name];
  history.replaceState(null, '', `#${name}`);
  if (focus) { document.querySelector(`[data-view="${name}"] h1`)?.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' }); }
  if (name === 'knowledge' && !knowledgeLoaded) loadKnowledge();
}
function overview(d) {
  const p = d.project, all = d.sessions.available ? d.sessions.all : null;
  $('project-name').textContent = p.name ?? 'Project'; $('project-path').textContent = p.root ?? 'Unavailable';
  $('project-state').textContent = p.error ? 'Read error' : p.initialized ? 'Configured' : 'Not configured';
  $('overview-warning').textContent = p.error || '';
  const metrics = $('overview-metrics'); metrics.replaceChildren();
  metrics.append(metric('Sessions', all ? fmt(all.sessions) : '—'), metric('Projects', all ? fmt(all.projectCount) : '—'),
    metric('Agents', all ? fmt(Object.keys(all.byAgent).length) : '—'), metric('Reported tokens', all?.tokens ? fmt(all.tokens) : '—'),
    metric('Elapsed time', all ? duration(all.minutes) : '—'), metric('Open tasks', d.tasks.available ? fmt(d.tasks.active.length + d.tasks.backlog.length) : '—'));
  const project = card('Current project');
  project.append(table(['Setting', 'Value'], [['Name', p.name], ['Kit', p.kit], ['Profile', p.profiles?.join(', ') || '—'], ['Modules', p.modules?.join(', ') || '—'], ['Agents', p.agents?.join(', ') || '—']]));
  project.append(action(p.initialized ? 'Maintenance →' : 'Configure project →', p.initialized ? 'maintenance' : 'setup', true));
  const activity = card('Activity', 'Last 30 active days · UTC');
  activity.append(activityChart(d.sessions.available ? Object.entries(all.last30Days).sort().map(([day, sessions]) => ({ day, sessions })) : []));
  activity.append(action('Browse sessions →', 'profiling'), action('Browse knowledge →', 'knowledge'));
  $('workspace-actions').replaceChildren(project, activity);
  $('overview-projects').replaceChildren(all?.projects.length ? table(['Project', 'Sessions', 'Elapsed', 'Tokens', 'Last session'], all.projects.slice(0, 8).map((r) => [r.project, fmt(r.sessions), duration(r.minutes), r.tokens ? fmt(r.tokens) : '—', date(r.last)])) : el('p', 'No local sessions found.', 'muted'));
}
function comparisonTable(title, rows) {
  const columns = [
    ['name', title, (r) => r.name], ['sessions', 'Sessions', (r) => fmt(r.sessions)], ['minutes', 'Elapsed', (r) => duration(r.minutes)],
    ['tokensIn', 'Input', (r) => r.usageKnown ? fmt(r.tokensIn) : '—'], ['tokensOut', 'Output', (r) => r.usageKnown ? fmt(r.tokensOut) : '—'], ['costUsd', 'Cost', (r) => r.costKnown ? money(r.costUsd) : '—'],
  ];
  let key = 'sessions', ascending = false;
  const wrap = el('div');
  const render = () => {
    const ordered = [...rows].sort((a, b) => (typeof a[key] === 'number' ? a[key] - b[key] : a[key].localeCompare(b[key])) * (ascending ? 1 : -1));
    const node = table(columns.map(([, label]) => label), ordered.map((r) => columns.map(([, , value]) => value(r))));
    node.querySelectorAll('th').forEach((th, i) => {
      const [field, label] = columns[i]; if (field === key) th.setAttribute('aria-sort', ascending ? 'ascending' : 'descending');
      th.replaceChildren(button(`${label}${field === key ? ascending ? ' ↑' : ' ↓' : ''}`, () => { ascending = field === key ? !ascending : true; key = field; render(); }));
    });
    wrap.replaceChildren(node);
  }; render(); return wrap;
}
function profiling(d) {
  const root = $('profile-results'); root.replaceChildren();
  if (!d.sessions.available) { root.append(card('No sessions', d.sessions.error || 'No registry or local history found.')); return; }
  const p = d.sessions.profiling, v = p.summary;
  for (const key of ['project', 'agent', 'model']) fillOptions($(`filter-${key}`), p.options[key], `All ${key === 'project' ? 'projects' : key === 'agent' ? 'agents' : 'models'}`);
  $('history-source').textContent = d.sessions.history?.local ? 'Claude Code · Codex · Copilot · Registry + local history' : 'YAW registry';
  const metrics = el('div', null, 'metrics');
  metrics.append(metric('Sessions', fmt(v.sessions), countLabel(p.projects.length, 'project')), metric('Elapsed', duration(v.minutes), `${v.durationKnown}/${v.sessions} end times`),
    metric('Tokens', v.usageKnown ? fmt(v.tokensIn + v.tokensOut) : '—', `${v.usageKnown}/${v.sessions} usage coverage`), metric('Reported cost', v.costKnown ? money(v.costUsd) : '—', `${v.costKnown}/${v.sessions} cost coverage`));
  root.append(metrics);
  const chart = card('Activity'); chart.append(activityChart(p.activity)); root.append(chart);
  const tabs = el('nav', null, 'data-tabs'); tabs.setAttribute('aria-label', 'Session views');
  for (const [key, label] of [['sessions', 'Sessions'], ['agents', 'Agents'], ['projects', 'Projects'], ['models', 'Models']]) {
    const b = button(`${label} ${key === 'sessions' ? v.sessions : p[key].length}`, () => { group = key; profiling(data); });
    b.setAttribute('aria-pressed', String(group === key)); tabs.append(b);
  } root.append(tabs);
  const container = card(group[0].toUpperCase() + group.slice(1));
  if (group === 'sessions') {
    const columns = [['started', 'Session / started'], ['agent', 'Agent'], ['project', 'Project'], ['model', 'Model'], ['tokens', 'Tokens in / out'], ['minutes', 'Elapsed'], ['cost', 'Cost']];
    const node = table(columns.map(([, label]) => label), p.recent.map((r) => [
      `${r.title || r.id}\n${date(r.started)}`, r.agent, r.project, r.model, `${r.tokensIn === null ? '—' : fmt(r.tokensIn)} / ${r.tokensOut === null ? '—' : fmt(r.tokensOut)}`, duration(r.minutes), money(r.costUsd),
    ]));
    node.querySelectorAll('th').forEach((th, i) => {
      const [key, label] = columns[i]; if (key === sort) th.setAttribute('aria-sort', direction === 'asc' ? 'ascending' : 'descending');
      const b = button(`${label}${key === sort ? direction === 'asc' ? ' ↑' : ' ↓' : ''}`, () => { direction = key === sort && direction === 'asc' ? 'desc' : 'asc'; sort = key; sessionPage = 1; load(); });
      b.dataset.sort = key; th.replaceChildren(b);
    });
    container.append(node, pager(p.pagination.page, p.pagination.pages, countLabel(v.sessions, 'session'), (page) => { sessionPage = page; load(); }));
  } else container.append(comparisonTable({ agents: 'Agent', projects: 'Project', models: 'Model' }[group], p[group]));
  root.append(container);
}
function maintenance(d) {
  const root = $('maintenance-body'); root.replaceChildren(); const m = d.maintenance;
  if (m.error) root.append(card('Read error', m.error, 'warn'));
  else if (!m.available) { root.append(card('Project not configured')); if (setup) root.append(action('Configure project →', 'setup', true)); }
  else {
    const count = (state) => m.files.filter((f) => f.state === state).length;
    const metrics = el('div', null, 'metrics'); metrics.append(metric('Files', m.files.length), metric('Edited', count('edited')), metric('Missing', count('missing')), metric('Conflicts', count('conflict'))); root.append(metrics);
    root.append(el('p', `Kit ${m.kit} · Project pin ${m.pinned} · ${m.excluded} secret files excluded · Checks not run`, 'small muted'));
    root.append(table(['File', 'Module', 'State', 'Ownership'], m.files.map((f) => [f.path, f.module, f.state, f.managed ? 'Managed' : 'User'])));
  }
  const commands = card('Commands'); commands.append(command('yaw doctor\nyaw status\nyaw update\nyaw add <module>\njust check')); root.append(commands);
}
function tasks(d) {
  const root = $('tasks-body'), t = d.tasks; root.replaceChildren();
  if (!t.available) { root.append(el('p', t.error || 'No TASKS.md.', 'muted')); return; }
  if (t.readOnly) root.append(el('p', 'GitHub mirror · just task sync', 'small muted'));
  root.append(el('h2', `Active (${t.active.length})`), table(['Task', 'Title', 'Status', 'Progress'], t.active.map((r) => [r.id, r.title, r.status, r.progress === undefined ? '—' : `${r.progress}%`])),
    el('h2', `Backlog (${t.backlog.length})`), table(['Task', 'Title', 'Note'], t.backlog.map((r) => [r.id, r.title, r.note])));
}
function fillOptions(select, options, label) {
  const value = select.value; select.replaceChildren(); const all = el('option', label); all.value = ''; select.append(all);
  for (const name of options) { const option = el('option', name); option.value = name; select.append(option); }
  select.value = options.includes(value) ? value : '';
}
function pager(page, pages, note, change) {
  const row = el('div', null, 'pager'), previous = button('← Previous', () => change(page - 1)), next = button('Next →', () => change(page + 1));
  previous.disabled = page <= 1; next.disabled = page >= pages;
  row.append(el('span', `${note} · Page ${page}/${pages}`, 'small muted'), previous, next); return row;
}
// Small safe Markdown display: headings, lists, paragraphs, fenced code. Raw HTML stays literal text.
function inline(node, text) {
  const pattern = /`([^`]+)`|\*\*([^*]+)\*\*/g; let offset = 0;
  for (const match of text.matchAll(pattern)) {
    node.append(document.createTextNode(text.slice(offset, match.index)));
    node.append(el(match[1] !== undefined ? 'code' : 'strong', match[1] ?? match[2]));
    offset = match.index + match[0].length;
  }
  node.append(document.createTextNode(text.slice(offset)));
  return node;
}
function markdown(text) {
  const body = el('div', null, 'markdown'); let code = null, list = null, paragraph = [];
  const flush = () => { if (paragraph.length) body.append(inline(el('p'), paragraph.join(' '))); paragraph = []; };
  const content = text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').replace(/^\s*#\s+[^\n]+\n?/, '');
  for (const line of content.split('\n')) {
    if (line.startsWith('```')) { flush(); list = null; if (code) { body.append(code); code = null; } else code = el('pre', ''); continue; }
    if (code) { code.textContent += `${line}\n`; continue; }
    if (!line.trim()) { flush(); list = null; continue; }
    const heading = /^(#{1,6})\s+(.*)/.exec(line);
    if (heading) { flush(); list = null; body.append(inline(el(`h${Math.min(heading[1].length + 1, 6)}`), heading[2])); }
    else if (/^[-*] /.test(line)) { flush(); if (!list) { list = el('ul'); body.append(list); } list.append(inline(el('li'), line.slice(2))); }
    else { list = null; paragraph.push(line); }
  }
  flush(); if (code) body.append(code); return body;
}
function renderRecord(record) {
  const root = $('knowledge-detail'); root.replaceChildren();
  if (!record) { root.append(el('p', 'Select a record.', 'muted')); return; }
  const meta = el('div', null, 'record-meta'); meta.append(el('span', record.scope, 'pill'), el('span', record.type), el('span', record.namespace), el('span', record.status));
  root.append(meta, el('h2', record.title), el('code', record.path, 'record-path'));
  const tools = el('div', null, 'record-tools'), content = el('div'); let source = false;
  const toggle = button('View source', () => { source = !source; toggle.textContent = source ? 'Rendered view' : 'View source'; content.replaceChildren(source ? el('pre', record.content) : markdown(record.content)); });
  tools.append(toggle); content.append(markdown(record.content)); root.append(tools, content);
}
async function loadKnowledge() {
  const id = ++knowledgeRequest; $('knowledge-error').hidden = true; $('knowledge-status').textContent = 'Reading records…';
  const params = new URLSearchParams({ scope: $('knowledge-scope').value, q: $('knowledge-search').value, namespace: $('knowledge-namespace').value, type: $('knowledge-type').value, page: String(knowledgePage) });
  if (knowledgeKey) params.set('record', knowledgeKey);
  try {
    const res = await fetch(`/api/knowledge?${params}`), body = await res.json();
    if (id !== knowledgeRequest) return;
    if (!res.ok) throw new Error(body.error || 'Knowledge unavailable');
    knowledgeLoaded = true;
    fillOptions($('knowledge-namespace'), body.options.namespaces, 'All namespaces'); fillOptions($('knowledge-type'), body.options.types, 'All types');
    $('knowledge-status').textContent = `${countLabel(body.total, 'record')} · ${body.excluded} excluded${body.limited ? ' · Scan limit reached' : ''}`;
    const root = $('knowledge-list'); root.replaceChildren();
    for (const r of body.entries) {
      const b = button('', () => { knowledgeKey = r.key; loadKnowledge(); }, 'knowledge-row');
      b.setAttribute('aria-pressed', String(r.key === knowledgeKey));
      b.append(el('strong', r.title), el('span', `${r.scope} / ${r.namespace} · ${r.type}${r.status ? ` · ${r.status}` : ''}`, 'small muted'), el('code', r.path)); root.append(b);
    }
    if (!body.entries.length) root.append(el('p', 'No matching records.', 'muted'));
    root.append(pager(body.page, body.pages, countLabel(body.total, 'record'), (page) => { knowledgePage = page; knowledgeKey = ''; loadKnowledge(); }));
    renderRecord(body.record);
    $('knowledge-sources').replaceChildren(table(['Scope', 'Source', 'State', 'Records'], body.sources.map((s) => [s.scope, s.path, s.state, s.records])));
  } catch (e) { if (id !== knowledgeRequest) return; $('knowledge-error').textContent = e.message; $('knowledge-error').hidden = false; $('knowledge-status').textContent = 'Read failed'; renderRecord(null); }
}
async function load(refresh = false) {
  const id = ++requestId; $('workspace-error').hidden = true; $('workspace-status').textContent = 'Scanning local session metadata…'; $('profile-results').setAttribute('aria-busy', 'true');
  const params = new URLSearchParams({ history: 'local', sort, direction, page: String(sessionPage) });
  for (const key of ['project', 'agent', 'model', 'days']) params.set(key, $(`filter-${key}`).value);
  if (refresh) params.set('refresh-history', '1');
  try {
    const res = await fetch(`/api/dashboard?${params}`, { headers: { accept: 'application/json' } }), body = await res.json();
    if (id !== requestId) return; if (!res.ok) throw new Error(body.error || 'Workspace unavailable');
    data = body; overview(data); profiling(data); maintenance(data); tasks(data);
    $('workspace-status').textContent = `Updated ${date(data.generated)}`;
  } catch (e) {
    if (id !== requestId) return; $('workspace-error').textContent = `${e.message}. Check yaw web and refresh.`; $('workspace-error').hidden = false;
    $('workspace-status').textContent = 'Refresh failed'; $('profile-results').replaceChildren(card('Read failed', e.message, 'warn'));
  } finally { if (id === requestId) $('profile-results').removeAttribute('aria-busy'); }
}
export function startWorkspace() {
  document.querySelectorAll('[data-route]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.route)));
  for (const key of ['project', 'agent', 'model', 'days']) $(`filter-${key}`).addEventListener('change', () => { sessionPage = 1; load(); });
  $('reset-filters').addEventListener('click', () => { for (const key of ['project', 'agent', 'model']) $(`filter-${key}`).value = ''; $('filter-days').value = 'all'; sessionPage = 1; load(); });
  $('refresh').addEventListener('click', () => { load(true); if (active === 'knowledge') loadKnowledge(); });
  for (const key of ['scope', 'namespace', 'type']) $(`knowledge-${key}`).addEventListener('change', () => {
    if (key === 'scope') { $('knowledge-namespace').value = ''; $('knowledge-type').value = ''; }
    knowledgePage = 1; knowledgeKey = ''; loadKnowledge();
  });
  $('knowledge-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { knowledgePage = 1; knowledgeKey = ''; loadKnowledge(); }, 200); });
  window.addEventListener('hashchange', () => showView(location.hash.slice(1), false));
  showView(location.hash.slice(1) || 'overview', false); load();
}
