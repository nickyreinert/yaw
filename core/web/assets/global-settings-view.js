// Global Settings: Defaults (your defaults for new projects, plus presets), Files (~/.yaw, read-only),
// Notifications (personal channels), Classification (local Laya settings and setup steps) and Review prompts (your blueprint). Text nodes only; writes go through CSRF-protected actions and are hash-checked.
import { button, el, grid, press, source, tabs } from './settings-view.js';
import { available, choiceLabel, choiceValue } from './ui-state.js';
import { renderReviewPrompts } from './review-prompts-view.js';
import { RADIO_MAX, choiceField } from './setup-cards.js';
import { pickFolder } from './folder-picker.js';
import { CHATS } from './chat-services.js';

const $ = (id) => document.getElementById(id);
const TABS = ['interview', 'files', 'notifications', 'classification', 'improve', 'sessions', 'review', 'sync'];
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
  let tab = 'interview', classifier = null, classifierSamples = null, profile = null, answers = null, presets = null, files = null, comfort = null, previewed = null, selected = null;
  const drawer = $('global-detail');
  const closeDrawer = () => { drawer.hidden = true; document.body.classList.remove('has-drawer'); selected = null; onFile(''); renderFiles(); };
  drawer.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

  function show(sub, query = '') {
    tab = TABS.includes(sub) ? sub : 'interview';
    document.querySelectorAll('#global-settings-tabs [data-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
    for (const id of TABS) $(`gs-${id}`).hidden = id !== tab;
    if (tab === 'interview') (profile ? Promise.resolve(renderInterview()) : loadInterview()).catch(report);
    if (tab === 'notifications') loadNotifications().catch(report);
    if (tab === 'classification') loadClassifier().catch(report);
    if (tab === 'improve') loadImprove().catch(report);
    if (tab === 'review') loadReview().catch(report);
    if (tab === 'sessions') loadSessions().catch(report);
    if (tab === 'sync') loadSync().catch(report);
    const file = tab === 'files' ? new URLSearchParams(query).get('file') ?? '' : '';
    if (tab === 'files') (files ? Promise.resolve() : loadFiles()).then(() => { if (file && file !== selected) openFile(file); else if (!file && selected) closeDrawer(); else renderFiles(); }).catch(report);
    else hide();
    return tab;
  }
  function hide() { if (!drawer.hidden) { drawer.hidden = true; document.body.classList.remove('has-drawer'); selected = null; } }
  function reset() { classifier = null; classifierSamples = null; profile = null; presets = null; files = null; comfort = null; previewed = null; }

  async function loadReview() {
    const data = await get('global/review-prompts');
    renderReviewPrompts($('gs-review'), { data, scope: 'global', api, load: loadReview });
  }

  async function loadImprove() {
    const data = await get('improve/settings'), root = $('gs-improve');
    const enabled = new Set(data.enabledAgents), status = el('p', '', 'small'); status.setAttribute('role', 'status');
    const choices = el('div', null, 'improve-agent-options');
    const defaultTarget = document.createElement('select'); defaultTarget.setAttribute('aria-label', 'Default review destination');
    const populate = (wanted = defaultTarget.value || data.defaultTarget) => {
      defaultTarget.replaceChildren();
      for (const [name] of CHATS) { const o = el('option', `${name} · browser`); o.value = `browser:${name}`; defaultTarget.append(o); }
      for (const agent of data.agents.filter((a) => enabled.has(a.id))) { const o = el('option', `${agent.name} · CLI${agent.installed ? '' : ' (not installed)'}`); o.value = `cli:${agent.id}`; defaultTarget.append(o); }
      defaultTarget.value = wanted; if (!defaultTarget.value) defaultTarget.value = 'browser:ChatGPT';
    };
    for (const agent of data.agents) {
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = enabled.has(agent.id);
      checkbox.addEventListener('change', () => { checkbox.checked ? enabled.add(agent.id) : enabled.delete(agent.id); populate(); });
      const label = el('label', null, 'improve-agent-option');
      label.append(checkbox, el('strong', agent.name), el('span', agent.installed ? 'Installed on the dashboard server' : 'Not found on the dashboard server PATH', 'small muted'));
      choices.append(label);
    }
    populate(data.defaultTarget);
    const label = el('label', 'Default review destination'); label.append(defaultTarget);
    root.replaceChildren(el('article', null, 'card'));
    root.firstChild.append(el('h2', 'Improve · review destinations'),
      el('p', 'Choose where Improve sends a review when you ask. Browser chats open with an empty conversation; copy and paste the prompt as in the interview.'),
      el('h3', 'Installed coding agents'), choices,
      el('p', 'CLI reviews use your existing sign-in and the CLI’s model provider; they may use paid hosted models. YAW starts a separate review in a temporary folder, sends the inspected prompt over stdin, and displays the answer here. No suggestions are applied. Codex user config is excluded for this restricted review.', 'small muted'),
      el('p', 'Supported: Claude Code and Codex. Install and sign in separately. YAW does not install software or store credentials; provider-side retention still applies.', 'small muted'),
      label, button('Save review destinations', async () => {
        try { await api('improve-settings', { enabledAgents: [...enabled], defaultTarget: defaultTarget.value }); status.textContent = 'Review destinations saved.'; }
        catch (e) { status.textContent = e.message; }
      }, 'primary'), status);
  }

  // Session sources ---------------------------------------------------------------------------------------
  async function loadSessions() {
    const data = await get('global/session-sources'), root = $('gs-sessions');
    let list = data.sources.map((s) => ({ ...s })), dirty = false;
    const msg = el('p', '', 'small muted'); msg.setAttribute('role', 'status');
    const say = (t, bad) => { msg.textContent = t; msg.className = bad ? 'warn' : 'small muted'; };
    const formatSelect = (value) => {
      const sel = document.createElement('select'); sel.setAttribute('aria-label', 'Format');
      for (const [id, name] of Object.entries(data.formats)) { const o = document.createElement('option'); o.value = id; o.textContent = name; sel.append(o); }
      sel.value = value; return sel;
    };
    const draw = () => {
      root.replaceChildren(el('h2', 'Session folders'),
        el('p', 'Where YAW reads your agents\' session history. Sessions › Refresh scans exactly these folders (nothing is scanned by itself) and keeps only counts, times and model names, never message text. Each folder needs the format of the tool that wrote it; the VS Code extensions of Claude Code and Codex write to the same folders as their command lines.', 'small muted'));
      const rows = el('div', null, 'source-rows');
      list.forEach((s, i) => {
        const row = el('div', null, 'source-row'), on = document.createElement('input'), path = document.createElement('input'), fmt = formatSelect(s.agent);
        on.type = 'checkbox'; on.checked = s.enabled; on.setAttribute('aria-label', 'Read this folder');
        path.value = s.path; path.setAttribute('aria-label', 'Folder'); path.spellcheck = false;
        on.addEventListener('change', () => { s.enabled = on.checked; dirty = true; });
        fmt.addEventListener('change', () => { s.agent = fmt.value; s.files = undefined; dirty = true; });
        path.addEventListener('input', () => { s.path = path.value; s.files = undefined; dirty = true; });
        const count = s.files === null ? 'folder not found' : s.files === undefined ? 'save to count' : `${s.files} history file${s.files === 1 ? '' : 's'}`;
        const browse = button('Browse…', async () => { const c = await pickFolder({ list: (p) => get('browse', p ? { path: p } : {}), start: path.value, title: 'Choose a session folder' }); if (c) { path.value = c; s.path = c; s.files = undefined; dirty = true; draw(); } });
        row.append(on, fmt, path, el('span', count, s.files === null ? 'small warn-text' : 'small muted'), browse, button('Remove', () => { list.splice(i, 1); dirty = true; draw(); }, 'danger'));
        rows.append(row);
      });
      if (!list.length) rows.append(el('p', 'No folders: a scan finds nothing. Add one below or reset to the defaults.', 'warn'));
      root.append(rows);
      const addRow = el('div', null, 'source-row'), newFmt = formatSelect('claude'), newPath = document.createElement('input');
      newPath.placeholder = '/absolute/path/to/the/agent/folder'; newPath.setAttribute('aria-label', 'New folder'); newPath.spellcheck = false;
      const add = (agent, path) => { if (!path) return; list.push({ agent, path, enabled: true }); dirty = true; draw(); };
      addRow.append(el('span', '+'), newFmt, newPath, el('span'), button('Browse…', async () => { const c = await pickFolder({ list: (p) => get('browse', p ? { path: p } : {}), start: newPath.value, title: 'Choose a session folder' }); if (c) newPath.value = c; }), button('Add', () => add(newFmt.value, newPath.value.trim())));
      root.append(addRow);
      if (data.suggestions.length) {
        root.append(el('h3', 'Found on this machine'), el('p', 'Other places that look like agent histories.', 'small muted'));
        const sug = el('div', null, 'source-rows');
        for (const s of data.suggestions.filter((x) => !list.some((l) => l.agent === x.agent && l.path === x.path))) {
          const row = el('div', null, 'source-row');
          row.append(el('span', '+'), el('span', data.formats[s.agent]), code(s.path), el('span', `${s.files} history file${s.files === 1 ? '' : 's'} · ${s.note}`, 'small muted'), el('span'), button('Add', () => add(s.agent, s.path)));
          sug.append(row);
        }
        root.append(sug);
      }
      const found = Object.entries(data.formats).map(([id, name]) => `${name}: ${data.found[id] ?? 0}`).join(' · ');
      root.append(el('p', `Sessions in the last scan: ${found}.`, 'small muted'),
        el('p', 'Not readable yet: Cursor and Antigravity (databases / binary chats) and VS Code Copilot Chat. Their folders cannot be added.', 'small muted'));
      const bar = el('div', null, 'interview-actions');
      bar.append(button('Save folders', async () => {
        try { Object.assign(data, await api('session-sources-save', { sources: list.map(({ agent, path, enabled }) => ({ agent, path, enabled })) })); list = data.sources.map((s) => ({ ...s })); dirty = false; draw(); say('Saved. Press Refresh on a Sessions page to scan them.'); }
        catch (e) { say(e.message, true); }
      }, 'primary'), button('Reset to defaults', async () => {
        if (!confirm('Forget your folders and use each agent\'s usual folder again?')) return;
        try { Object.assign(data, await api('session-sources-reset', {})); list = data.sources.map((s) => ({ ...s })); dirty = false; draw(); say('Back to the defaults.'); } catch (e) { say(e.message, true); }
      }), msg);
      root.append(bar);
      if (dirty) say('Unsaved changes.');
    };
    draw();
  }

  async function loadSync() {
    const data = await get('global/sync'), root = $('gs-sync'); root.replaceChildren();
    root.append(el('h2', 'Sync'), el('p', 'Merge saved numerical statistics across devices. Sync presets, personal defaults and, if you tick them, task snapshots and global knowledge in both directions. No transcripts, passwords or workspace folders are transferred; task and knowledge text is, so tick those only for a destination you trust (the files are plain text). Refresh Sessions locally before syncing to include recent statistics. Sessions from your other devices then appear on the Sessions pages as "synced · device"; a device needs this YAW version and one sync to share start times.'));
    const field = (title, value = '') => {
      const label = el('label', title), input = document.createElement('input');
      input.value = value; label.append(input); root.append(label); return input;
    };
    const name = field('Device name', data.device?.name ?? '');
    const folder = field('Existing folder (including a mounted NAS)', data.config?.target ?? '');
    const browse = button('Browse…', async () => {
      const chosen = await pickFolder({ list: (path) => get('browse', path ? { path } : {}), start: folder.value, title: 'Choose the sync folder' });
      if (chosen) folder.value = chosen;
    });
    const folderRow = el('div', null, 'inline-control'); folder.parentNode.append(folderRow); folderRow.append(folder, browse);
    const github = field('Or private GitHub repository (owner/repository)', data.config?.github ?? '');
    const scopes = [];
    const SCOPE_TEXT = { settings: 'Personal defaults (About you answers)', presets: 'Presets', statistics: 'Session statistics (counts, times, model names; shown on the Sessions pages)',
      tasks: 'Tasks (the Global → Tasks snapshots: project folder name, task ids, titles and status)', knowledge: 'Global knowledge (Markdown records in ~/.yaw/knowledge)' };
    for (const key of ['settings', 'presets', 'statistics', 'tasks', 'knowledge']) {
      const label = el('label', ` ${SCOPE_TEXT[key]}`), input = document.createElement('input'); input.type = 'checkbox';
      input.checked = data.config ? data.config.scopes.includes(key) : !['tasks', 'knowledge'].includes(key);
      label.prepend(input); root.append(label); scopes.push([key, input]);
    }
    const run = async (resolution) => {
      const result = await api('sync-run', { name: name.value || undefined, resolution });
      await loadSync(); root.append(el('p', result.message, 'small muted'));
    };
    root.append(button('Save sync settings', async () => {
      try {
        await api('sync-setup', { name: name.value || undefined, target: folder.value || undefined, github: github.value || undefined, scopes: scopes.filter(([, input]) => input.checked).map(([key]) => key) });
        await loadSync();
      } catch (e) { report(e); }
    }));
    if (data.configured) root.append(button('Sync now', () => run().catch(report), 'primary'));
    root.append(el('p', data.lastSync ? `Last successful sync: ${new Date(data.lastSync).toLocaleString()}` : 'No successful sync yet.', 'small muted'));
    if (data.conflicts.length) {
      root.append(el('p', `Conflicting records: ${data.conflicts.join(', ')}. Choose which version to keep for these conflicts.`, 'warn'),
        button('Keep local conflicts', () => run('local').catch(report)), button('Keep remote conflicts', () => run('remote').catch(report)));
    }
    const filter = document.createElement('select'); filter.setAttribute('aria-label', 'Statistics device');
    for (const [id, text] of [['', 'All devices'], ...data.devices.map((d) => [d.id, `${d.name}${d.local ? ' (this device)' : ' (synced)'}`])]) {
      const o = document.createElement('option'); o.value = id; o.textContent = text; filter.append(o);
    }
    const stats = el('div');
    const render = (totals) => { stats.replaceChildren(grid(['Sessions', 'Input tokens', 'Output tokens', 'Prompts', 'Answers'], [[totals.sessions, totals.tokens_in ?? '—', totals.tokens_out ?? '—', totals.prompts ?? '—', totals.answers ?? '—']])); };
    filter.addEventListener('change', async () => { try { render((await get('global/sync', { device: filter.value })).totals); } catch (e) { report(e); } });
    root.append(el('h3', 'Merged statistics'), filter, stats); render(data.totals);
    root.append(grid(['Device', 'Source', 'Sessions', 'Last contribution'], data.devices.map((d) => [d.name, d.local ? 'This device' : 'Synced', d.sessions, new Date(d.updated).toLocaleString()])));
    root.append(el('p', 'Overlapping session snapshots are counted once, using the observation with the most messages. Divergent copies are not combined. Device subtotals may overlap. GitHub requires Git and an authenticated gh CLI; the repository must already exist and be private.', 'small muted'));
  }

  // Interview --------------------------------------------------------------------------------------------
  async function loadInterview() {
    [profile, presets] = await Promise.all([get('global/profile'), get('global/presets')]);
    answers = structuredClone(profile.answers); previewed = null; renderInterview();
  }
  const fingerprint = () => JSON.stringify(answers);
  function status(text) { const s = $('gs-status'); if (s) s.textContent = text; }
  function renderInterview() {
    const root = $('gs-interview'); root.replaceChildren();
    root.append(el('p', `Defaults for every new project · stored in ${profile.path}${profile.exists ? '' : ' (not created yet)'} · existing projects keep their own answers · nothing is written until Apply`, 'small muted'));
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
    const multi = q.type === 'multi', radios = q.type === 'boolean' || (q.type === 'choice' && (q.choices ?? []).length <= RADIO_MAX);
    const wrap = el(multi || radios ? 'fieldset' : 'label', null, 'interview-question');
    const head = el(multi || radios ? 'legend' : 'span', q.label.replace(' (comma-separated)', '')); head.append(code(q.id)); head.lastChild.className = 'small muted'; wrap.append(head);
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
      const choices = q.type === 'boolean' ? [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] : q.choices ?? [];
      wrap.append(choiceField({ name: `gs-${q.id}`, id: `gs-${q.id.replaceAll('.', '-')}`, choices, value: String(value), label: q.label,
        onChange: (v) => set(q.type === 'boolean' ? v === 'true' : v) }).node);
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

  // Classification -----------------------------------------------------------------------------------------
  const FIELDS = [
    ['endpoint', 'Laya address', 'text', 'Loopback only: http://127.0.0.1:<port> or http://[::1]:<port>. Hosted addresses and redirects are refused.'],
    ['threshold', 'Confidence threshold', 'number', 'Predictions below this probability are counted as unknown. Higher is stricter.', 0.01],
    ['maxTurnBytes', 'Largest turn (bytes)', 'number', 'A prompt, its answers and the next prompt, as UTF-8. Larger turns are skipped, never shortened. Laya is most accurate up to about 4,000 tokens.', 100],
    ['maxLen', 'Token budget (max_len)', 'number', 'Sent to Laya per turn; must be at least the largest turn. Laya caps it with LAYA_MAX_TOKEN_BUDGET.', 256],
    ['timeoutSeconds', 'Timeout per turn (seconds)', 'number', 'How long to wait for one answer. The first call can be slow while Laya loads its checkpoint.', 10],
  ];
  async function loadClassifier() {
    classifier ??= await get('preferences');
    classifierSamples ??= await get('classifier-samples');
    renderClassifier();
  }
  function renderClassifier() {
    const root = $('gs-classification'); root.replaceChildren();
    const { classifier: saved, defaults, limits } = classifier;
    const card = el('section', null, 'card'); card.append(el('h2', 'Local classifier'));
    card.append(el('p', 'Classify (in the filter bar of a Sessions page, or yaw sessions evaluate) sends each prompt/answer turn to a Laya service running on this computer and counts the predicted outcome, sentiment, assistant behaviour and failure type per session. It is experimental, never runs automatically, and saves only the counts, never message text. YAW does not install or start Laya; see the steps below.', 'small muted'));
    const form = el('div', null, 'classifier-form'), inputs = {};
    for (const [key, label, type, help, step] of FIELDS) {
      const wrap = el('label', label), input = el('input'), range = limits[key];
      input.type = type; input.name = key; input.id = `classifier-${key}`; input.value = String(saved[key]);
      if (step) { input.step = String(step); input.min = String(range[0]); input.max = String(range[1]); input.inputMode = 'decimal'; }
      inputs[key] = input;
      wrap.append(input, el('span', `${help} Default ${defaults[key]}${range ? `; ${range[0]}–${range[1]}` : ''}.`, 'small muted'));
      form.append(wrap);
    }
    const promptLabel = el('label', 'Shared prompt guidance · sent for every classification category');
    promptLabel.className = 'classifier-prompt';
    const prompt = document.createElement('textarea');
    prompt.id = 'classifier-prompt'; prompt.name = 'prompt'; prompt.rows = 5; prompt.maxLength = 4000; prompt.value = saved.prompt;
    const promptHelp = el('span', 'Add context for Laya. YAW still appends the category-specific labels and safety instructions. Maximum 4,000 characters.', 'small muted');
    promptHelp.id = 'classifier-prompt-help';
    prompt.setAttribute('aria-describedby', promptHelp.id);
    promptLabel.append(prompt, promptHelp);
    form.append(promptLabel);
    const values = () => ({ ...Object.fromEntries(FIELDS.map(([key, , type]) => [key, type === 'number' ? Number(inputs[key].value) : inputs[key].value.trim()])), prompt: prompt.value.trim() });
    const s = el('p', '', 'small muted'); s.setAttribute('role', 'status');
    const say = (text, bad = false) => { s.textContent = text; s.className = `small ${bad ? 'error-text' : 'muted'}`; };
    const act = async (fn) => { buttons.forEach((b) => { b.disabled = true; }); try { await fn(); } catch (e) { say(e.message, true); } finally { buttons.forEach((b) => { b.disabled = false; }); } };
    const buttons = [
      button('Test connection', () => act(async () => { say('Sending one made-up test turn to Laya…'); say((await api('classifier-test', { classifier: values() })).message); }), ''),
      button('Save', () => act(async () => { const r = await api('classifier-save', { classifier: values() }); classifier = { ...classifier, classifier: r.classifier }; say(r.message); }), 'primary'),
      button('Reset to defaults', () => { for (const [key] of FIELDS) inputs[key].value = String(defaults[key]); prompt.value = defaults.prompt; say('Defaults restored in the form; press Save to keep them.'); }, ''),
    ];
    buttons[0].title = 'Sends one fixed, made-up turn (no session text) with the values in this form and checks the answer format. Nothing is saved.';
    const actions = el('div', null, 'interview-actions'); actions.append(...buttons, s);
    card.append(form, actions);
    root.append(card, sampleReview(values), setupCard(saved));
  }
  function sampleReview(values) {
    const card = el('section', null, 'card'), samples = classifierSamples ?? [];
    card.append(el('h2', 'Try Laya on saved sessions'));
    card.append(el('p', 'Choose up to three sessions from your last scan. YAW sends up to three turns per session to the configured loopback Laya service, then shows the top label, confidence, and short prompt/answer excerpts. This is a preview only: predictions and excerpts are not saved, and it does not train or change Laya.', 'small muted'));
    const select = document.createElement('select'); select.multiple = true; select.size = Math.min(8, Math.max(3, samples.length)); select.setAttribute('aria-label', 'Sessions to preview');
    for (const sample of samples) {
      const option = document.createElement('option'); option.value = sample.id;
      option.textContent = `${day(sample.started)} · ${sample.agent} · ${sample.project} · ${sample.prompts ?? '?'} prompts`;
      select.append(option);
    }
    const status = el('p', samples.length ? 'Only sessions in the latest saved scan are listed. Refresh Sessions first if the session you want is missing.' : 'No saved sessions to sample. Run Refresh from a Sessions page first.', 'small muted');
    status.setAttribute('role', 'status');
    const output = el('div');
    const run = button('Preview selected sessions', async () => {
      const ids = [...select.selectedOptions].map((option) => option.value);
      if (!ids.length) { status.textContent = 'Choose at least one session.'; return; }
      if (ids.length > 3) { status.textContent = 'Choose no more than three sessions.'; return; }
      if (!confirm(`Send up to three turns from ${ids.length} selected session(s) to Laya at ${values().endpoint}? The excerpts and predictions are shown here temporarily and are not saved.`)) return;
      run.disabled = true; run.textContent = 'Previewing…'; status.className = 'small muted'; status.textContent = 'Sending selected turns to local Laya…'; output.replaceChildren();
      try {
        const result = await api('classifier-preview', { ids, classifier: values(), confirm: true });
        status.textContent = result.message; status.className = 'small muted';
        output.replaceChildren(...result.sessions.map((session) => {
          const section = el('article', null, 'card'), started = new Date(session.started).toLocaleString();
          section.append(el('h3', `${session.agent} · ${started}`), el('p', session.project, 'small muted'),
            el('p', `${session.classified} turn(s) classified · ${session.skipped} skipped`, 'small'));
          for (const turn of session.turns) {
            const detail = el('div', null, 'setup-step');
            detail.append(el('h4', `Turn ${turn.turn}`), el('strong', 'Prompt excerpt'), el('pre', turn.prompt),
              el('strong', 'Answer excerpt'), el('pre', turn.answer),
              grid(['Category', 'Top label', 'Confidence', 'Applied label'], Object.entries(turn.predictions).map(([key, prediction]) => [
                key, prediction.choice, `${(prediction.confidence * 100).toFixed(1)}%`, prediction.prediction,
              ])));
            section.append(detail);
          }
          if (session.truncated) section.append(el('p', 'Preview stopped at the three-turn limit for this session.', 'small muted'));
          if (!session.turns.length) section.append(el('p', 'No eligible prompt/answer turns were found.', 'small muted'));
          return section;
        }));
      } catch (e) { status.textContent = e.message; status.className = 'small error-text'; }
      finally { run.disabled = false; run.textContent = 'Preview selected sessions'; }
    }, 'primary');
    run.disabled = !samples.length;
    card.append(select, el('p', 'Select up to 3 sessions; hold Ctrl or Command to select multiple.', 'small muted'),
      el('p', 'The preview uses the current form values, whether or not they have been saved.', 'small muted'), run, status, output);
    return card;
  }
  function setupCard(saved) {
    const port = new URL(saved.endpoint).port || '80', host = new URL(saved.endpoint).hostname.replace(/^\[|\]$/g, '');
    const card = el('section', null, 'card laya-setup'); card.append(el('h2', 'Set up Laya'));
    const step = (title, text, command) => {
      const box = el('div', null, 'setup-step'); box.append(el('h3', title));
      if (text) box.append(el('p', text, 'small'));
      if (command) {
        const pre = el('pre', null, 'command'), copy = button('Copy', async () => {
          try { await navigator.clipboard.writeText(command); copy.textContent = 'Copied'; } catch { copy.textContent = 'Select and copy'; }
          setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
        }, 'copy');
        pre.append(el('code', command)); box.append(el('div', null, 'command-wrap')); box.lastChild.append(pre, copy);
      }
      card.append(box);
    };
    card.append(el('p', 'Laya is an open-source (Apache-2.0) Python decision model by NandhaKishorM. It needs Python 3.10 or newer. On first use it downloads the multilingual checkpoint (about 322M parameters) into the Hugging Face cache (HF_HUB_CACHE moves it). Review the model card and your disk and memory before you start.', 'small'));
    step('1. Install it in its own virtual environment', 'Keeps Laya and PyTorch out of your other Python setups.', 'python3 -m venv ~/.laya\n~/.laya/bin/python -m pip install "laya[serve]"');
    step('Or install with uv', null, 'uv venv ~/.laya --python 3.12\nuv pip install --python ~/.laya/bin/python "laya[serve]"');
    step('2. Start the service on this computer only', 'Keep this terminal open while you classify. LAYA_HOST matters: by default laya-serve listens on all network interfaces (0.0.0.0). Add LAYA_DEVICE=mps (Apple), cuda or cpu to pick the device.',
      `LAYA_HOST=${host} LAYA_PORT=${port} LAYA_MODELS=multilingual LAYA_DEFAULT_MODEL=multilingual ~/.laya/bin/laya-serve`);
    step('3. Test it', 'Press Test connection above. The first answer may take a while as the checkpoint downloads and loads.', null);
    step('4. Classify', 'Press Classify in the filter bar of Global → Sessions (all workspaces) or Workspace → Sessions (this workspace), or run:', 'yaw sessions evaluate --days 30');
    const more = el('p', 'Full instructions, GPU builds and troubleshooting: ', 'small muted'), link = el('a', 'github.com/NandhaKishorM/laya');
    link.href = 'https://github.com/NandhaKishorM/laya'; link.target = '_blank'; link.rel = 'noopener noreferrer'; more.append(link, '. YAW never installs, downloads or starts anything for Laya.');
    card.append(more);
    return card;
  }

  return { show, hide, reset };
}
