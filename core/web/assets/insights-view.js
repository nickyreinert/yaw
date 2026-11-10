import { automaticExamples, correctionCount, folderLevel, folderParent, frustrationCount, hasFriction, insightCoverage, reviewPrompt } from './insights-model.js';
import { CHATS } from './chat-services.js';
import { createSessionPreview } from './session-preview.js';

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
  let host, context, scope, version = 0, message = '', draft = '', target = null, job = null, poll = 0;
  let instructionPreview = null;
  const report = (error) => say(error.message);
  // Drops everything tied to the open conversation: the review draft, a running review.
  function discard() {
    version++; poll++;
    if (job?.id) api('improve-agent-clear', { id: job.id }).catch(() => {});
    draft = ''; job = null; message = '';
    instructionPreview = null;
  }
  const preview = createSessionPreview({ api, onChange: () => draw(), onClose: discard, rel: (path) => context.rel(path), extra: () => ({
    before: [...(message ? [el('p', { className: 'improve-notice', role: 'status' }, message)] : []), reviewOptions()],
    toolbar: [button('Review conversation', prepare, { className: 'primary' })],
    after: draft ? [review()] : [],
  }) });
  function reset() { preview.reset(); discard(); host?.replaceChildren(); }
  const read = (row) => { discard(); return preview.open(row); };
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
  const sessionTable = (id, rows) => context.table(id, [
    { key: 'title', label: 'Session', value: (r) => r.title || r.id, show: (r) => el('div', {}, el('strong', { title: r.id }, r.title || `${r.agent} session`), el('div', { className: 'small muted' }, `${context.rel(r.project)} · ${r.agent} · ${r.model}`)) },
    { key: 'started', label: 'Started', value: (r) => r.started, show: (r) => date(r.started) },
    { key: 'outcome', label: 'Outcome estimates', value: (r) => labels(r.evaluation?.counts?.outcome) },
    { key: 'corrections', label: 'Admitted errors / apologies', value: (r) => rate(r, correctionCount), show: (r) => rateText(r, correctionCount) },
    { key: 'frustration', label: 'Frustration', value: (r) => rate(r, frustrationCount), show: (r) => rateText(r, frustrationCount) },
    { key: 'read', label: 'Conversation', sortable: false, value: () => '', show: (r) => button(r.source === 'synced' || r.prompts === null ? 'Not on this device' : 'Read conversation →', () => read(r), { disabled: r.source === 'synced' || r.prompts === null, title: 'Read this session’s local transcript temporarily. No model is called.' }) },
  ], rows, { sort: 'started', dir: 'desc' });
  // Folders and projects one level at a time; the sessions of the current project are listed under them.
  function folderBrowser(rows) {
    const at = context.at ?? '', root = context.root ?? '', level = folderLevel(rows, at, root);
    const name = at ? (at.startsWith('/') ? context.rel(at) : at) : 'All folders';
    const bar = el('div', { className: 'improve-folder-bar' }, button('← Back', () => context.set({ improveAt: folderParent(at, root) }), { disabled: !at, title: 'Up one level' }), el('strong', {}, name));
    const kids = level.kids.length ? context.table('improve-folders', [
      { key: 'name', label: 'Folder / project', value: (k) => k.name, show: (k) => button(k.deeper ? `${k.name}/` : k.name, () => context.set({ improveAt: k.key }), { className: 'name' }) },
      { key: 'sessions', label: 'Sessions', num: true, value: (k) => k.rows.length },
      { key: 'classified', label: 'Classified', num: true, value: (k) => k.classified },
      { key: 'attention', label: 'With signals', num: true, value: (k) => k.attention },
      { key: 'last', label: 'Last active', value: (k) => k.last, show: (k) => date(k.last) },
    ], level.kids, { sort: 'attention', dir: 'desc' }) : null;
    const here = level.direct.length ? [at ? el('h3', {}, `Sessions in ${name}`) : null, sessionTable('improve-folder-sessions', level.direct)] : [];
    return el('div', { className: 'improve-folder-browser' }, bar, kids, ...here,
      !kids && !here.length ? el('p', { className: 'muted' }, 'Nothing here for the current filters. Use Back to return.') : null);
  }
  function overview() {
    const coverage = insightCoverage(context.rows), attention = context.rows.filter(hasFriction);
    const metrics = el('div', { className: 'metrics compact improve-metrics' },
      metric('Classified sessions', `${coverage.classifiedSessions}/${coverage.sessions}`, `${coverage.unclassifiedSessions} still unclassified`),
      metric('Worth a closer look', number(attention.length), 'sessions with friction or unresolved outcome labels'),
      metric('Local conversations', number(context.rows.filter((r) => r.source !== 'synced' && r.prompts !== null).length), 'available to open after a local scan'));
    const tabs = el('div', { className: 'improve-browse-heading' }, el('div', {}, el('h2', {}, 'Where did work get difficult?'), el('p', { className: 'small muted' }, context.workspace ? 'Sessions of this workspace with saved signals.' : 'Browse by folder and project, or list every session with saved signals.')),
      context.workspace ? null : el('div', { className: 'improve-view-switch' }, el('span', { className: 'eyebrow' }, 'View'), el('div', { className: 'subtabs', 'aria-label': 'View' },
        ...[['folders', 'Folder Browser'], ['sessions', 'All Sessions']].map(([value, label]) => button(label, () => context.set({ improveView: value }), { 'aria-pressed': String(context.view === value) })))));
    const options = el('div', { className: 'subtabs improve-focus', 'aria-label': 'Classification selection' },
      ...[['attention', `Needs attention (${attention.length})`], ['classified', `All classified (${classified().length})`], ['all', `All sessions (${context.rows.length})`]].map(([value, label]) => button(label, () => context.set({ improveFocus: value }), { 'aria-pressed': String(context.focus === value) })));
    const rows = visibleRows();
    const browse = context.workspace || context.view === 'sessions' ? sessionTable('improve-sessions', rows) : folderBrowser(rows);
    const empty = !rows.length ? el('div', { className: 'improve-empty' }, el('strong', {}, context.focus === 'attention' ? 'No matching friction labels yet' : 'No matching sessions'),
      el('p', {}, 'Try All classified, choose another project, or classify the sessions in your current filters.'), button('Browse all sessions', () => context.set({ improveFocus: 'all', improveView: 'sessions' }))) : browse;
    return [metrics, el('div', { className: 'improve-charts' }, chart('Did the task get done?', 'outcome', null, 'outcome'),
      chart('Where did collaboration get difficult?', 'behaviour', ['admits_error', 'apology_loop', 'sycophantic_admission'], 'admission'),
      chart('How did the user react?', 'sentiment', ['frustrated', 'aggressive', 'positive', 'neutral'], 'correction')),
      el('article', { className: 'card improve-browser' }, tabs, options, el('p', { className: 'small muted' }, 'Read conversation opens only that local transcript beside the list. Classifier labels are clues; outcome and collaboration remain separate. Rates use classified turns, so long sessions do not automatically rank worse.'), preview.layout(empty))];
  }
  function prepare() {
    if (job?.status === 'running') return;
    try {
      draft = reviewPrompt({ examples: automaticExamples(preview.session), coverage: insightCoverage(context.rows), period: context.period, selectedSessions: 1 });
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
      job.output && job.status === 'completed' ? instructionEditor({ instruction: suggestedInstruction(job.output) }) : null];
  }
  // A structured verdict may carry a candidate instruction; plain text verdicts start with an empty editor.
  function suggestedInstruction(output) {
    try { const doc = JSON.parse(String(output).replace(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/, '$1')); return typeof doc?.instruction === 'string' ? doc.instruction : ''; } catch { return ''; }
  }
  function instructionEditor(record) {
    const box = el('section', { className: 'improve-instruction' }, el('h3', {}, 'Review an instruction addition'),
      el('p', { className: 'small muted' }, 'Applies only after reviewing the exact diff. Existing rules stay intact; project instructions keep the 90-line budget.'));
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
    const select = el('select', { 'aria-label': 'Review destination', disabled: job?.status === 'running', onchange: () => { target = select.value; actions.replaceChildren(...actionRow()); } },
      ...CHATS.map(([name]) => el('option', { value: `browser:${name}` }, `${name} · browser`)),
      ...(context.settings?.agents ?? []).filter((a) => a.installed && context.settings.enabledAgents.includes(a.id)).map((a) => el('option', { value: `cli:${a.id}` }, `${a.name} · installed CLI`)));
    select.value = target ?? context.settings?.defaultTarget ?? 'browser:ChatGPT'; if (!select.value) select.value = 'browser:ChatGPT'; target = select.value;
    const text = el('textarea', { rows: 12, value: draft, disabled: job?.status === 'running', 'aria-label': 'Review prompt', oninput: () => {
      draft = text.value;
      if (job) { api('improve-agent-clear', { id: job.id }).catch(() => {}); job = null; host.querySelector('[data-verdict]')?.replaceChildren(); }
    } });
    // Only the action row is rebuilt when the destination changes, so the page does not re-render and jump.
    const actionRow = () => [el('label', {}, 'Review with', select), button('Copy review prompt', copy),
      target.startsWith('cli:') ? button('Run review with CLI', run, { className: 'primary', disabled: job?.status === 'running' }) : el('a', { className: 'button primary', href: CHATS.find(([name]) => `browser:${name}` === target)?.[1] ?? CHATS[0][1], target: '_blank', rel: 'noopener noreferrer' }, `Open ${target.slice(8)} ↗`)];
    const actions = el('div', { className: 'plan-actions review-destination' }, ...actionRow());
    return el('article', { className: 'card improve-review', 'data-review-draft': '' }, el('h2', {}, 'Get one useful improvement'),
      el('p', { className: 'improve-notice', role: 'alert' }, el('strong', {}, 'Warning: this prompt can contain sensitive data. Handle with absolute care.'), ' Inspect and redact it before copying or sending it anywhere.'),
      el('p', {}, 'The prompt includes highlighted exchanges and nearby context. The reviewer returns one verdict and up to three actions.'),
      text, actions,
      el('p', { className: 'small muted' }, 'Instruction changes require a separate diff review and Apply. ', el('a', { href: '#global-settings/improve' }, 'Configure CLI agents'), target.startsWith('browser:') ? ' Copy first, then paste into the new chat; the link contains no conversation text.' : ''),
      el('div', { 'data-verdict': '' }, ...verdict()));
  }
  // The review options and call to action shown at the top of the open conversation.
  function reviewOptions() {
    return el('div', {}, el('div', { className: 'improve-review-callout' }, el('div', {}, el('strong', {}, 'Turn this conversation into a better next session'),
      el('p', { className: 'small' }, 'We include relevant moments and their context automatically. You can edit the prompt before sharing.')),
    button('Review this conversation →', prepare, { className: 'primary', disabled: !preview.session?.messages?.length })));
  }
  function draw() {
    if (!host || !context) return;
    host.replaceChildren(...(message && !preview.isOpen() ? [el('p', { role: 'status' }, message)] : []), ...overview());
  }
  return {
    render(node, next) { if (scope !== next.scope) { reset(); scope = next.scope; } host = node; context = next; draw(); },
    reset,
  };
}
