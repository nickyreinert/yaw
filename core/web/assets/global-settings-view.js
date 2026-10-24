// Global Settings: Interview (your defaults for new projects, plus presets), Files (~/.yaw, read-only) and
// Notifications (personal channels). Text nodes only; writes go through CSRF-protected actions and are hash-checked.
import { button, el, grid, press, source, tabs } from './settings-view.js';
import { available, choiceLabel, choiceValue } from './ui-state.js';

const $ = (id) => document.getElementById(id);
const TABS = ['interview', 'files', 'notifications'];
const code = (t) => el('code', t);
const size = (n) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MiB` : n >= 1024 ? `${Math.round(n / 1024)} KiB` : `${n} B`;
const day = (s) => Number.isFinite(Date.parse(s)) ? new Date(s).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—';

// A parsed file as nested tables; scalars stay text. Deep or long structures fall back to Raw.
function formView(value, depth = 0) {
  if (value === null || typeof value !== 'object') return el('span', value === null ? '—' : String(value));
  if (depth > 3) return el('code', JSON.stringify(value).slice(0, 400));
  if (Array.isArray(value)) {
    if (!value.length) return el('span', 'empty', 'muted');
    const objects = value.every((v) => v && typeof v === 'object' && !Array.isArray(v));
    if (!objects) return el('span', value.map((v) => typeof v === 'object' ? JSON.stringify(v) : String(v)).join(', '));
    const keys = [...new Set(value.slice(0, 200).flatMap(Object.keys))].slice(0, 10);
    const box = el('div'); box.append(grid(keys, value.slice(0, 200).map((v) => keys.map((k) => v[k] === undefined ? '—' : formView(v[k], depth + 1)))));
    if (value.length > 200) box.append(el('p', `First 200 of ${value.length} entries. Use Raw for all.`, 'small muted'));
    return box;
  }
  const keys = Object.keys(value);
  if (!keys.length) return el('span', 'empty', 'muted');
  return grid(['Key', 'Value'], keys.map((k) => [code(k), formView(value[k], depth + 1)]));
}

export function createGlobalSettings({ api, get, report, notifications, onFile }) {
  let tab = 'interview', profile = null, answers = null, presets = null, files = null, comfort = null, previewed = null, selected = null;
  const drawer = $('global-detail');
  const closeDrawer = () => { drawer.hidden = true; document.body.classList.remove('has-drawer'); selected = null; onFile(''); renderFiles(); };
  drawer.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

  function show(sub, query = '') {
    tab = TABS.includes(sub) ? sub : 'interview';
    document.querySelectorAll('#global-settings-tabs [data-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
    for (const id of TABS) $(`gs-${id}`).hidden = id !== tab;
    if (tab === 'interview') (profile ? Promise.resolve(renderInterview()) : loadInterview()).catch(report);
    if (tab === 'notifications') loadNotifications().catch(report);
    const file = tab === 'files' ? new URLSearchParams(query).get('file') ?? '' : '';
    if (tab === 'files') (files ? Promise.resolve() : loadFiles()).then(() => { if (file && file !== selected) openFile(file); else if (!file && selected) closeDrawer(); else renderFiles(); }).catch(report);
    else hide();
    return tab;
  }
  function hide() { if (!drawer.hidden) { drawer.hidden = true; document.body.classList.remove('has-drawer'); selected = null; } }
  function reset() { profile = null; presets = null; files = null; comfort = null; previewed = null; }

  // Interview --------------------------------------------------------------------------------------------
  async function loadInterview() {
    [profile, presets] = await Promise.all([get('global/profile'), get('global/presets')]);
    answers = structuredClone(profile.answers); previewed = null; renderInterview();
  }
  const fingerprint = () => JSON.stringify(answers);
  function status(text) { const s = $('gs-status'); if (s) s.textContent = text; }
  function renderInterview() {
    const root = $('gs-interview'); root.replaceChildren();
    root.append(el('p', `Your defaults for every new project: yaw init starts with them. Stored in ${profile.path}${profile.exists ? '' : ' (not created yet)'}; existing projects keep their own answers. Nothing is written until you preview and apply.`, 'small muted'));
    const box = el('section', null, 'card interview-section'); box.append(el('h2', 'About you'));
    for (const q of profile.questions) box.append(question(q));
    if (!profile.questions.length) box.append(el('p', 'This kit asks no personal questions.', 'muted'));
    const actions = el('div', null, 'interview-actions'), s = el('p', '', 'small muted'); s.id = 'gs-status'; s.setAttribute('role', 'status');
    const apply = button('Apply', () => applyProfile().catch(fail), 'primary'); apply.id = 'gs-apply'; apply.disabled = !previewed || previewed.state !== fingerprint();
    actions.append(button('Preview changes', () => previewProfile().catch(fail)), apply, button('Reset', () => loadInterview().catch(report)), s);
    const out = el('div'); out.id = 'gs-preview';
    if (previewed) out.append(previewCard(previewed.result));
    box.append(actions, out); root.append(box, presetsCard());
  }
  function question(q) {
    const multi = q.type === 'multi', wrap = el(multi ? 'fieldset' : 'label', null, 'interview-question');
    const head = el(multi ? 'legend' : 'span', q.label.replace(' (comma-separated)', '')); head.append(code(q.id)); head.lastChild.className = 'small muted'; wrap.append(head);
    const value = answers[q.id] ?? q.default;
    const set = (v) => { answers[q.id] = v; changed(); };
    if (multi) {
      const box = el('div', null, 'checks');
      for (const c of q.choices ?? []) {
        const l = el('label'), input = el('input'); input.type = 'checkbox'; input.value = choiceValue(c); input.checked = [].concat(value ?? []).includes(input.value); input.disabled = !available(c);
        input.addEventListener('change', () => set([...box.querySelectorAll('input')].filter((x) => x.checked && !x.disabled).map((x) => x.value)));
        l.append(input, document.createTextNode(choiceLabel(c))); box.append(l);
      }
      wrap.append(box);
    } else if (q.type === 'choice' || q.type === 'boolean') {
      const sel = el('select'), choices = q.type === 'boolean' ? [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] : q.choices ?? [];
      for (const c of choices) { const o = el('option', choiceLabel(c)); o.value = String(choiceValue(c)); o.disabled = !available(c); sel.append(o); }
      sel.value = String(value); sel.addEventListener('change', () => set(q.type === 'boolean' ? sel.value === 'true' : sel.value)); wrap.append(sel);
    } else if (q.type === 'number') {
      const i = el('input'); i.type = 'number'; i.step = 'any'; i.value = String(value ?? ''); i.addEventListener('input', () => set(i.value === '' ? q.default : Number(i.value))); wrap.append(i);
    } else {
      const t = el('textarea'); t.maxLength = 8192; t.rows = 1; t.value = String(value ?? ''); t.addEventListener('input', () => set(t.value)); wrap.append(t);
    }
    if (q.hint) wrap.append(el('span', q.hint, 'small muted'));
    return wrap;
  }
  function changed() {
    const apply = $('gs-apply'); if (apply) apply.disabled = !previewed || previewed.state !== fingerprint();
    if (previewed && previewed.state !== fingerprint()) status('Changed since the preview; preview again before applying.');
  }
  const fail = (e) => { if ($('gs-status')) status(e.message); else report(e); };
  // Only answered questions are sent; keys set by other commands stay as they are.
  const payload = () => Object.fromEntries(profile.questions.filter((q) => answers[q.id] !== undefined).map((q) => [q.id, answers[q.id]]));
  async function previewProfile() {
    status('Rendering preview…');
    const result = await api('profile-preview', { answers: payload(), expected: profile.hash });
    previewed = { state: fingerprint(), result }; renderInterview();
    status(result.changed ? 'Review the change, then Apply.' : 'Nothing would change.');
  }
  function previewCard(r) {
    const box = el('div', null, 'card'); box.append(el('h2', 'Preview'));
    if (!r.changed) { box.append(el('p', 'No change.', 'muted')); return box; }
    box.append(el('pre', r.diff, 'file-source plain')); return box;
  }
  async function applyProfile() {
    if (!confirm(`Save your defaults to ${profile.path}?`)) return;
    status('Saving…');
    const result = await api('profile-apply', { answers: payload(), expected: profile.hash });
    files = null; await loadInterview(); status(result.message);
  }
  function presetsCard() {
    const box = el('section', null, 'card'); box.append(el('h2', 'Presets'));
    box.append(el('p', 'Saved setups for yaw init --preset <name>. Create one with yaw presets save in a configured project.', 'small muted'));
    const list = presets?.presets ?? [];
    if (!list.length) { box.append(el('p', 'No presets saved.', 'muted')); return box; }
    const msg = el('p', '', 'small muted'); msg.setAttribute('role', 'status');
    const run = (fn) => fn().catch((e) => { msg.textContent = e.message; });
    const t = grid(['Name', 'Description', 'Depth', 'Created', ''], list.map((p) => {
      const tools = el('span', null, 'row-actions');
      tools.append(button('View', () => { location.hash = `#global-settings/files?file=${encodeURIComponent(`presets/${p.name}.yaml`)}`; }),
        button('Rename', () => run(async () => {
          const to = prompt(`New name for preset ${p.name} (lower-case letters, digits, hyphens):`, p.name);
          if (!to || to === p.name) return;
          const r = await api('preset-rename', { name: p.name, to }); presets = await get('global/presets'); files = null; renderInterview(); status(r.message);
        })),
        button('Delete', () => run(async () => {
          if (!confirm(`Delete preset ${p.name}? This removes ~/.yaw/presets/${p.name}.yaml.`)) return;
          const r = await api('preset-delete', { name: p.name, confirm: true }); presets = await get('global/presets'); files = null; renderInterview(); status(r.message);
        }), 'danger'));
      return [code(p.name), p.description || '—', p.mode || '—', p.created ? day(p.created) : '—', tools];
    }));
    t.classList.add('preset-table'); box.append(t, msg); return box;
  }

  // Files ------------------------------------------------------------------------------------------------
  async function loadFiles() { files = await get('global/files'); renderFiles(); }
  function renderFiles() {
    const root = $('gs-files'); root.replaceChildren();
    if (!files) return;
    root.append(el('p', `Your YAW folder ${files.dir}${files.dataDir ? ` (collected data in ${files.dataDir})` : ''}. Read-only here: change settings on the Interview and Notifications tabs or with the yaw CLI. It never holds secrets.`, 'small muted'));
    const cols = el('div', null, 'settings-groups');
    for (const g of files.groups) {
      const box = el('section', null, 'card settings-group'); box.append(el('h2', g.title));
      for (const f of g.files) {
        const b = button('', () => { if (!f.folder) onFile(f.path); }, 'file-row'), left = el('span');
        left.append(code(f.path)); b.title = f.about ?? '';
        b.append(left, el('span', f.folder ? `${f.entries} entries · not browsable` : f.missing ? 'not created yet' : f.blocked ? 'not a regular file' : `${size(f.size)} · ${day(f.modified)}`, 'small muted'));
        b.disabled = Boolean(f.folder || f.missing || f.blocked);
        b.setAttribute('aria-pressed', String(selected === f.path));
        box.append(b, el('p', f.about, 'small muted file-about'));
      }
      cols.append(box);
    }
    root.append(cols);
  }
  async function openFile(path) {
    selected = path; renderFiles();
    drawer.hidden = false; document.body.classList.add('has-drawer'); drawer.replaceChildren(el('p', `Reading ${path}…`, 'muted'));
    let file;
    try { file = await get('global/file', { path }); } catch (e) { drawer.replaceChildren(drawerBar(path, ''), el('p', e.message, 'warn')); return; }
    if (selected !== path) return;
    drawer.replaceChildren(drawerBar(path, `~/.yaw · updated ${day(file.modified)} · ${size(file.size)}`));
    if (file.about) drawer.append(el('p', file.about, 'small muted'));
    if (file.tooLarge) { drawer.append(el('p', `Larger than ${Math.round(file.limit / 1024)} KiB; open it in your editor.`, 'warn')); return; }
    const pane = el('div', null, 'drawer-pane');
    const pick = (id) => { press(nav, id); pane.replaceChildren(id === 'form' ? el('div', null, 'file-view') : source(file.content)); if (id === 'form') pane.firstChild.append(formView(file.data)); };
    const nav = tabs([['form', 'Form', file.data === null], ['raw', 'Raw']], pick);
    nav.append(el('span', 'Read-only', 'small muted'));
    drawer.append(nav, pane); pick(file.data === null ? 'raw' : 'form'); drawer.querySelector('.drawer-bar button').focus();
  }
  function drawerBar(path, meta) {
    const bar = el('div', null, 'drawer-bar'), title = el('div');
    title.append(el('span', meta, 'eyebrow'), el('h2', path)); bar.append(title, button('✕ Close', closeDrawer)); return bar;
  }

  // Notifications ----------------------------------------------------------------------------------------
  async function loadNotifications() {
    await notifications();
    comfort ??= await get('global/comfort');
    const root = $('gs-comfort'); root.replaceChildren(el('h2', 'Projects'));
    root.append(el('p', 'Notifications fire in projects with the comfort module. Add it with yaw add comfort in that project.', 'small muted'));
    root.append(comfort.length ? grid(['Project', 'Folder', 'Comfort'], comfort.map((p) => [p.name, code(p.root), p.comfort ? 'enabled' : 'not installed'])) : el('p', 'No projects in the switcher yet.', 'muted'));
  }

  return { show, hide, reset };
}
