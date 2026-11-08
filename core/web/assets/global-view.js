import { renderOverviewMetrics, summarizeOverview } from './overview-metrics.js';
// Global Overview, Analytics (also Workspace → Analytics, locked to the open project) and Global Tasks.
// One column browser drives every card, chart and table; filters, split and table state live in the URL. It
// also holds Refresh / Auto / Classify, scoped to all workspaces (Global) or the open one (Workspace).
// Rows are metadata only; all text goes into text nodes and colours are set through CSSOM.
import { FACET_KEYS, matchesFacets, changeFacet, readFacets, renderFacetBrowser, UNAVAILABLE } from './analytics-filters.js';
import { createInsights } from './insights-view.js';
import { toolOutputTable } from './tool-output.js';
const $ = (id) => document.getElementById(id);
function h(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'on') for (const [e, f] of Object.entries(v)) n.addEventListener(e, f);
    else if (k === 'class') n.className = v;
    else if (k === 'style') Object.assign(n.style, v);
    else if (k === 'value') n.value = v;
    else if (['checked', 'selected', 'disabled'].includes(k)) n[k] = Boolean(v);
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  n.append(...flat(kids));
  return n;
}
const flat = (kids) => kids.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false).map((x) => x instanceof Node ? x : String(x));
const fill = (node, ...kids) => node.replaceChildren(...flat(kids));
const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...kids) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); n.append(...kids); return n; };

const DAY = 86400000;
const fmt = (n) => n === null || n === undefined ? '—' : Number(n).toLocaleString('en');
const dur = (m) => m === null || m === undefined ? '—' : m >= 60 ? `${Math.floor(m / 60)}h ${Math.round(m % 60)}m` : `${Math.round(m)}m`;
const short = (n) => n === null || n === undefined || !Number.isFinite(n) ? '—' : n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n * 10) / 10);
const day = (t) => new Date(t).toISOString().slice(0, 10);
const base = (p) => p.split('/').filter(Boolean).pop() ?? p;
const tokens = (r) => r.tokensIn === null ? 0 : r.tokensIn + (r.tokensOut ?? 0);
const sum = (rows, f) => rows.reduce((n, r) => n + (f(r) ?? 0), 0);
const median = (list) => { const x = list.filter((v) => v !== null && v !== undefined).sort((a, b) => a - b); return x.length ? x[Math.floor(x.length / 2)] : null; };
const metric = (label, value, note) => h('div', { class: 'metric' }, h('span', { class: 'eyebrow' }, label), h('strong', {}, value), note ? h('span', { class: 'muted' }, note) : null);
const measured = (r) => r.prompts !== null;
const syncedNote = (n) => `${fmt(n)} synced session${n === 1 ? '' : 's'} · project paths unavailable`;

const DEFAULTS = { path: '', project: [], device: [], folder: [], agent: [], model: [], language: [], period: '90', from: '', to: '', split: 'agent', table: 'sessions', improveView: 'projects', improveFocus: 'attention' };
const FILTERS = ['path', ...FACET_KEYS, 'period', 'from', 'to', 'split'];
const KEYS = { 'global-improve': [...FILTERS, 'device', 'improveView', 'improveFocus'], global: [...FILTERS, 'device'], 'global-analytics': [...FILTERS, 'device', 'table'], analytics: ['agent', 'model', 'period', 'from', 'to', 'split', 'table'], 'global-tasks': ['path', 'project'] };
const DIMS = [['none', 'None'], ['agent', 'Agent'], ['model', 'Model'], ['folder', 'Folder'], ['project', 'Project']];
const PALETTE = ['#2154c7', '#49b8cc', '#cf713d', '#7455ac', '#ca5c54', '#42846b', '#142d46', '#8b9cab'];
const AGENT_COLOR = { claude: '#cc6b3e', codex: '#2154c7', copilot: '#297c68', gemini: '#7455ac' };
const TABLES = [['sessions', 'Sessions'], ['lengths', 'Lengths & timing'], ['agents', 'Agents'], ['models', 'Models'], ['folders', 'Folders'], ['projects', 'Projects'], ['outcomes', 'Outcomes'], ['tooloutput', 'Tool output']];
const TABLE_IDS = { folders: 'folders-s' };

export function createGlobal({ get, api, report, openProject, replace, onData, afterCollect }) {
  const insights = createInsights({ api, get });
  const state = { ...DEFAULTS }, tables = {}, facetSearches = {}, autoDone = new Set(), job = { busy: null, message: '', error: false };
  let prefs = null, improvePrefs = null;
  let route = null, data = null, loading = null, NOW = Date.now();
  let ROOT = '/', ROOTP = '', PROJECTS = [], DEVICES = [], S;
  const locked = () => route === 'analytics';
  const rel = (p) => p === ROOTP ? base(p) : p.startsWith(ROOT) ? p.slice(ROOT.length) : p;
  const path = () => state.path ? ROOT + state.path : ROOTP;
  const inPath = (p) => !state.path || (`${p}/`).startsWith(`${path()}/`);
  const under = (p, dir) => p === dir || p.startsWith(`${dir}/`);
  const known = (p) => data?.projects.includes(p);

  // ---------- data ----------
  function prepare(body) {
    data = body; NOW = Date.now();
    const roots = [...new Set([...(body.rows ?? []).map((r) => r.project), ...(body.tasks ?? []).map((t) => t.project), ...(body.projects ?? [])])]
      .filter((p) => typeof p === 'string' && p.startsWith('/')).sort();
    // The shared folder of the innermost projects is the drill-down root, so a project in a parent folder (like the
    // home folder) does not flatten the tree; such projects sit next to the top folders. One project drills from its parent.
    const parts = roots.filter((p) => !roots.some((q) => q.startsWith(`${p}/`))).map((p) => p.split('/').filter(Boolean));
    let common = parts[0] ?? [];
    for (const p of parts) { let i = 0; while (i < common.length && common[i] === p[i]) i++; common = common.slice(0, i); }
    if (parts.length && parts.some((p) => p.length === common.length)) common = common.slice(0, -1);
    ROOTP = common.length ? `/${common.join('/')}` : ''; ROOT = `${ROOTP}/`;
    PROJECTS = roots;
    const devices = new Map((body.rows ?? []).map((r) => [r.deviceId, r.deviceName]));
    devices.set('local', 'This device');
    DEVICES = [...devices].map(([id, name]) => ({ id, name })).sort((a, b) => a.id === 'local' ? -1 : b.id === 'local' ? 1 : a.name.localeCompare(b.name));
    onData?.(body);
  }
  const deviceLabel = (id) => {
    const d = DEVICES.find((x) => x.id === id);
    if (!d) return id;
    const duplicates = DEVICES.filter((x) => x.name === d.name).length > 1;
    return duplicates ? `${d.name} (${d.id === 'local' ? 'local' : d.id.slice(0, 8)})` : d.name;
  };
  async function load(force = false) {
    if (force) insights.reset();
    if (data && !force) return data;
    loading ??= get('sessions').then(prepare).finally(() => { loading = null; });
    await loading; return data;
  }

  // ---------- URL ----------
  function readQuery(qs) {
    const p = new URLSearchParams(qs);
    for (const k of Object.keys(DEFAULTS)) if (!FACET_KEYS.includes(k)) state[k] = p.get(k) ?? DEFAULTS[k];
    Object.assign(state, readFacets(p, locked() ? 'workspace' : 'global'));
    for (const k of Object.keys(tables)) delete tables[k];
    for (const [k, v] of p) {
      const m = /^(q|sort|page)\.([\w-]+)$/.exec(k); if (!m) continue;
      const t = tables[m[2]] ??= {};
      if (m[1] === 'sort') { [t.sort, t.dir] = v.split('.'); t.sortSet = true; } else t[m[1]] = m[1] === 'page' ? Number(v) || 1 : v;
    }
    if (!['7', '30', '90', 'all'].includes(state.period)) state.period = DEFAULTS.period;
    if (!DIMS.some(([d]) => d === state.split) || (locked() && ['folder', 'project'].includes(state.split))) state.split = DEFAULTS.split;
  }
  const visibleTables = () => route === 'global-improve' ? [`improve-${state.improveView}`] : route === 'global' ? ['folders'] : route === 'global-tasks' ? ['tasks'] : [TABLE_IDS[state.table] ?? state.table];
  function writeUrl() {
    if (!route) return;
    const p = new URLSearchParams();
    for (const k of new Set(KEYS[route] ?? [])) {
      if (FACET_KEYS.includes(k)) { for (const value of state[k]) p.append(k, value); }
      else if (state[k] !== DEFAULTS[k]) p.set(k, state[k]);
    }
    for (const [id, t] of Object.entries(tables)) {
      if (!visibleTables().includes(id)) continue;
      if (t.q) p.set(`q.${id}`, t.q);
      if (t.sort && t.sortSet) p.set(`sort.${id}`, `${t.sort}.${t.dir}`);
      if (t.page > 1) p.set(`page.${id}`, t.page);
    }
    const url = `#${route}${p.size ? `?${p.toString().replaceAll('%2F', '/')}` : ''}`;
    replace(url);
  }
  function set(changes) {
    const active = document.activeElement, browser = active?.closest('.facet-browser');
    const focus = browser ? active.getAttribute('aria-label') : null;
    const slot = browser?.closest('.gfilter-slot');
    const scrolls = browser ? [...browser.querySelectorAll('.facet-list')].map((n) => n.scrollTop) : [];
    for (const key of FACET_KEYS) if (key in changes && !Array.isArray(changes[key])) changes[key] = changes[key] ? [changes[key]] : [];
    Object.assign(state, changes); for (const t of Object.values(tables)) t.page = 1; writeUrl(); render();
    if (focus && slot) {
      [...slot.querySelectorAll('.facet-list')].forEach((n, i) => { n.scrollTop = scrolls[i] ?? 0; });
      [...slot.querySelectorAll('input')].find((n) => n.getAttribute('aria-label') === focus)?.focus({ preventScroll: true });
    }
  }

  // ---------- filtering ----------
  function bounds() {
    const rows = data?.rows ?? [];
    const to = state.to ? Date.parse(state.to) + DAY : NOW;
    let from = state.from ? Date.parse(state.from) : NOW - Number(state.period) * DAY;
    if (!state.from && state.period === 'all') {
      const deviceRows = state.device.length ? rows.filter((r) => state.device.includes(r.deviceId)) : rows;
      from = deviceRows.reduce((m, r) => Math.min(m, r.started), NOW - DAY);
    }
    return [from, Math.max(from + DAY, to)];
  }
  function scopeRows() {
    const [from, to] = bounds();
    return (data?.rows ?? []).filter((r) => (locked() ? r.project === data.current : inPath(r.project)) && r.started >= from && r.started < to);
  }
  function filtered() { return scopeRows().filter((r) => matchesFacets(r, state, undefined, ROOTP)); }
  const projectMatches = (project) => inPath(project) && matchesFacets({ project }, state, ['folder', 'project'], ROOTP);
  function folders() {
    const out = new Set(['']);
    for (const p of PROJECTS.filter((x) => x.startsWith(ROOT))) { const parts = rel(p).split('/'); for (let i = 1; i < parts.length; i++) out.add(parts.slice(0, i).join('/')); }
    return [...out].sort();
  }
  const folderOf = (r) => {
    if (r.project === path()) return './';
    if (!r.project.startsWith(`${path()}/`)) return r.project;
    const rest = r.project.slice(path().length + 1).split('/'); return rest.length > 1 ? `${rest[0]}/` : rest[0];
  };

  // ---------- split ----------
  function splitValue(r) {
    switch (state.split) {
      case 'agent': return r.agent;
      case 'model': return r.model;
      case 'project': return base(r.project);
      case 'folder': return folderOf(r);
      default: return 'All sessions';
    }
  }
  function makeSplit(rows) {
    const counts = new Map();
    for (const r of rows) counts.set(splitValue(r), (counts.get(splitValue(r)) ?? 0) + 1);
    let keys = [...counts].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    if (keys.length > 8) keys = [...keys.slice(0, 7), 'Other'];
    if (!keys.length) keys = ['All sessions'];
    const color = (k) => state.split === 'agent' && AGENT_COLOR[k] ? AGENT_COLOR[k] : k === 'Other' ? '#c9d3cf' : PALETTE[keys.indexOf(k) % PALETTE.length];
    return { keys, color, keyOf: (r) => { const k = splitValue(r); return keys.includes(k) ? k : 'Other'; } };
  }
  const legend = () => state.split === 'none' ? null : h('div', { class: 'legend' }, S.keys.map((k) => h('span', {}, h('i', { style: { background: S.color(k) } }), k)));

  // ---------- charts ----------
  function timeBuckets(rows) {
    const [from, to] = bounds(), span = (to - from) / DAY, size = span > 730 ? 30 : span > 120 ? 7 : 1, n = Math.max(1, Math.ceil(span / size));
    const buckets = Array.from({ length: n }, (_, i) => ({ label: day(from + i * size * DAY), rows: [] }));
    for (const r of rows) { const i = Math.floor((r.started - from) / (size * DAY)); if (buckets[i]) buckets[i].rows.push(r); }
    return { buckets, unit: size === 30 ? 'month' : size === 7 ? 'week' : 'day' };
  }
  function bins(rows, value, edges) {
    const list = rows.map((r) => [r, value(r)]).filter(([, v]) => v !== null && v !== undefined && Number.isFinite(v));
    return edges.map((b, i) => ({ label: i === 0 ? `≤ ${short(b)}` : b === Infinity ? `> ${short(edges[i - 1])}` : `${short(edges[i - 1])}–${short(b)}`,
      rows: list.filter(([, v]) => v > (edges[i - 1] ?? -Infinity) && v <= b).map(([r]) => r) }));
  }
  function columns(buckets, value = () => 1, { wide = false, unit = '' } = {}) {
    const W = wide ? 800 : 380, H = wide ? 110 : 130, bw = W / buckets.length, dense = wide || buckets.length > 12;
    const totals = buckets.map((b) => sum(b.rows, value)), max = Math.max(1, ...totals);
    const svg = s('svg', { viewBox: `0 0 ${W} ${H + 30}`, class: 'chart', role: 'img', 'aria-label': 'Stacked column chart' });
    buckets.forEach((b, i) => {
      let y = H;
      for (const k of S.keys) {
        const v = sum(b.rows.filter((r) => S.keyOf(r) === k), value); if (!v) continue;
        const hh = v / max * (H - 14);
        svg.append(s('rect', { x: i * bw + (bw > 8 ? 2 : 0.5), y: y - hh, width: Math.max(1, bw - (bw > 8 ? 4 : 1)), height: hh, fill: S.color(k) },
          s('title', {}, `${b.label}${state.split === 'none' ? '' : ` · ${k}`}: ${short(v)}${unit}`)));
        y -= hh;
      }
      if (!dense) svg.append(s('text', { x: i * bw + bw / 2, y: H - totals[i] / max * (H - 14) - 3, 'text-anchor': 'middle' }, short(totals[i])));
    });
    const last = buckets.length - 1, ticks = dense ? [0, Math.floor(last / 2), last] : buckets.map((_, i) => i);
    for (const i of new Set(ticks)) {
      const anchor = dense && last > 0 ? (i === 0 ? 'start' : i === last ? 'end' : 'middle') : 'middle';
      svg.append(s('text', { x: anchor === 'start' ? i * bw : anchor === 'end' ? (i + 1) * bw : i * bw + bw / 2, y: H + 14, 'text-anchor': anchor }, buckets[i].label));
    }
    if (dense) svg.append(s('text', { x: 0, y: 10 }, `max ${short(max)}${unit}`));
    return svg;
  }
  function bars(groups, value = () => 1, unit = '') {
    if (!groups.length) return h('p', { class: 'muted' }, 'No sessions in this selection.');
    const totals = groups.map((g) => sum(g.rows, value)), max = Math.max(1, ...totals);
    return h('div', { class: 'hbars' }, groups.map((g, i) => h('div', { class: 'hbar' },
      h('span', { title: g.label }, g.label),
      h('div', { class: 'bar' }, S.keys.map((k) => { const v = sum(g.rows.filter((r) => S.keyOf(r) === k), value); return v ? h('span', { style: { width: `${v / max * 100}%`, background: S.color(k) }, title: `${k}: ${short(v)}${unit}` }) : null; })),
      h('span', {}, short(totals[i]) + unit))));
  }
  const groupBy = (rows, key) => { const m = new Map(); for (const r of rows) { const k = key(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return [...m].map(([label, list]) => ({ label, rows: list })); };
  const bySize = (groups) => groups.sort((a, b) => b.rows.length - a.rows.length).slice(0, 15);
  function scatter(rows, fx, fy, xl, yl) {
    const W = 380, H = 190, pts = rows.map((r) => ({ r, x: fx(r), y: fy(r) })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).slice(0, 2000);
    const mx = Math.max(1, ...pts.map((p) => p.x)), my = Math.max(1, ...pts.map((p) => p.y));
    const svg = s('svg', { viewBox: `0 0 ${W + 30} ${H + 30}`, class: 'chart', role: 'img', 'aria-label': `${xl} versus ${yl}` });
    svg.append(s('line', { x1: 28, y1: H, x2: W + 28, y2: H, stroke: '#d9e3df' }), s('line', { x1: 28, y1: 0, x2: 28, y2: H, stroke: '#d9e3df' }));
    for (const p of pts) svg.append(s('circle', { cx: 28 + p.x / mx * W, cy: H - p.y / my * (H - 6), r: 3.2, fill: S.color(S.keyOf(p.r)), 'fill-opacity': 0.75 }, s('title', {}, `${p.r.title || p.r.id} · ${S.keyOf(p.r)}: ${short(p.x)} ${xl}, ${short(p.y)} ${yl}`)));
    svg.append(s('text', { x: 30, y: H + 16 }, `${xl} → (max ${short(mx)})`), s('text', { x: 32, y: 10 }, `↑ ${yl} (max ${short(my)})`));
    return svg;
  }
  function heatmap(rows) {
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const r of rows) { const d = new Date(r.started); grid[(d.getUTCDay() + 6) % 7][d.getUTCHours()]++; }
    const max = Math.max(1, ...grid.flat());
    return h('div', { class: 'heat' }, h('span'), Array.from({ length: 24 }, (_, i) => h('span', {}, i % 3 ? '' : String(i))),
      ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => [h('span', {}, d), grid[i].map((v, hr) => h('div', { title: `${d} ${hr}:00 · ${v} sessions`, style: { background: `rgba(23,62,73,${v ? 0.12 + v / max * 0.88 : 0.04})` } }))]));
  }
  const chart = (title, sub, body, wide = false) => h('article', { class: `card${wide ? ' wide' : ''}` }, h('div', { class: 'chart-head' }, h('h2', {}, title), sub ? h('span', { class: 'small muted' }, sub) : null), body);

  // ---------- tables: filter, sort, page ----------
  function dataTable(id, cols, rows, { pageSize = 20, sort, dir = 'desc', note } = {}) {
    const t = tables[id] ??= {};
    if (t.sort && !cols.some((c) => c.key === t.sort && c.sortable !== false)) { t.sort = undefined; t.sortSet = false; }
    t.sort ??= sort; t.dir = t.dir === 'asc' || t.dir === 'desc' ? t.dir : dir; t.page ??= 1;
    const input = h('input', { type: 'search', placeholder: 'Filter rows…', value: t.q ?? '', 'aria-label': 'Filter table rows' });
    const info = h('span', { class: 'small muted' }), body = h('div'), pager = h('div', { class: 'pager' });
    const text = (c, r) => c.text ? c.text(r) : String(c.value(r) ?? '');
    const draw = () => {
      const q = (t.q ?? '').toLowerCase();
      const list = rows.filter((r) => !q || cols.some((c) => text(c, r).toLowerCase().includes(q)));
      const c = cols.find((x) => x.key === t.sort);
      if (c) list.sort((a, b) => {
        const x = c.value(a), y = c.value(b);
        if (x === null || x === undefined) return y === null || y === undefined ? 0 : 1;
        if (y === null || y === undefined) return -1;
        const d = typeof x === 'number' ? x - y : String(x).localeCompare(String(y));
        return t.dir === 'asc' ? d : -d;
      });
      const pages = Math.max(1, Math.ceil(list.length / pageSize)); t.page = Math.min(Math.max(1, t.page), pages);
      const slice = list.slice((t.page - 1) * pageSize, t.page * pageSize);
      fill(body, h('div', { class: 'table-scroll' }, h('table', { class: 'dt' },
        h('thead', {}, h('tr', {}, cols.map((x) => h('th', { scope: 'col', 'aria-sort': t.sort === x.key ? (t.dir === 'asc' ? 'ascending' : 'descending') : null, class: x.num ? 'num' : '' },
          x.sortable === false ? x.label : h('button', { type: 'button', class: 'sort', on: { click: () => { t.dir = t.sort === x.key && t.dir === 'desc' ? 'asc' : 'desc'; t.sort = x.key; t.sortSet = true; t.page = 1; writeUrl(); draw(); } } },
            x.label, h('span', { class: 'arrow', 'aria-hidden': 'true' }, t.sort === x.key ? (t.dir === 'asc' ? '↑' : '↓') : '↕')))))),
        h('tbody', {}, slice.length ? slice.map((r) => h('tr', {}, cols.map((x) => h('td', { class: x.num ? 'num' : '' }, x.show ? x.show(r) : text(x, r)))))
          : h('tr', {}, h('td', { colspan: cols.length, class: 'muted' }, 'No matching rows.'))))));
      info.textContent = `${list.length === rows.length ? fmt(rows.length) : `${fmt(list.length)} of ${fmt(rows.length)}`} rows`;
      fill(pager, h('span', { class: 'small muted' }, `Page ${t.page}/${pages}`),
        h('button', { type: 'button', disabled: t.page <= 1, on: { click: () => { t.page--; writeUrl(); draw(); } } }, '← Previous'),
        h('button', { type: 'button', disabled: t.page >= pages, on: { click: () => { t.page++; writeUrl(); draw(); } } }, 'Next →'));
    };
    input.addEventListener('input', () => { t.q = input.value; t.page = 1; writeUrl(); draw(); });
    draw();
    return h('div', { class: 'dt-wrap' }, h('div', { class: 'dt-tools' }, input, info, note ? h('span', { class: 'small muted' }, note) : null), body, pager);
  }
  const num = (key, label, value, show) => ({ key, label, value, num: true, text: show ? (r) => String(show(r)) : (r) => short(value(r)), show });
  const str = (key, label, value, show) => ({ key, label, value, text: (r) => String(value(r) ?? '—'), show });

  // ---------- sticky filter bar ----------
  // The filter bar shrinks to two rows (lists become dropdowns) once the page scrolls; the button overrides that until reload.
  let compactAuto = false, compactManual = null;
  const filterCompact = () => compactManual ?? compactAuto;
  function setCompact(value, manual = false) {
    if (manual) compactManual = value; else compactAuto = value;
    for (const bar of document.querySelectorAll('.gfilter.analytics-filter')) {
      bar.classList.toggle('compact', filterCompact());
      const button = bar.querySelector('.filter-toggle');
      if (button) { button.textContent = filterCompact() ? 'Expand filters' : 'Collapse filters'; button.setAttribute('aria-expanded', String(!filterCompact())); }
      if (!filterCompact()) for (const open of bar.querySelectorAll('.facet-column.open')) open.classList.remove('open');
    }
  }
  // Hysteresis (collapse past 160px, expand again near the top) so the shrinking page cannot make the bar flicker.
  document.addEventListener('scroll', (e) => {
    if (compactManual !== null) return;
    const slot = document.querySelector('.gfilter-slot:has(.analytics-filter)');
    const box = e.target === document ? document.scrollingElement : e.target;
    if (!slot || !box?.contains?.(slot)) return;
    const top = box.scrollTop;
    if (!compactAuto && top > 160) setCompact(true);
    else if (compactAuto && top < 20) setCompact(false);
  }, true);

  function filterBar(mode) {
    const end = [];
    const select = (label, key, options, all, display = (o) => o) => h('label', key === 'language' ? { title: 'Project programming language: configured in YAW or detected from local file names. Unknown when no evidence is available.' } : {}, label, h('select', { on: { change: (e) => set({ [key]: e.target.value }) } },
      h('option', { value: '' }, all), options.map((o) => h('option', { value: o, selected: Array.isArray(state[key]) ? state[key].includes(o) : state[key] === o }, display(o)))));
    const seg = (label, key, opts) => h('div', { class: 'lbl', role: 'group', 'aria-label': label }, h('span', {}, label), h('div', { class: 'presets' }, opts.map(([v, l]) =>
      h('button', { type: 'button', 'aria-pressed': String(state[key] === v && (key !== 'period' || (!state.from && !state.to))), on: { click: () => set(key === 'period' ? { period: v, from: '', to: '' } : { [key]: v }) } }, l))));
    const bar = h('div', { class: 'gfilter', role: 'search', 'aria-label': 'Filter all charts and tables on this page' });
    if (mode === 'tasks') {
      bar.append(h('label', {}, 'Folder', h('select', { on: { change: (e) => set({ path: e.target.value, project: [] }) } }, folders().map((f) => h('option', { value: f, selected: state.path === f }, f ? `${f}/` : 'All folders')))),
        select('Project', 'project', PROJECTS.filter(inPath), 'All projects', rel));
    } else {
      bar.classList.add('analytics-filter');
      if (locked()) bar.classList.add('workspace-filter');
      const facets = renderFacetBrowser({ rows: scopeRows(), selection: state, scope: locked() ? 'workspace' : 'global', root: ROOTP, searches: facetSearches[route] ??= {},
        label: (key, value) => value === UNAVAILABLE ? 'Unavailable (synced)' : key === 'device' ? deviceLabel(value) : key === 'project' ? (PROJECTS.filter((p) => base(p) === base(value)).length > 1 ? `${base(value)} · ${rel(value)}` : base(value)) : key === 'folder' ? rel(value) || base(value) : value,
        onChange: (key, values) => {
          const rows = scopeRows();
          set(changeFacet(rows, state, key, values, ROOTP));
        } });
      const dates = h('div', { class: 'analytics-dates' },
        seg('Period', 'period', [['7', '7 d'], ['30', '30 d'], ['90', '90 d'], ['all', 'All']]),
        h('label', {}, 'From', h('input', { type: 'date', value: state.from, on: { change: (e) => set({ from: e.target.value }) } })),
        h('label', {}, 'To', h('input', { type: 'date', value: state.to, on: { change: (e) => set({ to: e.target.value }) } })),
        seg('Split charts by', 'split', locked() ? DIMS.slice(0, 3) : DIMS));
      bar.append(...(locked() ? [h('div', { class: 'workspace-filter-row' }, facets, dates)] : [facets, dates]));
    }
    if (mode !== 'tasks') {
      if (filterCompact()) bar.classList.add('compact');
      end.push(h('button', { type: 'button', class: 'filter-toggle', 'aria-expanded': String(!filterCompact()), title: 'Show the filter lists, or shrink them to two rows',
        on: { click: () => setCompact(!filterCompact(), true) } }, filterCompact() ? 'Expand filters' : 'Collapse filters'));
    }
    bar.append(h('div', { class: 'gfilter-end' }, mode === 'tasks' ? null : h('strong', {}, `${fmt(filtered().length)} sessions`),
      ['sessions', 'improve', 'overview'].includes(mode) ? collectControls() : null,
      ...end,
      h('button', { type: 'button', title: 'Clear filters, list searches and chart split', on: { click: () => { facetSearches[route] = {}; set({ ...DEFAULTS, table: state.table }); } } }, 'Reset')));
    if (['sessions', 'improve', 'overview'].includes(mode)) bar.append(collectStatus());
    return bar;
  }

  // ---------- Refresh / Auto / Classify ----------
  const scopeText = () => locked() ? 'this workspace' : 'all discovered workspaces';
  const periodText = () => state.from || state.to ? 'all history (a custom date range scans everything)' : state.period === 'all' ? 'all history' : `the last ${state.period} days`;
  const improveEligible = () => filtered().filter((r) => r.source !== 'synced' && r.prompts !== null);
  const improveToClassify = () => { const rows = improveEligible(), pending = rows.filter((r) => !r.evaluation); return pending.length ? pending : rows; };
  function collectControls() {
    if (route === 'global-improve') {
      const rows = improveToClassify(), pending = rows.some((r) => !r.evaluation);
      return h('div', { class: 'collect-actions' },
        h('button', { type: 'button', disabled: Boolean(job.busy), on: { click: () => run(false) }, title: 'Refresh saved metadata from configured local histories.' }, '↻ Refresh'),
        h('button', { type: 'button', class: 'primary', disabled: Boolean(job.busy) || !rows.length, on: { click: () => run(true) } }, job.busy === 'classify' ? 'Classifying…' : `${pending ? 'Classify' : 'Reclassify'} ${rows.length} ${pending ? 'unclassified' : 'filtered'} sessions`),
        h('a', { href: '#global-settings/classification', class: 'small' }, 'Classification settings'));
    }
    const busy = Boolean(job.busy), endpoint = prefs?.classifier?.endpoint ?? 'http://127.0.0.1:8000';
    return h('div', { class: 'collect-actions', role: 'group', 'aria-label': 'Collect session data' },
      h('button', { type: 'button', disabled: busy, on: { click: () => run(false) },
        title: `Refresh: read the local Claude Code, Codex and Copilot CLI transcripts of ${scopeText()} for ${periodText()} and save aggregate counts, lengths and timing. No message text is stored and no model runs; unchanged transcripts are reused, so repeat runs are fast. If the request fails, an ad blocker may have blocked this local dashboard request.` },
      job.busy === 'refresh' ? 'Refreshing…' : '↻ Refresh'),
      h('label', { class: 'auto-check', title: `Auto: run Refresh by itself when Analytics opens (once per page load, ${locked() ? 'this workspace here, all workspaces on Global → Analytics' : 'all workspaces here, only the open one on Workspace → Analytics'}). A personal setting; it never classifies.` },
        h('input', { type: 'checkbox', checked: prefs?.autoRefresh, disabled: !prefs || busy, on: { change: (e) => saveAuto(e.target.checked) } }), 'Auto'),
      h('button', { type: 'button', disabled: busy, on: { click: () => run(true) },
        title: `Classify: send each prompt/answer turn of ${scopeText()} in ${periodText()} to your local Laya service at ${endpoint} to estimate outcome, sentiment, assistant behaviour and failure type. Experimental and slow; asks before reading messages. Only the counts are saved. Set Laya up under Global → Settings → Classification.` },
      job.busy === 'classify' ? 'Classifying…' : 'Classify'));
  }
  function collectStatus() {
    const last = data?.history?.collected ? `Last refresh ${new Date(data.history.collected).toLocaleString()} · pages read saved results${prefs?.autoRefresh ? ' · Auto is on' : ''}.` : 'No saved scan yet: press Refresh to read local session history.';
    return h('p', { class: `gfilter-status small${job.error ? ' error-text' : ' muted'}`, role: 'status' }, job.message || last,
      job.error && job.busy === null && !job.classify
        ? ' If the browser blocked the request, check your ad blocker (for example uBlock Origin), allow this local dashboard, then retry.'
        : null,
      job.skipped && job.busy === null ? [' ', h('a', { href: '#global-settings/sessions' }, 'Session history folders →')] :
        job.error && job.busy === null && job.classify ? [' ', h('a', { href: '#global-settings/classification' }, 'Classification settings →')] : null);
  }
  let classifierPoll = 0;
  function drawClassifierJob(jobState) {
    const panel = $('classifier-job');
    if (!panel || !jobState) return;
    panel.hidden = false;
    const active = ['running', 'pausing', 'paused', 'stopping'].includes(jobState.status);
    const progress = $('classifier-job-progress'), message = $('classifier-job-message');
    const summary = $('classifier-job-summary');
    summary.textContent = jobState.status === 'completed' ? 'Classification complete' :
      jobState.status === 'stopped' ? 'Classification stopped' :
        jobState.status === 'failed' ? 'Classification failed' :
          jobState.status === 'pausing' ? 'Finishing current turn before pausing…' :
            jobState.status === 'paused' ? 'Classification paused' :
            jobState.status === 'stopping' ? 'Stopping classification…' : 'Classifying sessions…';
    message.textContent = jobState.message ?? '';
    if (jobState.sessions > 0) {
      progress.max = jobState.sessions;
      const sessionProgress = jobState.turns
        ? (Math.max(0, (jobState.turn ?? 0) - (jobState.complete ? 0 : 1)) / jobState.turns)
        : jobState.sessionComplete ? 1 : 0;
      progress.value = Math.min(Math.max(0, (jobState.session ?? 1) - 1 + sessionProgress), jobState.sessions);
      progress.removeAttribute('aria-valuetext');
      progress.setAttribute('aria-valuetext', `${jobState.session} of ${jobState.sessions} sessions`);
    } else {
      progress.removeAttribute('value');
      progress.removeAttribute('aria-valuetext');
    }
    const controls = $('classifier-job-controls');
    fill(controls, active && jobState.status !== 'stopping'
      ? ['paused', 'pausing'].includes(jobState.status)
        ? h('button', { type: 'button', on: { click: () => controlClassifier('classifier-resume') } }, jobState.status === 'paused' ? 'Resume' : 'Continue now')
        : h('button', { type: 'button', on: { click: () => controlClassifier('classifier-pause') } }, 'Pause after current turn')
      : null,
    active ? h('button', { type: 'button', class: 'danger', disabled: jobState.status === 'stopping',
      on: { click: () => controlClassifier('classifier-stop') } }, 'Stop') : null);
    if (active) panel.open = true;
  }
  async function controlClassifier(action) {
    try { drawClassifierJob(await api(action, {})); }
    catch (e) { report(e); }
  }
  async function monitorClassifier(token) {
    while (token === classifierPoll) {
      try {
        const state = await get('classification-job');
        if (!state) {
          await new Promise((resolve) => setTimeout(resolve, 150));
          continue;
        }
        drawClassifierJob(state);
        if (!['running', 'pausing', 'paused', 'stopping'].includes(state.status)) return;
      } catch (e) { report(e); return; }
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }
  async function saveAuto(on) {
    try {
      const result = await api('preferences', { autoRefresh: on });
      prefs = { ...prefs, autoRefresh: on }; Object.assign(job, { message: result.message, error: false, classify: false });
    } catch (e) { Object.assign(job, { message: e.message, error: true, classify: false }); }
    render();
  }
  async function run(classify) {
    if (job.busy) return;
    const all = !locked();
    const ids = classify && route === 'global-improve' ? improveToClassify().map((r) => r.id) : undefined;
    if (ids && JSON.stringify(ids).length > 200000) { Object.assign(job, { message: 'This classification selection is too large for one request. Narrow the project, date or agent filters.', error: true }); render(); return; }
    const scope = ids ? `${ids.length} saved local sessions matching these filters` : `${scopeText()} for ${periodText()}`;
    if (classify && !confirm(`Classify ${scope}?\n\nYAW reads these conversations and sends eligible turns to local Laya (${prefs?.classifier?.endpoint ?? 'http://127.0.0.1:8000'}). Only aggregate counts are saved. Pause and Stop remain available while it runs.`)) return;
    Object.assign(job, { busy: classify ? 'classify' : 'refresh', error: false, skipped: 0, classify,
      message: classify ? 'Classifying eligible turns with local Laya… this can take a while.' : `Reading local transcripts of ${scopeText()}…` });
    render();
    const poll = classify ? ++classifierPoll : null;
    if (classify) monitorClassifier(poll);
    try {
      const result = await api(classify ? 'evaluate' : 'collect', { all, days: days(), confirm: classify, ...(ids ? { ids } : {}) });
      job.message = result.message;
      job.skipped = result.skipped ?? 0;
      if (classify) await get('classification-job').then(drawClassifierJob);
      if (all) autoDone.add('current');
      autoDone.add(all ? 'all' : 'current');
      await load(true); afterCollect?.();
    } catch (e) { Object.assign(job, { message: e.message, error: true }); }
    finally {
      if (classify) classifierPoll++;
      job.busy = null;
      render();
    }
  }
  const days = () => state.from || state.to ? 'all' : state.period;
  const empty = (node, text) => fill(node, h('article', { class: 'card' }, h('h2', {}, 'No saved sessions'), h('p', {}, text)));
  const noData = 'No registry or saved scan yet. Press Refresh in the filter bar of Analytics to read local session history.';
  const openButton = (root, target, label = 'Open →') => known(root)
    ? h('button', { type: 'button', class: 'open-proj', title: `Open ${root} in the Workspace area`, on: { click: () => openProject(root, target) } }, label)
    : h('span', { class: 'small muted', title: 'Not in the project switcher: run yaw web in that folder or add it there' }, 'not added');

  // ---------- Global overview ----------
  function overview() {
    if (!data.available) { fill($('ov-filter'), filterBar('overview')); for (const id of ['ov-metrics', 'ov-tree', 'ov-crumbs']) fill($(id)); empty($('ov-charts'), noData); return; }
    const rows = filtered(); S = makeSplit(rows);
    fill($('ov-filter'), filterBar('overview'));
    const open = data.tasks.filter((t) => t.available && projectMatches(t.project)).reduce((n, t) => n + t.active.length + t.backlog.length, 0);
    const projects = new Set(rows.filter((r) => r.source !== 'synced').map((r) => r.project)).size;
    const syncedCount = rows.filter((r) => r.source === 'synced').length;
    renderOverviewMetrics($('ov-metrics'), { summary: summarizeOverview(rows), projects, openTasks: open,
      projectNote: syncedCount ? syncedNote(syncedCount) : 'With sessions in range', taskNote: 'Project scope · independent of device' });
    const segs = state.path.split('/').filter(Boolean);
    fill($('ov-crumbs'), h('span', { class: 'root' }, ROOT), h('button', { type: 'button', 'aria-current': segs.length ? null : 'true', on: { click: () => set({ path: '', project: '' }) } }, 'all'),
      segs.map((seg, i) => [h('span', {}, '/'), h('button', { type: 'button', 'aria-current': i === segs.length - 1 ? 'true' : null, on: { click: () => set({ path: segs.slice(0, i + 1).join('/'), project: '' }) } }, seg)]),
      state.project.length ? [h('span', {}, '/'), h('strong', {}, state.project.length === 1 ? base(state.project[0]) : `${state.project.length} projects`), h('button', { type: 'button', class: 'linkish', on: { click: () => set({ project: '' }) } }, '✕ clear project')] : null);
    const kids = new Map();
    // A folder that is also a project drills down; the project itself is listed inside it as ./
    for (const p of PROJECTS) {
      if (!inPath(p)) continue;
      if (p === path() || !p.startsWith(`${path()}/`)) { kids.set(p, { full: p, seg: p === path() ? './' : p, project: true, projects: 1, rows: [] }); continue; }
      const seg = p.slice(path().length + 1).split('/')[0], full = `${path()}/${seg}`;
      const k = kids.get(full) ?? { full, seg, project: true, projects: 0, rows: [] };
      if (p !== full) k.project = false;
      k.projects++; kids.set(full, k);
    }
    for (const r of rows.filter((x) => x.source === 'synced')) {
      const key = `\u0000${r.deviceId}`;
      const k = kids.get(key) ?? { full: key, seg: `Synced · ${deviceLabel(r.deviceId)}`, project: false, projects: 0, rows: [], synced: true };
      k.rows.push(r); kids.set(key, k);
    }
    for (const r of rows) {
      if (r.source === 'synced') continue;
      for (const k of kids.values()) if (!k.synced && (k.project ? r.project === k.full : under(r.project, k.full) && r.project !== path())) k.rows.push(r);
    }
    const list = [...kids.values()], max = Math.max(1, ...list.map((k) => k.rows.length));
    const last = (k) => k.rows.length ? Math.max(...k.rows.map((r) => r.started)) : null;
    fill($('ov-tree'), dataTable('folders', [
      str('name', 'Folder / project', (k) => k.seg, (k) => k.synced ? h('span', {}, k.seg) : h('button', { type: 'button', class: 'name', on: { click: () => k.project ? set({ project: k.full }) : set({ path: rel(k.full), project: '' }) } }, h('span', { 'aria-hidden': 'true' }, k.project ? '◆ ' : '▸ '), k.seg + (k.project ? '' : '/'))),
      num('projects', 'Projects', (k) => k.project || k.synced ? null : k.projects, (k) => k.project || k.synced ? '—' : String(k.projects)),
      num('sessions', 'Sessions', (k) => k.rows.length), num('tokens', 'Tokens', (k) => sum(k.rows, tokens)),
      num('minutes', 'Elapsed', (k) => sum(k.rows, (r) => r.minutes), (k) => dur(sum(k.rows, (r) => r.minutes))),
      str('last', 'Last active', last, (k) => last(k) ? day(last(k)) : '—'),
      { key: 'share', label: `Sessions by ${state.split === 'none' ? 'total' : state.split}`, sortable: false, value: () => null, text: () => '', show: (k) => h('div', { class: 'bar' }, S.keys.map((key) => { const v = k.rows.filter((r) => S.keyOf(r) === key).length; return v ? h('span', { style: { width: `${v / max * 100}%`, background: S.color(key) }, title: `${key}: ${v}` }) : null; })) },
      { key: 'open', label: '', sortable: false, value: () => null, text: () => '', show: (k) => k.project ? openButton(k.full, 'overview') : null },
    ], list, { sort: 'sessions', pageSize: 15 }));
    const t = timeBuckets(rows);
    fill($('ov-charts'),
      chart(`Sessions per ${t.unit}`, 'UTC', [legend(), columns(t.buckets, undefined, { wide: true })], true),
      chart(`Sessions by ${segs.length ? `${segs.at(-1)}/` : 'top folder'}`, 'Current drill-down level', bars(bySize(groupBy(rows, folderOf)))),
      chart('Tokens by model', 'Only agents that report usage', bars(bySize(groupBy(rows, (r) => r.model)), tokens)),
      chart(`Tokens per ${t.unit}`, '', [legend(), columns(t.buckets, tokens, { wide: true })], true),
      chart('When you work', 'Sessions by weekday and hour, UTC · not split', heatmap(rows)),
      chart(`Elapsed hours per ${t.unit}`, 'includes idle time', columns(t.buckets, (r) => (r.minutes ?? 0) / 60, { unit: ' h' })));
  }

  // ---------- Sessions (global, or locked to the workspace) ----------
  function sessions() {
    insights.reset();
    $('ss-charts').hidden = false;
    $('ss-intro').textContent = locked() ? `This workspace · ${data?.current ?? ''}` :
      `${state.device.length ? state.device.map(deviceLabel).join(', ') : 'All devices'} · All projects · local + synced session stats`;
    const labels = document.querySelectorAll('#sessions .metric-group-label');
    // Without data the filter bar stays, so Refresh can collect the first scan.
    if (!data.available) { fill($('ss-filter'), filterBar('sessions')); for (const id of ['ss-metrics', 'ss-insights', 'ss-charts']) fill($(id)); labels.forEach((x) => { x.hidden = true; }); empty($('ss-browse'), noData); return; }
    labels.forEach((x) => { x.hidden = false; });
    const rows = filtered(), m = rows.filter(measured), n = Math.max(1, m.length); S = makeSplit(rows);
    fill($('ss-filter'), filterBar('sessions'));
    const prompts = sum(m, (r) => r.prompts), answers = sum(m, (r) => r.answers), usage = rows.filter((r) => r.tokensIn !== null).length, costs = rows.filter((r) => r.cost !== null).length;
    const projects = new Set(rows.filter((r) => r.source !== 'synced').map((r) => r.project)).size;
    const syncedCount = rows.filter((r) => r.source === 'synced').length;
    fill($('ss-metrics'), metric('Sessions', fmt(rows.length), `${fmt(projects)} projects${syncedCount ? ` · ${syncedNote(syncedCount)}` : ''}`),
      metric('Elapsed', dur(sum(rows, (r) => r.minutes)), `median ${dur(median(rows.map((r) => r.minutes)))} per session`),
      metric('Tokens', usage ? short(sum(rows, tokens)) : '—', `${usage}/${rows.length} usage coverage`),
      metric('Reported cost', costs ? `$${sum(rows, (r) => r.cost).toFixed(2)}` : '—', `${costs}/${rows.length} cost coverage`));
    const resp = median(m.map((r) => r.medianResp)), partial = m.filter((r) => r.partial).length;
    fill($('ss-insights'), metric('Prompts', fmt(prompts), `${(prompts / n).toFixed(1)} per session`), metric('Answers', fmt(answers), `${(answers / n).toFixed(1)} per session`),
      metric('Chars / prompt', fmt(Math.round(sum(m, (r) => r.promptChars) / Math.max(1, prompts))), 'weighted mean'),
      metric('Chars / answer', fmt(Math.round(sum(m, (r) => r.answerChars) / Math.max(1, answers))), 'weighted mean'),
      metric('Response time', resp === null ? '—' : `${resp} s`, 'median of session medians'),
      metric('Measured', `${fmt(m.length)}/${fmt(rows.length)}`, `sessions with scanned transcripts${partial ? ` · ${partial} partial` : ''}`));
    const t = timeBuckets(rows), outcomes = rows.filter((r) => r.outcome);
    const per = (f) => (r) => { const v = f(r); return Number.isFinite(v) ? v : null; };
    fill($('ss-charts'),
      chart(`Sessions per ${t.unit}`, 'UTC', [legend(), columns(t.buckets, undefined, { wide: true })], true),
      chart('Session duration', 'minutes elapsed', columns(bins(rows, (r) => r.minutes, [5, 15, 30, 60, 120, Infinity]))),
      chart('Prompts per session', 'scanned sessions', columns(bins(m, (r) => r.prompts, [2, 5, 10, 20, 40, Infinity]))),
      chart('Answer length', 'mean characters per answer, per session', columns(bins(m, per((r) => r.answerChars / r.answers), [200, 1000, 3000, 6000, Infinity]))),
      chart('Prompt length', 'mean characters per prompt, per session', columns(bins(m, per((r) => r.promptChars / r.prompts), [100, 300, 1000, 3000, Infinity]))),
      chart('Elapsed × answers', 'one dot per session', scatter(m, (r) => r.minutes, (r) => r.answers, 'elapsed min', 'answers')),
      chart('Prompt length × answer length', 'do longer prompts get longer answers?', scatter(m, (r) => r.promptChars / r.prompts, (r) => r.answerChars / r.answers, 'chars/prompt', 'chars/answer')),
      chart('Response time', 'median seconds to first answer, per session', columns(bins(m, (r) => r.medianResp, [5, 10, 20, 30, Infinity]))),
      chart('Tokens by model', 'Only agents that report usage', bars(bySize(groupBy(rows, (r) => r.model)), tokens)),
      chart('Experimental outcomes', `${outcomes.length} classified sessions · local Laya predictions`, bars(bySize(groupBy(outcomes, (r) => r.outcome)))));
    const tabs = locked() ? TABLES.filter(([k]) => !['folders', 'projects'].includes(k)) : TABLES;
    if (!tabs.some(([k]) => k === state.table)) state.table = 'sessions';
    const sub = h('div', { class: 'subtabs', role: 'group', 'aria-label': 'Tables' }, tabs.map(([k, l]) =>
      h('button', { type: 'button', 'aria-pressed': String(state.table === k), on: { click: () => { state.table = k; writeUrl(); sessions(); } } }, l)));
    const groupCols = (label) => [str('name', label, (g) => g.label), num('sessions', 'Sessions', (g) => g.rows.length),
      num('minutes', 'Elapsed', (g) => sum(g.rows, (r) => r.minutes), (g) => dur(sum(g.rows, (r) => r.minutes))),
      num('tokens', 'Tokens', (g) => sum(g.rows, tokens)), num('prompts', 'Prompts', (g) => sum(g.rows, (r) => r.prompts)),
      num('cpa', 'Chars / answer', (g) => { const a = sum(g.rows, (r) => r.answers); return a ? Math.round(sum(g.rows, (r) => r.answerChars) / a) : null; }),
      num('cost', 'Cost', (g) => sum(g.rows, (r) => r.cost), (g) => `$${sum(g.rows, (r) => r.cost).toFixed(2)}`)];
    const labelsOf = (counts) => Object.entries(counts ?? {}).map(([label, c]) => `${label}: ${c}`).join(', ') || '—';
    const project = str('project', 'Project', (r) => r.source === 'synced' ? '—' : rel(r.project));
    const body = {
      sessions: () => dataTable('sessions', [str('title', 'Session', (r) => r.title || r.id), str('started', 'Started', (r) => r.started, (r) => new Date(r.started).toLocaleString()), str('agent', 'Agent', (r) => r.agent),
        ...(locked() ? [] : [project, str('device', 'Device', (r) => deviceLabel(r.deviceId))]), str('language', 'Language', (r) => r.language), str('model', 'Model', (r) => r.model), num('prompts', 'Prompts', (r) => r.prompts), num('answers', 'Answers', (r) => r.answers),
        num('tin', 'Tokens in', (r) => r.tokensIn), num('tout', 'Tokens out', (r) => r.tokensOut), num('minutes', 'Elapsed', (r) => r.minutes, (r) => dur(r.minutes)),
        num('cost', 'Cost', (r) => r.cost, (r) => r.cost === null ? '—' : `$${r.cost.toFixed(2)}`)], rows, { sort: 'started' }),
      lengths: () => dataTable('lengths', [str('title', 'Session', (r) => r.title || r.id), num('prompts', 'Prompts', (r) => r.prompts), num('answers', 'Answers', (r) => r.answers),
        num('cpp', 'Chars / prompt', (r) => r.prompts ? Math.round(r.promptChars / r.prompts) : null), num('med', 'Answer chars median', (r) => r.medianAnswer), num('p95', 'Answer chars p95', (r) => r.p95Answer),
        num('rmed', 'Response s median', (r) => r.medianResp), num('rp95', 'Response s p95', (r) => r.p95Resp), num('total', 'Answer chars total', (r) => r.answerChars),
        str('partial', 'Coverage', (r) => r.partial ? 'partial' : 'complete')], m, { sort: 'total', note: 'Transcripts of any size are read completely; oversized single lines are skipped and marked partial.' }),
      agents: () => dataTable('agents', groupCols('Agent'), groupBy(rows, (r) => r.agent), { sort: 'sessions' }),
      models: () => dataTable('models', groupCols('Model'), groupBy(rows, (r) => r.model), { sort: 'sessions' }),
      folders: () => dataTable('folders-s', groupCols('Folder'), groupBy(rows, folderOf), { sort: 'sessions' }),
      projects: () => dataTable('projects', groupCols('Project'), groupBy(rows, (r) => r.source === 'synced' ? `Synced · ${r.deviceName}` : rel(r.project)), { sort: 'sessions' }),
      outcomes: () => dataTable('outcomes', [str('title', 'Session', (r) => r.title || r.id), str('agent', 'Agent', (r) => r.agent), ...(locked() ? [] : [project]), str('language', 'Language', (r) => r.language),
        str('outcome', 'Outcome', (r) => r.outcome), ...['sentiment', 'behaviour', 'failure'].map((k) => str(k, k[0].toUpperCase() + k.slice(1), (r) => labelsOf(r.evaluation?.counts?.[k]))),
        num('classified', 'Classified turns', (r) => r.evaluation?.classified ?? null)], outcomes, { sort: 'outcome', dir: 'asc', note: 'Experimental local predictions; low-confidence turns count as unknown.' }),
      tooloutput: () => toolOutputTable(rows, { table: dataTable, num, str, short }),
    }[state.table]();
    fill($('ss-browse'), sub, h('article', { class: 'card' }, body), data.limited ? h('p', { class: 'small muted' }, `Showing the newest ${fmt(data.rows.length)} of ${fmt(data.total)} sessions.`) : null,
      data.undated ? h('p', { class: 'small muted' }, `${fmt(data.undated)} session${data.undated === 1 ? ' has' : 's have'} no start time and cannot be charted. For synced sessions, update YAW on the other device and sync there again.`) : null);
  }

  // ---------- Improve: shared metadata filters and sorting; explicit conversation reads ----------
  function improve() {
    fill($('improve-filter'), filterBar('improve'));
    const rows = filtered(), [from, to] = bounds();
    if (!['projects', 'sessions'].includes(state.improveView)) state.improveView = 'projects';
    if (!['attention', 'classified', 'all'].includes(state.improveFocus)) state.improveFocus = 'attention';
    insights.render($('improve-content'), { rows, table: dataTable, series: makeSplit(rows), rel: (p) => p ? rel(p) : 'Project unavailable', set,
      onConversation: (open) => { $('improve-filter').hidden = open; },
      settings: improvePrefs, view: state.improveView, focus: state.improveFocus,
      scope: JSON.stringify([data.current, ...FILTERS.map((k) => state[k]), state.device, state.improveFocus, state.improveView]),
      period: `${day(from)} through ${day(to - 1)} UTC; ${rows.length} filtered saved sessions${data.limited ? '; list capped at 20,000' : ''}` });
  }

  // ---------- Global tasks ----------
  function tasksView() {
    fill($('tk-filter'), filterBar('tasks'));
    const scope = data.tasks.filter((t) => projectMatches(t.project));
    const rows = scope.filter((t) => t.available).flatMap((t) => [...t.active, ...t.backlog].map((r) => ({ project: t.project, ...r })));
    const none = scope.filter((t) => !t.available || !(t.active.length + t.backlog.length)).map((t) => base(t.project));
    fill($('tk-list'), h('article', { class: 'card' }, dataTable('tasks', [
      str('project', 'Project', (r) => rel(r.project), (r) => known(r.project)
        ? h('button', { type: 'button', class: 'name', title: `Open ${r.project} → Tasks`, on: { click: () => openProject(r.project, 'workspace-tasks') } }, `${base(r.project)} →`) : base(r.project)),
      str('id', 'Task', (r) => r.id), str('title', 'Title', (r) => r.title), str('status', 'Status / note', (r) => r.status ?? r.note),
      num('progress', 'Progress', (r) => r.progress ?? null, (r) => r.progress === undefined || r.progress === null ? '—' : `${r.progress}%`)], rows,
    { sort: 'project', dir: 'asc', note: `This workspace is read live; others are snapshots from the last session scan${none.length ? ` · no tasks in ${none.join(', ')}` : ''}` })));
  }

  function render() {
    if (!data || !route) return;
    try {
      if (route === 'global-improve') improve();
      else if (route === 'global') overview();
      else if (route === 'global-tasks') tasksView();
      else sessions();
    } catch (e) { report(e); }
  }
  return {
    async show(name, query = '') {
      if (route !== name || name !== 'global-improve') insights.reset();
      route = name; readQuery(query); writeUrl();
      try { await load(); } catch (e) { report(e); return; }
      if (['analytics', 'global-analytics', 'global-improve', 'global'].includes(name) && !prefs) prefs = await get('preferences').catch(() => null);
      if (name === 'global-improve') improvePrefs = await get('improve/settings').catch(() => null);
      if (route !== name) return;
      render();
      // Auto refresh once per page load and scope; all workspaces cover the open one too.
      const scope = locked() ? 'current' : 'all';
      if (['analytics', 'global-analytics'].includes(name) && prefs?.autoRefresh && !autoDone.has(scope)) { autoDone.add(scope); run(false); }
    },
    async reload() { try { await load(true); } catch (e) { report(e); return; } render(); },
    hide() { insights.reset(); route = null; },
  };
}
