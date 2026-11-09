import { asksIn, effectiveAnswers, visibleQuestions, defaultModules, toggleModules, installDialogCancellation, focusStepStart, interviewDetailText } from './ui-state.js';
import { isPreference, questionApplies, switchable } from '../../interview/policy.js';

import { CARD_QUESTIONS, GROUP_INTRO, choiceField, decisionIcon, gitInitControl, isInline, renderModuleGroups, renderCommunicationCard, renderStack } from './setup-cards.js';
import { createPlanCard } from './plan-card.js';
import { renderReview } from './review-step.js';
import { createProjectTree } from './project-tree.js';
import { DEPTHS, depthOf } from '../../interview/depth.js';

export async function mountInterview(root, options = {}) {
let presentation = options.presentation ?? 'interview', settingsPreview = null;
const questionMode = () => presentation === 'settings' ? 'pro' : state.mode;
const prefix = options.prefix ?? '';
const localId = (id) => prefix && !id.startsWith(prefix) ? prefix + id : id;
const $ = (id) => root.querySelector('#' + CSS.escape(localId(id)));
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
let stackValid = true, activeProfile = null, compact = localStorage.getItem('yaw.setup.compact') !== '0';
let revision = 0, timer, busy = false, lastPreview, planReady = false;
const projectTree = createProjectTree($('project-structure'), { readFile: async (path) => (await request('file-preview', { setup: state, path })).json() });
const dock = $('interview-dock');
function syncDockHeight() {
  const height = Math.max(0, ...[...document.querySelectorAll('.interview-dock')].map((node) => node.getClientRects().length ? node.getBoundingClientRect().height : 0));
  document.documentElement.style.setProperty('--interview-dock-height', `${height}px`);
}
const dockObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(syncDockHeight);
dockObserver?.observe(dock);
let helpTarget = {};
const sectionTarget = () => [{ setup: true }, { question: 'user.agents' }, { question: 'idea.text' }, { question: 'arch.language' }, { workflow: true }, {}][stepIndex] ?? {};
function highlightTree() { projectTree.highlight(helpTarget, sectionTarget()); }
const controls = new Map(), sections = new Map();
const actionIds = ['draft', 'preset', 'diff', 'apply'];
const steps = [
  { title: 'Starting point', hint: 'Choose your starting depth', ids: ['setup-depth', 'start'], groups: [] },
  { title: 'About you', hint: 'Agents, preferences & guidance', ids: [], groups: ['user', 'communication'] },
  { title: 'Your project', hint: 'The idea and who it’s for', ids: [], groups: ['idea'] },
  { title: 'Architecture', hint: 'Language, runtime and constraints', ids: ['stack'], groups: ['arch'] },
  { title: 'Your workflow', hint: 'Modules, tasks & collaboration', ids: ['module-section'], groups: null },
  { title: 'Review & apply', hint: 'Inspect what will be written', ids: ['confirm'], groups: [] },
  { title: 'Finished', hint: 'What happened and what to do next', ids: ['finished'], groups: [] },
];
const LAST = steps.length - 1, REVIEW = LAST - 1, WORKFLOW = steps.findIndex((s) => s.groups === null), STACK = steps.findIndex((s) => s.ids.includes('stack'));
let stepIndex = 0, helpStep = null;
// The setup interview prompt follows the current validated setup; the two kickoff prompts appear once applied.
let planCard, conceptCard, finalCard;
let promptRevision = 0;
// edit: answering; applying: the log streams; done: the server has stopped.
let phase = 'edit', reviewReturn = false;
const visitedSteps = new Set();
const sectionOf = (question) => {
  const id = typeof question === 'string' ? question : question.id;
  if (id.startsWith('user.') && id !== 'user.agents') return 'communication';
  return id.split('.')[0];
};
const belongs = (step, group) => step.groups === null ? !['user', 'communication', 'idea', 'arch'].includes(group) : step.groups.includes(group);
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
  dock.hidden = formView || phase !== 'edit' || stepIndex === REVIEW;
  $('project-structure').hidden = formView || phase !== 'edit' || stepIndex === REVIEW;
  syncDockHeight();
  highlightTree();
  if (planCard) planCard.node.hidden = formView;
  if (finalCard) finalCard.node.hidden = formView;
  if (!formView && helpStep !== stepIndex) { helpStep = stepIndex; explain(stepIndex === 0 ? 'Interview depth' : steps[stepIndex].title, stepHelp()); }
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
  for (const id of ['start', 'stack', 'module-section', 'confirm']) $(id).hidden = !step.ids.includes(id);
  $('depth-coverage').textContent = 'Can always be changed';
  for (const [group, section] of sections) section.node.hidden = !section.applicable || !belongs(step, group);
  $('sections').replaceChildren();
  let ordinal = 0;
  steps.forEach((s, i) => {
    ordinal++;
    const li = element('li');
    const button = element('button', undefined, { type: 'button' });
    if (i === stepIndex) button.setAttribute('aria-current', 'step');
    const shown = [...controls.values()].filter((c) => !c.node.hidden && !isInline(c.q) && belongs(s, sectionOf(c.q)));
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
    const heading = (step.ids[0] ? $(step.ids[0])?.querySelector('h2:not(.sr-only), legend') : null) ?? visibleSection?.querySelector('h2');
    focusStepStart(finished ? $('finished') : $('setup'), heading);
  }
}
function advance() {
  if (stepIndex >= REVIEW) return;
  if (steps[stepIndex].ids.includes('stack') && !stackValid) return;
  if (steps[stepIndex].groups?.includes('idea') && controls.get('idea.text')?.inputs[0]?.validity.valid === false) { controls.get('idea.text').inputs[0].reportValidity(); return; }
  if (steps[stepIndex].groups?.includes('idea') && !state.answers['idea.text']?.trim()) {
    error('Describe this project before continuing. Include its users and their main task.');
    controls.get('idea.text')?.inputs[0]?.focus();
    return;
  }
  const modules = selectedModules();
  const answers = effectiveAnswers(catalog.questions.filter((q) => modules.includes(q.owner) || isPreference(q) || ['pro', 'all'].includes(state.mode) && asksIn(q, state.mode)), state.answers, state.mode);
  for (const q of visibleQuestions(catalog.questions, state.answers, state.mode, modules)) {
    if (!isInline(q) && !(q.id === 'arch.hosting-control' && controls.get(q.id)?.node.hidden) && belongs(steps[stepIndex], sectionOf(q))) state.answers[q.id] = answers[q.id];
  }
  state.proposed = (state.proposed ?? []).filter((id) => !belongs(steps[stepIndex], sectionOf(id)));
  visitedSteps.add(stepIndex);
  stepIndex++;
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
  root.querySelectorAll('button[name=mode]').forEach((input) => { input.disabled = busy || sectionEditing(); });
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

// Backticks are rendered as code without parsing user text as HTML.
function helpText(text) {
  const node = element('p');
  text.split(/(`[^`]+`)/g).forEach((part) => node.append(part.startsWith('`') ? element('code', part.slice(1, -1)) : document.createTextNode(part)));
  return node;
}
const aboutHelp = () => [helpText('Creates one `AGENTS.md` as the global entry point for all agents, referring to individual agent files within the project.')];
function stepHelp() {
  if (stepIndex === 0) return [element('p', 'Can always be changed')];
  if (stepIndex === 1) return aboutHelp();
  if (stepIndex === 2) return [helpText('Describe what your app does, its target users and its constraints.'), helpText('Will be stored as a global entry in `AGENTS.md`.')];
  if (stepIndex === STACK) {
    const tools = element('ul'); for (const tool of activeProfile?.requires ?? []) { const item = element('li'); item.append(element('code', tool)); tools.append(item); }
    return [...(activeProfile ? [element('p', 'Environment tools')] : []), tools, helpText('Agent instructions: `AGENTS.md` and `docs/engineering.md`.')];
  }
  if (stepIndex === REVIEW) return [helpText('Save draft: Continue later.'), helpText('Save preset: Save for future use.')];
  return [];
}
function explain(title, content, target = {}) {
  $('setting-help-title').replaceChildren(decisionIcon('book'), element('span', title));
  $('setting-help-content').replaceChildren(...content);
  helpTarget = target;
  highlightTree();
}
function questionHelp(q) {
  const details = interviewDetailText(q.id);
  if (details) return details.map(helpText);
  if (q.id.startsWith('user.')) return aboutHelp();
  if (q.id === 'idea.text') return [helpText('Describe what your app does, its target users and its constraints.'), helpText('Will be stored as a global entry in `AGENTS.md`.')];
  if (q.id === 'arch.wrapper') return [helpText('Tells the agent to add a wrapper script for common commands like installing, running and checking the project.'), helpText('Shell: `sh project.sh setup`. Just: `just setup`. Make: `make setup`. Off: no additional wrapper. YAW’s checks use `just check`.')];
  if (q.id === 'arch.docker') return [helpText('Tells the agent to set up Docker support.')];
  return [helpText(q.hint || q.label)];
}
function provisionalFiles() {
  const answers = effectiveAnswers(catalog.questions, state.answers, state.mode);
  const selected = selectedModules();
  const agents = answers['user.agents'] ?? ['claude'];
  const files = [{ path: '.yaw/answers.yaml', module: 'core' }, { path: '.yaw/manifest.json', module: 'core' }];
  for (const module of catalog.modules.filter((item) => selected.includes(item.name))) {
    for (const path of module.plannedFiles ?? []) {
      if (path === 'project.sh' && answers['arch.wrapper'] !== 'shell' || path === 'Makefile' && answers['arch.wrapper'] !== 'make') continue;
      if ((path.startsWith('.claude/') || path === 'CLAUDE.md') && !agents.includes('claude')) continue;
      if ((path.startsWith('.codex/')) && !agents.includes('codex')) continue;
      if ((path.startsWith('.github/agents/')) && !agents.includes('copilot')) continue;
      if (path === 'GEMINI.md' && !agents.includes('gemini')) continue;
      if (!files.some((file) => file.path === path)) files.push({ path, module: module.name });
    }
  }
  return files;
}
function buildPlan() {
  planCard = createPlanCard({ title: 'LLM Support', label: 'Setup interview prompt', chat: true, collapsed: true,
    instruction: 'Use any LLM to support you with project decisions.' });
  conceptCard = createPlanCard({ id: 'concept-prompt', title: 'I already have a concept', label: 'Concept prompt', chat: true, collapsed: true,
    instruction: 'Copy this into the chat that holds your concept. Paste its answer into your coding agent; the agent writes the documents.' });
  finalCard = createPlanCard({ id: 'final-prompt', title: 'Let my coding agent write them', collapsed: true,
    instruction: 'Copy this into your local coding agent. It writes the missing documents directly in the project; nothing to paste back.' });
  sections.get('idea')?.node.append(planCard.node);
}
async function refreshPrompts() {
  const current = ++promptRevision;
  planCard?.setPrompt('', 'Updating prompt…');
  try {
    const result = await (await request('setup-prompts', state)).json();
    if (current !== promptRevision) return;
    planCard?.setPrompt(result.interview);
  } catch (e) {
    if (current !== promptRevision) return;
    planCard?.setPrompt('', e.message);
  }
}
function buildQuestions() {
  const title = { user: 'About you', communication: 'Communication style', idea: 'Purpose/Idea', arch: 'Architecture', quality: 'Quality', tasks: 'Tasks', team: 'Team' };
  for (const q of catalog.questions) {
    const sectionId = sectionOf(q);
    if (!sections.has(sectionId)) {
      const section = element('section', undefined, { id: `section-${sectionId}`, 'aria-labelledby': `title-${sectionId}`, class: 'settings-group', 'data-section': sectionId });
      const heading = element('h2', undefined, { id: `title-${sectionId}`, class: 'module-group-title' });
      heading.append(decisionIcon('file'), element('span', title[sectionId] ?? sectionId));
      section.append(heading);
      $('questions').append(section);
      sections.set(sectionId, { node: section });
    }
    const id = `q-${q.id.replaceAll('.', '-')}`;
    const radios = q.type === 'choice' || q.type === 'boolean';
    const grouped = q.type === 'multi' || radios;
    const node = element(grouped ? 'fieldset' : 'div', undefined, { class: 'question', id: `wrap-${id}` });
    const label = q.label.replace(' (comma-separated)', '');
    node.append(element(grouped ? 'legend' : 'label', label, grouped ? {} : { for: id }));
    let input;
    const inputs = [];
    if (['arch.docker', 'quality.unit-tests'].includes(q.id)) {
      input = element('input', undefined, { id, name: q.id, type: 'checkbox', role: 'switch', class: 'module-switch', 'aria-label': label });
      node.append(input); inputs.push(input);
    } else if (q.type === 'multi' || q.type === 'choice' || q.type === 'boolean') {
      const choices = q.type === 'boolean' ? [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] : q.choices;
      const field = choiceField({ name: q.id, id, choices, value: q.default, label, multi: q.type === 'multi', onChange: () => {} });
      node.append(field.node); inputs.push(...field.inputs);
    } else {
      const shortText = ['user.language', 'arch.framework', 'arch.cost-limit'].includes(q.id);
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
    if (q.id === 'idea.text') node.insertBefore(hint, inputs[0]); else node.append(hint);
    let wordCount;
    if (q.maxWords) { wordCount = element('p', `0 / ${q.maxWords} words`, { class: 'hint purpose-count', 'aria-live': 'polite' }); node.append(wordCount); }
    if (q.status) node.append(element('p', q.status, { class: 'hint status', id: `${id}-status` }));
    const describedBy = [q.hint ? `${id}-hint` : '', q.status ? `${id}-status` : ''].filter(Boolean).join(' ');
    if (describedBy) inputs.forEach((i) => i.setAttribute('aria-describedby', describedBy));
    if (switchable(q)) node.append(scopeSwitch(q, id, label));
    const showHelp = () => explain(label, questionHelp(q), { question: q.id });
    node.addEventListener('focusin', showHelp); node.addEventListener('mouseenter', showHelp);
    let capability, gitHolder;
    if (q.id === 'user.agents') { capability = element('div'); node.append(capability); }
    // Creating the repository is asked right next to "Use GitHub for the repo?": same context.
    if (q.id === 'tasks.use-github') { gitHolder = element('div', undefined, { class: 'git-holder' }); node.append(gitHolder); }
    inputs.forEach((i) => i.addEventListener(q.type === 'text' || q.type === 'number' ? 'input' : i.type === 'checkbox' ? 'change' : 'click', () => {
      if (q.type === 'multi') state.answers[q.id] = inputs.filter((x) => x.getAttribute('aria-pressed') === 'true' && !x.disabled).map((x) => x.value);
      else if (q.type === 'boolean') state.answers[q.id] = i.type === 'checkbox' ? i.checked : i.value === 'true';
      else if (q.type === 'number') state.answers[q.id] = i.value === '' ? q.default : Number(i.value);
      else state.answers[q.id] = i.value;
      state.proposed = (state.proposed ?? []).filter((id) => id !== q.id);
      update();
    }));
    // Questions of module cards are asked inside the card, under the module switch.
    if (!isInline(q) && !GROUP_INTRO.has(q.id)) sections.get(sectionId).node.append(node);
    controls.set(q.id, { q, node, label: node.firstChild, plainLabel: label, inputs, hint, capability, gitHolder, wordCount });
  }

  const personal = sections.get('communication')?.node;
  if (personal) {
    const holder = element('div', undefined, { class: 'module-grid communication-card-holder' });
    personal.append(holder);
  }
  // Choose the kit profile first; optional planning constraints follow it.
  sections.get('arch')?.node.before($('stack'));
  const arch = sections.get('arch')?.node;
  if (arch) { const wrapper = controls.get('arch.wrapper')?.node; const docker = controls.get('arch.docker')?.node; if (docker) arch.append(docker); if (wrapper) arch.append(wrapper); }
  if (personal) {
    const personalExtras = element('div', undefined, { class: 'personal-default-controls' });
    personalExtras.append(element('p', catalog.personalWarning ?? 'Quick uses your saved personal settings, or the documented defaults. You can review them separately.', { class: 'hint' }));
    const global = element('a', undefined, { href: '#global-settings/interview', target: '_blank', rel: 'noopener noreferrer', class: 'button' });
    global.append(decisionIcon('users'), element('span', 'Add personal defaults for future projects')); personalExtras.append(global); personal.append(personalExtras);
  }

}

function renderQuestions() {
  root.querySelectorAll('.personal-default-controls').forEach((node) => { node.hidden = presentation !== 'settings' && depthOf(state.mode) === 'quick'; });
  const modules = selectedModules();
  const visible = new Set(visibleQuestions(catalog.questions, state.answers, questionMode(), modules).map((q) => q.id));
  const answers = effectiveAnswers(catalog.questions.filter((q) => modules.includes(q.owner) || isPreference(q) || ['pro', 'all'].includes(questionMode()) && asksIn(q, questionMode())), state.answers, state.mode);

  for (const [id, c] of controls) {
    c.node.hidden = !visible.has(id) || CARD_QUESTIONS.has(id) || ['arch.framework', 'arch.hosting-control', 'arch.libraries', 'arch.services', 'arch.cost', 'arch.cost-limit'].includes(id);
    for (const button of c.inputs.filter((i) => i.type === 'button' && i.value === 'no-preference' && id.startsWith('arch.'))) {
      button.hidden = (answers[id] ?? c.q.default) !== 'no-preference';
    }
    if (c.gitHolder) {
      c.gitHolder.replaceChildren(gitInitControl({ gitRepo: catalog.gitRepo, gitInit: state.gitInit !== false, readOnly: sectionEditing(), onGitInit: setGitInit }));
    }
    c.label.textContent = c.plainLabel;
    if (id === 'idea.text') c.label.classList.add('sr-only');
    if (id === 'quality.unit-tests') c.label.replaceChildren(decisionIcon('shield'), element('span', c.plainLabel));
    const value = answers[id] ?? c.q.default;
    for (const input of c.inputs) {
      if (input.type === 'checkbox') input.checked = Boolean(value);
      else if (input.type === 'button') input.setAttribute('aria-pressed', String(c.q.type === 'multi' ? value.includes(input.value) : input.value === String(value)));
      else if (document.activeElement !== input) input.value = String(value);
    }
    c.hint.hidden = !c.q.hint;
    if (c.wordCount) {
      const count = String(value).trim().split(/\s+/).filter(Boolean).length;
      c.wordCount.textContent = `${count} / ${c.q.maxWords} words`;
      c.inputs[0].setCustomValidity(count > c.q.maxWords ? `Use at most ${c.q.maxWords} words.` : '');
      c.inputs[0].setAttribute('aria-invalid', String(count > c.q.maxWords));
    }
    if (c.capability) {
      c.capability.replaceChildren();
      for (const agent of value) {
        const notes = { codex: ['Hooks must be trusted once via `/hooks`; `yaw doctor` reminds you.', 'Telemetry features are partially supported via user’s `~/.codex/config.toml` only.'], copilot: ['Some telemetry and hook features are unsupported.'], gemini: ['Some telemetry and hook features are unsupported.'] }[agent];
        if (!notes) continue;
        const note = element('div', undefined, { class: 'agent-support' });
        note.append(element('strong', catalog.agents[agent]?.name ?? agent));
        const list = element('ul'); notes.forEach((text) => { const item = element('li'); item.append(helpText(text)); list.append(item); }); note.append(list); c.capability.append(note);
      }
    }
  }
  for (const [id, s] of sections) {
    const qs = [...controls.values()].filter((c) => sectionOf(c.q) === id && visible.has(c.q.id) && !CARD_QUESTIONS.has(c.q.id) && !isInline(c.q) && !GROUP_INTRO.has(c.q.id));
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
    onExplain: explain,
    architectureNode: sections.get('arch')?.node,
    onChange: (id, value) => { state.answers[id] = value; state.proposed = (state.proposed ?? []).filter((key) => key !== id); update(); $('stack-cards').querySelector(`[aria-pressed="true"]${id === 'arch.language' ? '.chip' : '.host'}`)?.focus({ preventScroll: true }); },
  });
  stackValid = result.valid; activeProfile = result.profile;
}
function renderCommunication() {
  const section = sections.get('communication');
  if (!section) return;
  const shown = presentation === 'settings' || depthOf(state.mode) !== 'quick';
  section.applicable = shown;
  const answers = effectiveAnswers(catalog.questions, state.answers, state.mode);
  renderCommunicationCard(section.node.querySelector('.communication-card-holder'), {
    modules: catalog.modules, selected: selectedModules(), answers, questions: catalog.questions, compact,
    gitRepo: catalog.gitRepo, gitInit: state.gitInit !== false, readOnly: sectionEditing(), onExplain: () => explain('Communication style', [helpText('Language, experience, how often the agent asks, answer depth and responses.')], { module: 'communication' }),
    questionNodes: (name, on) => [...controls.values()].filter((c) => isPreference(c.q) && !c.node.hidden)
      .map((c) => { c.inputs.forEach((input) => { input.disabled = sectionEditing(); }); return c.node; }),
    onToggle: (name, on) => { state.modules = toggleModules(catalog.modules, selectedModules(), name, on); update(); $('module-communication')?.focus(); },
  });
}
function setGitInit(on) {
  state.gitInit = on;
  if (!on && selectedModules().includes('git-hooks')) state.modules = toggleModules(catalog.modules, selectedModules(), 'git-hooks', false);
  update();
}
function renderModules() {
  const quickWorkflow = presentation !== 'settings' && depthOf(state.mode) === 'quick';
  $('module-title').replaceChildren(decisionIcon('users'), element('span', quickWorkflow ? 'Repository' : 'Collaboration'));
  $('module-title').classList.add('module-group-title');
  if (quickWorkflow) {
    const github = controls.get('tasks.use-github');
    if (github) {
      github.node.hidden = false;
      if (github.gitHolder) github.gitHolder.hidden = true;
      $('modules').replaceChildren(github.node);
    }
    return;
  }
  const github = controls.get('tasks.use-github');
  if (github?.gitHolder) github.gitHolder.hidden = false;
  const answers = effectiveAnswers(catalog.questions, state.answers, state.mode);
  renderModuleGroups($('modules'), {
    modules: catalog.modules.filter((m) => m.name !== 'communication' && (presentation === 'settings' || depthOf(state.mode) === 'pro' || selectedModules().includes(m.name) || depthOf(state.mode) === 'basic' && ['review', 'github', 'tasks'].includes(m.name))), selected: selectedModules(), answers, questions: catalog.questions, compact,
    onCompact: (on) => { compact = on; localStorage.setItem('yaw.setup.compact', on ? '1' : '0'); renderModules(); renderCommunication(); scopeIds(); $('compact-modules')?.focus(); },
    gitRepo: catalog.gitRepo, gitInit: state.gitInit !== false && !catalog.gitRepo, usesGitHub: answers['tasks.use-github'] !== false,
    readOnly: sectionEditing(), onExplain: explain, compactRoot: $('module-tools'),
    groupNodes: (group) => [...controls.values()].filter((c) => GROUP_INTRO.get(c.q.id) === group && !c.node.hidden).map((c) => c.node),
    // Options are always there so a card keeps its size; they are greyed out while the module is off.
    questionNodes: (name, on) => {
      const everything = effectiveAnswers(catalog.questions, state.answers, state.mode);
      return [...controls.values()].filter((c) => c.q.owner === name && isInline(c.q) && (on ? !c.node.hidden : asksIn(c.q, questionMode()) && questionApplies(c.q, everything)))
        .map((c) => { c.node.hidden = false; c.inputs.forEach((i) => { i.disabled = !on || sectionEditing() || i.dataset.unavailable === '1'; }); return c.node; });
    },
    onToggle: (name, on) => { state.modules = toggleModules(catalog.modules, selectedModules(), name, on); update(); $(`module-${name}`)?.focus(); },
    onAnswer: (id, value) => { state.answers[id] = value; update(); },
  });
}
// Where a review item is configured: the step and the control to focus.
const stepFor = (q) => q.id.startsWith('arch.') ? STACK : isInline(q) || CARD_QUESTIONS.has(q.id) ? WORKFLOW : steps.findIndex((st) => belongs(st, sectionOf(q)));
function setDepth(mode) {
  state.mode = mode;
  root.querySelectorAll('button[name=mode]').forEach((input) => { input.setAttribute('aria-pressed', String(input.value === depthOf(mode))); });
  update();
}
function jump(target) {
  if (presentation === 'settings') {
    const id = target.question ? controls.get(target.question)?.inputs[0]?.id : target.stack ? 'stack-title' : target.plan ? 'plan-card' : `module-${target.module}`;
    const node = id && $(id); node?.scrollIntoView({ block: 'center' }); node?.focus({ preventScroll: true }); return;
  }
  let step, focusId;
  if (target.stack) { step = STACK; focusId = 'stack-title'; }
  else if (target.plan) { step = steps.findIndex((st) => st.groups?.includes('idea')); focusId = 'plan-card'; }
  else if (target.module === 'communication') { if (depthOf(state.mode) === 'quick') setDepth('basic'); step = 1; focusId = 'module-communication'; }
  else if (target.module) { if (depthOf(state.mode) === 'quick') setDepth('pro'); step = WORKFLOW; focusId = `module-${target.module}`; }
  else {
    const c = controls.get(target.question);
    if (!asksIn(c.q, state.mode)) setDepth(asksIn(c.q, 'basic') ? 'basic' : 'pro');
    step = stepFor(c.q); focusId = c.inputs[0]?.id;
  }
  stepIndex = step; reviewReturn = true; renderWizard();
  const node = $(focusId);
  if (node) { if (node.tabIndex < 0) node.tabIndex = -1; node.focus(); node.scrollIntoView({ block: 'center', behavior: 'instant' }); }
}
function summary(preview) {
  renderReview($('summary'), { preview, modules: catalog.modules, questions: catalog.questions, jump,
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
  lastPreview = null; promptRevision++;
  if (!planReady) projectTree.update(provisionalFiles(), { provisional: true });
  $('project-structure').setAttribute('aria-busy', 'true');
  planCard?.setPrompt('', 'Updating prompt…');
  error(''); actions(false);
  // Do not leave a stale preview or diff (possibly including an earlier value) on screen.
  $('summary').textContent = 'Updating preview…';
  $('diff-panel').hidden = true; $('diff-output').textContent = '';
  renderQuestions(); renderStackStep(); renderCommunication(); renderModules(); renderWizard(); scopeIds();
  // Cards are rebuilt on every change; keep the keyboard where it was.
  if (activeId && document.activeElement?.id !== activeId) $(activeId)?.focus({ preventScroll: true });
  clearTimeout(timer);
  const current = revision;
  timer = setTimeout(async () => {
    refreshPrompts();
    try {
      const body = await (await request('diff')).json();
      if (current !== revision) return;
      lastPreview = body; summary(body); actions(true);
      planReady = body.files.length > 0;
      $('project-structure').setAttribute('aria-busy', 'false');
      projectTree.update(body.files.length ? body.files : provisionalFiles(), { provisional: !body.files.length });
      highlightTree();
      status(body.unresolved?.length ? `Still needed: ${body.unresolved.join(', ')}. You can save a draft.` : 'Preview updated.');
    } catch (e) {
      if (current !== revision) return;
      $('project-structure').setAttribute('aria-busy', 'false');
      planReady = false; projectTree.update(provisionalFiles(), { provisional: true });
      if (e.message.startsWith('Choose another stack')) {
        const fix = element('button', 'Architecture (step 4)', { type: 'button', class: 'link' });
        fix.addEventListener('click', () => showSection('stack'));
        const plan = element('p', 'Your file plan appears once language and place fit together: '); plan.append(fix, '.');
        $('summary').replaceChildren(plan, element('p', `Suggested modules: ${selectedModules().join(', ')}`));
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
  if (catalog.hosted) list.append(
    bullet('Open the Claude connection link in the host interface.'),
    bullet('Resolve native startup confirmations on the host.'),
    bullet('The host keeps running when this page closes.'));
  else list.append(
    bullet(`Start ${names} in this folder; it reads AGENTS.md.`),
    bullet(code('yaw web'), ': start the workspace again.'),
    bullet(code('yaw doctor'), ' checks the setup; ', code('just --list'), ' shows all recipes.'),
    bullet(options.persistent ? 'The workspace remains open.' : 'This page is disconnected: the local server stopped after applying.'));
  $('next-steps').hidden = false;
  // Two ways to the project documents: a concept from another chat, or the local coding agent.
  if (kickoff) {
    conceptCard.setPrompt(kickoff.conceptPrompt); finalCard.setPrompt(kickoff.localPrompt);
    $('kickoff-box').replaceChildren(element('h3', 'Next: your project documents'),
      element('p', 'YAW has set up the working environment. Choose one way to write the Architecture, Data Model and UI/UX documents.', { class: 'small muted' }),
      conceptCard.node, finalCard.node);
  }
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
    const response = await request('apply', { ...state, secrets: secretValues });
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
  const facts = [`Writes ${written} file${written === 1 ? '' : 's'} ${catalog.hosted ? `on the host: ${lastPreview.destination}` : 'in this folder'}${kept ? `; ${kept} kept as they are` : ''}`];
  if (catalog.hosted) facts.push('Launches one Claude Code process with native Remote Control');
  if (catalog.personalDefaultsNotice && depthOf(state.mode) !== 'quick') facts.push('Confirmed personal answers will establish your defaults for future projects');
  if (catalog.skipVerify) facts.push('Skips the check (--skip-verify)');
  else if (!catalog.editing) facts.push('Then runs just setup and just check');
  if (!options.persistent) facts.push('The local server stops afterwards; yaw web starts it again');
  $('apply-facts').replaceChildren(...facts.map((f) => element('li', f)));
}
// Personal or team (T-027): a personal value stays in ~/.yaw/user-profile.yaml, a team value is committed in
// .yaw/answers.yaml. Default is team; only communication-like preferences (switchable) have the switch.
const scopeSyncs = [];
const scopeOf = (q) => state.scopes?.[q.id] === 'personal' ? 'personal' : 'team';
function scopeSwitch(q, id, label) {
  const wrap = element('div', undefined, { class: 'scope-toggle' });
  const toggle = element('input', undefined, { id: `${id}-scope`, type: 'checkbox', role: 'switch', class: 'module-switch scope-switch', 'aria-describedby': `${id}-scope-note` });
  const note = element('p', '', { class: 'hint scope-note', id: `${id}-scope-note`, 'aria-live': 'polite' });
  wrap.append(toggle, element('label', 'Personal', { for: `${id}-scope` }), note);
  const sync = () => {
    const personal = scopeOf(q) === 'personal';
    toggle.checked = personal;
    note.textContent = !personal ? 'Team: committed in .yaw/answers.yaml for everyone.'
      : 'Personal: only on your machine (~/.yaw/user-profile.yaml). Teammates no longer see this setting.';
  };
  toggle.addEventListener('change', () => {
    if (toggle.checked && scopeOf(q) === 'team' && !window.confirm(`Make "${label}" personal? Teammates will stop seeing it: the value leaves .yaw/answers.yaml and is kept only in your ~/.yaw/user-profile.yaml.`)) {
      toggle.checked = false;
      return;
    }
    const next = toggle.checked ? 'personal' : 'team';
    const scopes = { ...(state.scopes ?? {}) };
    if (next === 'team') delete scopes[q.id]; else scopes[q.id] = next;
    state.scopes = scopes;
    sync();
    update();
  });
  scopeSyncs.push(sync);
  sync();
  return wrap;
}
function loadState(next) {
  const { profile: _ignored, ...rest } = next;
  state = { ...rest, ...(catalog.editing ? { modules: rest.modules ?? catalog.initial.modules } : {}), gitInit: rest.gitInit ?? !catalog.gitRepo };
  scopeSyncs.forEach((sync) => sync());
  if (state.modules) for (const name of [...state.modules]) state.modules = toggleModules(catalog.modules, state.modules, name, true);
  visitedSteps.clear();

  root.querySelectorAll('button[name=mode]').forEach((i) => { i.setAttribute('aria-pressed', String(i.value === depthOf(state.mode))); });
  update();
}
// New setup always starts from global defaults. Presets remain an explicit choice.
const prefillOptions = [{ value: 'new', label: 'New setup', description: 'From global defaults' }];
let prefillValue = 'new', prefillLocked = false, prefillRevision = 0;
async function pickPrefill(value) {
  const current = ++prefillRevision;
  try {
    let next;
    if (value === 'current') next = catalog.initial;
    else if (value === 'new') next = { mode: 'quick', answers: {}, modules: null };
    else { const [kind, name] = value.split(':'); next = await (await request('prefill', { kind, ...(name ? { name } : {}) })).json(); }
    if (current !== prefillRevision) return;
    prefillValue = value; loadState(next); renderPrefill();
  } catch (e) { if (current === prefillRevision) error(e.message); }
}
function renderPrefill() {
  $('prefill').replaceChildren(...prefillOptions.map((preset) => {
    const card = element('button', undefined, { type: 'button', class: 'preset-card decision-option', 'aria-pressed': String(prefillValue === preset.value) });
    card.disabled = prefillLocked;
    card.append(decisionIcon(preset.value === 'new' ? 'file' : 'memory'), element('strong', preset.label));
    if (preset.value === 'new') card.append(element('span', 'From global defaults'), element('small', 'If this is your first initialization, the general settings apply as defaults.'));
    else if (preset.value.startsWith('preset:')) {
      const date = /^\d{4}-\d{2}-\d{2}$/.test(preset.created ?? '') ? preset.created : 'Unknown date';
      const destination = ({ local: 'Computer', 'self-hosted': 'Server', serverless: 'Serverless', edge: 'Edge / CDN', static: 'Static hosting', wordpress: 'WordPress', 'app-store': 'Desktop / mobile', 'browser-extension': 'Browser extension' })[preset.architecture] ?? preset.architecture;
      const language = catalog.questions.find((question) => question.id === 'arch.language')?.choices.find((choice) => (choice.value ?? choice) === preset.language)?.label ?? preset.language;
      card.append(element('span', date), element('span', [destination, language, preset.framework].filter(Boolean).join(' · ') || 'No saved architecture'), element('small', preset.purpose || 'No saved purpose'));
    }
    card.addEventListener('click', () => pickPrefill(preset.value));
    return card;
  }));
  $('start').hidden = presentation === 'settings' || !steps[stepIndex].ids.includes('start');
}

async function start() {
  const body = options.bootstrap ?? await (await fetch('/api/bootstrap')).json();
  catalog = body;
  state.gitInit = !catalog.gitRepo;
  const depthCards = $('setup-depth').querySelector('.depth-options');
  depthCards.replaceChildren(...DEPTHS.map((depth) => {
    const button = element('button', undefined, { type: 'button', name: 'mode', value: depth.value, class: 'decision-option', title: depth.description,
      'aria-pressed': String(depth.value === depthOf(state.mode)) });
    const showHelp = () => explain(depth.label, [element('p', depth.description)]);
    button.addEventListener('focus', showHelp); button.addEventListener('mouseenter', showHelp);
    button.append(decisionIcon(({ quick: 'bolt', basic: 'shield', pro: 'box' })[depth.value]), element('strong', depth.label)); return button;
  }));
  if (catalog.editing) {
    if (!options.persistent) document.title = 'YAW edit setup';
    prefillOptions.push({ value: 'current', label: 'Current project setup' });
    prefillValue = 'current';
    if (catalog.sections.length) {
      const selected = (q) => catalog.sections.some((s) => q.id === s || q.id.startsWith(`${s}.`));
      catalog.questions = catalog.questions.map((q) => selected(q) ? q : { ...q, editHidden: true });
      prefillLocked = true;
      root.querySelectorAll('button[name=mode]').forEach((input) => { input.disabled = true; });
    }
    catalog.questions = catalog.questions.map((q) => Object.hasOwn(catalog.initial.answers, q.id) ? { ...q, default: catalog.initial.answers[q.id] } : q);
  }
  for (const id of ['save-dialog', 'apply-dialog']) installDialogCancellation($(id));
  if (catalog.hasDraft) prefillOptions.push({ value: 'draft', label: 'Resume project draft' });
  for (const p of catalog.presets) prefillOptions.push({ ...p, value: `preset:${p.name}`, label: p.name });
  renderPrefill();
  $('verify-note').textContent = catalog.editing ? '' : catalog.skipVerify ? 'Verification disabled with --skip-verify.' : 'Apply runs just setup and just check.';
  $('diff').hidden = !catalog.editing;
  buildQuestions();
  buildPlan();
  for (const [id, icon] of [['start-title', 'memory'], ['confirm-title', 'shield']]) {
    const heading = $(id); heading.classList.add('module-group-title'); const text = heading.textContent; heading.replaceChildren(decisionIcon(icon), element('span', text));
  }
  for (const [id, icon] of [['draft', 'file'], ['preset', 'memory'], ['apply', 'shield'], ['diff', 'file']]) $(id).prepend(decisionIcon(icon));
  $('draft').addEventListener('focus', () => explain('Save draft', [element('p', 'Continue later')]));
  $('draft').addEventListener('mouseenter', () => explain('Save draft', [element('p', 'Continue later')]));
  $('preset').addEventListener('focus', () => explain('Save preset', [element('p', 'Save for future use')]));
  $('preset').addEventListener('mouseenter', () => explain('Save preset', [element('p', 'Save for future use')]));
  $('previous-step').addEventListener('click', () => { if (stepIndex > 0) { stepIndex--; renderWizard(true); } });
  $('back-to-review').addEventListener('click', () => { stepIndex = REVIEW; renderWizard(true); });
  $('next-step-button').addEventListener('click', advance);
  $('setup').addEventListener('submit', (e) => e.preventDefault());
  root.querySelectorAll('button[name=mode]').forEach((input) => input.addEventListener('click', () => {
    setDepth(input.value);
  }));
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
function showSection(section) {
  const index = ({ start: 0, user: 1, idea: 2, stack: STACK, workflow: WORKFLOW })[section];
  if (index === undefined || phase !== 'edit') return;
  if (presentation === 'settings') {
    const node = section === 'stack' ? $('stack') : section === 'workflow' ? $('module-section') : sections.get(section === 'user' ? 'user' : 'idea')?.node;
    node?.scrollIntoView({ block: 'start' }); return;
  }
  stepIndex = index; renderWizard(true);
}
await start();
return {
  destroy() { dockObserver?.disconnect(); projectTree.destroy(); clearTimeout(timer); revision++; promptRevision++; prefillRevision++; root.replaceChildren(); syncDockHeight(); }, state: () => state,
  setPresentation(mode) {
    if (!['settings', 'interview'].includes(mode) || presentation === mode) return;
    presentation = mode; update();
  },
  showSection,
};
}
