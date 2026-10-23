import { choiceValue, choiceLabel, available, effectiveAnswers, visibleQuestions, defaultModules, toggleModules, installDialogCancellation } from './ui-state.js';

const $ = (id) => document.getElementById(id);
const csrf = document.querySelector('meta[name="yaw-csrf"]').content;
let catalog, state = { mode: 'quick', answers: {}, profile: '', modules: null };
let revision = 0, timer, busy = false, lastPreview;
const controls = new Map(), sections = new Map();
const actionIds = ['draft', 'preset', 'diff', 'apply'];

function element(tag, text, attrs = {}) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}
function error(message) {
  $('error').textContent = message;
  $('error').hidden = !message;
}
function status(message) { $('status').textContent = message; }
function actions(enabled) { actionIds.forEach((id) => { $(id).disabled = !enabled || busy; }); }
async function request(action, input = state) {
  const response = await fetch(`/api/${action}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-YAW-Token': csrf }, body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = await response.json();
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
  return response;
}
const selectedModules = () => state.modules ?? defaultModules(catalog.modules, catalog.questions, state.answers, state.mode);
const shownValue = (v) => Array.isArray(v) ? v.join(', ') : String(v ?? '');

function buildQuestions() {
  for (const [target, text] of [['setup-depth', 'Setup depth'], ['start', 'Starting answers']]) {
    const li = element('li'); li.append(element('a', text, { href: `#${target}` })); $('sections').append(li);
  }
  const title = { user: 'About you', idea: 'The idea', arch: 'Architecture', quality: 'Quality', tasks: 'Tasks', team: 'Team' };
  for (const q of catalog.questions) {
    const sectionId = q.id.split('.')[0];
    if (!sections.has(sectionId)) {
      const section = element('section', undefined, { id: `section-${sectionId}`, 'aria-labelledby': `title-${sectionId}` });
      section.append(element('h2', title[sectionId] ?? sectionId, { id: `title-${sectionId}` }));
      const reviewed = element('button', 'Mark shown answers reviewed', { type: 'button' });
      reviewed.addEventListener('click', () => {
        const modules = selectedModules();
        const values = effectiveAnswers(catalog.questions.filter((q) => modules.includes(q.owner)), state.answers, state.mode);
        for (const shown of visibleQuestions(catalog.questions, state.answers, state.mode, modules)) {
          if (shown.id.split('.')[0] === sectionId) state.answers[shown.id] = values[shown.id];
        }
        update();
      });
      section.append(reviewed);
      $('questions').append(section);
      const link = element('a', '', { href: `#section-${sectionId}` });
      const li = element('li'); li.append(link); $('sections').append(li);
      sections.set(sectionId, { node: section, link, li, title: title[sectionId] ?? sectionId });
    }
    const id = `q-${q.id.replaceAll('.', '-')}`;
    const node = element(q.type === 'multi' ? 'fieldset' : 'div', undefined, { class: 'question', id: `wrap-${id}` });
    const label = q.label.replace(' (comma-separated)', '');
    node.append(element(q.type === 'multi' ? 'legend' : 'label', label, q.type === 'multi' ? {} : { for: id }));
    let input;
    const inputs = [];
    if (q.type === 'multi') {
      for (const c of q.choices) {
        const value = choiceValue(c);
        input = element('input', undefined, { type: 'checkbox', value, name: q.id, id: `${id}-${value}` });
        input.disabled = !available(c);
        const l = element('label'); l.append(input, document.createTextNode(`${choiceLabel(c)}${available(c) ? '' : ' — phase 3, not available yet'}`));
        node.append(l); inputs.push(input);
      }
    } else if (q.type === 'choice' || q.type === 'boolean') {
      input = element('select', undefined, { id, name: q.id });
      const choices = q.type === 'boolean' ? [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] : q.choices;
      for (const c of choices) {
        const option = element('option', `${choiceLabel(c)}${available(c) ? '' : ' — not available yet'}`, { value: choiceValue(c) });
        option.disabled = !available(c); input.append(option);
      }
      node.append(input); inputs.push(input);
    } else {
      input = element(q.type === 'text' ? 'textarea' : 'input', undefined, { id, name: q.id });
      if (q.type === 'text') input.maxLength = 8192;
      else { input.type = 'number'; input.step = 'any'; }
      node.append(input); inputs.push(input);
    }
    const hint = element('p', q.hint ?? '', { class: 'hint', id: `${id}-hint` });
    if (!q.hint) hint.hidden = true;
    node.append(hint);
    inputs.forEach((i) => i.setAttribute('aria-describedby', `${id}-hint ${id}-default`));
    const defaults = element('p', `Default: ${shownValue(q.default) || '(empty)'}`, { class: 'default', id: `${id}-default` });
    node.append(defaults);
    const why = element('details'); why.append(element('summary', 'Why this matters'), element('div', q.helpText || q.hint || 'This answer shapes the generated project rules. You can keep the documented default.', { class: 'help' }));
    node.append(why);
    const example = element('details'); example.append(element('summary', 'Example'), element('p', q.type === 'text' ? (q.hint || 'Describe your project in plain words. Do not enter passwords, tokens or API keys.') : `For example: ${shownValue(q.default)}. Keep the default if unsure.`));
    node.append(example);
    let capability;
    if (q.id === 'user.agents') { capability = element('div'); node.append(capability); }
    inputs.forEach((i) => i.addEventListener(q.type === 'text' || q.type === 'number' ? 'input' : 'change', () => {
      if (q.type === 'multi') state.answers[q.id] = inputs.filter((x) => x.checked && !x.disabled).map((x) => x.value);
      else if (q.type === 'boolean') state.answers[q.id] = i.value === 'true';
      else if (q.type === 'number') state.answers[q.id] = i.value === '' ? q.default : Number(i.value);
      else state.answers[q.id] = i.value;
      update();
    }));
    sections.get(sectionId).node.append(node);
    controls.set(q.id, { q, node, label: node.firstChild, plainLabel: label, inputs, hint, why, example, defaults, capability, expertise: null });
  }
  for (const [target, text] of [['stack', 'Stack profile'], ['module-section', 'Modules'], ['confirm', 'Review and confirm']]) {
    const li = element('li'); li.append(element('a', text, { href: `#${target}` })); $('sections').append(li);
  }
}

function renderQuestions() {
  const modules = selectedModules();
  const visible = new Set(visibleQuestions(catalog.questions, state.answers, state.mode, modules).map((q) => q.id));
  const answers = effectiveAnswers(catalog.questions.filter((q) => modules.includes(q.owner)), state.answers, state.mode);
  const expertise = answers['user.expertise'] ?? 'intermediate';
  for (const [id, c] of controls) {
    c.node.hidden = !visible.has(id);
    c.label.textContent = expertise === 'expert' ? `${c.q.id} — ${c.plainLabel}` : c.plainLabel;
    const value = answers[id] ?? c.q.default;
    for (const input of c.inputs) {
      if (c.q.type === 'multi') input.checked = value.includes(input.value);
      else if (document.activeElement !== input) input.value = String(value);
    }
    c.hint.hidden = !c.q.hint || expertise === 'expert';
    if (c.expertise !== expertise) {
      c.why.open = expertise === 'layperson';
      c.example.open = expertise === 'layperson';
      c.expertise = expertise;
    }
    c.defaults.textContent = `${expertise === 'layperson' ? 'If unsure, keep this recommended starting answer: ' : 'Default: '}${shownValue(c.q.default) || '(empty)'}`;
    if (c.capability) {
      c.capability.replaceChildren();
      for (const agent of value) {
        const detail = catalog.agents[agent];
        if (!detail) continue;
        const note = element('details'); note.append(element('summary', `${detail.name}: capability notes`));
        if (detail.note) note.append(element('p', detail.note));
        for (const [feature, support] of Object.entries(detail.capabilities ?? {})) {
          if (support.support !== 'native') note.append(element('p', `${feature}: ${support.support}. ${support.note ?? support.via ?? ''}`));
        }
        c.capability.append(note);
      }
    }
  }
  for (const [id, s] of sections) {
    const qs = [...controls.values()].filter((c) => c.q.id.split('.')[0] === id && visible.has(c.q.id));
    const answered = qs.filter((c) => Object.hasOwn(state.answers, c.q.id)).length;
    s.node.hidden = s.li.hidden = qs.length === 0;
    s.link.textContent = `${s.title} — ${answered}/${qs.length} reviewed${answered === qs.length ? ' ✓' : ''}`;
  }
}
function renderModules() {
  const selected = selectedModules();
  $('modules').replaceChildren();
  for (const m of catalog.modules) {
    const card = element('div', undefined, { class: 'module-card' });
    const label = element('label');
    const input = element('input', undefined, { type: 'checkbox', id: `module-${m.name}` });
    input.checked = selected.includes(m.name); input.disabled = m.name === 'core';
    label.append(input, document.createTextNode(`${m.name}${m.name === 'core' ? ' (required)' : ''}`));
    card.append(label, element('p', m.description));
    if (m.depends.length) card.append(element('p', `Requires: ${m.depends.join(', ')}`));
    input.addEventListener('change', () => {
      state.modules = toggleModules(catalog.modules, selectedModules(), m.name, input.checked);
      update();
      $(`module-${m.name}`).focus();
    });
    $('modules').append(card);
  }
}
function summary(preview) {
  const root = $('summary'); root.replaceChildren();
  root.append(element('p', `Profile: ${preview.profile}${preview.profile === preview.suggestion ? ' (suggested)' : ''}`));
  root.append(element('p', `Modules: ${preview.modules.join(', ')}`));
  root.append(element('p', `${preview.files.length} files; approximately ${preview.footprint.bytes.toLocaleString()} bytes + ${preview.footprint.baseCopies} base copies.`));
  root.append(element('p', preview.footprint.note));
  if (preview.secrets.names.length) {
    root.append(element('p', preview.secrets.existingFile
      ? `${preview.secrets.names.length} local secret name(s) found in .env.example; existing .env will not be read or changed.`
      : `${preview.secrets.names.length} local secret name(s) found in .env.example; values are optional and saved only to .env.`));
  }
  const files = element('details'); files.open = true;
  files.append(element('summary', 'Files to be generated'));
  const ul = element('ul');
  for (const f of preview.files) ul.append(element('li', `${f.path}${f.action === 'kept' ? ' — kept unchanged' : ''}${f.bytes === null ? ' (bookkeeping)' : ` (${f.bytes} B rendered)`}`));
  files.append(ul); root.append(files);
  const answers = element('details'); answers.append(element('summary', 'Answers and defaults'));
  const list = element('ul');
  for (const [id, value] of Object.entries(preview.answers)) list.append(element('li', `${id}: ${shownValue(value) || '(empty)'}${preview.defaulted.includes(id) ? ' (default)' : ''}`));
  answers.append(list); root.append(answers);
}
function applySecretFields() {
  const container = $('secret-fields'); container.replaceChildren();
  const { names, existingFile } = lastPreview.secrets;
  if (!names.length) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  container.append(element('h3', 'Optional local secrets'));
  container.append(element('p', existingFile
    ? 'An existing .env is preserved without being read or modified. These values will not be saved.'
    : 'Values are sent only to this local server, written directly to .env with private permissions, and never added to answers or logs. Leave a field blank to skip it.'));
  if (existingFile) return;
  for (const name of names) {
    const id = `secret-${name}`;
    container.append(element('label', name, { for: id }));
    container.append(element('input', undefined, {
      type: 'password', id, name, autocomplete: 'new-password', autocapitalize: 'off', spellcheck: 'false',
    }));
  }
}
function update() {
  revision++;
  lastPreview = null;
  error(''); actions(false);
  // Do not leave a stale preview or diff (possibly including an earlier value) on screen.
  $('summary').textContent = 'Updating preview…';
  $('diff-panel').hidden = true; $('diff-output').textContent = '';
  renderQuestions(); renderModules();
  clearTimeout(timer);
  const current = revision;
  timer = setTimeout(async () => {
    try {
      const body = await (await request('preview')).json();
      if (current !== revision) return;
      lastPreview = body; summary(body); actions(true);
      status('Preview only. Unreviewed questions use the documented defaults.');
    } catch (e) {
      if (current !== revision) return;
      $('summary').textContent = 'Preview unavailable. Fix the error before saving or applying.';
      error(e.message); status('Nothing was saved or applied.');
    }
  }, 180);
}

async function perform(name, input = state) {
  busy = true; actions(false); error('');
  try {
    const body = await (await request(name, input)).json();
    if (name === 'diff') {
      $('diff-output').textContent = body.diff; $('diff-panel').hidden = false; $('diff-title').focus();
    } else status(body.message);
  } catch (e) { error(e.message); }
  finally { busy = false; actions(Boolean(lastPreview)); }
}
async function apply() {
  busy = true; actions(false); error('');
  $('setup').inert = true;
  $('log-panel').hidden = false; $('log').textContent = ''; $('log-title').focus();
  status('Applying… keep this page open for the log.');
  let secretValues = Object.fromEntries([...$('secret-fields').querySelectorAll('input[type=password]')]
    .map((input) => [input.name, input.value]).filter(([, value]) => value !== ''));
  for (const input of $('secret-fields').querySelectorAll('input[type=password]')) input.value = '';
  let completed = false, started = false;
  try {
    const response = await request('apply', { ...state, secrets: secretValues });
    started = true;
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = '';
    const receive = (line) => {
      if (!line) return;
      const event = JSON.parse(line);
      if (event.type === 'log') $('log').textContent += event.text;
      if (event.type === 'error') error(event.message);
      if (event.type === 'done') {
        completed = true; status(event.message);
        if (!event.ok) error(event.message);
      }
    };
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n'); buffer = lines.pop();
      lines.forEach(receive);
      if (done) { receive(buffer); break; }
    }
    if (!completed) throw new Error('Apply did not report completion. Inspect the project and terminal; do not assume it succeeded.');
  } catch (e) { error(e.message); status(started ? 'Apply did not complete successfully. Inspect the project before retrying.' : 'Apply was rejected before it started. Fix the error and review again.'); }
  finally {
    secretValues = null;
    if (started) status(`${$('status').textContent} The local server closes after apply; restart yaw init only if the project is still uninitialized.`);
    else {
      busy = false; $('setup').inert = false; actions(Boolean(lastPreview));
    }
  }
}
async function start() {
  const response = await fetch('/api/bootstrap');
  const body = await response.json();
  if (!response.ok) throw new Error(body.error);
  catalog = body;
  for (const id of ['save-dialog', 'apply-dialog']) installDialogCancellation($(id));
  for (const p of catalog.profiles) $('profile').append(element('option', `${p.name} — ${p.summary}`, { value: p.name }));
  if (catalog.hasUserProfile) $('prefill').append(element('option', 'Saved user preferences', { value: 'profile' }));
  if (catalog.hasDraft) $('prefill').append(element('option', 'Resume project draft', { value: 'draft' }));
  for (const p of catalog.presets) $('prefill').append(element('option', `Preset / previous project: ${p.name}`, { value: `preset:${p.name}` }));
  $('verify-note').textContent = catalog.skipVerify ? 'Verification was explicitly disabled with --skip-verify.' : 'Apply runs the same verification as the CLI: just setup && just check.';
  buildQuestions();
  $('setup').addEventListener('submit', (e) => e.preventDefault());
  document.querySelectorAll('input[name=mode]').forEach((input) => input.addEventListener('change', () => {
    state.mode = input.value; state.modules = null; update();
  }));
  $('profile').addEventListener('change', () => { state.profile = $('profile').value; update(); });
  $('reset-modules').addEventListener('click', () => { state.modules = null; update(); });
  $('load').addEventListener('click', async () => {
    try {
      if ($('prefill').value === 'new') state = { mode: 'quick', answers: {}, profile: '', modules: null };
      else {
        const [kind, name] = $('prefill').value.split(':');
        state = await (await request('prefill', { kind, ...(name ? { name } : {}) })).json();
      }
      document.querySelectorAll('input[name=mode]').forEach((i) => { i.checked = i.value === (state.mode === 'standard' ? 'full' : state.mode); });
      $('profile').value = state.profile;
      update();
    } catch (e) { error(e.message); }
  });
  $('draft').addEventListener('click', () => perform('draft'));
  $('diff').addEventListener('click', () => perform('diff'));
  $('preset').addEventListener('click', () => {
    $('save-consent').checked = $('save-profile').checked = false;
    $('save-confirm').disabled = true;
    $('save-dialog').returnValue = '';
    $('save-dialog').showModal();
  });
  $('save-consent').addEventListener('change', () => { $('save-confirm').disabled = !$('save-consent').checked; });
  $('save-dialog').addEventListener('close', () => {
    if ($('save-dialog').returnValue === 'save' && $('save-consent').checked) perform('preset', { ...state, consent: true, saveProfile: $('save-profile').checked });
    $('save-consent').checked = $('save-profile').checked = false;
  });
  $('apply').addEventListener('click', () => {
    applySecretFields();
    $('apply-dialog').returnValue = '';
    $('apply-dialog').showModal();
  });
  $('apply-dialog').addEventListener('close', () => {
    if ($('apply-dialog').returnValue === 'apply') apply();
    else $('secret-fields').replaceChildren();
  });
  update();
}
start().catch((e) => { actions(false); error(e.message); status('The form could not start. Nothing was written.'); });
