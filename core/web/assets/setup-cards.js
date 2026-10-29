// Setup cards (ADR-0054, ADR-0055): the stack step (language × where it runs → one profile) and the grouped
// module cards with the review agents. DOM only through createElement (CSP: no innerHTML, no inline styles).
// Shared by the setup form (app.js) and Settings → Interview (settings-view.js).

import { profileForStack } from '../../interview/suggest.js';

export const GROUPS = [
  // Git & GitHub first: the answers there decide which other modules apply.
  ['github', 'Git & GitHub', 'Repository, commit checks and, on GitHub, issues and team rules.'],
  ['basics', 'The basics', 'Recommended for every project.'],
  ['memory', 'Remember the work', 'Pick up where you left off.'],
  ['quality', 'Reviews', 'Reviewers check what a linter cannot.'],
  ['comfort', 'Comfort', 'Personal helpers on your machine; no model tokens.'],
];
export const REVIEWERS = [
  ['quality', 'Quality', 'Readability, naming, duplication, missing tests and error handling: what a linter cannot judge.', '"parseDate swallows errors; add a test for an empty string."'],
  ['logic', 'Business logic', 'Checks the change against your rules and the business-logic notices in .decisions/.', '"Discount is applied after tax; NOTICE-0004 says before."'],
  ['ux', 'UI / UX', 'Labels, empty and error states, keyboard use, contrast and consistency of screens.', '"The delete button has no confirmation and no focus style."'],
  ['feature', 'Feature fit', 'Compares the result with the task or issue: is every acceptance point done, is anything extra?', '"Task asks for CSV and JSON export; only CSV is done."'],
];
export const TRIGGERS = [['off', 'Off'], ['request', 'On request'], ['suggest', 'Suggest when a task is done'], ['push', 'Required before push']];
// Questions these cards answer; the generic question list hides them.
export const CARD_QUESTIONS = new Set(['arch.language', 'arch.runs-on', 'quality.review-gate', ...REVIEWERS.map(([k]) => `quality.review-${k}`)]);
// Optional tool questions live inside module cards; personal communication preferences belong in About you.
export const INLINE_OWNERS = new Set(['comfort', 'team', 'tasks']);
// Questions that open a group instead of sitting in a card: "Use GitHub for the repo?" leads the Git & GitHub group.
export const GROUP_INTRO = new Map([['tasks.use-github', 'github']]);
export const isInline = (q) => INLINE_OWNERS.has(q.owner) && !GROUP_INTRO.has(q.id);
// Radio buttons up to this many choices; a dropdown only beyond it.
export const RADIO_MAX = 5;
const HOST_EXTRA = {
  'self-hosted': 'Dockerfile and compose.yaml when the stack ships them',
  serverless: 'the deploy configuration is up to you',
  edge: 'the edge runtime configuration is up to you',
  'app-store': 'packaging and signing are up to you',
  static: 'no server code',
};

export function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...kids.filter((kid) => kid !== null && kid !== undefined && kid !== false));
  return node;
}

const choiceOf = (c) => (typeof c === 'object' ? { value: c.value, label: c.label ?? String(c.value) } : { value: c, label: String(c) });
const shortLabel = (label) => label.split(/ [—(–-] |: /)[0];

// Small, decorative line drawings. The adjacent text always names the choice.
const ICONS = {
  'lang-python': 'M12 3H8a4 4 0 0 0-4 4v4h8v2H7a4 4 0 0 0-4 4v1M12 21h4a4 4 0 0 0 4-4v-4h-8v-2h5a4 4 0 0 0 4-4V6M8 7h.01M16 17h.01',
  'lang-typescript': 'M3 3h18v18H3zM6 9h6m-3 0v9m9-8c-4-3-6 2-2 3 5 1 2 6-2 3',
  'lang-php': 'M2 12c0-10 20-10 20 0s-20 10-20 0Zm4-2v6m0-6h2c3 0 3 4 0 4H6m5-6v6m0-4h2v4m3-4v6m0-6h2c3 0 3 4 0 4h-2',
  'lang-kotlin': 'M3 3h18L12 12l9 9H3V3Zm0 18L21 3M3 3l9 9',
  'lang-html': 'm8 5-6 7 6 7m8-14 6 7-6 7m-3-15-2 16',
  'lang-go': 'M2 8h5M1 12h5m-4 4h5m8-8h-3c-5 0-5 8 0 8h3v-4h-3m8-4c-4 0-4 8 0 8s4-8 0-8Z',
  'lang-rust': 'm12 2 2 3 4-1 1 4 3 2-2 3 1 4-4 1-2 3-3-2-4 1-1-4-3-2 2-3-1-4 4-1ZM9 16V8h4c4 0 4 5 0 5H9m4 0 3 3',
  'lang-swift': 'M4 4c5 6 8 8 12 9L7 3c7 4 12 9 12 13l2 5-6-2c-5 2-10-1-12-5 4 3 7 3 9 1C8 12 5 8 4 4Z',
  'lang-java': 'M6 11h11v5c0 6-11 6-11 0Zm11 1h2c4 0 3 5-2 5M4 22h16M11 2c-5 3 5 3 0 7m5-7c-5 3 4 3-1 7',
  edit: 'm15 4 5 5M4 20l5-1L21 7l-5-5L4 14Zm0 0 1-6 5 5',
  file: 'M5 2h9l5 5v15H5zM14 2v6h5M8 12h8m-8 4h8',
  book: 'M3 4h6c2 0 3 1 3 2 0-1 1-2 3-2h6v16h-6c-2 0-3 1-3 2 0-1-1-2-3-2H3Zm9 2v16',
  branch: 'M6 7v10m0-7h6a6 6 0 0 0 6-6M9 4a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM9 20a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12-19v6h-6',
  memory: 'M3 6c0-5 18-5 18 0s-18 5-18 0Zm0 0v12c0 5 18 5 18 0V6M3 12c0 5 18 5 18 0',
  bell: 'M8 19h8m-11-3h14c-3-3-2-4-2-8a5 5 0 0 0-10 0c0 4 1 5-2 8Zm5 4a2 2 0 0 0 4 0',
  list: 'm3 5 2 2 3-4m3 2h10M3 12h5m3 0h10M3 19h5m3 0h10',
  users: 'M10 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM1 21v-3c0-6 11-6 11 0v3m3-17c7-3 9 8 2 9m-1 3c5-1 7 1 7 5',
  map: 'm2 5 7-3 6 3 7-3v17l-7 3-6-3-7 3Zm7-3v17m6-14v17',
  message: 'M3 3h18v14H9l-6 5ZM7 7h10M7 12h7',
  ruler: 'm3 17 14-14 5 5L8 22Zm3-3 3 3m1-7 3 3m1-7 3 3',
  building: 'M4 21V5h16v16M8 21v-5h8v5M8 8h1m6 0h1M8 12h1m6 0h1M2 21h20',
  server: 'M4 3h16v7H4zM4 14h16v7H4zM7 6h1m3 0h6M7 17h1m3 0h6',
  cloud: 'M6 18a4 4 0 0 1-1-8 7 7 0 0 1 13-1 4.5 4.5 0 0 1 0 9Z',
  box: 'm12 3 9 5v9l-9 5-9-5V8Zm0 10 9-5M12 13 3 8m9 5v9M7 5.8l9 5',
  open: 'M8 10V7a4 4 0 0 1 7.5-2M5 10h14v11H5zM12 14v3',
  briefcase: 'M8 6V3h8v3M3 6h18v15H3zM3 11l9 3 9-3M12 12v4',
  shield: 'm12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Zm-4 9 3 3 5-6',
  globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z',
  unplug: 'm4 4 16 16M8 5l3 3m4-3 3 3M5 8l3 3m8 2-3 3-5-5M5 19l3-3',
  gift: 'M3 9h18v4H3zM5 13v8h14v-8M12 9v12M12 9C4 9 4 2 8 3c3 0 4 6 4 6Zm0 0s1-6 4-6c4-1 4 6-4 6Z',
  wallet: 'M20 7H4V4h14v3M4 7v14h17V7ZM16 12h5v5h-5z',
  chart: 'M3 3v18h18M7 16l4-5 4 2 5-7M16 6h4v4',
  question: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 3h.01',
  shuffle: 'M3 6h3c5 0 7 12 12 12h3m-4-4 4 4-4 4M3 18h3c2 0 3-2 4-4m4-4c1-2 2-4 4-4h3m-4-4 4 4-4 4',
  terminal: 'M3 4h18v16H3zM7 9l3 3-3 3m6 0h4',
  bolt: 'm13 2-9 12h7l-1 8L21 9h-8Z',
  window: 'M3 4h18v16H3zM3 8h18M7 6h.01m3 0h.01',
  phone: 'M7 2h10v20H7zM10 18h4',
};
export function decisionIcon(kind) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [name, value] of Object.entries({ class: 'decision-icon', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(name, value);
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', ICONS[kind] ?? ICONS.question); svg.append(path);
  return svg;
}
const LANGUAGE_ICONS = { python: 'python', javascript: 'typescript', php: 'php', kotlin: 'kotlin', html: 'html', go: 'go', rust: 'rust', swift: 'swift', java: 'java' };
export function languageIcon(language) {
  const icon = decisionIcon(`lang-${LANGUAGE_ICONS[language] ?? 'html'}`);
  icon.classList.add('language-icon'); return icon;
}
export function moduleIcon(name) {
  return decisionIcon(({ core: 'book', standards: 'ruler', security: 'shield', devenv: 'terminal', github: 'branch', 'git-hooks': 'branch', ci: 'shuffle', 'code-map': 'map', decisions: 'book', communication: 'message', tasks: 'list', review: 'shield', comfort: 'bell', sessions: 'chart', team: 'users', backup: 'memory' })[name] ?? 'box');
}
const GROUP_ICONS = { github: 'branch', basics: 'box', memory: 'memory', quality: 'shield', comfort: 'bell' };
const ARCH_DECISIONS = {
  'arch.hosting-control': { 'on-premises': 'building', 'self-hosted': 'server', managed: 'cloud' },
  'arch.libraries': { 'standard-only': 'box', 'open-source': 'open', 'commercial-allowed': 'briefcase' },
  'arch.services': { none: 'unplug', 'approved-only': 'shield', allowed: 'globe' },
  'arch.cost': { 'free-only': 'gift', capped: 'wallet', flexible: 'chart' },
};

// The profile for a (language, runsOn) pair, or null (ADR-0054: at most one).
export function profileFor(profiles, language, runsOn) {
  return profileForStack(profiles, language, runsOn);
}

// One-of-few choices as radio buttons (a dropdown only beyond RADIO_MAX).
// field: { name, id, choices: [{ value, label, disabled? }], value, disabled, describedBy, label, onChange(value) } -> { node, inputs }
const pretty = (v) => { const t = String(v).replaceAll('-', ' '); return t[0].toUpperCase() + t.slice(1); };
export function radioChoices(choices) {
  return choices.map((c) => typeof c === 'object'
    ? { value: String(c.value), label: c.label ?? pretty(c.value), disabled: c.phase > 1 || c.disabled === true }
    : { value: String(c), label: pretty(c), disabled: false });
}
export function choiceField({ name, id, choices, value, disabled = false, describedBy, label, onChange }) {
  const list = radioChoices(choices);
  if (ARCH_DECISIONS[name]) {
    const inputs = list.map((c) => el('input', { type: 'radio', name, id: `${id}-${c.value}`, value: c.value, checked: c.value === String(value), disabled: disabled || c.disabled,
      'aria-describedby': describedBy, onchange: (e) => { if (e.target.checked) onChange(c.value); } }));
    const node = el('div', { class: 'decision-options', role: 'radiogroup', 'aria-label': label },
      ...list.map((c, i) => el('label', { class: 'decision-option' }, inputs[i], decisionIcon(c.value === 'no-preference' ? 'shuffle' : ARCH_DECISIONS[name][c.value]), el('span', { text: c.label }))));
    return { node, inputs };
  }
  if (list.length > RADIO_MAX) {
    const select = el('select', { id, name, 'aria-label': label, 'aria-describedby': describedBy, disabled, onchange: (e) => onChange(e.target.value) },
      ...list.map((c) => el('option', { value: c.value, disabled: c.disabled, text: c.label })));
    select.value = String(value);
    return { node: select, inputs: [select] };
  }
  const longest = Math.max(...list.map((c) => c.label.length));
  const inputs = list.map((c) => el('input', { type: 'radio', name, value: c.value, id: `${id}-${c.value}`, checked: c.value === String(value),
    disabled: disabled || c.disabled, 'data-unavailable': c.disabled ? '1' : null, 'aria-describedby': describedBy, onchange: (e) => { if (e.target.checked) onChange(c.value); } }));
  const node = el('div', { class: `radios${list.length > 3 || longest > 26 ? ' stacked' : ''}`, role: 'radiogroup', 'aria-label': label },
    ...list.map((c, i) => el('label', {}, inputs[i], ` ${c.label}${c.disabled ? ' (not available yet)' : ''}`)));
  return { node, inputs };
}

// "No git repository yet: create one", asked next to "Use GitHub for the repo?" (same context).
// ctx: { gitRepo, gitInit, readOnly, onGitInit(on) }
export function gitInitControl(ctx) {
  if (ctx.gitRepo) return el('p', { class: 'small git-ok git-init', text: '✓ Git repository found in this folder' });
  return el('label', { class: 'small git-init', title: 'YAW runs `git init` when it writes the files. Commit checks and the push gate need a repository; you can also do this later with yaw edit.' },
    el('input', { type: 'checkbox', id: 'git-init', checked: ctx.gitInit, disabled: ctx.readOnly, onchange: (e) => ctx.onGitInit(e.target.checked) }),
    ' No git repository yet: create one (git init)');
}

// ---------------------------------------------------------------- stack step

// ctx: { profiles, questions, answers, onChange(id, value), disabled }
// -> { valid: boolean, profile }
export function renderStack(root, ctx) {
  const q = (id) => ctx.questions.find((x) => x.id === id);
  const langQ = q('arch.language');
  const hostQ = q('arch.runs-on');
  if (!langQ || !hostQ) {
    root.replaceChildren(el('p', { class: 'muted', text: 'The stack questions are not part of this setup.' }));
    return { valid: true, profile: null };
  }
  const langs = langQ.choices.map(choiceOf);
  const hosts = hostQ.choices.map(choiceOf);
  const lang = ctx.answers['arch.language'] ?? langQ.default;
  const host = ctx.answers['arch.runs-on'] ?? hostQ.default;
  const langName = (k) => k ? shortLabel(langs.find((l) => l.value === k)?.label ?? k) : 'Choose a language';
  const hostName = (k) => { const s = shortLabel(hosts.find((h) => h.value === k)?.label ?? k ?? ''); return s ? s[0].toUpperCase() + s.slice(1) : 'Choose where it runs'; };
  const fit = (l, h) => {
    const p = profileFor(ctx.profiles, l, h);
    return p ? (p.stack.basic ? 'basic' : 'tailored') : 'none';
  };

  const langRow = el('div', { class: 'chips', role: 'group', 'aria-label': langQ.label });
  for (const l of langs) {
    langRow.append(el('button', { type: 'button', class: 'chip language-chip', 'aria-pressed': String(l.value === lang), disabled: ctx.disabled,
      title: l.label, onclick: () => ctx.onChange('arch.language', l.value) }, languageIcon(l.value), el('span', { text: langName(l.value) })));
  }
  const hostGrid = el('div', { class: 'hosts', role: 'group', 'aria-label': hostQ.label });
  for (const h of hosts) {
    const f = fit(lang, h.value);
    const p = profileFor(ctx.profiles, lang, h.value);
    const text = !lang ? 'Choose a language to see the matching stack' : f === 'tailored' ? `✓ ${p.title}` : f === 'basic' ? `◐ basic ${langName(lang)} stack` : 'No YAW profile yet';
    hostGrid.append(el('button', { type: 'button', class: 'host', 'aria-pressed': String(h.value === host), disabled: ctx.disabled,
      onclick: () => ctx.onChange('arch.runs-on', h.value) },
    decisionIcon(({ local: 'terminal', 'self-hosted': 'server', serverless: 'cloud', edge: 'bolt', static: 'window', wordpress: 'window', 'app-store': 'phone' })[h.value]),
    el('strong', { text: hostName(h.value) }),
    el('span', { class: 'small muted', text: h.label.slice(shortLabel(h.label).length).replace(/^[\s—(–:-]+/, '').replace(/\)$/, '') }),
    el('span', { class: `fit ${f === 'tailored' ? 'yes' : f === 'basic' ? 'basic' : 'no'}`, text })));
  }

  const profile = profileFor(ctx.profiles, lang, host);
  const result = el('div', { class: `stack-result${profile ? (profile.stack.basic ? ' basic' : '') : ' invalid'}`, role: 'status' });
  const needs = (p) => el('li', { text: `Needs ${p.requires?.length ? p.requires.join(', ') : 'nothing extra'} on your computer (yaw doctor checks)` });
  if (!lang || !host) {
    result.append(el('h3', { text: 'Choose a language and where this project will run' }),
      el('p', { text: 'Not sure? Use the planning guidance in Your project, then review its stack recommendation here.' }));
  } else if (profile && !profile.stack.basic) {
    result.append(
      el('h3', { text: `Your stack: ${profile.title}` }),
      el('ul', {}, el('li', { text: profile.summary }), profile.stack.notes?.[host] ? el('li', { text: profile.stack.notes[host] }) : null, needs(profile), el('li', { text: 'Adds its checks to just check and docs/standards.md' })),
      el('p', { class: 'small muted' }, `${langName(lang)} · ${hostName(host)} → `, el('code', { text: profile.name })));
  } else if (profile) {
    result.append(
      el('h3', { text: `Your stack: ${langName(lang)} · ${hostName(host)} (basic)` }),
      el('ul', {}, el('li', { text: `No tailored profile yet; standard tools: ${profile.summary}` }), HOST_EXTRA[host] ? el('li', { text: HOST_EXTRA[host] }) : null, needs(profile),
        el('li', { text: 'Tighten the checks later in the justfile and docs/standards.md' })));
  } else {
    const other = hosts.filter((h) => fit(lang, h.value) !== 'none').map((h) => hostName(h.value));
    const here = langs.filter((l) => fit(l.value, host) !== 'none').map((l) => langName(l.value));
    result.append(
      el('h3', { text: `No YAW profile for ${langName(lang)} on ${hostName(host)}` }),
      el('ul', {}, el('li', { text: `${langName(lang)} profiles available for: ${other.join(', ') || 'nothing yet'}` }), el('li', { text: `Profiles for ${hostName(host)}: ${here.join(', ') || 'nothing yet'}` })));
  }
  root.replaceChildren(
    el('h3', { class: 'stack-step', text: `1 · ${langQ.label}` }), langRow,
    el('h3', { class: 'stack-step', text: `2 · ${hostQ.label}` }), hostGrid,
    result);
  return { valid: Boolean(profile), profile };
}

// ---------------------------------------------------------------- module cards

// ctx: { modules (catalog), selected: string[], answers, questions, compact, gitRepo, gitInit, usesGitHub,
//   readOnly, onToggle(name, on), onAnswer(id, value), onGitInit(on), onCompact(on), onPreset(kind) }
export function renderModuleGroups(root, ctx) {
  const selected = new Set(ctx.selected);
  const hasGit = ctx.gitRepo || ctx.gitInit;
  const bar = el('div', { class: 'module-bar' },
    el('div', { class: 'presets', role: 'group', 'aria-label': 'Preset' },
      el('button', { type: 'button', disabled: ctx.readOnly, title: 'Use saved optional tool defaults; otherwise keep optional tools off.', onclick: () => ctx.onPreset('quick'), text: 'Quick' }),
      el('button', { type: 'button', disabled: ctx.readOnly, title: 'Every module that fits your answers, including commit checks and review agents.', onclick: () => ctx.onPreset('full'), text: 'Everything that fits' })),
    el('label', { class: 'small', title: 'Compact hides the examples and costs, for users who already know the modules.' },
      el('input', { type: 'checkbox', checked: ctx.compact, onchange: (e) => ctx.onCompact(e.target.checked) }), ' Compact view'));
  const groups = el('div', { class: `module-groups${ctx.compact ? ' compact' : ''}` });
  for (const [id, title, lead] of GROUPS) {
    const mods = ctx.modules.filter((m) => (m.group ?? 'basics') === id);
    const intro = ctx.groupNodes?.(id) ?? [];
    if (!mods.length && !intro.length) continue;
    const grid = el('div', { class: 'module-grid' });
    for (const m of mods) grid.append(moduleCard(m, ctx, selected, hasGit));
    groups.append(el('section', { class: 'module-group', 'aria-label': title }, el('h3', { class: 'module-group-title' }, decisionIcon(GROUP_ICONS[id]), el('span', { text: title })), el('p', { class: 'small muted lead', text: lead }),
      ...(intro.length ? [el('div', { class: 'group-intro' }, ...intro)] : []), grid));
  }
  root.replaceChildren(bar, groups);
}

// Cards that show their "?" panel (kept across redraws).
const expanded = new Set();

// Every card reads the same way: switch and title, one short line, its options, warnings, then the "?" with
// everything else (description, example, cost, notes for the agent, dependencies). A card never changes size when
// it is switched: its options are always there, greyed out while the module is off. Compact view drops the short
// line and the "?"; the same text shows as a tooltip on hover or focus.
function moduleCard(m, ctx, selected, hasGit) {
  const on = selected.has(m.name);
  const required = m.name === 'core';
  const notes = [];
  if (m.appliesTo?.usesGitHub && !ctx.usesGitHub) notes.push('needs GitHub: answer Yes above');
  if (m.name === 'git-hooks' && !hasGit) notes.push('needs a git repository');
  const input = el('input', { type: 'checkbox', role: 'switch', class: 'module-switch', id: `module-${m.name}`, checked: on, disabled: required || ctx.readOnly,
    onchange: (e) => ctx.onToggle(m.name, e.target.checked) });
  const questions = ctx.questionNodes?.(m.name, on) ?? [];
  const card = el('article', { class: `module-card${on ? ' on' : ''}${m.name === 'review' || questions.length ? ' wide' : ''}` },
    el('label', { class: 'module-head' }, input, moduleIcon(m.name), el('strong', { text: m.title ?? m.name }), required ? el('span', { class: 'pill', text: 'required' }) : null,
      el('span', { class: 'switch-state small muted', text: on ? 'Active' : 'Off' }),
      el('code', { class: 'small muted', text: m.name, title: m.name })));

  const more = () => [
    ...(m.details?.length ? [el('ul', {}, ...m.details.map((d) => el('li', { text: d })))] : [el('p', { class: 'small', text: m.what ?? m.description })]),
    ...(m.example ? [el('p', { class: 'example small' }, el('span', { class: 'muted', text: `${m.example.when} ` }), m.example.run ? el('code', { text: m.example.run }) : null, el('span', { text: ` → ${m.example.then}` }))] : []),
    ...(m.cost ? [el('p', { class: 'cost small muted', text: m.cost })] : []),
    ...(m.rules?.length ? [el('p', { class: 'small', text: `Adds ${m.rules.length} note${m.rules.length === 1 ? '' : 's'} for the agent (AGENTS.md):` }), el('ul', {}, ...m.rules.map((r) => el('li', { text: r })))] : []),
    ...(m.depends?.length && !required ? [el('p', { class: 'small muted deps', text: `Uses: ${m.depends.join(', ')}` })] : []),
  ];

  if (ctx.compact) card.append(el('div', { class: 'card-tip', role: 'tooltip' }, ...more()));
  else card.append(el('p', { class: 'what', text: m.short ?? m.what ?? m.description }));
  if (questions.length) card.append(el('div', { class: 'card-questions' }, ...questions));
  if (m.name === 'review') card.append(reviewerGrid(ctx, on, hasGit));
  for (const n of notes) card.append(el('p', { class: 'small warn-text card-note', text: n }));
  if (!ctx.compact) {
    const open = expanded.has(m.name);
    const panel = el('div', { class: 'card-more', id: `more-${m.name}`, hidden: !open }, ...more());
    const help = el('button', { type: 'button', class: 'help-button', 'aria-expanded': String(open), 'aria-controls': `more-${m.name}`, 'aria-label': `More about ${m.title ?? m.name}`, text: '?',
      onclick: () => {
        const now = panel.hidden;
        panel.hidden = !now; help.setAttribute('aria-expanded', String(now));
        if (now) expanded.add(m.name); else expanded.delete(m.name);
      } });
    card.append(el('div', { class: 'card-foot' }, help), panel);
  }
  return card;
}

function reviewerGrid(ctx, on, hasGit) {
  const trig = (k) => ctx.answers[`quality.review-${k}`] ?? ctx.questions.find((q) => q.id === `quality.review-${k}`)?.default ?? 'off';
  const grid = el('div', { class: 'reviewers' });
  for (const [k, title, what, example] of REVIEWERS) {
    const { node: select } = choiceField({ name: `review-trigger-${k}`, id: `review-${k}`, label: `${title} reviewer`, value: trig(k), disabled: !on || ctx.readOnly,
      choices: TRIGGERS.map(([value, label]) => ({ value, label: value === 'push' && !hasGit ? `${label} (needs git)` : label, disabled: value === 'push' && !hasGit })),
      onChange: (value) => ctx.onAnswer(`quality.review-${k}`, value) });
    grid.append(el('div', { class: `reviewer${trig(k) === 'off' ? ' off' : ''}`, title: `${what} ${example}` }, el('strong', { text: title }), select));
  }
  const gated = REVIEWERS.some(([k]) => trig(k) === 'push');
  if (!hasGit) return el('div', {}, grid, el('div', { class: 'gate muted' }, el('small', { text: 'The push gate needs a git repository.' })));
  const gate = ctx.answers['quality.review-gate'] ?? 'warn';
  const radio = (value, label, tip) => el('label', { title: tip }, el('input', { type: 'radio', name: 'review-gate', value, checked: gate === value, disabled: !on || !gated || ctx.readOnly,
    onchange: () => ctx.onAnswer('quality.review-gate', value) }), ` ${label}`);
  return el('div', {}, grid, el('div', { class: `gate${gated ? '' : ' muted'}` }, el('b', { text: 'Push gate' }),
    radio('warn', 'Warn', 'Show findings and ask before pushing'), radio('block', 'Block', 'Stop the push until findings are fixed'),
    ...(gated ? [] : [el('small', { text: 'Set a reviewer to "Required before push" to use it.' })])));
}
