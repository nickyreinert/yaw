// One session's local conversation as a drill-down level of a session list. The list is passed to layout(): while a
// conversation is open it replaces the list, and Back returns to the list without changing the page.
// Reading is explicit (one `insights-review` call per open); text goes into text nodes only, with paths redacted.
import { redactPaths } from './insights-model.js';

const el = (tag, attrs = {}, ...kids) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (['disabled', 'className'].includes(key)) node[key] = value;
    else if (value !== false && value !== undefined) node.setAttribute(key, value);
  }
  node.append(...kids.flat(Infinity).filter((x) => x !== null && x !== undefined)); return node;
};
const button = (text, onclick, attrs = {}) => el('button', { type: 'button', onclick, ...attrs }, text);
const date = (n) => new Date(n).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

// api(action, input) reads the conversation; onChange() asks the owner to redraw; onClose() runs when the user closes it.
// extra(session) may return { before, toolbar, after } node lists to add the owner's own actions around the dialogue.
export function createSessionPreview({ api, onChange, onClose, rel = (path) => path, extra }) {
  let row = null, session = null, loading = false, message = '', clue = 0, version = 0, panel = null, show = 'all';
  const bubbles = new Map();
  // show: 'all' steps through corrections and apologies; a hint kind steps through that kind only.
  const marked = (m) => m.highlights.some((h) => show === 'all' ? h.kind !== 'recovery' : h.kind === show);
  const moments = () => (session?.messages ?? []).filter(marked);
  function clear() { version++; row = null; session = null; loading = false; message = ''; clue = 0; panel = null; show = 'all'; bubbles.clear(); }
  async function open(next) {
    const token = ++version;
    row = next; session = null; loading = true; message = ''; clue = 0; onChange?.();
    try {
      const result = await api('insights-review', { ids: [next.id], conversation: true, confirm: true });
      if (token !== version) return;
      session = result.sessions[0];
      if (session.unavailable) message = session.unavailable;
    } catch (e) { if (token === version) message = e.message; }
    finally { if (token === version) { loading = false; onChange?.(); jump(0); } }
  }
  function jump(index) {
    const list = moments(); if (!list.length) return;
    clue = (index + list.length) % list.length;
    bubbles.get(list[clue].index)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const counter = panel?.querySelector('[data-clue-count]'); if (counter) counter.textContent = `${clue + 1} / ${list.length}`;
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
  // With a filter, only the turns holding that hint and one turn either side stay visible; gaps are counted.
  function visible() {
    const all = session.messages ?? [];
    if (show === 'all') return all;
    const turns = new Set(all.filter(marked).flatMap((m) => [m.turn - 1, m.turn, m.turn + 1]));
    return all.filter((m) => turns.has(m.turn));
  }
  function filters() {
    const all = session.messages ?? [], count = (kind) => all.filter((m) => m.highlights.some((h) => h.kind === kind)).length;
    const pick = (value) => () => { show = value; clue = 0; onChange?.(); jump(0); };
    return el('div', { className: 'subtabs clue-filter', role: 'group', 'aria-label': 'Show' }, el('span', { className: 'eyebrow' }, 'Show'),
      ...[['all', `All (${all.length})`], ['correction', `Corrections (${count('correction')})`], ['admission', `Apology / mistake (${count('admission')})`], ['recovery', `Recovery (${count('recovery')})`]]
        .map(([value, label]) => button(label, pick(value), { 'aria-pressed': String(show === value), disabled: value !== 'all' && !count(value) })));
  }
  function conversation(toolbar = []) {
    const list = moments(), messages = el('div', { className: 'improve-dialogue', 'aria-label': 'Recorded conversation' });
    bubbles.clear();
    const shown = visible();
    shown.forEach((m, i) => {
      const gap = m.index - (i ? shown[i - 1].index + 1 : 0);
      if (gap > 0) messages.append(el('p', { className: 'conversation-gap small muted' }, `… ${gap} message${gap === 1 ? '' : 's'} hidden …`));
      const bubble = el('article', { className: `conversation-message from-${m.role}${m.highlights.some((h) => h.kind !== 'recovery') ? ' has-clue' : ''}` },
        el('div', { className: 'message-role' }, m.role === 'user' ? 'You' : 'Assistant'), el('div', { className: 'message-text' }, ...highlighted(m)));
      bubbles.set(m.index, bubble); messages.append(bubble);
    });
    const rest = (session.messages?.length ?? 0) - (shown.at(-1)?.index ?? -1) - 1;
    if (show !== 'all' && rest > 0) messages.append(el('p', { className: 'conversation-gap small muted' }, `… ${rest} message${rest === 1 ? '' : 's'} hidden …`));
    return el('section', { className: 'conversation-reader' }, el('div', { className: 'conversation-toolbar' },
      el('div', {}, el('h3', {}, 'The conversation'), el('p', { className: 'small muted' }, `${session.messages?.length ?? 0} recorded messages${session.limited ? ' · Partial read: later messages or broken lines may be missing' : ''}`)),
      el('div', { className: 'clue-navigation' }, button('← Previous clue', () => jump(clue - 1), { disabled: !list.length }), el('span', { 'data-clue-count': '', 'aria-live': 'polite' }, list.length ? `${clue + 1} / ${list.length}` : 'No phrase clues'), button('Next clue →', () => jump(clue + 1), { disabled: !list.length }), ...toolbar)),
    filters(),
    el('div', { className: 'clue-legend small' }, el('mark', { className: 'clue-correction' }, 'Correction'), el('mark', { className: 'clue-admission' }, 'Apology / mistake'), el('mark', { className: 'clue-recovery' }, 'Recovery'), el('span', { className: 'muted' }, 'Phrase hints, not confirmed errors. Paths redacted.')),
    messages);
  }
  function node() {
    if (!row) return null;
    const ready = session && !session.unavailable, more = ready ? extra?.(session) ?? {} : {};
    panel = el('aside', { className: 'session-preview', 'aria-label': 'Conversation preview' },
      el('div', { className: 'session-preview-head' },
        el('div', {}, el('h2', {}, row.title || 'Session conversation'), el('p', { className: 'muted small' }, `${rel(row.project)} · ${row.agent} · ${row.model} · ${date(row.started)}`)),
        button('← Back to sessions', () => close(), { title: 'Return to the session list' })),
      message ? el('p', { className: 'improve-notice', role: 'status' }, message) : null,
      loading ? el('p', { role: 'status' }, 'Opening the local conversation…') : null,
      ...(more.before ?? []), ready ? conversation(more.toolbar) : null, ...(more.after ?? []));
    return panel;
  }
  // The list, or while a conversation is open, that conversation in its place.
  function layout(list) {
    const side = node();
    return el('div', { className: 'session-split' }, side ?? el('div', { className: 'session-split-list' }, list));
  }
  function close() { clear(); onClose?.(); onChange?.(); }
  return { open, close, reset: clear, layout, isOpen: () => Boolean(row), get row() { return row; }, get session() { return session; } };
}
