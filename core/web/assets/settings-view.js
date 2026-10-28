import { mountInterview } from './interview-view.js';
// Settings (Project | Files | Review prompts | Kickoff) and the decision-category editor. Text nodes only: file content,
// answers and categories are never parsed as HTML. Every write goes through a CSRF-protected workspace action.
import { renderReviewPrompts } from './review-prompts-view.js';

const $ = (id) => document.getElementById(id);
export function el(tag, text, cls) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = String(text);
  if (cls) node.className = cls;
  return node;
}
export function button(text, fn, cls) { const b = el('button', text, cls); b.type = 'button'; b.addEventListener('click', fn); return b; }
export function grid(head, rows) {
  const wrap = el('div', null, 'table-scroll'), t = el('table'), tr = t.createTHead().insertRow();
  for (const h of head) { const th = el('th', h); th.scope = 'col'; tr.append(th); }
  const body = t.createTBody();
  for (const r of rows) { const row = body.insertRow(); for (const c of r) { const td = row.insertCell(); if (c instanceof Node) td.append(c); else td.textContent = c ?? '—'; } }
  wrap.append(t); return wrap;
}
const code = (t) => el('code', t);
// The interview as tabs, in the order of the setup wizard. A question belongs to the pane of its group.
export const PANES = [['start', 'Starting point'], ['user', 'About you'], ['idea', 'Your project'], ['stack', 'Stack & standards'], ['workflow', 'Your workflow']];
const PANE_OF = { user: 'user', idea: 'idea', arch: 'stack', quality: 'stack' };
export const paneOf = (id) => PANE_OF[id.split('.')[0]] ?? 'workflow';
const pills = (list, cls = '') => { const s = el('span'); for (const x of list) s.append(el('span', x, `pill ${cls}`)); return s; };
const day = (s) => Number.isFinite(Date.parse(s)) ? new Date(s).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '';
export function tabs(items, onPick, current) {
  const nav = el('div', null, 'editor-tabs');
  for (const [id, label, disabled] of items) {
    const b = button(label, () => onPick(id)); b.dataset.mode = id; b.disabled = Boolean(disabled); b.setAttribute('aria-pressed', String(id === current)); nav.append(b);
  }
  return nav;
}
export const press = (nav, id) => nav.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === id)));

// ------------------------------------------------------------------------------- read-only structured views

const kind = (path) => {
  const n = path.replace(/^\.yaw\/base\//, '');
  if (/(^|\/)(settings(\.local)?|hooks)\.json$/.test(n)) return 'hooks';
  if (/(^|\/)manifest\.json$/.test(n)) return 'manifest';
  if (/(^|\/)answers\.yaml$/.test(n)) return 'answers';
  if (/(^|\/)justfile$|\.just$/.test(n)) return 'just';
  if (/\.md$/.test(n)) return 'markdown';
  return null;
};
const VIEWS = {
  hooks(text, v) {
    const d = JSON.parse(text), rows = [];
    for (const [event, list] of Object.entries(d.hooks ?? {})) for (const e of Array.isArray(list) ? list : []) for (const h of e.hooks ?? []) {
      const cmd = String(h.command ?? '');
      rows.push([code(event), e.matcher ? code(e.matcher) : 'every time', pills([/--module (\S+)/.exec(cmd)?.[1] ?? '—']), /--agent (\S+)/.exec(cmd)?.[1] ?? '—', h.timeout ? `${h.timeout} s` : '—']);
    }
    v.append(el('h3', `Hooks (${rows.length})`), grid(['When', 'Tools', 'YAW module', 'Agent', 'Timeout'], rows));
    const deny = d.permissions?.deny ?? [];
    if (deny.length) v.append(el('h3', `Agent may never read (${deny.length})`), pills(deny.map((x) => String(x).replace(/^Read\((.*)\)$/, '$1'))));
    const other = Object.keys(d).filter((x) => !['hooks', 'permissions'].includes(x));
    if (other.length) v.append(el('h3', 'Other settings'), pills(other, 'muted-pill'));
  },
  manifest(text, v) {
    const d = JSON.parse(text);
    v.append(el('h3', 'Setup'), grid(['', ''], [['Kit version', d.kit], ['Preset', d.preset ?? '—'], ['Profiles', pills(d.profiles ?? [])], ['Agents', pills(d.agents ?? [])],
      ['Modules', pills(Object.entries(d.modules ?? {}).filter(([, m]) => m.enabled).map(([n]) => n))], ['MCP servers', (d.mcpServers ?? []).length ? pills(d.mcpServers.map((m) => m.name ?? String(m))) : 'none']]));
    const files = d.files ?? [];
    v.append(el('h3', `Files YAW wrote (${files.length})`), grid(['File', 'Module', 'Also from', 'Ownership'], files.map((x) =>
      [code(x.path), pills([x.module]), x.fragments?.length ? pills(x.fragments.map((y) => y.module)) : '', x.managed ? 'YAW keeps it current' : 'Yours after the first write'])));
  },
  answers(text, v, ctx) {
    v.append(el('p', 'These answers drive the generated files. Change them on the Project tab: Preview shows every file that would change, Apply writes them.', 'small muted'));
    if (ctx?.openInterview) v.append(button('Edit on the Project tab →', ctx.openInterview, 'primary'));
    const rows = [];
    let section = '';
    for (const line of text.split('\n')) {
      if (!line.trim() || line.trim().startsWith('#')) continue;
      const m = /^(\s*)([\w.-]+):\s*(.*)$/.exec(line);
      if (!m) continue;
      if (!m[1]) { if (m[3]) rows.push([code(m[2]), m[3]]); else section = m[2]; continue; }
      rows.push([code(`${section}.${m[2]}`), m[3]]);
    }
    v.append(grid(['Key', 'Value'], rows));
  },
  just(text, v) {
    const recipes = [], imports = [];
    let doc = [];
    for (const line of text.split('\n')) {
      const imp = /^import\s+'([^']+)'/.exec(line);
      if (imp) { imports.push(imp[1]); doc = []; continue; }
      if (/^#/.test(line)) { if (!/^# \/?yaw:/.test(line)) doc.push(line.replace(/^#\s?/, '')); continue; }
      if (/^\[/.test(line)) continue;
      const r = /^([\w-]+)([^:=]*):(?!=)\s*(.*)$/.exec(line);
      if (r) recipes.push([code(`just ${r[1]}${r[2].trim() ? ` ${r[2].trim()}` : ''}`), r[3] ? pills(r[3].split(/\s+/)) : '', doc.join(' ')]);
      if (!/^\s/.test(line)) doc = [];
    }
    v.append(el('h3', `Recipes (${recipes.length})`), grid(['Run', 'Runs first', 'What it does'], recipes));
    if (imports.length) v.append(el('h3', 'Imports'), pills(imports));
  },
  markdown(text, v) {
    const blocks = [];
    let cur = { yaw: null, lines: [] };
    const push = () => { if (cur.lines.some((l) => l.trim())) blocks.push(cur); };
    for (const line of text.split('\n')) {
      const open = /<!-- yaw:([a-z0-9-]+) -->/.exec(line);
      if (open) { push(); cur = { yaw: open[1], lines: [] }; continue; }
      if (/<!-- \/yaw:[a-z0-9-]+ -->/.test(line)) { push(); cur = { yaw: null, lines: [] }; continue; }
      cur.lines.push(line);
    }
    push();
    const ours = blocks.filter((b) => b.yaw).length;
    v.append(el('p', `${ours} YAW block${ours === 1 ? '' : 's'} (refreshed by yaw apply) · ${blocks.length - ours} part${blocks.length - ours === 1 ? '' : 's'} kept as written.`, 'small muted'));
    for (const b of blocks) {
      const box = el('div', null, `file-block${b.yaw ? ' yaw' : ''}`);
      box.append(el('span', b.yaw ? `YAW · ${b.yaw}` : 'Yours', `pill${b.yaw ? '' : ' muted-pill'}`));
      let list = null;
      for (const l of b.lines) {
        if (!l.trim()) { list = null; continue; }
        const h = /^#+\s+(.*)/.exec(l);
        if (h) { box.append(el('h4', h[1])); list = null; continue; }
        const li = /^\s*[-*]\s+(.*)/.exec(l);
        if (li) { if (!list) { list = el('ul'); box.append(list); } list.append(el('li', li[1].replace(/\*\*|`/g, ''))); continue; }
        box.append(el('p', l.replace(/\*\*|`/g, ''))); list = null;
      }
      v.append(box);
    }
  },
};
export function source(text) {
  const pre = el('pre', null, 'file-source');
  let inYaw = false;
  for (const line of text.split('\n')) {
    if (/<!-- yaw:[a-z0-9-]+ -->|^# yaw:/.test(line)) inYaw = true;
    pre.append(el('span', line, inYaw ? 'yaw' : ''));
    if (/<!-- \/yaw:[a-z0-9-]+ -->|^# \/yaw:/.test(line)) inYaw = false;
  }
  return pre;
}

// ------------------------------------------------------------------------------- kickoff

// The kickoff guide and the planning prompt, shared by Settings → Kickoff and the last setup step.
export function kickoffCard({ guide, prompt }) {
  const card = el('section', null, 'card kickoff');
  card.append(el('h2', 'Kickoff: plan the work'));
  const steps = el('ol', null, 'kickoff-guide');
  for (const line of guide) steps.append(el('li', line));
  const status = el('span', '', 'small muted'); status.setAttribute('role', 'status');
  const copy = button('Copy prompt', async () => {
    try { await navigator.clipboard.writeText(prompt); status.textContent = 'Copied.'; } catch { status.textContent = 'Copy failed; select the text below.'; }
  }, 'primary');
  const text = el('pre', prompt, 'kickoff-prompt');
  const bar = el('div', null, 'interview-actions'); bar.append(copy, status);
  card.append(steps, el('h3', 'Planning prompt'), bar, text);
  return card;
}

// ------------------------------------------------------------------------------- settings view

export function createSettings({ api, get, report, refresh, go, openSetup }) {
  let tab = 'interview', files = null, open = new Set(), selected = null, interview = null, interviewStarted = false;
  let mountedInterview = null;
  let pane = PANES[0][0], guided = false, repane = null;
  const drawer = $('settings-detail');
  const closeDrawer = () => { drawer.hidden = true; document.body.classList.remove('has-drawer'); selected = null; renderFiles(); };
  drawer.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !drawer.hidden && !drawer.contains(document.activeElement)) closeDrawer(); });

  function show(name, params) {
    const section = params?.get('section');
    if (PANES.some(([id]) => id === section)) { pane = section; repane?.(); }
    tab = ['interview', 'files', 'review', 'kickoff'].includes(name) ? name : 'interview';
    document.querySelectorAll('#settings-tabs [data-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
    for (const id of ['interview', 'files', 'review', 'kickoff']) $(`settings-${id}`).hidden = id !== tab;
    if (tab !== 'files' && !drawer.hidden) closeDrawer();
    if (tab === 'interview' && !interview && !interviewStarted) { interviewStarted = true; loadInterview().catch(report); }
    if (tab === 'kickoff') loadKickoff().catch(report);
    if (tab === 'files' && !files) loadFiles().catch(report);
    if (tab === 'review') loadReview().catch(report);
    return tab;
  }
  function hide() { if (!drawer.hidden) closeDrawer(); }
  function reset() { mountedInterview?.destroy(); mountedInterview = null; files = null; interview = null; interviewStarted = false; }

  // Review prompts --------------------------------------------------------------------------------------
  async function loadReview() {
    const data = await get('review-prompts');
    renderReviewPrompts($('settings-review'), { data, scope: 'project', api, load: loadReview });
  }

  // Kickoff -------------------------------------------------------------------------------------------
  async function loadKickoff() {
    const data = await get('kickoff'), root = $('settings-kickoff');
    root.replaceChildren();
    if (!data.available) { root.append(el('p', data.message, 'muted')); return; }
    root.append(kickoffCard(data));
  }
  // Files ---------------------------------------------------------------------------------------------
  async function loadFiles() { files = await get('settings'); renderFiles(); }
  function row(f, label) {
    const b = button('', () => openFile(f), 'file-row');
    const left = el('span'); left.append(code(label));
    if (f.editable) left.append(el('span', 'editable', 'badge'));
    b.append(left, el('span', f.missing ? 'missing' : f.blocked ? 'not a regular file' : `updated ${day(f.modified)}`, 'small muted'));
    b.disabled = Boolean(f.missing || f.blocked);
    b.setAttribute('aria-pressed', String(selected === f.path));
    return b;
  }
  function renderFiles() {
    const root = $('settings-files'); root.replaceChildren();
    if (!files) return;
    if (!files.available) { root.append(el('p', 'This folder has no YAW setup. Run yaw init here.', 'muted')); return; }
    root.append(el('p', `Files YAW writes here, grouped by purpose. Knowledge, decisions, tasks and the code map have their own pages.${files.excluded ? ` ${files.excluded} secret file(s) hidden.` : ''}`, 'small muted'));
    const cols = el('div', null, 'settings-groups');
    for (const g of files.groups) {
      const box = el('section', null, 'card settings-group'), head = el('div', null, 'settings-group-head');
      head.append(el('h2', g.title), el('code', g.command, 'small muted')); box.append(head);
      for (const f of g.files) {
        if (!f.folder) { box.append(row(f, f.path)); continue; }
        const expanded = open.has(f.path);
        const b = button('', () => { if (expanded) open.delete(f.path); else open.add(f.path); renderFiles(); }, 'file-row');
        b.setAttribute('aria-expanded', String(expanded)); b.title = f.about ?? '';
        const left = el('span'); left.append(el('span', expanded ? '▾ ' : '▸ ', 'caret'), code(`${f.path}/`), el('span', `${f.files.length}${f.limited ? '+' : ''} files`, 'badge'));
        b.append(left); box.append(b);
        if (expanded) {
          const tree = el('div', null, 'file-tree'); tree.append(el('p', f.about, 'small muted'));
          for (const child of f.files) tree.append(row({ ...child, about: f.about }, child.path.slice(f.path.length + 1)));
          box.append(tree);
        }
      }
      cols.append(box);
    }
    root.append(cols);
  }
  async function openFile(f) {
    selected = f.path; renderFiles();
    drawer.hidden = false; document.body.classList.add('has-drawer'); drawer.replaceChildren(el('p', `Reading ${f.path}…`, 'muted'));
    let file;
    try { file = await get('settings/file', { path: f.path }); } catch (e) { drawer.replaceChildren(el('p', e.message, 'warn')); return; }
    if (selected !== f.path) return;
    const bar = el('div', null, 'drawer-bar'), title = el('div');
    title.append(el('span', `${file.module ?? ''}${file.managed ? ' · YAW keeps it current' : ' · yours after the first write'} · updated ${day(file.modified)}`, 'eyebrow'), el('h2', file.path));
    bar.append(title, button('✕ Close', closeDrawer));
    drawer.replaceChildren(bar);
    if (file.about ?? f.about) drawer.append(el('p', file.about ?? f.about, 'small muted'));
    if (file.tooLarge) { drawer.append(el('p', `Larger than ${Math.round(file.limit / 1024)} KiB; open it in your editor.`, 'warn')); return; }
    const k = kind(file.path), pane = el('div', null, 'drawer-pane');
    const form = () => { const v = el('div', null, 'file-view'); try { VIEWS[k](file.content, v, { openInterview: () => { closeDrawer(); go('interview'); } }); } catch (e) { v.append(el('p', `Not readable as ${k}: ${e.message}. Use Raw.`, 'warn')); } return v; };
    const pick = (id) => { press(nav, id); pane.replaceChildren(id === 'form' ? form() : source(file.content)); };
    const nav = tabs([['form', 'Form', !k], ['raw', 'Raw']], pick);
    nav.append(el('span', file.path.startsWith('.yaw/base/') ? 'Read-only · snapshot, never edit' : file.editable ? 'Edit on the Project tab' : 'Read-only · yaw apply refreshes it', 'small muted'));
    drawer.append(nav, pane); pick(k ? 'form' : 'raw'); drawer.querySelector('.drawer-bar button').focus();
  }

  // Interview -----------------------------------------------------------------------------------------
  async function loadInterview() {
    const opened = await get('interview');
    interview = opened;
    const root = $('settings-interview'); root.replaceChildren();
    if (!opened.available) { root.append(el('p', opened.message ?? 'Interview unavailable.')); return; }
    const shell = await (await fetch('/interview-shell.html')).text();
    const parsed = new DOMParser().parseFromString(shell, 'text/html');
    root.append(...[...parsed.body.childNodes].map((node) => document.importNode(node, true)));
    if (opened.folder?.confirm) {
      const warning = el('label', null, 'card');
      const accept = el('input'); accept.type = 'checkbox';
      accept.addEventListener('change', () => { opened.confirmFolder = accept.checked; });
      warning.append(accept, document.createTextNode(' Set up YAW in this non-empty folder. Review its contents first.'));
      root.prepend(warning);
    }
    const json = (body) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
    mountedInterview = await mountInterview(root, {
      bootstrap: { ...opened, editing: !opened.fresh, sections: [], skipVerify: true }, prefix: 'project-interview-', persistent: true, kickoffCard,
      navigate: (view) => { if (view !== 'setup') location.hash = view; },
      request: async (action, payload) => {
        if (action === 'preview' || action === 'diff') return json(await api('interview-preview', { ...payload, expected: opened.hash }));
        if (action === 'apply') {
          const result = await api('interview-apply', { ...payload, expected: opened.hash, confirmFolder: opened.confirmFolder === true });
          return new Response(result.events.map((event) => JSON.stringify(event)).join('\n') + '\n', { headers: { 'Content-Type': 'application/x-ndjson' } });
        }
        return json(await api('interview-action', { action, payload, expected: opened.hash, confirmFolder: opened.confirmFolder === true }));
      },
    });
  }
  return { show, hide, reset };
}

// ------------------------------------------------------------------------------- decision categories

// Pairs used by a decision cannot be removed or renamed (the server enforces the same rule on save).
export async function taxonomyEditor(root, { api, get, done }) {
  const t = await get('taxonomy');
  root.replaceChildren(el('h2', 'Decision categories'));
  if (!t.available) { root.append(el('p', 'This workspace has no decision journal. Enable it with yaw add decisions.', 'muted')); return; }
  root.append(el('code', t.path, 'record-path'), el('p', 'Every decision picks one "Category / Subcategory" pair; keywords help agents find related decisions. Pairs in use cannot be removed or renamed.', 'small muted'));
  let doc = JSON.parse(t.content), mode = 'form', raw = null;
  const original = doc.categories.map((c) => ({ name: c.name, subs: c.subcategories.map((s) => s.name) }));
  const status = el('span', '', 'small muted'), err = el('p', '', 'warn'), pane = el('div', null, 'taxonomy-pane');
  err.setAttribute('role', 'alert'); err.hidden = true;
  const mark = () => { status.textContent = 'Unsaved changes'; };
  const problem = (text) => { err.textContent = text; err.hidden = !text; };
  function readRaw() {
    try { const d = JSON.parse(raw.value); if (!Array.isArray(d?.categories)) throw new Error('"categories" must be a list'); doc = d; problem(''); return true; }
    catch (e) { problem(`Raw JSON is invalid: ${e.message}. Fix it before switching or saving.`); return false; }
  }
  const nav = tabs([['form', 'Form'], ['raw', 'Raw JSON']], (id) => switchTo(id), 'form');
  const save = button('Save', async () => {
    if (mode === 'raw' && !readRaw()) return;
    try { const r = await api('taxonomy-save', { content: `${JSON.stringify(doc, null, 2)}\n`, expected: t.hash }); problem(''); status.textContent = r.message; done?.(r); }
    catch (e) { problem(e.message); }
  }, 'primary');
  nav.append(status, save);
  function switchTo(id) {
    if (mode === 'raw' && id !== 'raw' && !readRaw()) return;
    mode = id; press(nav, id); pane.replaceChildren();
    if (id === 'raw') { raw = el('textarea', null, 'record-editor'); raw.rows = 22; raw.spellcheck = false; raw.value = `${JSON.stringify(doc, null, 2)}\n`; raw.setAttribute('aria-label', 'Decision categories as JSON'); raw.addEventListener('input', mark); pane.append(raw); return; }
    doc.categories.forEach((c, ci) => {
      const box = el('div', null, 'taxonomy-category'), name = el('input');
      name.value = c.name; name.setAttribute('aria-label', 'Category name');
      const catUsed = c.subcategories.some((s, si) => (t.usage[`${original[ci]?.name ?? c.name} / ${original[ci]?.subs[si] ?? s.name}`] ?? []).length);
      name.addEventListener('input', () => { c.name = name.value; mark(); });
      if (catUsed && original[ci]) name.title = 'Used by decisions: renaming is refused on save';
      box.append(name);
      c.subcategories.forEach((s, si) => {
        const used = original[ci] && si < original[ci].subs.length ? t.usage[`${original[ci].name} / ${original[ci].subs[si]}`] ?? [] : [];
        const r = el('div', null, 'taxonomy-sub'), n = el('input'), k = el('input'), del = button('✕', () => { c.subcategories.splice(si, 1); original[ci]?.subs.splice(si, 1); mark(); switchTo('form'); }, 'mini');
        n.value = s.name; n.setAttribute('aria-label', `Subcategory of ${c.name}`); n.addEventListener('input', () => { s.name = n.value; mark(); });
        k.value = s.keywords.join(', '); k.setAttribute('aria-label', `Keywords for ${s.name}, comma separated`);
        k.addEventListener('input', () => { s.keywords = k.value.split(',').map((x) => x.trim()).filter(Boolean); mark(); });
        if (used.length) { del.disabled = true; del.title = `Used by ${used.length} decision(s); move them first`; }
        r.append(n, k, del, el('span', used.length ? `Used by ${used.length}: ${used.slice(0, 6).join(', ')}${used.length > 6 ? ' …' : ''}` : 'Not used yet', 'small muted'));
        box.append(r);
      });
      box.append(button('+ Subcategory', () => { c.subcategories.push({ name: 'New', keywords: [] }); mark(); switchTo('form'); }, 'mini'));
      pane.append(box);
    });
    pane.append(button('+ Category', () => { doc.categories.push({ name: 'New category', subcategories: [{ name: 'General', keywords: [] }] }); mark(); switchTo('form'); }));
  }
  root.append(nav, err, pane); switchTo('form');
}
