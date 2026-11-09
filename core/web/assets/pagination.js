// Shared pagination: page sizes, window maths and the Previous / page numbers / Next control used by every paged view.
// Text-node rendering only; the module has no import of its own, so the server can share PAGE_SIZES.
export const PAGE_SIZES = [5, 10, 25, 50];
export const DEFAULT_PAGE_SIZE = 5;
export const pageSizeOf = (value) => PAGE_SIZES.includes(Number(value)) ? Number(value) : DEFAULT_PAGE_SIZE;

// The page (clamped into range) and slice bounds for `total` rows.
export function paginate(total, page, size = DEFAULT_PAGE_SIZE) {
  size = pageSizeOf(size);
  const pages = Math.max(1, Math.ceil(total / size)), current = Math.min(pages, Math.max(1, Math.floor(Number(page)) || 1));
  return { size, pages, page: current, start: (current - 1) * size, end: Math.min(total, current * size) };
}
// A new page size keeps the first visible row on screen.
export const resizePage = (page, oldSize, newSize) => Math.floor(((page - 1) * oldSize) / newSize) + 1;

// 1 … 4 5 6 … 20: first, last and the neighbours of the current page.
export function pageNumbers(page, pages) {
  const shown = [...new Set([1, page - 1, page, page + 1, pages].filter((n) => n >= 1 && n <= pages))].sort((a, b) => a - b), out = [];
  for (const n of shown) { if (out.length && n - out.at(-1) > 1) out.push('…'); out.push(n); }
  return out;
}

function node(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined && text !== null) n.textContent = String(text);
  if (cls) n.className = cls;
  return n;
}
function control(text, fn, { disabled = false, current = false, label } = {}) {
  const b = node('button', text); b.type = 'button'; b.disabled = disabled;
  if (current) b.setAttribute('aria-current', 'page');
  if (label) b.setAttribute('aria-label', label);
  b.addEventListener('click', fn); return b;
}
// onPage(n) and onSize(n) only report the request; the caller redraws.
export function renderPager({ page, pages, size, note = '', onPage, onSize }) {
  const row = node('div', null, 'pager'), select = node('select');
  select.setAttribute('aria-label', 'Rows per page');
  for (const n of PAGE_SIZES) { const o = node('option', n); o.value = String(n); o.selected = n === size; select.append(o); }
  select.value = String(size);
  select.addEventListener('change', () => onSize(Number(select.value)));
  const label = node('label', 'Rows per page ', 'small muted'); label.append(select);
  const nav = node('nav', null, 'pager-pages'); nav.setAttribute('aria-label', 'Pagination');
  nav.append(control('← Previous', () => onPage(page - 1), { disabled: page <= 1 }),
    ...pageNumbers(page, pages).map((n) => n === '…' ? node('span', n, 'small muted') : control(n, () => onPage(n), { current: n === page, label: `Page ${n}` })),
    control('Next →', () => onPage(page + 1), { disabled: page >= pages }));
  row.append(node('span', `${note ? `${note} · ` : ''}Page ${page}/${pages}`, 'small muted'), label, nav);
  return row;
}

// A client-paged block: `state` ({ page, size }, kept by the caller so it survives redraws) and `render(start, end)`
// returning the node for that slice of the rows.
export function paged(state, total, render, note = '') {
  const wrap = node('div'), body = node('div'), foot = node('div');
  const draw = () => {
    const w = paginate(total, state.page, state.size);
    state.page = w.page; state.size = w.size;
    body.replaceChildren(render(w.start, w.end));
    foot.replaceChildren(renderPager({ ...w, note,
      onPage: (n) => { state.page = n; draw(); },
      onSize: (n) => { state.page = resizePage(w.page, w.size, n); state.size = n; draw(); } }));
  };
  draw(); wrap.append(body, foot); return wrap;
}
