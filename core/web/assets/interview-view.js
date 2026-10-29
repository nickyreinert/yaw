import { choiceValue, choiceLabel, available, asksIn, matches, effectiveAnswers, visibleQuestions, defaultModules, toggleModules, installDialogCancellation } from './ui-state.js';
import { isPreference, questionApplies } from '../../interview/policy.js';

import { CARD_QUESTIONS, GROUP_INTRO, RADIO_MAX, choiceField, decisionIcon, gitInitControl, isInline, renderModuleGroups, renderStack } from './setup-cards.js';
import { createPlanCard } from './plan-card.js';
import { renderReview } from './review-step.js';
import { DEPTHS, depthOf } from '../../interview/depth.js';

export async function mountInterview(root, options = {}) {
let presentation = options.presentation ?? 'interview', settingsPreview = null;
const questionMode = () => presentation === 'settings' ? 'pro' : state.mode;
const prefix = options.prefix ?? '';
const localId = (id) => prefix && !id.startsWith(prefix) ? prefix + id : id;
const $ = (id) => root.querySelector('#' + CSS.escape(localId(id)));
const kickoffCard = options.kickoffCard;
const showView = (view, replace) => options.navigate?.(view, replace);
const setInterviewDone = (done) => options.onDone?.(done);
function scopeIds() {
  if (!prefix) return;
  for (const node of root.querySelectorAll('[id]')) node.id = localId(node.id);
  for (const node of root.querySelectorAll('[for], [aria-labelledby], [aria-describedby], [aria-controls]')) {
    for (const key of ['for', 'aria-labelledby', 'aria-describedby', 'aria-controls']) {
      if (node.hasAttribute(key)) node.setAttribute(key, node.getAttribute(key).split(' ').map(localId).join(' '));
    }
  }
}
scopeIds();
for (const button of root.querySelectorAll('.focus-toggle')) {
  const on = document.body.classList.contains('interview-focus');
  button.setAttribute('aria-checked', String(on));
  button.setAttribute('aria-label', on ? 'Focus mode on' : 'Focus mode off');
}
const csrf = document.querySelector('meta[name="yaw-csrf"]').content;
let catalog, state = { mode: 'quick', answers: {}, modules: null };
let stackValid = true, compact = localStorage.getItem('yaw.setup.compact') === '1';
let revision = 0, timer, busy = false, lastPreview;
const controls = new Map(), sections = new Map();
const actionIds = ['draft', 'preset', 'diff', 'apply'];
const steps = [
  { title: 'Starting point', hint: 'Choose your starting depth', ids: ['setup-depth', 'start'], groups: [] },
  { title: 'About you', hint: 'Agents, preferences & guidance', ids: [], groups: ['user'] },
  { title: 'Your project', hint: 'The idea and who it’s for', ids: [], groups: ['idea'] },
  { title: 'Stack & standards', hint: 'How the project is built', ids: ['stack'], groups: ['arch', 'quality'] },
  { title: 'Your workflow', hint: 'Modules, tasks & collaboration', ids: ['module-section'], groups: null },
  { title: 'Review & apply', hint: 'Inspect what will be written', ids: ['confirm'], groups: [] },
  { title: 'Finished', hint: 'What happened and what to do next', ids: ['finished'], groups: [] },
];
const LAST = steps.length - 1, REVIEW = LAST - 1, WORKFLOW = steps.findIndex((s) => s.groups === null), STACK = steps.findIndex((s) => s.ids.includes('stack'));
let stepIndex = 0;
// The answer of the planning chat (step 3): sent with Apply only, never with previews or drafts.
let plan = null, planInfo = null, planCard;
// edit: answering; applying: the log streams; done: the server has stopped.
let phase = 'edit', reviewReturn = false;
const visitedSteps = new Set();
const belongs = (step, group) => step.groups === null ? !['user', 'idea', 'arch', 'quality'].includes(group) : step.groups.includes(group);
const skipped = (index) => depthOf(state.mode) === 'quick' && (steps[index].groups?.includes('user') || index === WORKFLOW);
function renderWizard(focus = false) {
  const formView = presentation === 'settings' && phase === 'edit';
  root.classList?.toggle('settings-form', formView);
  if (formView && !settingsPreview) {
    settingsPreview = element('details', undefined, { class: 'settings-preview' });
    settingsPreview.append(element('summary', 'Preview changes'));
    $('summary').before(settingsPreview); settingsPreview.append($('summary'));
  } else if (!formView && settingsPreview) {
    settingsPreview.replaceWith($('summary')); settingsPreview = null;
  }
  if (planCard) planCard.node.hidden = formView;
  if (formView) {
    $('setup').hidden = false; $('finished').hidden = true; $('start').hidden = true;
    for (const id of ['stack', 'module-section', 'confirm']) { $(id).hidden = false; $(id).classList.add('settings-group'); }
    for (const section of sections.values()) section.node.hidden = !section.applicable;
    $('back-to-review').hidden = true;
    return;
  }
  const step = steps[stepIndex];
  const finished = step.ids.includes('finished');
  $('setup').hidden = finished; $('finished').hidden = !finished;
  if (stepIndex === REVIEW) reviewReturn = false;
  $('back-to-review').hidden = !reviewReturn || stepIndex >= REVIEW;
  for (const id of ['start', 'stack', 'module-section', 'confirm']) $(id).hidden = !step.ids.includes(id) || (id === 'start' && !hasPresets());
  const visible = visibleQuestions(catalog.questions, state.answers, state.mode, selectedModules());
  const ids = new Set(visible.map((q) => q.id));
  const extra = visibleQuestions(catalog.questions, state.answers, 'pro', selectedModules()).filter((q) => !ids.has(q.id)).length;
  $('depth-coverage').textContent = `${DEPTHS.find((d) => d.value === depthOf(state.mode))?.description ?? ''} ${visible.length} questions at this depth${extra ? ` · ${extra} more in Pro` : ''}.`;
  for (const [group, section] of sections) section.node.hidden = !section.applicable || !belongs(step, group);
  $('sections').replaceChildren();
  let ordinal = 0;
  steps.forEach((s, i) => {
    if (skipped(i)) return;
    ordinal++;
    const li = element('li');
    const button = element('button', undefined, { type: 'button' });
    if (i === stepIndex) button.setAttribute('aria-current', 'step');
    const shown = [...controls.values()].filter((c) => !c.node.hidden && !isInline(c.q) && belongs(s, c.q.id.split('.')[0]));
    const reviewed = shown.filter((c) => Object.hasOwn(state.answers, c.q.id)).length;
    const complete = i === LAST ? phase === 'done' : visitedSteps.has(i) && (!shown.length || reviewed === shown.length);
    button.append(element('span', complete ? '✓' : String(ordinal).padStart(2, '0'), { class: 'step-number', 'aria-hidden': 'true' }));
    button.append(element('strong', s.title));
    button.disabled = phase === 'edit' ? i === LAST : i !== LAST;
    button.addEventListener('click', () => { stepIndex = i; renderWizard(true); }); li.append(button); $('sections').append(li);
  });
  $('previous-step').disabled = stepIndex === 0;
  $('next-step-button').hidden = stepIndex >= REVIEW;
  const blocked = step.ids.includes('stack') && !stackValid;
  $('next-step-button').disabled = blocked;
  $('next-step-button').title = blocked ? 'Pick a language and hosting target with a YAW profile' : '';
  if (focus) {
    const visibleSection = [...sections.values()].find((s) => !s.node.hidden)?.node;
    const heading = (step.ids[0] ? $(step.ids[0])?.querySelector('h2, legend') : null) ?? visibleSection?.querySelector('h2');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }
}
function advance() {
  if (stepIndex >= REVIEW) return;
  if (steps[stepIndex].ids.includes('stack') && !stackValid) return;
  if (steps[stepIndex].groups?.includes('idea') && !state.answers['idea.text']?.trim()) {
    error('Describe this project before continuing. Include its users and their main task.');
    controls.get('idea.text')?.inputs[0]?.focus();
    return;
  }
  const modules = selectedModules();
  const answers = effectiveAnswers(catalog.questions.filter((q) => modules.includes(q.owner) || isPreference(q) || ['pro', 'all'].includes(state.mode) && asksIn(q, state.mode)), state.answers, state.mode);
  for (const q of visibleQuestions(catalog.questions, state.answers, state.mode, modules)) {
    if (!isInline(q) && belongs(steps[stepIndex], q.id.split('.')[0])) state.answers[q.id] = answers[q.id];
  }
  state.proposed = (state.proposed ?? []).filter((id) => !belongs(steps[stepIndex], id.split('.')[0]));
  visitedSteps.add(stepIndex);
  do { stepIndex++; } while (stepIndex < REVIEW && skipped(stepIndex));
  update(); renderWizard(true);
}

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
function actions(enabled) {
  actionIds.forEach((id) => { $(id).disabled = !enabled || busy || (id !== 'draft' && Boolean(lastPreview?.unresolved?.length)); });
  root.querySelectorAll('input[name=mode]').forEach((input) => { input.disabled = busy || sectionEditing(); });
}
async function request(action, input = state) {
  if (options.request) return options.request(action, input);
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

function buildPlan() {
  planCard = createPlanCard({
    request,
    getAnswers: () => state.answers,
    onUse(reply, text) {
      plan = text; planInfo = reply;
      if (reply.idea) state.answers['idea.text'] = reply.idea;
      if (reply.language) state.answers['arch.language'] = reply.language;
      if (reply.runsOn) state.answers['arch.runs-on'] = reply.runsOn;
      state.proposed = ['idea.text', 'arch.language', 'arch.runs-on'].filter((id) => Object.hasOwn(state.answers, id));
      planInfo.basis = structuredClone(state.answers);
      planCard.setInfo(reply); update();
    },
    onRemove() { plan = null; planInfo = null; update(); },
  });
  sections.get('idea')?.node.append(planCard.node);
}
function buildQuestions() {
  const title = { user: 'About you', idea: 'The idea', arch: 'Architecture', quality: 'Quality', tasks: 'Tasks', team: 'Team' };
  for (const q of catalog.questions) {
    const sectionId = q.id.split('.')[0];
    if (!sections.has(sectionId)) {
      const section = element('section', undefined, { id: `section-${sectionId}`, 'aria-labelledby': `title-${sectionId}`, class: 'settings-group' });
      section.append(element('h2', title[sectionId] ?? sectionId, { id: `title-${sectionId}` }));
      $('questions').append(section);
      sections.set(sectionId, { node: section });
    }
    const id = `q-${q.id.replaceAll('.', '-')}`;
    const radios = (q.type === 'choice' && q.choices.length <= RADIO_MAX) || q.type === 'boolean';
    const grouped = q.type === 'multi' || radios;
    const node = element(grouped ? 'fieldset' : 'div', undefined, { class: 'question', id: `wrap-${id}` });
    const label = q.label.replace(' (comma-separated)', '');
    node.append(element(grouped ? 'legend' : 'label', label, grouped ? {} : { for: id }));
    let input;
    const inputs = [];
    if (q.type === 'multi') {
      for (const c of q.choices) {
        const value = choiceValue(c);
        input = element('input', undefined, { type: 'checkbox', value, name: q.id, id: `${id}-${value}` });
        input.disabled = !available(c); if (!available(c)) input.dataset.unavailable = '1';
        const l = element('label'); l.append(input, document.createTextNode(`${choiceLabel(c)}${available(c) ? '' : ' — phase 3, not available yet'}`));
        node.append(l); inputs.push(input);
      }
    } else if (q.type === 'choice' || q.type === 'boolean') {
      const choices = q.type === 'boolean' ? [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] : q.choices;
      const field = choiceField({ name: q.id, id, choices, value: String(q.default), label, onChange: () => {} });
      node.append(field.node); inputs.push(...field.inputs);
    } else {
      const shortText = ['arch.framework', 'arch.cost-limit'].includes(q.id);
      input = element(q.type === 'text' && !shortText ? 'textarea' : 'input', undefined, { id, name: q.id });
      if (q.type === 'text') {
        input.maxLength = 8192;
        if (shortText) { input.type = 'text'; input.className = 'short-answer'; }
        if (q.id === 'arch.cost-limit') input.placeholder = 'e.g. EUR 20 / month';
        if (q.id === 'arch.framework') input.placeholder = 'e.g. keep Django — or leave blank';
      }
      else { input.type = 'number'; input.step = 'any'; }
      node.append(input); inputs.push(input);
    }
    const hint = element('p', q.hint ?? '', { class: 'hint', id: `${id}-hint` });
    if (!q.hint) hint.hidden = true;
    node.append(hint);
    if (q.status) node.append(element('p', q.status, { class: 'hint status', id: `${id}-status` }));
    const describedBy = [q.hint ? `${id}-hint` : '', q.status ? `${id}-status` : ''].filter(Boolean).join(' ');
    if (describedBy) inputs.forEach((i) => i.setAttribute('aria-describedby', describedBy));
    const why = q.helpText ? element('details') : null;
    if (why) { why.append(element('summary', 'Why this matters'), element('div', q.helpText, { class: 'help' })); node.append(why); }
    let capability, gitHolder;
    if (q.id === 'user.agents') { capability = element('div'); node.append(capability); }
    // Creating the repository is asked right next to "Use GitHub for the repo?": same context.
    if (q.id === 'tasks.use-github') { gitHolder = element('div', undefined, { class: 'git-holder' }); node.append(gitHolder); }
    inputs.forEach((i) => i.addEventListener(q.type === 'text' || q.type === 'number' ? 'input' : 'change', () => {
      if (q.type === 'multi') state.answers[q.id] = inputs.filter((x) => x.checked && !x.disabled).map((x) => x.value);
      else if (q.type === 'boolean') state.answers[q.id] = i.value === 'true';
      else if (q.type === 'number') state.answers[q.id] = i.value === '' ? q.default : Number(i.value);
      else state.answers[q.id] = i.value;
      state.proposed = (state.proposed ?? []).filter((id) => id !== q.id);
      update();
    }));
    // Questions of module cards are asked inside the card, under the module switch.
    if (!isInline(q) && !GROUP_INTRO.has(q.id)) sections.get(sectionId).node.append(node);
    controls.set(q.id, { q, node, label: node.firstChild, plainLabel: label, inputs, hint, capability, gitHolder });
  }

  const personal = sections.get('user')?.node;
  // Choose the kit profile first; optional planning constraints follow it.
  sections.get('arch')?.node.before($('stack'));
  if (personal) {
    personal.append(element('p', catalog.personalWarning ?? 'Quick uses your saved personal settings, or the documented defaults. You can review them separately.', { class: 'hint' }));
    const global = element('button', 'Edit personal defaults for future projects', { type: 'button', class: 'link' });
    global.addEventListener('click', () => showView('global-settings')); personal.append(global);
  }

}

function renderQuestions() {
  const modules = selectedModules();
  const visible = new Set(visibleQuestions(catalog.questions, state.answers, questionMode(), modules).map((q) => q.id));
  const answers = effectiveAnswers(catalog.questions.filter((q) => modules.includes(q.owner) || isPreference(q) || ['pro', 'all'].includes(questionMode()) && asksIn(q, questionMode())), state.answers, state.mode);
  const expertise = answers['user.expertise'] ?? 'intermediate';
  for (const [id, c] of controls) {
    c.node.hidden = !visible.has(id) || CARD_QUESTIONS.has(id);
    if (c.gitHolder) {
      c.gitHolder.replaceChildren(gitInitControl({ gitRepo: catalog.gitRepo, gitInit: state.gitInit !== false, readOnly: sectionEditing(), onGitInit: setGitInit }));
    }
    c.label.textContent = expertise === 'expert' ? `${c.q.id} — ${c.plainLabel}` : c.plainLabel;
    const value = answers[id] ?? c.q.default;
    for (const input of c.inputs) {
      if (c.q.type === 'multi') input.checked = value.includes(input.value);
      else if (input.type === 'radio') input.checked = input.value === String(value);
      else if (document.activeElement !== input) input.value = String(value);
    }
    c.hint.hidden = !c.q.hint || expertise === 'expert' && id !== 'user.examples';
    if (c.capability) {
      c.capability.replaceChildren();
      for (const agent of value) {
        const detail = catalog.agents[agent];
        if (!detail) continue;
        const notes = [];
        if (detail.note) notes.push(detail.note);
        for (const [feature, support] of Object.entries(detail.capabilities ?? {})) {
          if (support.support !== 'native') notes.push(`${feature}: ${support.support}. ${support.note ?? support.via ?? ''}`);
        }
        if (notes.length) {
          const note = element('details'); note.append(element('summary', `${detail.name} support`));
          for (const text of notes) note.append(element('p', text));
          c.capability.append(note);
        }
      }
    }
  }
  for (const [id, s] of sections) {
    const qs = [...controls.values()].filter((c) => c.q.id.split('.')[0] === id && visible.has(c.q.id) && !CARD_QUESTIONS.has(c.q.id) && !isInline(c.q) && !GROUP_INTRO.has(c.q.id));
    s.applicable = qs.length > 0;
    s.node.hidden = !s.applicable;
  }
}
const sectionEditing = () => Boolean(catalog.editing && catalog.sections.length);
function renderStackStep() {
  const answers = effectiveAnswers(catalog.questions, state.answers, state.mode);
  const result = renderStack($('stack-cards'), {
    profiles: catalog.profiles, questions: catalog.questions, answers,
    disabled: sectionEditing() && !catalog.sections.some((s) => s === 'arch' || s.startsWith('arch.')),
    onChange: (id, value) => { state.answers[id] = value; state.proposed = (state.proposed ?? []).filter((key) => key !== id); update(); $('stack-cards').querySelector(`[aria-pressed="true"]${id === 'arch.language' ? '.chip' : '.host'}`)?.focus({ preventScroll: true }); },
  });
  stackValid = result.valid;
}
function setGitInit(on) {
  state.gitInit = on;
  if (!on && selectedModules().includes('git-hooks')) state.modules = toggleModules(catalog.modules, selectedModules(), 'git-hooks', false);
  update();
}
function renderModules() {
  const answers = effectiveAnswers(catalog.questions, state.answers, state.mode);
  renderModuleGroups($('modules'), {
    modules: catalog.modules.filter((m) => presentation === 'settings' || depthOf(state.mode) === 'pro' || selectedModules().includes(m.name) || depthOf(state.mode) === 'basic' && ['review', 'github', 'tasks'].includes(m.name)), selected: selectedModules(), answers, questions: catalog.questions, compact,
    gitRepo: catalog.gitRepo, gitInit: state.gitInit !== false && !catalog.gitRepo, usesGitHub: answers['tasks.use-github'] !== false,
    readOnly: sectionEditing(),
    groupNodes: (group) => [...controls.values()].filter((c) => GROUP_INTRO.get(c.q.id) === group && !c.node.hidden).map((c) => c.node),
    // Options are always there so a card keeps its size; they are greyed out while the module is off.
    questionNodes: (name, on) => {
      const everything = effectiveAnswers(catalog.questions, state.answers, state.mode);
      return [...controls.values()].filter((c) => c.q.owner === name && isInline(c.q) && (on ? !c.node.hidden : asksIn(c.q, questionMode()) && questionApplies(c.q, everything)))
        .map((c) => { c.node.hidden = false; c.inputs.forEach((i) => { i.disabled = !on || sectionEditing() || i.dataset.unavailable === '1'; }); return c.node; });
    },
    onToggle: (name, on) => { state.modules = toggleModules(catalog.modules, selectedModules(), name, on); update(); $(`module-${name}`)?.focus(); },
    onAnswer: (id, value) => { state.answers[id] = value; update(); },
    onCompact: (on) => { compact = on; localStorage.setItem('yaw.setup.compact', on ? '1' : '0'); renderModules(); },
    onPreset: (kind) => {
      let next = defaultModules(catalog.modules, catalog.questions, state.answers, kind);
      if (!catalog.gitRepo && state.gitInit === false) next = toggleModules(catalog.modules, next, 'git-hooks', false);
      state.modules = next; update();
    },
  });
}
// Where a review item is configured: the step and the control to focus.
const stepFor = (q) => q.id.startsWith('arch.') ? STACK : isInline(q) || CARD_QUESTIONS.has(q.id) ? WORKFLOW : steps.findIndex((st) => belongs(st, q.id.split('.')[0]));
function setDepth(mode) {
  state.mode = mode;
  root.querySelectorAll('input[name=mode]').forEach((input) => { input.checked = input.value === depthOf(mode); });
  const wasSkipped = skipped(stepIndex);
  while (skipped(stepIndex) && stepIndex < REVIEW) stepIndex++;
  update();
  if (wasSkipped) renderWizard(true);
}
function jump(target) {
  if (presentation === 'settings') {
    const id = target.question ? controls.get(target.question)?.inputs[0]?.id : target.stack ? 'stack-title' : target.plan ? 'plan-card' : `module-${target.module}`;
    const node = id && $(id); node?.scrollIntoView({ block: 'center' }); node?.focus({ preventScroll: true }); return;
  }
  let step, focusId;
  if (target.stack) { step = STACK; focusId = 'stack-title'; }
  else if (target.plan) { step = steps.findIndex((st) => st.groups?.includes('idea')); focusId = 'plan-card'; }
  else if (target.module) { step = WORKFLOW; focusId = `module-${target.module}`; }
  else {
    const c = controls.get(target.question);
    if (!asksIn(c.q, state.mode) || skipped(stepFor(c.q))) setDepth(asksIn(c.q, 'basic') ? 'basic' : 'pro');
    step = stepFor(c.q); focusId = c.inputs[0]?.id;
  }
  stepIndex = step; reviewReturn = true; renderWizard();
  const node = $(focusId);
  if (node) { if (node.tabIndex < 0) node.tabIndex = -1; node.focus(); node.scrollIntoView({ block: 'center', behavior: 'instant' }); }
}
function summary(preview) {
  renderReview($('summary'), { preview, modules: catalog.modules, questions: catalog.questions, jump, plan: planInfo,
    confirmProposal: () => { state.proposed = []; update(); } });
}
function applySecretFields() {
  const container = $('secret-fields'); container.replaceChildren();
  const { names, existingFile } = lastPreview.secrets;
  if (!names.length) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  container.append(element('h3', 'Optional secrets'));
  container.append(element('p', existingFile
    ? 'The existing .env stays as it is; nothing is saved.'
    : 'Saved only to .env (private permissions). Blank = skip. A saved secret skips the automatic check.'));
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
  const activeId = document.activeElement?.id;
  revision++;
  lastPreview = null;
  error(''); actions(false);
  // Do not leave a stale preview or diff (possibly including an earlier value) on screen.
  $('summary').textContent = 'Updating preview…';
  $('diff-panel').hidden = true; $('diff-output').textContent = '';
  renderQuestions(); renderStackStep(); renderModules(); renderWizard(); scopeIds();
  // Cards are rebuilt on every change; keep the keyboard where it was.
  if (activeId && document.activeElement?.id !== activeId) $(activeId)?.focus({ preventScroll: true });
  clearTimeout(timer);
  const current = revision;
  timer = setTimeout(async () => {
    try {
      const body = await (await request('preview')).json();
      if (current !== revision) return;
      lastPreview = body; summary(body); actions(true);
      status(body.unresolved?.length ? `Still needed: ${body.unresolved.join(', ')}. You can save a draft.` : 'Preview updated.');
    } catch (e) {
      if (current !== revision) return;
      if (e.message.startsWith('Choose another stack')) {
        $('summary').replaceChildren(element('p', 'Your file plan appears once language and place fit together (step 4).'), element('p', `Suggested modules: ${selectedModules().join(', ')}`));
        status('YAW has no profile for this combination; review your stack choices.');
      } else {
        $('summary').textContent = 'Preview unavailable. Fix the error before saving or applying.';
        error(e.message); status('Nothing was saved or applied.');
      }
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
const code = (text) => element('code', text);
const bullet = (...parts) => { const li = element('li'); li.append(...parts.map((p) => typeof p === 'string' ? document.createTextNode(p) : p)); return li; };
// The last step: outcome, then what the user can do now. The server has stopped by then.
function finish({ ok, message }, kickoff) {
  phase = 'done';
  setInterviewDone(true);
  $('finished-status').textContent = message;
  $('finished-status').className = `interview-finished-status ${ok ? 'ok-text' : 'warn'}`;
  $('log-details').open = !ok;
  const names = (state.answers['user.agents'] ?? []).map((a) => catalog.agents[a]?.name).filter(Boolean).join(' or ') || 'your coding agent';
  const list = $('next-list'); list.replaceChildren();
  if (!ok) list.append(bullet('Fix the problem in the log, then run ', code('just setup && just check'), '.'));
  list.append(
    bullet(`Start ${names} in this folder; it reads AGENTS.md.`),
    bullet(code('yaw web'), ': start the workspace again.'),
    bullet(code('yaw doctor'), ' checks the setup; ', code('just --list'), ' shows all recipes.'),
    bullet(options.persistent ? 'The workspace remains open.' : 'This page is disconnected: the local server stopped after applying.'));
  $('next-steps').hidden = false;
  $('kickoff-box').replaceChildren(...(kickoff ? [kickoffCard(kickoff, { request: options.persistent ? request : undefined })] : []));
  status(message);
  renderWizard(true);
}
async function apply() {
  busy = true; actions(false); error('');
  phase = 'applying'; stepIndex = LAST;
  $('log').textContent = ''; $('log-details').open = true; $('next-steps').hidden = true; $('kickoff-box').replaceChildren();
  $('finished-status').className = ''; $('finished-status').textContent = 'Applying… keep this page open.';
  renderWizard(true);
  status('Applying… keep this page open for the log.');
  let secretValues = Object.fromEntries([...$('secret-fields').querySelectorAll('input[type=password]')]
    .map((input) => [input.name, input.value]).filter(([, value]) => value !== ''));
  for (const input of $('secret-fields').querySelectorAll('input[type=password]')) input.value = '';
  let outcome = null, started = false, failure = '', kickoff = null;
  try {
    const response = await request('apply', { ...state, ...(plan ? { plan, planBasis: planInfo?.basis, foundationsReviewed: planInfo?.foundationsReviewed === true, foundationReview: planInfo?.foundationReview } : {}), secrets: secretValues });
    started = true;
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = '';
    const receive = (line) => {
      if (!line) return;
      const event = JSON.parse(line);
      if (event.type === 'log') $('log').textContent += event.text;
      if (event.type === 'error') failure = event.message;
      if (event.type === 'kickoff') kickoff = event;
      if (event.type === 'done') outcome = event;
    };
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split('\n'); buffer = lines.pop();
      lines.forEach(receive);
      if (done) { receive(buffer); break; }
    }
    if (!outcome) throw new Error('Apply did not report completion. Inspect the project and terminal; do not assume it succeeded.');
  } catch (e) { failure = failure || e.message; }
  finally {
    secretValues = null;
    if (started) finish(outcome ?? { ok: false, message: failure || 'Apply did not complete successfully. Inspect the project before retrying.' }, kickoff);
    else {
      busy = false; phase = 'edit'; stepIndex = REVIEW; renderWizard(true);
      error(failure); status('Apply was rejected before it started. Fix the error and review again.');
      actions(Boolean(lastPreview));
    }
  }
}
// "What the dialog does", as short facts.
function applyFacts() {
  const written = lastPreview.files.filter((f) => ['create', 'update', 'write', 'missing', 'delete'].includes(f.action)).length;
  const kept = lastPreview.files.filter((f) => f.action === 'kept').length;
  const facts = [`Writes ${written} file${written === 1 ? '' : 's'} in this folder${kept ? `; ${kept} kept as they are` : ''}`];
  if (catalog.personalDefaultsNotice && depthOf(state.mode) !== 'quick') facts.push('Confirmed personal answers will establish your defaults for future projects');
  if (catalog.skipVerify) facts.push('Skips the check (--skip-verify)');
  else if (!catalog.editing) facts.push('Then runs just setup and just check');
  if (!options.persistent) facts.push('The local server stops afterwards; yaw web starts it again');
  $('apply-facts').replaceChildren(...facts.map((f) => element('li', f)));
}
function loadState(next) {
  const { profile: _ignored, ...rest } = next;
  state = { ...rest, ...(catalog.editing ? { modules: rest.modules ?? catalog.initial.modules } : {}), gitInit: !catalog.gitRepo };
  visitedSteps.clear();
  plan = null; planInfo = null; planCard?.setInfo(null);
  root.querySelectorAll('input[name=mode]').forEach((i) => { i.checked = i.value === depthOf(state.mode); });
  update();
}
// Where the answers start from: a dropdown of the presets that exist; nothing is shown when there are none.
const prefillOptions = [{ value: 'new', label: 'New setup' }];
let prefillValue = 'new', prefillLocked = false;
const hasPresets = () => prefillOptions.length > 1;
function renderPrefill() {
  const select = element('select', undefined, { id: 'prefill-choice', 'aria-labelledby': 'start-title' });
  for (const o of prefillOptions) select.append(element('option', o.label, { value: o.value }));
  select.value = prefillValue; select.disabled = prefillLocked;
  select.addEventListener('change', () => { prefillValue = select.value; });
  $('prefill').replaceChildren(select);
  $('start').hidden = !hasPresets() || !steps[stepIndex].ids.includes('start');
}
async function start() {
  const body = options.bootstrap ?? await (await fetch('/api/bootstrap')).json();
  catalog = body;
  state.gitInit = !catalog.gitRepo;
  if (catalog.personalDefaultsNotice) {
    const notice = element('p', catalog.personalDefaultsNotice, { class: 'personal-defaults-notice', role: 'status' });
    $('setup').before(notice);
  }
  const depthCards = $('setup-depth').querySelector('.depth-options');
  depthCards.replaceChildren(...DEPTHS.map((depth) => {
    const label = element('label', undefined, { class: 'depth-card', title: depth.description });
    const input = element('input', undefined, { type: 'radio', name: 'mode', value: depth.value });
    input.checked = depth.value === depthOf(state.mode);
    label.append(input, decisionIcon(({ quick: 'bolt', basic: 'shield', pro: 'box' })[depth.value]), element('strong', depth.label)); return label;
  }));
  if (catalog.editing) {
    if (!options.persistent) document.title = 'YAW edit setup';
    prefillOptions.push({ value: 'current', label: 'Current project setup' });
    prefillValue = 'current';
    if (catalog.sections.length) {
      const selected = (q) => catalog.sections.some((s) => q.id === s || q.id.startsWith(`${s}.`));
      catalog.questions = catalog.questions.map((q) => selected(q) ? q : { ...q, editHidden: true });
      prefillLocked = true; $('load').disabled = true;
      root.querySelectorAll('input[name=mode]').forEach((input) => { input.disabled = true; });
    }
    catalog.questions = catalog.questions.map((q) => Object.hasOwn(catalog.initial.answers, q.id) ? { ...q, default: catalog.initial.answers[q.id] } : q);
  }
  for (const id of ['save-dialog', 'apply-dialog']) installDialogCancellation($(id));
  if (catalog.hasUserProfile) prefillOptions.push({ value: 'profile', label: 'Saved user preferences' });
  if (catalog.hasDraft) prefillOptions.push({ value: 'draft', label: 'Resume project draft' });
  for (const p of catalog.presets) prefillOptions.push({ value: `preset:${p.name}`, label: `Preset / previous project: ${p.name}` });
  renderPrefill();
  $('verify-note').textContent = catalog.editing ? '' : catalog.skipVerify ? 'Verification disabled with --skip-verify.' : 'Apply runs just setup and just check.';
  $('diff').hidden = !catalog.editing;
  buildQuestions();
  buildPlan();
  $('previous-step').addEventListener('click', () => { if (stepIndex > 0) { do { stepIndex--; } while (stepIndex > 0 && skipped(stepIndex)); renderWizard(true); } });
  $('back-to-review').addEventListener('click', () => { stepIndex = REVIEW; renderWizard(true); });
  $('next-step-button').addEventListener('click', advance);
  $('setup').addEventListener('submit', (e) => e.preventDefault());
  root.querySelectorAll('input[name=mode]').forEach((input) => input.addEventListener('change', () => {
    setDepth(input.value);
  }));
  $('load').addEventListener('click', async () => {
    try {
      if (prefillValue === 'current') loadState(catalog.initial);
      else if (prefillValue === 'new') loadState({ mode: 'quick', answers: {}, modules: null });
      else {
        const [kind, name] = prefillValue.split(':');
        loadState(await (await request('prefill', { kind, ...(name ? { name } : {}) })).json());
      }
    } catch (e) { error(e.message); }
  });
  $('draft').addEventListener('click', () => perform('draft'));
  $('diff').addEventListener('click', () => perform('diff'));
  $('preset').addEventListener('click', () => {
    $('save-profile').checked = false;
    $('save-dialog').returnValue = '';
    $('save-dialog').showModal();
  });
  // Pressing "Save" in this dialog is the consent for this one save.
  $('save-dialog').addEventListener('close', () => {
    if ($('save-dialog').returnValue === 'save') perform('preset', { ...state, consent: true, saveProfile: $('save-profile').checked });
    $('save-profile').checked = false;
  });
  $('apply').addEventListener('click', () => {
    applyFacts();
    applySecretFields();
    $('apply-dialog').returnValue = '';
    $('apply-dialog').showModal();
  });
  $('apply-dialog').addEventListener('close', () => {
    if ($('apply-dialog').returnValue === 'apply') apply();
    else $('secret-fields').replaceChildren();
  });
  if (catalog.editing) {
    loadState(catalog.handoff ?? catalog.initial);
    status('Editing the current project. Saved answers are prefilled; user-edited files will be kept.');
    showView('setup', false);
  } else if (catalog.handoff) {
    loadState({ modules: null, ...catalog.handoff });
    status('Continued from the terminal: your answers so far are filled in. Nothing is written until Apply.');
  } else update();
}
await start();
return {
  destroy() { clearTimeout(timer); revision++; root.replaceChildren(); }, state: () => state,
  setPresentation(mode) {
    if (!['settings', 'interview'].includes(mode) || presentation === mode) return;
    presentation = mode; update();
  },
  showSection(section) {
    const index = ({ start: 0, user: 1, idea: 2, stack: STACK, workflow: WORKFLOW })[section];
    if (index === undefined || phase !== 'edit') return;
    if (presentation === 'settings') {
      const node = section === 'stack' ? $('stack') : section === 'workflow' ? $('module-section') : sections.get(section === 'user' ? 'user' : 'idea')?.node;
      node?.scrollIntoView({ block: 'start' }); return;
    }
    if (skipped(index)) setDepth(section === 'user' ? 'basic' : 'pro');
    stepIndex = index; renderWizard(true);
  },
};
}
