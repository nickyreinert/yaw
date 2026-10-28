import { automaticExamples, correctionCount, frustrationCount, hasFriction, insightCoverage, projectReviews, redactPaths, reviewPrompt } from './insights-model.js';
import { CHATS } from './chat-services.js';

const el = (tag, attrs = {}, ...kids) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (['value', 'checked', 'disabled', 'className', 'textContent'].includes(key)) node[key] = value;
    else if (value !== false && value !== undefined) node.setAttribute(key, value);
  }
  node.append(...kids.flat(Infinity).filter((x) => x !== null && x !== undefined)); return node;
};
const button = (text, onclick, attrs = {}) => el('button', { type: 'button', onclick, ...attrs }, text);
const number = (n) => Number(n ?? 0).toLocaleString('en');
const date = (n) => new Date(n).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const labels = (counts) => Object.entries(counts ?? {}).filter(([, n]) => n > 0).map(([label, n]) => `${label.replaceAll('_', ' ')}: ${n}`).join(' · ') || 'Not classified';
const metric = (title, value, note) => el('div', { className: 'metric' }, el('span', { className: 'eyebrow' }, title), el('strong', {}, value), el('span', { className: 'muted' }, note));
const rate = (row, count) => row.evaluation?.classified ? count(row) / row.evaluation.classified : null;
const rateText = (row, count) => row.evaluation?.classified ? `${count(row)}/${row.evaluation.classified} turns` : '—';

export function createInsights({ api, get }) {
  let host, context, scope, version = 0, opened = null, session = null, loading = false, message = '', draft = '', target = null, job = null, poll = 0;
  const bubbleNodes = new Map();
  let clue = 0;
  let saved = null, selectedReview = null, instructionPreview = null;
  let imported = '', taskContext = '', structured = false;
  const report = (error) => say(error.message);
  function reset() {
    version++; poll++;
    if (job?.id) api('improve-agent-clear', { id: job.id }).catch(() => {});
    opened = null; session = null; loading = false; draft = ''; job = null; message = ''; clue = 0; bubbleNodes.clear();
    taskContext = ''; imported = ''; selectedReview = null; instructionPreview = null;
    context?.onConversation?.(false);
    host?.replaceChildren();
  }
  function say(text) { message = text; draw(); }
  const classified = () => context.rows.filter((r) => r.evaluation);
  function visibleRows() {
    if (context.focus === 'all') return context.rows;
    if (context.focus === 'classified') return classified();
    return context.rows.filter(hasFriction);
  }
  function chart(title, dimension, selectedLabels, kind) {
    const coverage = insightCoverage(context.rows), counts = coverage.counts[dimension];
    const entries = (selectedLabels ?? Object.keys(counts)).map((key) => [key, counts[key] ?? 0]).filter(([, value]) => value > 0);
    const max = Math.max(1, ...entries.map(([, n]) => n));
    const series = context.series;
    return el('article', { className: 'card improve-chart' }, el('h2', {}, title),
      entries.length ? entries.map(([label, n]) => {
        let bar;
        if (series?.keys.length > 1) {
          bar = el('div', { className: 'improve-stacked-bar', role: 'img', 'aria-label': `${label}: ${n} classified turns` });
          for (const group of series.keys) {
            const count = context.rows.filter((r) => series.keyOf(r) === group).reduce((sum, r) => sum + (r.evaluation?.counts?.[dimension]?.[label] ?? 0), 0);
            if (!count) continue;
            const segment = el('span', { title: `${group}: ${count} classified turns` });
            segment.style.width = `${count / max * 100}%`; segment.style.background = series.color(group); bar.append(segment);
          }
        } else bar = el('progress', { max, value: n, className: kind, 'aria-label': `${label}: ${n} classified turns` });
        return el('div', { className: 'improve-bar' }, el('span', {}, label.replaceAll('_', ' ')), bar, el('strong', {}, number(n)));
      }) : el('p', { className: 'muted' }, 'Classify sessions to see this pattern.'),
      series?.keys.length > 1 ? el('div', { className: 'legend' }, ...series.keys.map((group) => { const dot = el('i'); dot.style.background = series.color(group); return el('span', {}, dot, group); })) : null,
      el('p', { className: 'small muted' }, `${number(coverage.classifiedTurns)} classified turns · ${number(coverage.skippedTurns)} skipped. Estimated labels.`),
      dimension === 'outcome' ? el('p', { className: 'small muted' },
        `Each label estimates one request and its response; it does not verify code or tests. ${number(coverage.outcomeFeedback)} labels from explicit user feedback or absence of a verdict; remaining labels estimated by Laya.`,
        counts.unknown ? ` Unknown: ${number(coverage.outcomeUnknown.model)} model uncertain · ${number(coverage.outcomeUnknown.lowConfidence)} below confidence threshold · ${number(coverage.outcomeUnknown.noVerdict)} no user verdict` : '',
        coverage.outcomeUnknown.unrecorded ? ` · ${number(coverage.outcomeUnknown.unrecorded)} reason unavailable from older or synced results. Reclassify local sessions to update.` : '') : null);
  }
  function overview() {
    const coverage = insightCoverage(context.rows), attention = context.rows.filter(hasFriction);
    const metrics = el('div', { className: 'metrics compact improve-metrics' },
      metric('Classified sessions', `${coverage.classifiedSessions}/${coverage.sessions}`, `${coverage.unclassifiedSessions} still unclassified`),
      metric('Worth a closer look', number(attention.length), 'sessions with friction or unresolved outcome labels'),
      metric('Local conversations', number(context.rows.filter((r) => r.source !== 'synced' && r.prompts !== null).length), 'available to open after a local scan'));
    const tabs = el('div', { className: 'improve-browse-heading' }, el('div', {}, el('h2', {}, 'Where did work get difficult?'), el('p', { className: 'small muted' }, 'Start with a project you remember, or browse sessions with saved signals.')),
      el('div', { className: 'subtabs', 'aria-label': 'Browse Learn' }, ...[['projects', 'Projects'], ['sessions', 'Sessions']].map(([value, label]) => button(label, () => context.set({ improveView: value }), { 'aria-pressed': String(context.view === value) }))));
    const options = el('div', { className: 'subtabs improve-focus', 'aria-label': 'Classification selection' },
      ...[['attention', `Needs attention (${attention.length})`], ['classified', `All classified (${classified().length})`], ['all', `All sessions (${context.rows.length})`]].map(([value, label]) => button(label, () => context.set({ improveFocus: value }), { 'aria-pressed': String(context.focus === value) })));
    const rows = visibleRows();
    const browse = context.view === 'projects' ? context.table('improve-projects', [
      { key: 'project', label: 'Project', value: (g) => context.rel(g.project), show: (g) => g.local ? button(context.rel(g.project), () => context.set({ project: g.project, improveView: 'sessions' }), { className: 'name' }) : g.project },
      { key: 'sessions', label: 'Sessions', num: true, value: (g) => g.rows.length },
      { key: 'classified', label: 'Classified', num: true, value: (g) => g.classified },
      { key: 'attention', label: 'With signals', num: true, value: (g) => g.attention },
      { key: 'last', label: 'Last active', value: (g) => g.last, show: (g) => date(g.last) },
    ], projectReviews(rows), { sort: 'attention', dir: 'desc' }) : context.table('improve-sessions', [
      { key: 'title', label: 'Session', value: (r) => r.title || r.id, show: (r) => el('div', {}, el('strong', { title: r.id }, r.title || `${r.agent} session`), el('div', { className: 'small muted' }, `${context.rel(r.project)} · ${r.agent} · ${r.model}`)) },
      { key: 'started', label: 'Started', value: (r) => r.started, show: (r) => date(r.started) },
      { key: 'outcome', label: 'Outcome estimates', value: (r) => labels(r.evaluation?.counts?.outcome) },
      { key: 'corrections', label: 'Admitted errors / apologies', value: (r) => rate(r, correctionCount), show: (r) => rateText(r, correctionCount) },
      { key: 'frustration', label: 'Frustration', value: (r) => rate(r, frustrationCount), show: (r) => rateText(r, frustrationCount) },
      { key: 'read', label: 'Conversation', sortable: false, value: () => '', show: (r) => button(r.source === 'synced' || r.prompts === null ? 'Not on this device' : 'Read conversation →', () => open(r), { disabled: r.source === 'synced' || r.prompts === null, title: 'Read this session’s local transcript temporarily. No model is called.' }) },
    ], rows, { sort: 'started', dir: 'desc' });
    const empty = !rows.length ? el('div', { className: 'improve-empty' }, el('strong', {}, context.focus === 'attention' ? 'No matching friction labels yet' : 'No matching sessions'),
      el('p', {}, 'Try All classified, choose another project, or classify the sessions in your current filters.'), button('Browse all sessions', () => context.set({ improveFocus: 'all', improveView: 'sessions' }))) : browse;
    return [metrics, el('div', { className: 'improve-charts' }, chart('Did the task get done?', 'outcome', null, 'outcome'),
      chart('Where did collaboration get difficult?', 'behaviour', ['admits_error', 'apology_loop', 'sycophantic_admission'], 'admission'),
      chart('How did the user react?', 'sentiment', ['frustrated', 'aggressive', 'positive', 'neutral'], 'correction')),
      el('article', { className: 'card improve-browser' }, tabs, options, el('p', { className: 'small muted' }, 'Read conversation opens only that local transcript. Classifier labels are clues; outcome and collaboration remain separate. Rates use classified turns, so long sessions do not automatically rank worse.'), empty)];
  }
  async function open(row) {
    const token = ++version;
    opened = row; session = null; loading = true; draft = ''; message = ''; clue = 0; draw();
    try {
      const result = await api('insights-review', { ids: [row.id], conversation: true, confirm: true });
      if (token !== version) return;
      session = result.sessions[0];
      if (session.unavailable) message = session.unavailable;
    } catch (e) { if (token === version) message = e.message; }
    finally { if (token === version) { loading = false; draw(); jump(0); } }
  }
  const moments = () => (session?.messages ?? []).filter((m) => m.highlights.some((h) => h.kind !== 'recovery'));
  function jump(index) {
    const list = moments(); if (!list.length) return;
    clue = (index + list.length) % list.length;
    bubbleNodes.get(list[clue].index)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const counter = host.querySelector('[data-clue-count]'); if (counter) counter.textContent = `${clue + 1} / ${list.length}`;
  }
  function highlighted(m) {
    const parts = [], text = redactPaths(m.text);
    // Redaction changes offsets: match the original phrases again against the redacted text.
    const terms = m.highlights.map((h) => ({ ...h, phrase: m.text.slice(h.start, h.end) }));
    const ranges = [];
    for (const hint of terms.filter((h, i, all) => all.findIndex((x) => x.phrase === h.phrase && x.kind === h.kind) === i)) {
      let from = 0, matches = 0;
      while (matches++ < 200) {
        const index = text.toLocaleLowerCase().indexOf(hint.phrase.toLocaleLowerCase(), from);
        if (index < 0) break;
        ranges.push({ ...hint, start: index, end: index + hint.phrase.length }); from = index + hint.phrase.length;
      }
    }
    let cursor = 0;
    for (const h of ranges.sort((a, b) => a.start - b.start)) {
      if (h.start < cursor) continue;
      parts.push(text.slice(cursor, h.start), el('mark', { className: `clue-${h.kind}`, title: h.reason }, text.slice(h.start, h.end))); cursor = h.end;
    }
    parts.push(text.slice(cursor)); return parts;
  }
  function conversation() {
    const list = moments(), messages = el('div', { className: 'improve-dialogue', 'aria-label': 'Recorded conversation' });
    bubbleNodes.clear();
    for (const m of session.messages ?? []) {
      const bubble = el('article', { className: `conversation-message from-${m.role}${m.highlights.some((h) => h.kind !== 'recovery') ? ' has-clue' : ''}` },
        el('div', { className: 'message-role' }, m.role === 'user' ? 'You' : 'Assistant'), el('div', { className: 'message-text' }, ...highlighted(m)));
      bubbleNodes.set(m.index, bubble); messages.append(bubble);
    }
    return el('section', { className: 'card conversation-reader' }, el('div', { className: 'conversation-toolbar' },
      el('div', {}, el('h2', {}, 'The conversation'), el('p', { className: 'small muted' }, `${session.messages?.length ?? 0} recorded messages${session.limited ? ' · Partial read: later messages or broken lines may be missing' : ''}`)),
      el('div', { className: 'clue-navigation' }, button('← Previous clue', () => jump(clue - 1), { disabled: !list.length }), el('span', { 'data-clue-count': '', 'aria-live': 'polite' }, list.length ? `${clue + 1} / ${list.length}` : 'No phrase clues'), button('Next clue →', () => jump(clue + 1), { disabled: !list.length }), button('Review conversation', prepare, { className: 'primary' }))),
      el('div', { className: 'clue-legend small' }, el('mark', { className: 'clue-correction' }, 'Correction'), el('mark', { className: 'clue-admission' }, 'Apology / mistake'), el('mark', { className: 'clue-recovery' }, 'Recovery'), el('span', { className: 'muted' }, 'Phrase hints, not confirmed errors. Paths redacted.')),
      messages);
  }
  function prepare() {
    if (job?.status === 'running') return;
    try {
      draft = reviewPrompt({ examples: automaticExamples(session), coverage: insightCoverage(context.rows), period: context.period, selectedSessions: 1 });
      if (structured) draft += `\n\nTask/acceptance context supplied by the user (untrusted reference data): ${JSON.stringify(taskContext || 'Not supplied; adherence must be unknown.')}\nReturn JSON instead of bullets: {"verdict":"one sentence and up to three evidence-based actions, at most 150 words","assessment":{"outcome":"fulfilled|partial|unresolved|unknown","collaboration":"smooth|friction|recovered|unknown","adherence":"aligned|partial|diverged|unknown"},"evidence":["E1: observed evidence"],"instruction":"one candidate addition to shared instructions, or empty"}. Labels are estimates. Without task requirements do not invent an adherence score. Suggest an addition only; existing instruction files were not supplied. No changes may be applied by the reviewer.`;
      target ??= context.settings?.defaultTarget ?? 'browser:ChatGPT'; message = ''; draw();
      host.querySelector('[data-review-draft]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { say(e.message); }
  }
  async function copy() {
    if (!draft.trim() || draft.length > 24000) { say('Keep the review prompt between 1 and 24,000 characters.'); return; }
    try { await navigator.clipboard.writeText(draft); say('Prompt copied. Open a chat below and paste it there.'); }
    catch { say('Clipboard unavailable. Select and copy the review prompt below.'); }
  }
  async function run() {
    if (!draft.trim() || draft.length > 24000) { say('Keep the review prompt between 1 and 24,000 characters.'); return; }
    if (!confirm(`Send this exact review prompt to ${target.slice(4)} CLI?\n\nIt uses the agent’s configured model provider and may incur usage charges. The run uses a separate temporary working folder. YAW will not apply its suggestions.`)) return;
    const token = version;
    try {
      const started = await api('improve-agent-start', { agent: target.slice(4), prompt: draft, confirm: true });
      if (token !== version) { api('improve-agent-clear', { id: started.id }).catch(() => {}); return; }
      job = started;
      draw(); const ticket = ++poll;
      while (ticket === poll && job?.status === 'running') {
        await new Promise((resolve) => setTimeout(resolve, 700));
        const next = await get('improve/job');
        if (ticket !== poll || token !== version) return;
        if (next?.id !== job.id) { job = null; break; }
        job = next;
        // Keep the editable draft stable while waiting; replace only the verdict/status section.
        const node = host.querySelector('[data-verdict]'); if (node) node.replaceChildren(...verdict());
      }
    } catch (e) { if (token === version) say(e.message); }
  }
  function verdict() {
    if (!job) return [];
    return [el('h3', {}, job.status === 'completed' ? 'Your reviewer’s verdict' : 'CLI review'), el('p', { role: 'status' }, job.message),
      job.status === 'running' ? button('Stop review', async () => { await api('improve-agent-clear', { id: job.id }); poll++; job = null; draw(); }) : null,
      job.output && job.status === 'completed' ? el('pre', { className: 'improve-verdict' }, job.output) : null,
      job.output && job.status === 'completed' ? button('Save this verdict', () => saveVerdict(job.output).catch(report)) : null,
      job.output && job.status === 'completed' ? button('Save verdict and edited prompt', () => saveVerdict(job.output, true).catch(report)) : null];
  }
  async function saveVerdict(output, includePrompt = false) {
    if (!confirm(`Save this verdict in local Improve history?${includePrompt ? ' The edited review prompt will also be retained.' : ' The prompt and conversation will not be saved.'} History is separate from analytics and sync.`)) return;
    selectedReview = await api('improve-history-save', { title: opened?.title || 'Conversation review', verdict: output, confirm: true, includePrompt, ...(includePrompt ? { prompt: draft } : {}) });
    saved = await get('improve/history'); say('Verdict saved. You can export, delete or review an instruction addition below.');
  }
  async function loadSaved() { saved = await get('improve/history'); selectedReview = null; instructionPreview = null; draw(); }
  function historyPanel() {
    const box = el('section', { className: 'card improve-history' }, el('h2', {}, 'Saved verdicts'),
      el('p', { className: 'small muted' }, 'Private local history, separate from analytics and sync. Prompts are retained only when you explicitly include them. Expired reviews are purged when history is accessed.'));
    if (!saved) { box.append(button('Open saved verdicts', () => loadSaved().catch(report))); return box; }
    const days = el('select', { 'aria-label': 'Verdict retention' }, ...saved.retentionChoices.map((value) => el('option', { value: String(value) }, `${value} days`))); days.value = String(saved.retentionDays);
    box.append(days, button('Set retention', async () => {
      if (!confirm('Change saved-verdict retention? Shortening it can permanently remove expired verdicts and their retained prompts.')) return;
      try { saved = await api('improve-history-retention', { days: Number(days.value), confirm: true }); selectedReview = null; draw(); } catch (e) { report(e); }
    }));
    for (const entry of saved.records) box.append(el('div', { className: 'improve-history-row' }, button(entry.title, async () => {
      try { selectedReview = await api('improve-history-read', { id: entry.id }); instructionPreview = null; draw(); } catch (e) { report(e); }
    }), el('span', { className: 'small muted' }, `Saved ${date(entry.createdAt)} · expires ${date(entry.expiresAt)}`)));
    if (!saved.records.length) box.append(el('p', {}, 'No saved verdicts.'));
    const text = el('textarea', { rows: '5', maxlength: '64000', 'aria-label': 'Import verdict text or JSON', value: imported, oninput: () => { imported = text.value; } });
    const retainPrompt = el('input', { type: 'checkbox' });
    box.append(el('h3', {}, 'Import a verdict'), text, el('label', {}, retainPrompt, ' Also retain an included prompt'), button('Import verdict', async () => {
      if (!confirm('Save this imported verdict in local Improve history?')) return;
      try { selectedReview = await api('improve-history-import', { text: imported, confirm: true, includePrompt: retainPrompt.checked }); saved = await get('improve/history'); imported = ''; draw(); } catch (e) { report(e); }
    }));
    if (selectedReview) {
      const record = selectedReview;
      box.append(el('h3', {}, record.title), el('pre', {}, record.verdict));
      if (record.assessment) box.append(el('p', { className: 'small muted' }, `Model estimates: ${Object.entries(record.assessment).map(([key, value]) => `${key}: ${value}`).join(' · ')}`));
      if (record.prompt) box.append(el('details', {}, el('summary', {}, 'Retained review prompt'), el('pre', {}, record.prompt)));
      box.append(button('Copy exported JSON', async () => { try { await navigator.clipboard.writeText(JSON.stringify(record, null, 2)); say('Saved review copied. Inspect it before sharing.'); } catch (e) { report(e); } }),
        button('Delete saved verdict', async () => {
          if (!confirm('Permanently delete this saved verdict and any retained prompt? Applied instruction changes will be kept.')) return;
          try { await api('improve-history-delete', { id: record.id, confirm: true }); selectedReview = null; saved = await get('improve/history'); draw(); } catch (e) { report(e); }
        }));
      box.append(instructionEditor(record));
    }
    return box;
  }
  function instructionEditor(record) {
    const box = el('section', { className: 'improve-instruction' }, el('h3', {}, 'Review an instruction addition'),
      el('p', { className: 'small muted' }, 'Applies only after reviewing the exact diff. Existing rules stay intact; project instructions keep the 80-line budget.'));
    const addition = el('textarea', { rows: '4', maxlength: '4000', 'aria-label': 'Candidate instruction addition', value: record.instruction ?? '' });
    const target = el('select', { 'aria-label': 'Instruction target' }, el('option', { value: 'project-instructions' }, 'Current project: AGENTS.md'), el('option', { value: 'project-review-rules' }, 'Current project: reviewer rules'), el('option', { value: 'personal-review-rules' }, 'Personal reviewer defaults'));
    target.value = instructionPreview?.target ?? 'project-instructions';
    const invalidate = () => { instructionPreview = null; diff.replaceChildren(); };
    addition.addEventListener('input', invalidate); target.addEventListener('change', invalidate);
    const diff = el('div');
    const preview = async () => {
      instructionPreview = await api('improve-instruction-preview', { instruction: addition.value, target: target.value });
      const approved = instructionPreview;
      diff.replaceChildren(el('pre', {}, approved.diff), button('Apply this instruction addition', async () => {
        if (!confirm(`Apply this exact reviewed addition to ${approved.path}?`)) return;
        try { const result = await api('improve-instruction-apply', { ...approved, confirm: true }); instructionPreview = null; say(result.message); } catch (e) { report(e); }
      }));
    };
    box.append(target, addition, button('Preview instruction change', () => preview().catch(report)), diff);
    return box;
  }
  function review() {
    const select = el('select', { 'aria-label': 'Review destination', disabled: job?.status === 'running', onchange: () => { target = select.value; draw(); } },
      ...CHATS.map(([name]) => el('option', { value: `browser:${name}` }, `${name} · browser`)),
      ...(context.settings?.agents ?? []).filter((a) => a.installed && context.settings.enabledAgents.includes(a.id)).map((a) => el('option', { value: `cli:${a.id}` }, `${a.name} · installed CLI`)));
    select.value = target ?? context.settings?.defaultTarget ?? 'browser:ChatGPT'; if (!select.value) select.value = 'browser:ChatGPT'; target = select.value;
    const text = el('textarea', { rows: 12, value: draft, disabled: job?.status === 'running', 'aria-label': 'Review prompt', oninput: () => {
      draft = text.value;
      if (job) { api('improve-agent-clear', { id: job.id }).catch(() => {}); job = null; host.querySelector('[data-verdict]')?.replaceChildren(); }
    } });
    return el('article', { className: 'card improve-review', 'data-review-draft': '' }, el('h2', {}, 'Get one useful improvement'),
      el('p', {}, 'The prompt includes highlighted exchanges and nearby context. Inspect or redact it, then choose where to review it. The reviewer returns one verdict and up to three actions.'),
      el('div', { className: 'review-destination' }, el('label', {}, 'Review with', select), el('a', { href: '#global-settings/improve' }, 'Configure CLI agents')),
      el('p', { className: 'small muted' }, 'Only send content you are comfortable sharing with the chosen provider. Instruction changes require a separate diff review and Apply.'),
      text, el('div', { className: 'plan-actions' }, button('Copy review prompt', copy), target.startsWith('cli:') ? button('Run review with CLI', run, { className: 'primary', disabled: job?.status === 'running' }) : el('a', { className: 'button primary', href: CHATS.find(([name]) => `browser:${name}` === target)?.[1] ?? CHATS[0][1], target: '_blank', rel: 'noopener noreferrer' }, `Open ${target.slice(8)} ↗`)),
      target.startsWith('browser:') ? el('p', { className: 'small muted' }, 'Copy first, then paste into the new chat. The link contains no conversation text.') : null,
      el('div', { 'data-verdict': '' }, ...verdict()));
  }
  function draw() {
    if (!host || !context) return;
    context.onConversation?.(Boolean(opened));
    if (!opened) { host.replaceChildren(...(message ? [el('p', { role: 'status' }, message)] : []), ...overview(), historyPanel()); return; }
    const head = el('div', { className: 'improve-conversation-heading' }, button('← Back to projects and sessions', () => { reset(); draw(); }),
      el('div', {}, el('h2', {}, opened.title || 'Session conversation'), el('p', { className: 'muted small' }, `${context.rel(opened.project)} · ${opened.agent} · ${opened.model} · ${date(opened.started)}`)));
    const content = [head];
    if (message) content.push(el('p', { className: 'improve-notice', role: 'status' }, message));
    if (loading) content.push(el('p', { role: 'status' }, 'Opening the local conversation…'));
    else if (session && !session.unavailable) {
      const requestStructured = el('input', { type: 'checkbox', checked: structured, onchange: () => { structured = requestStructured.checked; } });
      const task = el('textarea', { rows: '3', maxlength: '4000', 'aria-label': 'Task and acceptance context', value: taskContext, oninput: () => { taskContext = task.value; } });
      content.push(el('details', {}, el('summary', {}, 'Actionable review options'),
        el('label', {}, requestStructured, ' Request structured outcome, collaboration and task-adherence estimates plus a candidate instruction addition'),
        el('label', {}, 'Optional task requirements and acceptance criteria', task),
        el('p', { className: 'small muted' }, 'Rebuild the review prompt after changing these options. Missing task context means unknown adherence; labels remain estimates.')));
      content.push(el('div', { className: 'improve-review-callout' }, el('div', {}, el('strong', {}, 'Turn this conversation into a better next session'),
        el('p', { className: 'small' }, 'We include relevant moments and their context automatically. You can edit the prompt before sharing.')),
      button('Review this conversation →', prepare, { className: 'primary', disabled: !session.messages?.length })), conversation());
      if (draft) content.push(review());
    }
    content.push(historyPanel());
    host.replaceChildren(...content);
  }
  return {
    render(node, next) { if (scope !== next.scope) { reset(); scope = next.scope; } host = node; context = next; draw(); },
    reset,
  };
}
