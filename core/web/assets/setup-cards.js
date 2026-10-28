// Setup cards (ADR-0054, ADR-0055): the stack step (language × where it runs → one profile) and the grouped
// module cards with the review agents. DOM only through createElement (CSP: no innerHTML, no inline styles).
// Shared by the setup form (app.js) and Settings → Interview (settings-view.js).

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

// The profile for a (language, runsOn) pair, or null (ADR-0054: at most one).
export function profileFor(profiles, language, runsOn) {
  return profiles.find((p) => p.stack?.language?.includes(language) && p.stack?.runsOn?.includes(runsOn)) ?? null;
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
    langRow.append(el('button', { type: 'button', class: 'chip', 'aria-pressed': String(l.value === lang), disabled: ctx.disabled,
      text: langName(l.value), title: l.label, onclick: () => ctx.onChange('arch.language', l.value) }));
  }
  const hostGrid = el('div', { class: 'hosts', role: 'group', 'aria-label': hostQ.label });
  for (const h of hosts) {
    const f = fit(lang, h.value);
    const p = profileFor(ctx.profiles, lang, h.value);
    const text = !lang ? 'Choose a language to see the matching stack' : f === 'tailored' ? `✓ ${p.title}` : f === 'basic' ? `◐ basic ${langName(lang)} stack` : `${langName(lang)} does not run here`;
    hostGrid.append(el('button', { type: 'button', class: 'host', 'aria-pressed': String(h.value === host), disabled: ctx.disabled,
      onclick: () => ctx.onChange('arch.runs-on', h.value) },
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
      el('ul', {}, el('li', { text: profile.summary }), needs(profile), el('li', { text: 'Adds its checks to just check and docs/standards.md' })),
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
      el('h3', { text: `${langName(lang)} does not run on ${hostName(host)}` }),
      el('ul', {}, el('li', { text: `${langName(lang)} runs on: ${other.join(', ') || 'nothing yet'}` }), el('li', { text: `${hostName(host)} runs: ${here.join(', ') || 'nothing yet'}` })));
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
    groups.append(el('section', { class: 'module-group', 'aria-label': title }, el('h3', { text: title }), el('p', { class: 'small muted lead', text: lead }),
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
    el('label', { class: 'module-head' }, input, el('strong', { text: m.title ?? m.name }), required ? el('span', { class: 'pill', text: 'required' }) : null,
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
