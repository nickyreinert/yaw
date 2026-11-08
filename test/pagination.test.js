// T-038: one shared pagination component (sizes 5/10/25/50, default 5) used by every paged web view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, pageNumbers, paged, paginate, renderPager, resizePage } from '../core/web/assets/pagination.js';
import { knowledgeData } from '../core/web/knowledge.js';
import { KIT_ROOT, tmp } from './helpers/fixtures.js';

// Minimal DOM: enough to render and click the pager without a browser.
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.events = {}; this.disabled = false; this.value = ''; this.className = ''; this.textContent = ''; }
  append(...kids) { this.children.push(...kids); }
  replaceChildren(...kids) { this.children = kids; }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener(name, fn) { (this.events[name] ??= []).push(fn); }
  click() { if (!this.disabled) for (const fn of this.events.click ?? []) fn(); }
  change(value) { this.value = String(value); for (const fn of this.events.change ?? []) fn(); }
  all(test) { return [...(test(this) ? [this] : []), ...this.children.flatMap((n) => n.all?.(test) ?? [])]; }
  get text() { return [this.textContent, ...this.children.map((n) => n.text ?? '')].join(''); }
}
function withDom(t) {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: (tag) => new Element(tag) } });
  t.after(() => { saved ? Object.defineProperty(globalThis, 'document', saved) : delete globalThis.document; });
}
const button = (root, text) => root.all((n) => n.tag === 'button' && n.textContent === text)[0];
const rowsOf = (root) => root.all((n) => n.tag === 'li').map((n) => n.textContent);

test('pagination: sizes are 5, 10, 25 and 50 with 5 as the default; unknown sizes fall back to 5', () => {
  assert.deepEqual(PAGE_SIZES, [5, 10, 25, 50]); assert.equal(DEFAULT_PAGE_SIZE, 5);
  assert.equal(paginate(100).size, 5); assert.equal(paginate(100, 1, 7).size, 5); assert.equal(paginate(100, 1, 25).pages, 4);
  assert.deepEqual(paginate(12, 99, 5), { size: 5, pages: 3, page: 3, start: 10, end: 12 });
  assert.deepEqual(paginate(0, 1, 5), { size: 5, pages: 1, page: 1, start: 0, end: 0 });
  assert.equal(resizePage(3, 5, 25), 1); assert.equal(resizePage(5, 5, 10), 3);
  assert.deepEqual(pageNumbers(1, 3), [1, 2, 3]); assert.deepEqual(pageNumbers(6, 20), [1, '…', 5, 6, 7, '…', 20]);
});

test('pagination: the pager offers all four sizes with 5 selected, and Previous, page numbers and Next report the target page', (t) => {
  withDom(t);
  const pages = [], sizes = [];
  const pager = renderPager({ page: 2, pages: 4, size: 5, note: '17 rows', onPage: (n) => pages.push(n), onSize: (n) => sizes.push(n) });
  const select = pager.all((n) => n.tag === 'select')[0];
  assert.deepEqual(select.children.map((o) => o.value), ['5', '10', '25', '50']); assert.equal(select.value, '5');
  assert.match(pager.text, /17 rows · Page 2\/4/);
  button(pager, '← Previous').click(); button(pager, 'Next →').click(); button(pager, '4').click();
  assert.deepEqual(pages, [1, 3, 4]);
  assert.equal(button(pager, '2').attrs['aria-current'], 'page');
  select.change(25); assert.deepEqual(sizes, [25]);
  const first = renderPager({ page: 1, pages: 4, size: 5, onPage: () => {}, onSize: () => {} });
  assert.equal(button(first, '← Previous').disabled, true); assert.equal(button(first, 'Next →').disabled, false);
  const last = renderPager({ page: 4, pages: 4, size: 5, onPage: () => {}, onSize: () => {} });
  assert.equal(button(last, 'Next →').disabled, true);
});

test('pagination: a paged block starts at 5 rows, pages with Previous/Next, and keeps its state across redraws', (t) => {
  withDom(t);
  const items = Array.from({ length: 12 }, (_, i) => `row ${i + 1}`), state = {};
  const render = (a, b) => { const ul = new Element('ul'); for (const s of items.slice(a, b)) { const li = new Element('li'); li.textContent = s; ul.append(li); } return ul; };
  let block = paged(state, items.length, render);
  assert.deepEqual(rowsOf(block), items.slice(0, 5));
  button(block, 'Next →').click(); assert.deepEqual(rowsOf(block), items.slice(5, 10));
  button(block, '3').click(); assert.deepEqual(rowsOf(block), items.slice(10)); assert.equal(button(block, 'Next →').disabled, true);
  button(block, '← Previous').click(); assert.deepEqual(rowsOf(block), items.slice(5, 10));
  block.all((n) => n.tag === 'select')[0].change(10); assert.deepEqual(rowsOf(block), items.slice(0, 10), 'page 2 of 5 maps to page 1 of 10');
  block = paged(state, items.length, render); assert.deepEqual(rowsOf(block), items.slice(0, 10), 'a redraw keeps the chosen size and page');
});

const fixture = (n) => {
  const root = tmp('yaw-page-project-'), home = tmp('yaw-page-home-');
  mkdirSync(join(root, '.decisions'), { recursive: true });
  for (let i = 1; i <= n; i++) writeFileSync(join(root, '.decisions', `ADR-${String(i).padStart(4, '0')}.md`), `# ADR-${String(i).padStart(4, '0')}: Record ${String(i).padStart(2, '0')}\n\n- **Status:** Accepted\n\nBody ${i}.`);
  return { root, kitRoot: KIT_ROOT, env: { HOME: home, YAW_HOME: join(home, '.yaw') } };
};
const ask = (f, params) => knowledgeData({ ...f, params: new URLSearchParams(params) });

test('knowledge: pages hold 5 records by default, accept 10/25/50 and ignore other sizes', () => {
  const f = fixture(60);
  const first = ask(f, {}); assert.equal(first.entries.length, 5); assert.equal(first.pages, 12); assert.equal(first.total, 60);
  for (const size of [10, 25, 50]) assert.equal(ask(f, { pageSize: String(size) }).entries.length, size);
  assert.equal(ask(f, { pageSize: '7' }).entries.length, 5); assert.equal(ask(f, { pageSize: '1000' }).entries.length, 5);
  assert.equal(ask(f, { pageSize: '50', page: '2' }).entries.length, 10);
});

test('knowledge: the selected record and its preview stay correct when the page or the page size changes', () => {
  const f = fixture(30);
  const page1 = ask(f, {}), picked = page1.entries[2];
  for (const params of [{ page: '2' }, { page: '6' }, { page: '3', pageSize: '10' }, { pageSize: '50' }]) {
    const next = ask(f, { ...params, record: picked.key });
    assert.equal(next.record.key, picked.key, `preview survives ${JSON.stringify(params)}`);
    assert.match(next.record.content, /Body 3/);
  }
  assert.equal(ask(f, { page: '2', record: picked.key }).entries.some((r) => r.key === picked.key), false, 'the row is only listed on its own page');
  assert.equal(ask(f, { pageSize: '50', record: picked.key }).entries.some((r) => r.key === picked.key), true);
});

test('every listed view uses the shared pager and no view keeps its own', () => {
  const read = (p) => readFileSync(new URL(`../core/web/assets/${p}`, import.meta.url), 'utf8');
  const workspace = read('workspace.js'), global = read('global-view.js');
  assert.match(workspace, /from '\.\/pagination\.js'/); assert.match(global, /from '\.\/pagination\.js'/);
  assert.doesNotMatch(workspace, /function pager\(/, 'Knowledge uses renderPager');
  assert.doesNotMatch(global, /h\('div', \{ class: 'pager' \}/, 'Analytics tables use renderPager');
  assert.doesNotMatch(global, /pageSize = (15|20)|pageSize: 15/, 'no per-table page size other than the shared default');
  for (const call of ['workspace-sessions', 'workspace-tasks', 'workspace-task-list', 'map-areas']) {
    assert.match(workspace, new RegExp(`\\$\\('${call}'\\)\\.replaceChildren\\(.*paged`), `${call} is paged`);
  }
  assert.match(workspace, /renderPager\(/); assert.match(workspace, /pageSize/);
  for (const file of ['dashboard.js', 'form-server.js']) assert.match(readFileSync(new URL(`../core/web/${file}`, import.meta.url), 'utf8'), /pagination\.js/, `${file} serves pagination.js`);
});
