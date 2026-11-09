// Global Settings: Defaults (your defaults for new projects or one preset, in sub-tabs), Files (~/.yaw, read-only),
// Notifications (personal channels), Classification (local Laya settings and setup steps) and Review prompts (your blueprint). Text nodes only; writes go through CSRF-protected actions and are hash-checked.
import { about, button, el, grid, hint, link, press, source, tabs } from './settings-view.js';
import { asksIn, available, choiceLabel, choiceValue, routeHidden, setFeatures, settingsRoute } from './ui-state.js';
import { renderReviewPrompts } from './review-prompts-view.js';
import { GROUPS, choiceField } from './setup-cards.js';
import { pickFolder } from './folder-picker.js';
import { depthLabel } from '../../interview/depth.js';
import { CHATS } from './chat-services.js';

const $ = (id) => document.getElementById(id);
const TABS = ['interview', 'files', 'notifications', 'classification', 'improve', 'sessions', 'review', 'sync', 'features'];
const code = (t) => el('code', t);
const size = (n) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MiB` : n >= 1024 ? `${Math.round(n / 1024)} KiB` : `${n} B`;
const day = (s) => Number.isFinite(Date.parse(s)) ? new Date(s).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '—';
function depthBadges(depths) {
  return depths.map((depth) => {
    const badge = el('span', `${depth === 'quick' ? 'Quick' : 'Basic'} default`, `depth-default ${depth}`);
    badge.title = `${depth === 'quick' ? 'Quick' : 'Basic'} uses this saved value without asking, when applicable.`;
    return badge;
  });
}

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

export function createGlobalSettings({ api, get, report, notifications, onFile, onFeatures = () => {} }) {
  let tab = 'interview', classifier = null, classifierSamples = null, profile = null, answers = null, presets = null, files = null, comfort = null, selected = null;
  const drawer = $('global-detail');
  const closeDrawer = () => { drawer.hidden = true; document.body.classList.remove('has-drawer'); selected = null; onFile(''); renderFiles(); };
  drawer.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

  // Tabs of a feature that is off (Global → Settings → Features) are hidden and open Defaults instead.
  const tabHidden = (id) => routeHidden(settingsRoute('global-settings', id));
  const drawTabs = () => document.querySelectorAll('#global-settings-tabs [data-tab]').forEach((b) => { b.hidden = tabHidden(b.dataset.tab); b.setAttribute('aria-pressed', String(b.dataset.tab === tab)); });
  function show(sub, query = '') {
    tab = TABS.includes(sub) && !tabHidden(sub) ? sub : 'interview';
    drawTabs();
    for (const id of TABS) $(`gs-${id}`).hidden = id !== tab;
    for (const id of ['sync', 'sessions']) $(`gs-${id}`).classList.add('card', 'settings-panel');
    if (tab === 'interview') (profile ? Promise.resolve(renderInterview()) : loadInterview()).catch(report);
    if (tab === 'notifications') loadNotifications().catch(report);
    if (tab === 'classification') loadClassifier().catch(report);
    if (tab === 'improve') loadImprove().catch(report);
    if (tab === 'review') loadReview().catch(report);
    if (tab === 'sessions') loadSessions().catch(report);
    if (tab === 'sync') loadSync().catch(report);
    if (tab === 'features') loadFeatures().catch(report);
    const file = tab === 'files' ? new URLSearchParams(query).get('file') ?? '' : '';
    if (tab === 'files') (files ? Promise.resolve() : loadFiles()).then(() => { if (file && file !== selected) openFile(file); else if (!file && selected) closeDrawer(); else renderFiles(); }).catch(report);
    else hide();
    return tab;
  }
  function hide() { if (!drawer.hidden) { drawer.hidden = true; document.body.classList.remove('has-drawer'); selected = null; } }
  function reset() { classifier = null; classifierSamples = null; profile = null; presets = null; files = null; comfort = null; }

  async function loadFeatures() {
    const data = await get('global/features'), root = $('gs-features'), settings = data.remoteControl;
    const enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.checked = settings.enabled;
    const label = el('label', ' Server mode'); label.prepend(enabled);
    const role = document.createElement('select'); role.setAttribute('aria-label', 'Server role');
    for (const [value, text] of [['', 'Choose role'], ['client', 'Client'], ['host', 'Host']]) { const o = el('option', text); o.value = value; role.append(o); }
    role.value = settings.role ?? '';
    const details = el('section'), client = el('section'), host = el('section');
    const addressLabel = el('label', 'Server address'), address = document.createElement('input'); address.type = 'text'; address.placeholder = 'http://192.168.1.10:4318'; address.value = settings.address ?? ''; addressLabel.append(address); client.append(addressLabel);
    const portLabel = el('label', 'Port'), port = document.createElement('input'); port.type = 'number'; port.min = '1024'; port.max = '65535'; port.value = settings.port; portLabel.append(port);
    const bindLabel = el('label', 'LAN interface'), bind = document.createElement('select');
    for (const ip of data.interfaces) { const o = el('option', ip); o.value = ip; bind.append(o); } bind.value = settings.bindAddress ?? data.defaultInterface; bindLabel.append(bind);
    const workspaceRoot = settings.workspaceRoot ?? `${data.root.replace(/\/$/, '')}/workspaces`;
    host.append(el('p', workspaceRoot, 'small'), bindLabel, portLabel);
    const status = el('p', '', 'small'); status.setAttribute('role', 'status');
    const update = () => { details.hidden = !enabled.checked; client.hidden = role.value !== 'client'; host.hidden = role.value !== 'host'; };
    enabled.addEventListener('change', update); role.addEventListener('change', update); update();
    details.append(role, client, host);
    const toggle = (text, on, help) => {
      const input = document.createElement('input'); input.type = 'checkbox'; input.checked = on !== false;
      const box = el('label', ` ${text}`, 'setting-toggle'); box.prepend(input);
      return [input, box, el('p', help, 'small muted')];
    };
    const [sync, syncLabel, syncHelp] = toggle('Settings Sync', data.features?.sync, 'Share defaults, presets and statistics between your devices through a folder or a private GitHub repository. Off hides the Sync tab; saved sync settings are kept.');
    const [profiling, profilingLabel, profilingHelp] = toggle('Profiling', data.features?.profiling, 'Classification labels saved sessions with your local Laya service; reviews look at the sessions that need attention. Off hides the Profiling pages (Global and Workspace), the Classification and Profiling settings and the Classification parts of Analytics; saved results are kept.');
    const card = el('article', null, 'card'); card.append(el('h2', 'Optional features'), syncLabel, syncHelp, profilingLabel, profilingHelp, label, details);
    card.append(button('Save features', async () => {
      try {
        const saved = await api('features-save', { sync: sync.checked, profiling: profiling.checked });
        setFeatures(saved.features); drawTabs(); onFeatures(saved.features);
        const input = { enabled: enabled.checked, port: Number(port.value) };
        const migration = enabled.checked && data.folderSync && !data.hubMigrated;
        if (migration) {
          if (!window.confirm('Move settings, presets and statistics from folder/GitHub sync to this server? Sync and back up the old vault first. Current local records will be transferred.')) return;
          input.migrate = true;
        }
        if (role.value) input.role = role.value;
        if (role.value === 'client') input.address = address.value;
        if (role.value === 'host') {
          input.bindAddress = bind.value; input.workspaceRoot = workspaceRoot;
          if (settings.role !== 'host' || settings.workspaceRoot !== workspaceRoot) {
            if (!window.confirm(`${workspaceRoot} will be your workspace folder from now on. Enable Host mode?`)) return;
            input.confirmWorkspace = true;
          }
        }
        if (input.enabled && !input.role) throw new Error('Choose Host or Client');
        await api('remote-settings', input); await loadFeatures();
      } catch (e) { status.textContent = e.message; }
    }, 'primary'), status);
    if (settings.enabled && settings.role) {
      const refresh = async () => { const state = await api('server-status', {}); status.textContent = state.connection ? `${state.connection.status}${state.connection.verification ? ` · pairing ${state.connection.verification}` : ''}${state.connection.message ? ` · ${state.connection.message}` : ''}` : state.address ?? 'Running'; };
      card.append(button('Refresh status', () => refresh().catch((e) => { status.textContent = e.message; })));
      if (settings.role === 'host') card.append(button('Open host', async () => { try { const value = await api('server-open', {}); window.open(value.url, '_blank', 'noopener,noreferrer'); } catch (e) { status.textContent = e.message; } }));
      refresh().catch((e) => { status.textContent = e.message; });
    }
    if (data.hubMigrated && !settings.enabled) card.append(el('p', 'Hub sync paused.', 'small'));
    root.replaceChildren(card);
  }

  async function loadReview() {
    const data = await get('global/review-prompts');
    renderReviewPrompts($('gs-review'), { data, scope: 'global', api, load: loadReview });
  }

  async function loadImprove() {
    const data = await get('improve/settings'), root = $('gs-improve');
    const enabled = new Set(data.enabledAgents), status = el('p', '', 'small'); status.setAttribute('role', 'status');
    const choices = el('div', null, 'improve-agent-options');
    const defaultTarget = document.createElement('select'); defaultTarget.setAttribute('aria-label', 'Preferred reviewer');
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
      label.append(checkbox, el('strong', agent.name), el('span', agent.installed ? 'Available here' : 'Install separately to run here', 'small muted'));
      choices.append(label);
    }
    populate(data.defaultTarget);
    const label = el('label', 'Preferred reviewer'); label.append(defaultTarget, el('span', 'Preselected when you request a review; you can change it for each review.', 'small muted'));
    root.replaceChildren(el('article', null, 'card'));
    const flow = el('ol', null, 'learn-flow');
    for (const [title, text] of [['Choose sessions', 'In Profiling, select saved conversations to inspect.'], ['Preview the prompt', 'Review the context before sharing it with a reviewer.'], ['Request a review', 'Use a browser chat or an enabled CLI. Review proposed changes before applying them.']]) {
      const step = el('li'); step.append(el('strong', title), el('span', text, 'small muted')); flow.append(step);
    }
    const help = el('details', null, 'settings-help');
    help.append(el('summary', 'How are reviews run?'),
      el('p', 'Profiling reviews run only when you request one. It does not forward each prompt. Session hooks collect metadata; model diagnosis happens separately on selected saved conversations.', 'small muted'),
      el('p', 'Browser chats open empty: paste the reviewed prompt yourself. CLI reviews run on the computer running yaw web (normally this computer), in a separate temporary folder, using your existing sign-in and model provider. They may use paid hosted models. YAW shows the response here; it does not apply suggestions automatically.', 'small muted'),
      el('p', 'Install and sign in to Claude Code or Codex separately. YAW does not install them or store credentials. Codex user config is excluded for this restricted review; provider retention still applies.', 'small muted'));
    const actions = el('div', null, 'interview-actions');
    root.firstChild.append(el('h2', 'Profiling Settings · reviewers'), el('p', 'Get a diagnosis of selected sessions and suggested improvements to your project instructions. Reviews run only when you request them.'), flow, help,
      el('h3', 'CLI reviewers'), el('p', 'Allow these tools as review choices. Availability is checked on the computer running yaw web.', 'small muted'), choices,
      label, actions);
    actions.append(button('Save review destinations', async () => {
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
        el('p', 'Where YAW reads your agents\' session history. Analytics › Refresh scans exactly these folders (nothing is scanned by itself) and keeps only counts, times and model names, never message text. Each folder needs the format of the tool that wrote it; the VS Code extensions of Claude Code and Codex write to the same folders as their command lines.', 'small muted'));
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
        try { Object.assign(data, await api('session-sources-save', { sources: list.map(({ agent, path, enabled }) => ({ agent, path, enabled })) })); list = data.sources.map((s) => ({ ...s })); dirty = false; draw(); say('Saved. Press Refresh on an Analytics page to scan them.'); }
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
    root.append(el('h2', 'Sync'), el('p', 'Share defaults, presets and saved statistics between your devices. Choose an existing folder or a private GitHub repository.'));
    const help = el('details', null, 'settings-help'); help.append(el('summary', 'What is transferred?'), el('p', 'No transcripts, passwords or workspace folders. Optional task snapshots and knowledge contain plain text: choose a destination you trust. Refresh Analytics before syncing to include recent statistics. Other devices appear as synced in Analytics after they sync with this YAW version.', 'small muted')); root.append(help);
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
    const SCOPE_TEXT = { settings: 'Personal defaults (About you answers)', presets: 'Presets', statistics: 'Session statistics (counts, times, model names; shown in Analytics)',
      tasks: ['Tasks (the ', link('Global → Tasks', 'global-tasks'), ' snapshots: project folder name, task ids, titles and status)'], knowledge: 'Global knowledge (Markdown records in ~/.yaw/knowledge)' };
    for (const key of ['settings', 'presets', 'statistics', 'tasks', 'knowledge']) {
      const label = el('label', ' '), input = document.createElement('input'); input.type = 'checkbox'; label.append(...[SCOPE_TEXT[key]].flat());
      input.checked = data.config ? data.config.scopes.includes(key) : !['tasks', 'knowledge'].includes(key);
      label.prepend(input); root.append(label); scopes.push([key, input]);
    }
    const run = async (resolution) => {
      let job = await api('sync-run', { name: name.value || undefined, resolution });
      const progress = el('p', '', 'small muted'), cancel = button('Cancel sync', () => api('sync-cancel', {}).catch(report));
      root.append(progress, cancel);
      while (job && ['running', 'cancelling'].includes(job.status)) {
        progress.textContent = `${job.message} Step ${job.steps}: ${job.step}`;
        await new Promise((resolve) => setTimeout(resolve, 600));
        job = await get('sync-job');
      }
      await loadSync(); root.append(el('p', job?.message ?? 'Sync finished.', job?.status === 'failed' ? 'warn' : 'small muted'));
    };
    const actions = el('div', null, 'interview-actions'); root.append(actions);
    actions.append(button('Save sync settings', async () => {
      try {
        await api('sync-setup', { name: name.value || undefined, target: folder.value || undefined, github: github.value || undefined, scopes: scopes.filter(([, input]) => input.checked).map(([key]) => key) });
        await loadSync();
      } catch (e) { report(e); }
    }));
    if (data.configured) actions.append(button('Sync now', () => run().catch(report), 'primary'));
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

  // Defaults ---------------------------------------------------------------------------------------------
  // One editor for your defaults (profile + tool defaults) or one preset (answers only), chosen at the top.
  const SUBTABS = [['about', 'About you'], ['communication', 'Communication'], ['tools', 'Tools'], ['workflow', 'Workflow']];
  const subOf = (id) => id === 'user.agents' ? 'about' : 'communication';
  let setupPolicy = null, target = '', preset = null, policy = {}, tools = new Set(), touched = new Set(), dirty = { profile: false, tools: false }, sub = 'about', note = '';
  async function loadInterview() {
    [setupPolicy, profile, presets] = await Promise.all([get('global/setup-defaults'), get('global/profile'), get('global/presets')]);
    if (target && !presets.presets.some((p) => p.name === target)) target = '';
    preset = target ? await get('global/preset', { name: target }) : null;
    answers = structuredClone(preset ? preset.answers : profile.answers);
    policy = preset ? answers : { ...setupPolicy.answers };
    tools = new Set(setupPolicy.modules); touched = new Set(); dirty = { profile: false, tools: false };
    renderInterview();
  }
  const unsaved = () => touched.size > 0 || dirty.tools;
  function status(text) { note = text; const s = $('gs-status'); if (s) s.textContent = text; }
  function changed(id) {
    if (id) { touched.add(id); dirty.profile = true; }
    const save = $('gs-save'); if (save) save.disabled = !unsaved();
    status('Unsaved changes.');
  }
  const fail = (e) => status(e.message);
  function select(name) {
    if (name === target) return;
    if (unsaved() && !confirm('Discard your unsaved changes?')) return;
    target = name; note = ''; loadInterview().catch(report);
  }
  function renderInterview() {
    const root = $('gs-interview'); root.replaceChildren();
    if (preset && sub === 'tools') sub = 'about';
    const nav = tabs(SUBTABS.map(([id, label]) => [id, label, Boolean(preset) && id === 'tools']), (id) => { sub = id; renderInterview(); }, sub);
    nav.classList.add('sub-tabs'); nav.setAttribute('aria-label', 'Defaults sections');
    if (preset) nav.querySelector('[data-mode=tools]').title = 'Presets store answers only; tools apply to your defaults.';
    root.append(presetsCard(), nav, sub === 'tools' ? toolsCard() : sub === 'workflow' ? workflowCard() : questionsCard(sub));
  }
  function presetsCard() {
    const box = el('section', null, 'card preset-editor'), head = el('div', null, 'section-heading');
    const s = el('span', note, 'small muted'); s.id = 'gs-status'; s.setAttribute('role', 'status');
    const save = button('Save', () => saveTarget().catch(fail), 'primary'); save.id = 'gs-save'; save.disabled = !unsaved();
    const actions = el('div', null, 'row-actions'); actions.append(s, button('Reset', () => { note = ''; loadInterview().catch(report); }), save);
    head.append(el('h2', preset ? `Editing preset ${preset.name}` : 'Editing your defaults'), actions);
    box.append(head, el('p', preset
      ? `Changes are saved to ~/.yaw/presets/${preset.name}.yaml. Other answers in the preset (project idea, stack) are kept. yaw init --preset ${preset.name} uses it.`
      : `Defaults for every new project · stored in ${profile.path}${profile.exists ? '' : ' (not created yet)'} · existing projects keep their own answers. Depth badges show where a saved value is used without asking.`, 'small muted'));
    const run = (fn) => fn().catch(fail);
    const view = (name) => { const b = button(name === target ? 'Viewing' : 'View', () => select(name)); b.setAttribute('aria-pressed', String(name === target)); return b; };
    const rows = [[code('Your defaults'), 'Defaults for every new project', '—', '—', view('')]];
    for (const p of presets?.presets ?? []) {
      const cell = el('span', null, 'row-actions');
      cell.append(view(p.name),
        button('Rename', () => run(async () => {
          const to = prompt(`New name for preset ${p.name} (lower-case letters, digits, hyphens):`, p.name);
          if (!to || to === p.name) return;
          const r = await api('preset-rename', { name: p.name, to }); if (target === p.name) target = to; files = null; await loadInterview(); status(r.message);
        })),
        button('Delete', () => run(async () => {
          if (!confirm(`Delete preset ${p.name}? This removes ~/.yaw/presets/${p.name}.yaml.`)) return;
          const r = await api('preset-delete', { name: p.name, confirm: true }); if (target === p.name) target = ''; files = null; await loadInterview(); status(r.message);
        }), 'danger'));
      rows.push([code(p.name), p.description || '—', depthLabel(p.mode) || '—', p.created ? day(p.created) : '—', cell]);
    }
    const t = grid(['Name', 'Description', 'Depth', 'Created', ''], rows);
    t.classList.add('preset-table');
    t.querySelectorAll('tbody tr').forEach((tr, i) => tr.classList.toggle('is-selected', (i === 0 ? '' : presets.presets[i - 1].name) === target));
    box.append(t);
    if (!presets?.presets.length) box.append(el('p', 'No presets saved yet. Save one from the interview (Save preset) or with yaw presets save in a configured project.', 'small muted'));
    return box;
  }
  function questionsCard(group) {
    const box = el('section', null, 'card interview-section');
    const list = profile.questions.filter((q) => subOf(q.id) === group);
    for (const q of list) box.append(question(q));
    if (!list.length) box.append(el('p', 'This kit asks no personal questions here.', 'muted'));
    return box;
  }
  function toolsCard() {
    const box = el('section', null, 'card'); box.append(el('h2', 'Optional tools for new projects'), el('p', 'Undecided tools start off. Quick reuses these defaults; Basic and All let you review them. Existing projects keep their selections.', 'small muted'));
    if (setupPolicy.warning) box.append(el('p', setupPolicy.warning, 'warn'));
    const groups = el('div', null, 'tool-default-groups');
    for (const [group, title] of GROUPS) {
      const modules = setupPolicy.catalog.filter((m) => m.group === group);
      if (!modules.length) continue;
      const section = el('section', null, 'tool-default-group'), cards = el('div', null, 'tool-default-cards');
      section.append(el('h3', title));
      for (const m of modules) {
        const card = el('article', null, 'tool-default'), label = el('label', null, 'setting-toggle');
        const input = el('input'); input.type = 'checkbox'; input.checked = tools.has(m.name);
        input.addEventListener('change', () => { if (input.checked) tools.add(m.name); else tools.delete(m.name); dirty.tools = true; changed(); });
        label.append(input, el('strong', m.title));
        const help = el('details', null, 'quick-help'), summary = el('summary', '?');
        summary.setAttribute('aria-label', `About ${m.title}`); summary.title = m.what;
        help.append(summary, el('p', m.what));
        if (m.adds.length) help.append(el('p', m.adds.join(' · '), 'small muted'));
        const dependencies = m.depends.filter((n) => n !== 'core');
        if (dependencies.length) help.append(el('p', `Also enables: ${dependencies.map((n) => setupPolicy.catalog.find((x) => x.name === n)?.title ?? n).join(', ')}.`, 'small muted'));
        card.append(label, help, el('p', m.short, 'small muted')); cards.append(card);
      }
      section.append(cards); groups.append(section);
    }
    box.append(...depthBadges(['quick']), groups); return box;
  }
  function workflowCard() {
    const box = el('section', null, 'card'); box.append(el('h2', 'Workflow defaults'));
    const policies = el('div', null, 'settings-fields');
    for (const q of setupPolicy.questions) {
      const field = el('fieldset', null, 'interview-question'), legend = el('legend', q.label);
      legend.append(...depthBadges(['quick', 'basic'].filter((depth) => !asksIn(q, depth))));
      const choices = q.type === 'boolean' ? [{ value: 'false', label: 'Off' }, { value: 'true', label: 'On' }] : q.choices;
      field.append(legend, choiceField({ name: `policy-${q.id}`, id: `policy-${q.id}`, choices, value: String(policy[q.id] ?? q.default), label: q.label,
        onChange: (v) => { policy[q.id] = q.type === 'boolean' ? v === 'true' : v; if (preset) changed(q.id); else { dirty.tools = true; changed(); } } }).node);
      if (q.hint) field.append(el('p', q.hint, 'small muted'));
      policies.append(field);
    }
    box.append(policies); return box;
  }
  function question(q) {
    const multi = q.type === 'multi', radios = q.type === 'boolean' || q.type === 'choice';
    const wrap = el(multi || radios ? 'fieldset' : 'label', null, 'interview-question');
    const head = el(multi || radios ? 'legend' : 'span', q.label.replace(' (comma-separated)', '')); head.append(...depthBadges(q.assumedIn ?? [])); wrap.append(head);
    const value = answers[q.id] ?? q.default;
    const set = (v) => { answers[q.id] = v; changed(q.id); };
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
      const t = el(q.id === 'user.language' ? 'input' : 'textarea'); t.maxLength = 8192; if (q.id === 'user.language') t.type = 'text'; else t.rows = 1; t.value = String(value ?? ''); t.addEventListener('input', () => set(t.value)); wrap.append(t);
    }
    if (q.hint) wrap.append(el('span', q.hint, 'small muted'));
    return wrap;
  }
  // Only answered questions are sent; keys set by other commands stay as they are.
  const payload = () => Object.fromEntries(profile.questions.filter((q) => answers[q.id] !== undefined).map((q) => [q.id, answers[q.id]]));
  async function saveTarget() {
    status('Saving…');
    const messages = [];
    if (preset) messages.push((await api('preset-save', { name: preset.name, answers: Object.fromEntries([...touched].map((id) => [id, answers[id]])), expected: preset.hash })).message);
    else {
      if (dirty.profile) messages.push((await api('profile-apply', { answers: payload(), expected: profile.hash })).message);
      if (dirty.tools) { await api('setup-defaults-save', { modules: [...tools], answers: policy }); messages.push('Tool defaults saved for future project setups.'); }
    }
    files = null; await loadInterview(); status(messages.join(' '));
  }

  // Files ------------------------------------------------------------------------------------------------
  async function loadFiles() { files = await get('global/files'); renderFiles(); }
  function renderFiles() {
    const root = $('gs-files'); root.replaceChildren();
    if (!files) return;
    root.append(hint('small muted', `Your YAW folder ${files.dir}${files.dataDir ? ` (collected data in ${files.dataDir})` : ''}. Read-only here: change settings on the `, link('Defaults', 'global-settings/interview'), ' and ', link('Notifications', 'global-settings/notifications'), ' tabs or with the yaw CLI. It never holds secrets.'));
    const cols = el('div', null, 'settings-groups');
    for (const g of files.groups) {
      const box = el('section', null, 'card settings-group'); box.append(el('h2', g.title));
      for (const f of g.files) {
        const b = button('', () => { if (!f.folder) onFile(f.path); }, 'file-row'), left = el('span');
        left.append(code(f.path)); b.title = f.about ?? '';
        b.append(left, el('span', f.folder ? `${f.entries} entries · not browsable` : f.missing ? 'not created yet' : f.blocked ? 'not a regular file' : `${size(f.size)} · ${day(f.modified)}`, 'small muted'));
        b.disabled = Boolean(f.folder || f.missing || f.blocked);
        b.setAttribute('aria-pressed', String(selected === f.path));
        box.append(b, about(f, 'small muted file-about'));
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
    if (file.about) drawer.append(about(file));
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
    card.append(hint('small muted', 'Classify (in the controller on ', link('Profiling', 'global-improve'), ', or yaw sessions evaluate) sends each prompt/answer turn to a Laya service running on this computer and counts the predicted outcome, sentiment, assistant behaviour and failure type per session. It is experimental, never runs automatically, and saves only the counts, never message text. YAW does not install or start Laya; see the steps below.'));
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
    card.append(el('p', 'Choose up to three sessions from your last scan. YAW sends up to three turns per session to local Laya, then shows model labels and confidence alongside applied labels, their source, UNKNOWN reasons, and short excerpts. Clear whole-message user verdicts can determine outcome; other categories use Laya. This preview is not saved and does not train Laya.', 'small muted'));
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
              grid(['Category', 'Model label', 'Model confidence', 'Applied label', 'Source', 'Unknown reason'], Object.entries(turn.predictions).map(([key, prediction]) => [
                key, prediction.choice, `${(prediction.confidence * 100).toFixed(1)}%`, prediction.prediction,
                prediction.source === 'userFeedback' ? 'User feedback rule' : 'Laya',
                prediction.unknownReason === 'model' ? 'Model uncertain' : prediction.unknownReason === 'lowConfidence' ? 'Below confidence threshold' : prediction.unknownReason === 'noVerdict' ? 'No user verdict' : '—',
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
      if (text) box.append(hint('small', ...[text].flat()));
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
    step('4. Classify', ['Choose 5, 10 or All and press Classify in the controller on ', link('Global → Profiling', 'global-improve'), ' (all workspaces) or ', link('Workspace → Profiling', 'profiling'), ' (this workspace; results also appear in ', link('Analytics', 'global-analytics'), '), or run:'], 'yaw sessions evaluate --days 30');
    const more = el('p', 'Full instructions, GPU builds and troubleshooting: ', 'small muted'), docs = el('a', 'github.com/NandhaKishorM/laya');
    docs.href = 'https://github.com/NandhaKishorM/laya'; docs.target = '_blank'; docs.rel = 'noopener noreferrer'; more.append(docs, '. YAW never installs, downloads or starts anything for Laya.');
    card.append(more);
    return card;
  }

  return { show, hide, reset };
}
