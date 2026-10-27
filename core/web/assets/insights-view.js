import { insightCoverage, redactPaths, REVIEW_LIMITS, reviewPrompt } from './insights-model.js';

const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (['value', 'checked', 'disabled', 'className', 'textContent'].includes(k)) n[k] = v;
    else n.setAttribute(k, v);
  }
  n.append(...kids.flat().filter((x) => x !== null && x !== undefined));
  return n;
};

export function createInsights({ api }) {
  let scope, rows = [], period, selection = new Set(), result = null, examples = [], packageText = '', instructions = '', version = 0;
  let busy = false, message = '', error = false, query = '', page = 1, host;
  function reset() {
    version++; selection = new Set(); result = null; examples = []; packageText = ''; instructions = ''; busy = false; message = ''; error = false; query = ''; page = 1;
    host?.replaceChildren();
  }
  function invalidate() { packageText = ''; }
  function notice(text, failed = false) { message = text; error = failed; draw(); }
  function totals() {
    const c = insightCoverage(rows);
    const labels = (key) => Object.entries(c.counts[key]).map(([label, n]) => `${label}: ${n}/${c.classifiedTurns} classified turns`).join(' · ') || 'No saved classifications';
    return el('div', { className: 'insights-summary' },
      el('p', {}, `${c.sessions} filtered sessions · ${c.measuredSessions} measured (${c.partialSessions} partial) · ${c.unmeasuredSessions} unmeasured · ${c.prompts} prompts · ${c.answers} answers.`),
      el('p', {}, `${c.classifiedSessions}/${c.sessions} sessions classified · ${c.classifiedTurns} classified turns · ${c.skippedTurns} skipped turns · ${c.unclassifiedSessions} unclassified sessions.`),
      el('p', {}, el('strong', {}, 'Estimated task outcome: '), labels('outcome')),
      el('p', {}, el('strong', {}, 'Estimated collaboration signals: '), ['sentiment', 'behaviour', 'failure'].map((k) => `${k}: ${labels(k)}`).join(' | ')),
      el('p', { className: 'small muted' }, 'Unknown and mixed labels are preserved. Counts use classified turns as the denominator and can repeat across dimensions. No validated detector or comparable-group analysis is available; there is not enough evidence for automatic advice.'));
  }
  async function read(ids, turn) {
    const selected = ids.map((id) => rows.find((r) => r.id === id));
    const description = selected.map((r) => `${r.agent} · ${new Date(r.started).toLocaleString()} · ${r.title || r.id}`).join('\n');
    if (!confirm(`Read these ${ids.length} local transcripts for temporary Insights review?\n\n${description}\n\nUp to 8 MiB or 1,000 recorded messages per session, from the start. Larger Gemini documents are skipped. Phrase suggestions are unvalidated; no Laya or hosted model is called. Nothing is saved.${turn ? `\nRead context around turn ${turn}.` : ''}`)) return;
    const token = ++version;
    busy = true; invalidate(); message = 'Reading selected transcripts…'; error = false; draw();
    try {
      const response = await api('insights-review', { ids, turn, confirm: true });
      if (token !== version) return;
      const toExamples = (s) => s.candidates.map((c) => ({ ...c, session: `S${[...selection].indexOf(s.id) + 1}`, source: s.id, excerpt: redactPaths(c.excerpt), selected: false }));
      if (turn) {
        for (const s of response.sessions) {
          if (s.unavailable) throw new Error(s.unavailable);
          const add = toExamples(s).filter((e) => !examples.some((old) => old.source === e.source && old.turn === e.turn));
          examples.push(...add);
        }
      } else { result = response; examples = response.sessions.flatMap(toExamples); }
      message = response.message;
    } catch (e) { if (token === version) { message = e.message; error = true; } }
    finally { if (token === version) { busy = false; draw(); } }
  }
  function picker() {
    const matches = rows.filter((r) => !query || [r.title, r.id, r.agent, r.model, r.project].join(' ').toLowerCase().includes(query.toLowerCase()));
    const pages = Math.max(1, Math.ceil(matches.length / 10)); page = Math.min(page, pages);
    const search = el('input', { type: 'search', value: query, placeholder: 'Find sessions…', 'aria-label': 'Find sessions for Insights', onchange: () => { query = search.value; page = 1; draw(); } });
    const list = el('div', { className: 'insights-session-list' }, matches.slice((page - 1) * 10, page * 10).map((r) => {
      const unavailable = r.source === 'synced' || r.prompts === null;
      const check = el('input', { type: 'checkbox', checked: selection.has(r.id), disabled: busy || Boolean(result) || unavailable,
        onchange: () => {
          if (check.checked && selection.size >= REVIEW_LIMITS.sessions) { check.checked = false; notice('Choose at most five sessions.', true); return; }
          check.checked ? selection.add(r.id) : selection.delete(r.id); draw();
        } });
      return el('label', { className: 'insights-session' }, check, el('span', {}, `${r.title || r.id} · ${r.agent} · ${r.model} · ${new Date(r.started).toLocaleString()}`,
        unavailable ? el('span', { className: 'small muted' }, ' · Evidence unavailable: needs a local saved scan; synced statistics remain in the summary.') : null));
    }));
    return el('div', {}, search, list, el('div', { className: 'plan-actions' },
      el('button', { type: 'button', disabled: page <= 1, onclick: () => { page--; draw(); } }, 'Previous'), el('span', {}, `${page}/${pages} · ${matches.length} sessions`),
      el('button', { type: 'button', disabled: page >= pages, onclick: () => { page++; draw(); } }, 'Next')),
    el('div', { className: 'plan-actions' },
      el('button', { type: 'button', disabled: busy || !selection.size || Boolean(result), onclick: () => read([...selection]) }, `Read selected transcripts (${selection.size}/5)`),
      el('button', { type: 'button', onclick: () => { reset(); draw(); } }, 'Clear temporary review')));
  }
  function editor(e, i) {
    const check = el('input', { type: 'checkbox', checked: e.selected, onchange: () => {
      if (check.checked && examples.filter((x) => x.selected).length >= REVIEW_LIMITS.examples) { check.checked = false; notice('Choose at most five examples.', true); return; }
      e.selected = check.checked; invalidate(); draw();
    } });
    const text = el('textarea', { rows: 9, value: e.excerpt, 'aria-label': `Edit or redact excerpt ${i + 1}`, oninput: () => { e.excerpt = text.value; invalidate(); clearPreview(); } });
    const reason = el('input', { type: 'text', value: e.reasons.join('; '), 'aria-label': `Selection reason for excerpt ${i + 1}`, oninput: () => { e.reasons = [reason.value]; invalidate(); clearPreview(); } });
    const detail = el('details', { className: 'insights-example', ...(e.open ? { open: '' } : {}) }, el('summary', {}, `${e.session} · turn ${e.turn} · ${e.reasons.join(', ')}`),
      el('label', {}, check, ' Include in package'), el('label', {}, 'Selection reason (editable)', reason),
      ...e.notes.map((n) => el('p', { className: 'small muted' }, n)),
      el('p', { className: 'small muted' }, 'Edit or redact this context. Remove false positives. Machine paths were redacted where recognized; names and other sensitive details may remain.'), text);
    detail.addEventListener('toggle', () => { e.open = detail.open; });
    return detail;
  }
  function clearPreview() { host?.querySelector('[data-package]')?.replaceChildren(); }
  function exportView() {
    const area = el('div', { 'data-package': '' });
    if (!packageText) return area;
    const exact = el('textarea', { rows: 14, value: packageText, 'aria-label': 'Exact review package', oninput: () => { packageText = exact.value; } });
    const status = el('p', { role: 'status', className: 'small' });
    const approved = el('input', { type: 'checkbox' });
    const copy = el('button', { type: 'button', disabled: true, onclick: async () => {
      if (!packageText.trim() || packageText.length > REVIEW_LIMITS.packageChars) { status.textContent = 'Keep the package between 1 and 24,000 characters.'; return; }
      try { await navigator.clipboard.writeText(packageText); status.textContent = 'Copied. Paste into your chosen coding agent or web chat; review its verdict before choosing an action.'; }
      catch { exact.focus(); exact.select(); status.textContent = 'Clipboard unavailable. Copy the selected package manually.'; }
    } }, 'Copy review prompt');
    approved.addEventListener('change', () => { copy.disabled = !approved.checked; });
    exact.addEventListener('input', () => { approved.checked = false; copy.disabled = true; });
    area.append(el('h3', {}, 'Inspect the exact package'), el('p', {}, 'Copying and pasting into an LLM is a deliberate disclosure to the service you choose. Inspect and redact excerpts and metadata first. YAW sends nothing to an external model.'),
      exact, el('label', {}, approved, ' I reviewed this exact package for sensitive information.'), copy, status);
    return area;
  }
  function draw() {
    if (!host) return;
    const body = [el('h2', {}, 'Insights review'), el('p', {}, 'Observe saved patterns, review a few exchanges, then copy a prompt for a short verdict. This review stays temporary and is cleared when you leave this view or change filters.'), totals(), picker(),
      el('p', { role: 'status', className: error ? 'error-text' : 'small muted' }, message)];
    if (result) {
      body.push(el('h3', {}, 'Review suggestions and comparisons'), el('p', {}, 'Choose up to five examples (three to five is a useful start). Hints can be wrong; selected examples cannot establish how common a problem is.'));
      for (const s of result.sessions) {
        if (s.unavailable) body.push(el('p', {}, `${s.exampleSession}: ${s.unavailable}`));
        else {
          const number = el('input', { type: 'number', min: 1, max: s.turns, value: 1, 'aria-label': `Manual turn for ${s.exampleSession}` });
          body.push(el('div', { className: 'plan-actions' }, el('span', {}, `${s.exampleSession}: ${s.turns} readable turns${s.limited ? ' · partial read' : ''}`), number,
            el('button', { type: 'button', disabled: busy || !s.turns, onclick: () => read([s.id], Number(number.value)) }, 'Read this turn')));
        }
      }
      body.push(...examples.map(editor));
      const supplied = el('textarea', { rows: 3, maxlength: 4000, value: instructions, 'aria-label': 'Optional existing instructions', oninput: () => { instructions = supplied.value; invalidate(); clearPreview(); } });
      body.push(el('label', {}, 'Existing shared instructions (optional; deliberately supplied by you)', supplied),
        el('button', { type: 'button', disabled: busy || !examples.some((e) => e.selected), onclick: () => {
          try { packageText = reviewPrompt({ examples: examples.filter((e) => e.selected), coverage: insightCoverage(rows), period, instructions,
            selectedSessions: selection.size, unavailableSessions: result.sessions.filter((s) => s.unavailable).length }); message = ''; error = false; draw(); }
          catch (e) { notice(e.message, true); }
        } }, 'Preview review prompt'), exportView());
    }
    host.replaceChildren(...body);
  }
  return {
    render(node, context) {
      if (scope !== context.scope) { reset(); scope = context.scope; }
      host = node; rows = context.rows; period = context.period; draw();
    },
    reset,
  };
}
