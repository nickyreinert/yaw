// Global Settings: Interview (your defaults for new projects, plus presets), Files (~/.yaw, read-only),
// Notifications (personal channels), Classification (local Laya settings and setup steps) and Review prompts (your blueprint). Text nodes only; writes go through CSRF-protected actions and are hash-checked.
import { button, el, grid, press, source, tabs } from './settings-view.js';
import { available, choiceLabel, choiceValue } from './ui-state.js';
import { renderReviewPrompts } from './review-prompts-view.js';
import { RADIO_MAX, choiceField } from './setup-cards.js';
import { pickFolder } from './folder-picker.js';

const $ = (id) => document.getElementById(id);
const TABS = ['interview', 'files', 'notifications', 'classification', 'review', 'sync'];
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
  let tab = 'interview', classifier = null, profile = null, answers = null, presets = null, files = null, comfort = null, previewed = null, selected = null;
  const drawer = $('global-detail');
  const syncTab = button('Sync', () => { location.hash = '#global-settings/sync'; });
  syncTab.dataset.tab = 'sync'; $('global-settings-tabs').append(syncTab);
  const closeDrawer = () => { drawer.hidden = true; document.body.classList.remove('has-drawer'); selected = null; onFile(''); renderFiles(); };
  drawer.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

  function show(sub, query = '') {
    tab = TABS.includes(sub) ? sub : 'interview';
    document.querySelectorAll('#global-settings-tabs [data-tab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === tab)));
    for (const id of TABS) $(`gs-${id}`).hidden = id !== tab;
    if (tab === 'interview') (profile ? Promise.resolve(renderInterview()) : loadInterview()).catch(report);
    if (tab === 'notifications') loadNotifications().catch(report);
    if (tab === 'classification') loadClassifier().catch(report);
    if (tab === 'review') loadReview().catch(report);
    if (tab === 'sync') loadSync().catch(report);
    const file = tab === 'files' ? new URLSearchParams(query).get('file') ?? '' : '';
    if (tab === 'files') (files ? Promise.resolve() : loadFiles()).then(() => { if (file && file !== selected) openFile(file); else if (!file && selected) closeDrawer(); else renderFiles(); }).catch(report);
    else hide();
    return tab;
  }
  function hide() { if (!drawer.hidden) { drawer.hidden = true; document.body.classList.remove('has-drawer'); selected = null; } }
  function reset() { classifier = null; profile = null; presets = null; files = null; comfort = null; previewed = null; }

  async function loadReview() {
    const data = await get('global/review-prompts');
    renderReviewPrompts($('gs-review'), { data, scope: 'global', api, load: loadReview });
  }

  async function loadSync() {
    const data = await get('global/sync'), root = $('gs-sync'); root.replaceChildren();
    root.append(el('h2', 'Sync'), el('p', 'Merge saved numerical statistics across devices. Sync presets and personal interview defaults in both directions. No transcripts, credentials or workspace folders are transferred. Refresh Sessions locally before syncing to include recent statistics.'));
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
    for (const key of ['settings', 'presets', 'statistics']) {
      const label = el('label', ` ${key}`), input = document.createElement('input'); input.type = 'checkbox';
      input.checked = data.config ? data.config.scopes.includes(key) : true;
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
  async function loadClassifier() { classifier ??= await get('preferences'); renderClassifier(); }
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
    const values = () => Object.fromEntries(FIELDS.map(([key, , type]) => [key, type === 'number' ? Number(inputs[key].value) : inputs[key].value.trim()]));
    const s = el('p', '', 'small muted'); s.setAttribute('role', 'status');
    const say = (text, bad = false) => { s.textContent = text; s.className = `small ${bad ? 'error-text' : 'muted'}`; };
    const act = async (fn) => { buttons.forEach((b) => { b.disabled = true; }); try { await fn(); } catch (e) { say(e.message, true); } finally { buttons.forEach((b) => { b.disabled = false; }); } };
    const buttons = [
      button('Test connection', () => act(async () => { say('Sending one made-up test turn to Laya…'); say((await api('classifier-test', { classifier: values() })).message); }), ''),
      button('Save', () => act(async () => { const r = await api('classifier-save', { classifier: values() }); classifier = { ...classifier, classifier: r.classifier }; say(r.message); }), 'primary'),
      button('Reset to defaults', () => { for (const [key] of FIELDS) inputs[key].value = String(defaults[key]); say('Defaults restored in the form; press Save to keep them.'); }, ''),
    ];
    buttons[0].title = 'Sends one fixed, made-up turn (no session text) with the values in this form and checks the answer format. Nothing is saved.';
    const actions = el('div', null, 'interview-actions'); actions.append(...buttons, s);
    card.append(form, actions);
    root.append(card, setupCard(saved));
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
