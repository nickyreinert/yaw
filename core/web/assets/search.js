// Quick search. Page search: filters the cards, rows and questions of one settings page and marks the matches.
// Sidebar search: one box over all pages and settings; a hit opens its page with the query already applied.
// Text nodes only: page content is never parsed as HTML.

const ITEMS = '.interview-question, .module-card, .file-row, .review-prompt, tbody tr, #notification-settings > label, .kickoff-guide li';
const CONTAINERS = '.card, .settings-group';
const SKIP = '.page-heading, .editor-tabs, script, style, textarea, input, select, option';
const MAX_MARKS = 400;

const norm = (s) => String(s ?? '').toLowerCase();
function textOf(node) {
  const values = [...node.querySelectorAll('input:not([type=checkbox]):not([type=radio]), textarea')].map((i) => i.value);
  return norm(`${node.textContent} ${values.join(' ')}`);
}

// A fragment of `text` around the first match, matches wrapped in <mark>.
export function snippet(text, query, radius = 48) {
  const out = document.createDocumentFragment(), q = norm(query), at = q ? norm(text).indexOf(q) : -1;
  if (at < 0) { out.append(text.length > radius * 2 ? `${text.slice(0, radius * 2)}…` : text); return out; }
  const from = Math.max(0, at - radius), to = Math.min(text.length, at + q.length + radius);
  const mark = document.createElement('mark');
  mark.className = 'search-hit'; mark.textContent = text.slice(at, at + q.length);
  out.append(`${from > 0 ? '…' : ''}${text.slice(from, at)}`, mark, `${text.slice(at + q.length, to)}${to < text.length ? '…' : ''}`);
  return out;
}

function clear(root) {
  for (const mark of root.querySelectorAll('mark.search-hit')) mark.replaceWith(document.createTextNode(mark.textContent));
  root.normalize();
  for (const node of root.querySelectorAll('.search-miss')) node.classList.remove('search-miss');
}

function filter(root, q) {
  const items = [...root.querySelectorAll(ITEMS)], miss = new Map(items.map((i) => [i, !textOf(i).includes(q)]));
  const containers = [...root.querySelectorAll(CONTAINERS)];
  // A title that matches keeps everything under it: searching "Architecture" shows the whole section.
  for (const c of containers) {
    const title = c.querySelector('h2, h3, legend')?.textContent;
    if (title && norm(title).includes(q)) for (const i of c.querySelectorAll(ITEMS)) miss.set(i, false);
  }
  for (const [item, missed] of miss) item.classList.toggle('search-miss', missed);
  for (const c of containers) {
    const inside = [...c.querySelectorAll(ITEMS)];
    const empty = inside.length ? inside.every((i) => miss.get(i)) : !textOf(c).includes(q);
    c.classList.toggle('search-miss', empty);
  }
}

function mark(root, q) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => n.nodeValue && norm(n.nodeValue).includes(q) && !n.parentElement.closest(`${SKIP}, .search-miss, [hidden]`) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  let count = 0;
  for (const node of nodes) {
    const text = node.nodeValue, lower = norm(text), frag = document.createDocumentFragment();
    let at = 0, hit;
    while ((hit = lower.indexOf(q, at)) >= 0 && count < MAX_MARKS) {
      const m = document.createElement('mark');
      m.className = 'search-hit'; m.textContent = text.slice(hit, hit + q.length);
      frag.append(text.slice(at, hit), m); at = hit + q.length; count++;
    }
    frag.append(text.slice(at)); node.replaceWith(frag);
  }
}

// Search box in a page heading. `root` holds the tabs and panes to filter; it gets the class `searching` while a
// query is set, so panes that are normally one-at-a-time can show everything. Rendering later (lazy tabs, edits
// that re-render the form) is picked up by an observer, so the filter always matches what is on screen.
export function attachPageSearch({ input, root, status }) {
  let query = '', frame = 0, scrollNext = false;
  const observer = new MutationObserver(() => schedule());
  const watch = () => observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  function apply() {
    frame = 0; observer.disconnect();
    clear(root); root.classList.toggle('searching', Boolean(query));
    if (query) { filter(root, query); mark(root, query); }
    const hits = [...root.querySelectorAll('mark.search-hit')].filter((m) => !m.closest('[hidden]'));
    if (status) status.textContent = !query ? '' : hits.length ? `${hits.length} match${hits.length === 1 ? '' : 'es'}` : 'No match here · try the sidebar search';
    if (scrollNext && hits.length) { hits[0].scrollIntoView({ block: 'center', behavior: 'instant' }); scrollNext = false; }
    observer.takeRecords(); watch();
  }
  function schedule() { if (!frame) frame = requestAnimationFrame(apply); }
  function set(value, { scroll = false } = {}) {
    query = norm(value).trim(); input.value = value; scrollNext = scroll; schedule();
  }
  input.addEventListener('input', () => set(input.value));
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape' && input.value) { e.stopPropagation(); set(''); } });
  watch();
  return { set, get query() { return query; } };
}

// Sidebar search. entries(): Promise of [{ title, trail, text, route }]; open(entry, query) navigates.
export function attachSidebarSearch({ input, results, nav, entries, open }) {
  let list = null, loading = null, token = 0;
  const load = () => (loading ??= Promise.resolve(entries()).then((e) => { list = e; }).catch(() => { list = []; }));
  const close = () => { results.hidden = true; nav.hidden = false; results.replaceChildren(); };
  async function run() {
    const q = norm(input.value).trim(), mine = ++token;
    if (!q) { close(); return; }
    await load(); if (mine !== token) return;
    const hits = list.filter((e) => norm(`${e.title} ${e.trail} ${e.text}`).includes(q)).slice(0, 40);
    nav.hidden = true; results.hidden = false; results.replaceChildren();
    if (!hits.length) { const none = document.createElement('p'); none.className = 'search-none'; none.textContent = `Nothing matches “${input.value.trim()}”.`; results.append(none); return; }
    for (const e of hits) {
      const b = document.createElement('button'), title = document.createElement('strong'), trail = document.createElement('span'), preview = document.createElement('span');
      b.type = 'button'; b.className = 'search-result';
      title.append(snippet(e.title, q, 60)); trail.className = 'search-trail'; trail.textContent = e.trail;
      preview.className = 'search-preview';
      const inText = e.text && norm(e.text).includes(q) && !norm(e.title).includes(q);
      if (inText) preview.append(snippet(e.text, q));
      b.append(title, trail); if (inText) b.append(preview);
      b.addEventListener('click', () => open(e, input.value.trim()));
      results.append(b);
    }
  }
  input.addEventListener('focus', () => { load(); });
  input.addEventListener('input', () => { run(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = ''; close(); input.blur(); }
    if (e.key === 'Enter') results.querySelector('.search-result')?.click();
    if (e.key === 'ArrowDown') { e.preventDefault(); results.querySelector('.search-result')?.focus(); }
  });
  results.addEventListener('keydown', (e) => {
    const all = [...results.querySelectorAll('.search-result')], at = all.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); all[Math.min(all.length - 1, at + 1)]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); if (at <= 0) input.focus(); else all[at - 1].focus(); }
    if (e.key === 'Escape') { input.focus(); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '') && !document.activeElement?.isContentEditable) { e.preventDefault(); input.focus(); }
  });
  return { refresh: () => { loading = null; list = null; if (input.value) run(); } };
}
