import { createSettings, taxonomyEditor } from './settings-view.js';
import { createGlobal } from './global-view.js';
import { createGlobalSettings } from './global-settings-view.js';
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
function action(text, view, primary = false) { return button(text, () => navigate(view), primary ? 'primary' : ''); }
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
let active = 'overview', data, requestId = 0;
let knowledgePage = 1, knowledgeKey = '', knowledgeRequest = 0, searchTimer, knowledgeLoaded = false, editable = [];
// The dashboard server can serve several projects; each tab names its own in every request.
const TYPES = ['document', 'rule', 'preference', 'lesson', 'snippet'];
let workspace = sessionStorage.getItem('yaw-workspace') ?? '';
const scoped = (params) => { if (workspace) params.set('workspace', workspace); return params; };
const setup = document.body.dataset.mode === 'setup';
// Routes are `#name[/sub][?query]`. Workspace and Global Sessions share one section, both Knowledge pages another.
const views = ['overview', 'setup', 'sessions', 'settings', 'knowledge', 'workspace-tasks', 'code-map', 'global', 'global-sessions', 'global-tasks', 'global-knowledge', 'global-settings'];
const SECTIONS = { 'global-sessions': 'sessions', 'global-knowledge': 'knowledge' };
const ALIASES = { decisions: 'knowledge/decisions', maintenance: 'settings/files', notifications: 'global-settings/notifications', 'settings/notifications': 'global-settings/notifications',
  profiling: 'global-sessions', tasks: 'global-tasks', projects: 'global' };
const TITLES = { overview: 'Workspace overview', setup: 'Settings / Interview', sessions: 'Workspace sessions', settings: 'Workspace settings', knowledge: 'Workspace knowledge',
  'workspace-tasks': 'Workspace tasks', 'code-map': 'Workspace code map', global: 'Global overview', 'global-sessions': 'Global sessions', 'global-tasks': 'Global tasks',
  'global-knowledge': 'Global knowledge', 'global-settings': 'Global settings' };
const GLOBAL_VIEWS = ['global', 'global-sessions', 'global-tasks', 'sessions'];
let settings, globalView, globalSettings, knowledgeScope = 'project', pendingType = null, shown = '';
const replace = (url) => { if (url !== location.hash) history.replaceState(null, '', url); shown = location.hash; };
function setInterviewFocus(on) {
  document.body.classList.toggle('interview-focus', on);
  document.querySelectorAll('.focus-toggle').forEach((button) => {
    button.setAttribute('aria-checked', String(on));
    button.setAttribute('aria-label', on ? 'Focus mode on' : 'Focus mode off');
  });
}
// After apply the server has stopped; there is nothing left to focus on.
export function setInterviewDone(on) { document.body.classList.toggle('interview-done', on); }
export function showView(hash, focus = true) {
  let [route, query = ''] = String(hash).split('?');
  route = ALIASES[route] ?? route;
  if (route.includes('?')) [route, query] = route.split('?');
  let [name, sub] = route.split('/');
  if (!views.includes(name) || name === 'setup' && !setup) { name = 'overview'; sub = undefined; query = ''; }
  const changed = name !== active;
  active = name;
  const section = SECTIONS[name] ?? name;
  document.querySelectorAll('[data-view]').forEach((node) => { node.hidden = node.dataset.view !== section; });
  document.querySelectorAll('[data-route]').forEach((node) => {
    if (node.dataset.route === (name === 'setup' ? 'settings' : name)) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current');
  });
  $('breadcrumb').textContent = TITLES[name];
  if (name === 'settings') sub = settings.show(sub); else settings?.hide();
  const interviewView = name === 'setup' || name === 'settings' && sub === 'interview';
  document.querySelectorAll('.focus-toggle').forEach((button) => { button.hidden = !interviewView || !button.closest(`[data-view="${section}"]`); });
  if (name === 'setup' && setup) setInterviewFocus(true);
  else if (!interviewView) setInterviewFocus(false);
  if (name === 'global-settings') sub = globalSettings.show(sub, query); else globalSettings?.hide();
  if (!['settings', 'knowledge', 'global-settings'].includes(name) || name === 'knowledge' && sub !== 'decisions') sub = undefined;
  if (name === 'global-settings' && sub === 'files' && new URLSearchParams(query).get('file')) sub = `files?file=${encodeURIComponent(new URLSearchParams(query).get('file'))}`;
  if (GLOBAL_VIEWS.includes(name)) globalView.show(name, query);
  else { globalView?.hide(); replace(`#${sub ? `${name}/${sub}` : name}`); }
  if (focus && changed) { document.querySelector(`[data-view="${section}"] h1`)?.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' }); }
  if (name === 'knowledge' || name === 'global-knowledge') openKnowledge(name === 'knowledge' ? 'project' : 'user', sub === 'decisions' ? 'decision' : null);
  if (name === 'code-map') loadMap().catch(reportError);
}
// Nav clicks add a history entry; filter changes replace it. Back/forward fire popstate and hashchange: render once.
function navigate(hash) { history.pushState(null, '', `#${hash}`); showView(hash); }
function onHistory() { if (location.hash !== shown) showView(location.hash.slice(1), false); }
function openProject(root, target) { sessionStorage.setItem('yaw-workspace', root); location.hash = `#${target}`; location.reload(); }
function openKnowledge(scope, type) {
  const changed = scope !== knowledgeScope || type;
  knowledgeScope = scope;
  $('knowledge-title').textContent = scope === 'project' ? 'Knowledge' : 'Global knowledge';
  $('knowledge-intro').textContent = scope === 'project' ? 'This workspace · Knowledge records and decisions' : 'Your personal records in ~/.yaw/knowledge · shared by all projects';
  $('knowledge-categories').hidden = scope !== 'project';
  if (changed) { knowledgePage = 1; knowledgeKey = ''; $('knowledge-namespace').value = ''; $('knowledge-type').value = ''; pendingType = type; loadKnowledge(); }
  else if (!knowledgeLoaded) loadKnowledge();
}
function overview(d) {
  const p = d.project, mine = d.sessions.available ? d.sessions.project : null;
  $('project-name').textContent = p.name ?? 'Project'; $('project-path').textContent = p.root ?? 'Unavailable';
  $('project-state').textContent = p.error ? 'Read error' : p.initialized ? 'Configured' : 'Not configured';
  $('overview-warning').textContent = p.error || '';
  const metrics = $('overview-metrics'); metrics.replaceChildren();
  metrics.append(metric('Workspace sessions', mine ? fmt(mine.sessions) : '—'),
    metric('Agents', mine ? fmt(Object.keys(mine.byAgent).length) : '—'), metric('Reported tokens', mine?.tokens ? fmt(mine.tokens) : '—'),
    metric('Elapsed time', mine ? duration(mine.minutes) : '—'), metric('Open tasks', d.tasks.available ? fmt(d.tasks.active.length + d.tasks.backlog.length) : '—'));
  const project = card('Current project');
  project.append(table(['Setting', 'Value'], [['Name', p.name], ['Kit', p.kit], ['Profile', p.profiles?.join(', ') || '—'], ['Modules', p.modules?.join(', ') || '—'], ['Agents', p.agents?.join(', ') || '—']]));
  project.append(action(p.initialized ? 'Settings →' : 'Configure project →', p.initialized ? 'settings' : 'settings/interview', true));
  document.querySelector('[data-route="code-map"]').hidden = !p.modules?.includes('code-map');
  const activity = card('Activity', 'Last 30 active days · UTC');
  activity.append(activityChart(mine ? Object.entries(mine.last30Days).sort().map(([day, sessions]) => ({ day, sessions })) : []));
  activity.append(action('Browse workspace sessions →', 'sessions'), action('Browse knowledge →', 'knowledge'));
  $('workspace-actions').replaceChildren(project, activity);
  $('workspace-sessions').replaceChildren(mine?.recent.length ? table(['Session', 'Agent', 'Started', 'Elapsed'], mine.recent.map((r) => [r.title || r.id, r.agent, date(r.started), duration(r.minutes)])) : el('p', 'No saved sessions for this workspace. Open Sessions and press Refresh to read local history.'));
  if (mine && mine.sessions > (mine.recent?.length ?? 0)) $('workspace-sessions').prepend(el('p', `Latest ${mine.recent.length} of ${mine.sessions} sessions. Browse workspace sessions for the complete paginated list.`));
  const t = d.tasks;
  $('workspace-tasks').replaceChildren(t.available ? table(['Task', 'Title', 'Status'], [...t.active, ...t.backlog].map((r) => [r.id, r.title, r.status ?? r.note])) : el('p', t.error || 'No workspace tasks.'));
  $('workspace-task-list').replaceChildren(t.available ? table(['Task', 'Title', 'Status / note', 'Progress'], [...t.active, ...t.backlog].map((r) =>
    [r.id, r.title, r.status ?? r.note, r.progress === undefined ? '—' : `${r.progress}%`])) : el('p', t.error || 'No task ledger (TASKS.md) in this workspace.', 'muted'));
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
  const edit = button('Edit', () => {
    const area = el('textarea'); area.value = record.content; area.rows = 22; area.setAttribute('aria-label', `Edit ${record.title}`); area.className = 'record-editor';
    const save = button('Save', () => saveRecord({ key: record.key, expected: record.hash, content: area.value }, record.key), 'primary');
    tools.replaceChildren(save, button('Cancel', () => renderRecord(record))); content.replaceChildren(area); area.focus();
  });
  const remove = button('Delete', async () => {
    if (!confirm(`Delete ${record.path}? This removes the file.`)) return;
    try { const r = await api('knowledge-remove', { record: { key: record.key, expected: record.hash, confirm: true } }); knowledgeKey = ''; await loadKnowledge(); $('knowledge-status').textContent = r.message; }
    catch (e) { knowledgeError(e); }
  }, 'danger');
  tools.append(toggle, edit, remove); content.append(markdown(record.content)); root.append(tools, content);
}
function knowledgeError(e) { $('knowledge-error').textContent = e.message; $('knowledge-error').hidden = false; }
async function saveRecord(record, key) {
  $('knowledge-error').hidden = true;
  try { const r = await api('knowledge-save', { record }); knowledgeKey = r.key ?? key ?? ''; await loadKnowledge(); $('knowledge-status').textContent = r.message; }
  catch (e) { knowledgeError(e); }
}
function newRecord() {
  const root = $('knowledge-detail'); root.replaceChildren(el('h2', 'New knowledge record'));
  const form = el('div', null, 'record-form'), fields = {};
  const field = (name, title, node) => { const label = el('label', title); label.append(node); form.append(label); fields[name] = node; return node; };
  const source = field('source', 'Where', el('select'));
  const sources = editable.filter((x) => x.create && x.scope === knowledgeScope);
  if (!sources.length) { root.append(el('p', knowledgeScope === 'project' ? 'This workspace has no writable knowledge folder.' : 'No personal knowledge folder is writable.', 'muted')); return; }
  for (const s of sources) { const o = el('option', `${s.scope} · ${s.path}`); o.value = s.key; source.append(o); }
  const type = field('type', 'Type', el('select'));
  for (const t of TYPES) { const o = el('option', t); o.value = t; type.append(o); }
  field('title', 'Title', el('input')).maxLength = 200;
  field('namespace', 'Namespace (user records only)', el('input')).placeholder = 'personal';
  field('tags', 'Tags (comma separated)', el('input'));
  const body = field('body', 'Content (Markdown)', el('textarea')); body.rows = 14;
  const sync = () => { fields.namespace.disabled = editable.find((x) => x.key === source.value)?.scope !== 'user'; };
  source.addEventListener('change', sync); sync();
  form.append(button('Create', () => saveRecord({ source: source.value, title: fields.title.value, type: type.value, body: body.value,
    tags: fields.tags.value.split(',').map((t) => t.trim()).filter(Boolean), ...(fields.namespace.disabled ? {} : { namespace: fields.namespace.value || 'personal' }) }), 'primary'),
  button('Cancel', () => loadKnowledge()));
  root.append(el('p', knowledgeScope === 'project' ? 'Project records are files in this repository. Secrets are refused. ADRs are created with yaw decisions record.' : 'Personal records live in ~/.yaw/knowledge and are shared by all your projects. Secrets are refused.', 'small muted'), form);
  fields.title.focus();
}
async function startProjects() {
  const box = document.querySelector('.project-switch');
  let list;
  try { const res = await fetch('/api/projects'); if (!res.ok) return; list = await res.json(); } catch { return; }
  if (!workspace || !list.projects.some((p) => p.root === workspace)) workspace = list.current ?? '';
  const select = el('select'); select.id = 'project-select'; select.setAttribute('aria-label', 'Switch project');
  for (const p of list.projects) { const o = el('option', p.name); o.value = p.root; o.title = p.root; select.append(o); }
  select.value = workspace;
  select.addEventListener('change', () => { workspace = select.value; sessionStorage.setItem('yaw-workspace', workspace); location.reload(); });
  const add = el('details', null, 'project-add'), input = el('input'); add.append(el('summary', 'Add project folder'));
  input.placeholder = '/path/to/project'; input.setAttribute('aria-label', 'Project folder path');
  const status = el('span', '', 'small muted');
  add.append(input, button('Add', async () => {
    try { const r = await api('project-add', { path: input.value }); workspace = r.root; sessionStorage.setItem('yaw-workspace', workspace); location.reload(); }
    catch (e) { status.textContent = e.message; }
  }), status);
  box.querySelector('.eyebrow').textContent = 'PROJECT';
  box.querySelector('.eyebrow').after(select); box.append(add);
}
async function loadKnowledge() {
  const id = ++knowledgeRequest; $('knowledge-error').hidden = true; $('knowledge-status').textContent = 'Reading records…';
  const params = scoped(new URLSearchParams({ scope: knowledgeScope, q: $('knowledge-search').value, namespace: $('knowledge-namespace').value, type: pendingType ?? $('knowledge-type').value, page: String(knowledgePage) }));
  if (knowledgeKey) params.set('record', knowledgeKey);
  try {
    const res = await fetch(`/api/knowledge?${params}`), body = await res.json();
    if (id !== knowledgeRequest) return;
    if (!res.ok) throw new Error(body.error || 'Knowledge unavailable');
    knowledgeLoaded = true; editable = body.editable ?? [];
    fillOptions($('knowledge-namespace'), body.options.namespaces, 'All namespaces'); fillOptions($('knowledge-type'), [...new Set([...body.options.types, ...(pendingType ? [pendingType] : [])])], 'All types');
    if (pendingType) { $('knowledge-type').value = pendingType; pendingType = null; }
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
async function load() {
  const id = ++requestId; $('workspace-error').hidden = true; $('workspace-status').textContent = 'Reading saved session data…';
  try {
    const res = await fetch(`/api/dashboard?${scoped(new URLSearchParams())}`, { headers: { accept: 'application/json' } }), body = await res.json();
    if (id !== requestId) return; if (!res.ok) throw new Error(body.error || 'Workspace unavailable');
    data = body; overview(data);
    $('workspace-status').textContent = `Updated ${date(data.generated)}`;
  } catch (e) {
    if (id !== requestId) return; $('workspace-error').textContent = `${e.message}. Check yaw web and refresh.`; $('workspace-error').hidden = false;
    $('workspace-status').textContent = 'Refresh failed';
  }
}
export function startWorkspace() {
  document.querySelectorAll('.focus-toggle').forEach((button) => button.addEventListener('click', () => setInterviewFocus(!document.body.classList.contains('interview-focus'))));
  document.querySelectorAll('[data-route]').forEach((b) => b.addEventListener('click', () => navigate(b.dataset.route)));
  $('refresh').addEventListener('click', () => {
    load();
    if (GLOBAL_VIEWS.includes(active)) globalView.reload();
    if (active === 'knowledge' || active === 'global-knowledge') loadKnowledge();
    if (active === 'settings') { settings.reset(); showView(location.hash.slice(1), false); }
    if (active === 'global-settings') { globalSettings.reset(); showView(location.hash.slice(1), false); }
  });
  $('map-refresh').addEventListener('click', () => loadMap().catch(reportError));
  for (const key of ['namespace', 'type']) $(`knowledge-${key}`).addEventListener('change', () => { knowledgePage = 1; knowledgeKey = ''; loadKnowledge(); });
  $('knowledge-categories').addEventListener('click', () => { knowledgeKey = ''; taxonomyEditor($('knowledge-detail'), { api, get }).catch(knowledgeError); });
  settings = createSettings({ api, get, report: reportError, refresh: () => load(), go: (tab) => navigate(`settings/${tab}`), openSetup: setup ? () => navigate('setup') : null });
  globalView = createGlobal({ get, api, report: reportError, openProject, replace, afterCollect: () => load() });
  globalSettings = createGlobalSettings({ api, get, report: reportError, notifications: loadNotifications,
    onFile: (path) => { if (path) navigate(`global-settings/files?file=${encodeURIComponent(path)}`); else replace('#global-settings/files'); } });
  document.querySelectorAll('#settings-tabs [data-tab]').forEach((b) => b.addEventListener('click', () => navigate(`settings/${b.dataset.tab}`)));
  document.querySelectorAll('#global-settings-tabs [data-tab]').forEach((b) => b.addEventListener('click', () => navigate(`global-settings/${b.dataset.tab}`)));
  $('knowledge-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { knowledgePage = 1; knowledgeKey = ''; loadKnowledge(); }, 200); });
  $('knowledge-new')?.addEventListener('click', () => newRecord());
  window.addEventListener('popstate', onHistory);
  window.addEventListener('hashchange', onHistory);
  startProjects().finally(() => {
    showView(location.hash.slice(1) || (setup ? 'setup' : 'overview'), false);
    load();
  });
}

function reportError(e) {
  $('workspace-error').textContent = e.message; $('workspace-error').hidden = false;
}
async function get(path, params = {}) {
  const query = scoped(new URLSearchParams(params)).toString();
  const response = await fetch(`/api/${path}${query ? `?${query}` : ''}`), body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}
async function api(path, input) {
  const query = input === undefined && workspace ? `?${scoped(new URLSearchParams())}` : '';
  if (input !== undefined && workspace && path !== 'project-add') input = { ...input, workspace };
  const response = await fetch(`/api/${path}${query}`, input === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-yaw-token': document.querySelector('meta[name="yaw-csrf"]').content }, body: JSON.stringify(input),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}
async function loadMap() {
  const map = await api('code-map');
  $('map-content').textContent = map.content || 'No saved code map. Enable it here with yaw add code-map, then run yaw map update.';
  $('map-areas').replaceChildren(table(['Area', 'Paths', 'Entry points', 'Tests', 'Related areas', 'Decisions'], map.areas.map((a) =>
    [a.title, a.paths.join(', '), a.entry.join(', '), a.tests.join(', '), a.relates.join(', '), a.adrs.join(', ')])));
}
async function loadNotifications() {
  const cfg = await api('notifications'), root = $('notification-settings'); root.replaceChildren();
  root.append(el('p', cfg.installed ? 'Comfort is enabled in this workspace. These notification settings are personal and shared across all comfort-enabled projects.' : 'Comfort is not enabled here. Run yaw add comfort in this workspace. Quick keeps it optional; Full includes it by default.'));
  const fields = {};
  const field = (name, title, type, value) => {
    const label = el('label', title), input = el('input'); input.type = type;
    if (type === 'checkbox') input.checked = value; else input.value = value;
    label.append(input); root.append(label); fields[name] = input; return input;
  };
  field('enabled', 'Enable notifications (personal setting)', 'checkbox', cfg.enabled);
  field('minutes', 'Minimum run length in minutes', 'number', cfg.minutes);
  const terminal = el('select'); terminal.setAttribute('aria-label', 'Terminal channel');
  for (const name of ['osc9', 'osc777', 'off']) { const o = el('option', name); o.value = name; terminal.append(o); }
  terminal.value = cfg.terminal; root.append(el('p', 'Terminal channel'), terminal);
  field('telegram', 'Enable Telegram', 'checkbox', cfg.telegram.enabled);
  field('tokenEnv', 'Bot token environment variable NAME (not the token)', 'text', cfg.telegram.tokenEnv);
  field('chatIdEnv', 'Chat ID environment variable NAME (not the ID)', 'text', cfg.telegram.chatIdEnv);
  root.append(el('p', `Telegram environment: ${cfg.telegramReady ? 'configured' : 'not configured'}. Enter credentials in your shell before starting yaw web; never paste them here. Restart an existing background server to pick up environment changes. ntfy: ${cfg.ntfyConfigured ? 'configured in comfort.yaml' : 'not configured'}.`));
  const status = el('p', cfg.delivery ? `Last background delivery: ${cfg.delivery.ok ? 'sent' : 'failed'} · ${date(cfg.delivery.date)}` : '');
  root.append(button('Save personal settings', async () => {
    try {
      const result = await api('notifications', { enabled: fields.enabled.checked, minutes: Number(fields.minutes.value), terminal: terminal.value,
        telegram: { enabled: fields.telegram.checked, tokenEnv: fields.tokenEnv.value, chatIdEnv: fields.chatIdEnv.value } });
      status.textContent = result.message;
    } catch (e) { reportError(e); }
  }), button('Send test notification', async () => {
    if (!confirm('Send a test notification through the configured remote channels?')) return;
    try { status.textContent = (await api('notification-test', { confirm: true })).message; } catch (e) { reportError(e); }
  }), status);
}
