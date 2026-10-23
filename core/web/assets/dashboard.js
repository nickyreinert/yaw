// Dashboard client (#172). Builds every node with textContent; no HTML from data is ever parsed.

const $ = (sel) => document.querySelector(sel);

function el(tag, text, cls) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (cls) node.className = cls;
  return node;
}

function table(headers, rows) {
  const t = el('table');
  const head = t.createTHead().insertRow();
  for (const h of headers) head.append(el('th', h));
  const body = t.createTBody();
  for (const row of rows) {
    const tr = body.insertRow();
    for (const cell of row) tr.append(el('td', cell ?? ''));
  }
  return t;
}

function facts(pairs) {
  const dl = el('dl');
  for (const [k, v] of pairs) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    dl.append(el('dt', k), el('dd', Array.isArray(v) ? v.join(', ') : v));
  }
  return dl;
}

const hours = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);
const when = (iso) => (iso ? iso.replace('T', ' ').slice(0, 16) : '');

function fill(id, ...nodes) {
  const body = document.querySelector(`#${id} .body`);
  body.replaceChildren(...nodes);
}

function problem(section, hint) {
  if (section?.error) return [el('p', `Could not read: ${section.error}`, 'warn')];
  if (section?.available === false) return [el('p', hint)];
  return null;
}

function stats(s) {
  const nodes = [facts([['Sessions', s.sessions], ['Time (start to last activity)', hours(s.minutes)]])];
  const agents = Object.entries(s.byAgent);
  if (agents.length) nodes.push(table(['Agent', 'Sessions', 'Time'], agents.map(([a, v]) => [a, v.sessions, hours(v.minutes)])));
  const days = Object.entries(s.last30Days).sort();
  if (days.length) {
    const max = Math.max(...days.map(([, n]) => n));
    const chart = el('div', null, 'bars');
    chart.setAttribute('aria-label', 'Sessions per day, last 30 days');
    for (const [day, n] of days) {
      const row = el('div', null, 'bar');
      const fillBar = el('span');
      fillBar.className = `w${Math.max(1, Math.round((n / max) * 10))}`;
      row.append(el('span', day, 'day'), fillBar, el('span', n, 'n'));
      chart.append(row);
    }
    nodes.push(el('h3', 'Last 30 days'), chart);
  }
  return nodes;
}

function render(data) {
  const p = data.project;
  if (p.error) fill('project', el('p', `Could not read the project: ${p.error}`, 'warn'));
  else {
    $('#title').textContent = `YAW dashboard: ${p.name}`;
    fill('project', facts([
      ['Idea', p.idea], ['Folder', p.root], ['Setup', p.mode], ['Agents', p.agents], ['Stack profile', p.profiles],
      ['Modules', p.modules], ['Tasks live in', p.tasks === 'github' ? 'GitHub issues' : p.tasks === 'both' ? 'TASKS.md, mirrored to GitHub' : p.tasks], ['Kit', p.kit],
    ]));
  }

  const s = data.sessions;
  const noRegistry = 'No session registry yet. Sessions are recorded by the sessions module when an agent starts in a YAW project (~/.yaw/yaw.db).';
  const none = problem(s, noRegistry);
  if (none) {
    fill('sessions', ...none);
    fill('all', ...problem(s, noRegistry));
  } else {
    const recent = s.project.recent;
    fill('sessions', ...stats(s.project), el('h3', 'Recent sessions'),
      recent.length ? table(['Started', 'Agent', 'Title', 'Branch', 'Time', 'Commits', 'Tasks'],
        recent.map((r) => [when(r.started), r.agent, r.title, r.branch, hours(r.minutes), r.commits, r.tasks]))
        : el('p', 'No sessions recorded for this project yet.'));
    fill('all', ...stats(s.all), el('h3', 'Projects'),
      table(['Project', 'Sessions', 'Time', 'Last session'], s.all.projects.map((x) => [x.project, x.sessions, hours(x.minutes), when(x.last)])));
  }

  const t = data.tasks;
  const noTasks = problem(t, 'No TASKS.md in this project.');
  if (noTasks) fill('tasks', ...noTasks);
  else {
    const nodes = [];
    if (t.readOnly) nodes.push(el('p', 'Read-only view of GitHub issues (just task sync refreshes it).'));
    nodes.push(el('h3', `Active (${t.active.length})`));
    nodes.push(t.active.length ? table(['ID', 'Title', 'Status', 'Progress'], t.active.map((x) => [x.issue ? `${x.id} (#${x.issue})` : x.id, x.title, x.status, x.progress !== undefined ? `${x.progress} %` : ''])) : el('p', 'Nothing in progress.'));
    nodes.push(el('h3', `Backlog (${t.backlog.length})`));
    nodes.push(t.backlog.length ? table(['ID', 'Title', 'Note'], t.backlog.map((x) => [x.issue ? `${x.id} (#${x.issue})` : x.id, x.title, x.note])) : el('p', 'The backlog is empty.'));
    fill('tasks', ...nodes);
  }

  const d = data.decisions;
  const noDecisions = problem(d, 'No .decisions/ folder in this project.');
  if (noDecisions) fill('decisions', ...noDecisions);
  else fill('decisions', d.entries.length
    ? table(['ID', 'Date', 'Decision', 'Status', 'Importance'], [...d.entries].reverse().map((x) => [x.id, x.date, x.summary, x.status, x.importance]))
    : el('p', 'No decisions recorded yet.'));

  $('#status').textContent = `Updated ${when(data.generated)} UTC.`;
}

async function load() {
  $('#status').textContent = 'Loading…';
  $('#error').hidden = true;
  try {
    const res = await fetch('/api/dashboard', { headers: { accept: 'application/json' } });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    render(body);
  } catch (e) {
    $('#error').textContent = `The dashboard could not load: ${e.message}. Is yaw web still running?`;
    $('#error').hidden = false;
    $('#status').textContent = '';
  }
}

$('#refresh').addEventListener('click', load);
load();
