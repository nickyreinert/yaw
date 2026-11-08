import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changeFacet, facetOptions, matchesFacets, readFacets, facetsForScope, renderFacetBrowser, UNAVAILABLE } from '../core/web/assets/analytics-filters.js';
const rows = [
  { deviceId: 'local', project: '/work/apps/one', language: 'javascript', agent: 'codex', model: 'a' },
  { deviceId: 'local', project: '/work/apps/two', language: 'python', agent: 'claude', model: 'b' },
  { deviceId: 'other', project: '/work/archive/three', language: 'python', agent: 'codex', model: 'c' },
  { deviceId: 'remote', source: 'synced', project: 'synced:remote', agent: 'codex', model: 'd' },
];
test('column browser combines multiple values with OR and columns with AND', () => {
  const selection = { device: ['local', 'other'], agent: ['codex'], language: ['python', 'javascript'] };
  assert.deepEqual(rows.filter((r) => matchesFacets(r, selection, undefined, '/work')), [rows[0], rows[2]]);
  assert.equal(matchesFacets(rows[0], { folder: ['/work/app'] }, undefined, '/work'), false);
  assert.equal(matchesFacets(rows[0], { folder: ['/work/apps'] }, undefined, '/work'), true);
});
test('earlier choices update lists and prune only incompatible later selections', () => {
  const next = changeFacet(rows, { model: ['a', 'c'], agent: ['codex'] }, 'device', ['other'], '/work');
  assert.deepEqual(next.model, ['c']); assert.deepEqual(next.agent, ['codex']);
  assert.deepEqual([...facetOptions(rows, next, 'project', '/work').keys()], ['/work/archive/three']);
  assert.deepEqual(changeFacet(rows, next, 'device', [], '/work').model, ['c']);
});
test('synced rows never invent folder/project paths and repeated URL filters round-trip', () => {
  assert.equal(matchesFacets(rows[3], { project: [UNAVAILABLE] }), true);
  assert.equal(matchesFacets(rows[3], { folder: ['/work'] }), false);
  const selected = readFacets(new URLSearchParams('device=local&device=other&device=local&agent=codex&model='));
  assert.deepEqual(selected.device, ['local', 'other']); assert.deepEqual(selected.agent, ['codex']); assert.deepEqual(selected.model, []);
  const params = new URLSearchParams();
  for (const [key, values] of Object.entries(selected)) for (const value of values) params.append(key, value);
  assert.deepEqual(readFacets(params), selected);
});

test('workspace scope keeps agent/model filters and clears hidden global filters from old URLs', () => {
  assert.deepEqual(facetsForScope('workspace').map(([key]) => key), ['agent', 'model']);
  assert.deepEqual(facetsForScope().map(([key]) => key), ['device', 'folder', 'project', 'language', 'agent', 'model']);
  const params = new URLSearchParams('device=other&folder=/unrelated&project=/unrelated/old&language=python&agent=codex&model=a&model=c');
  const selection = readFacets(params, 'workspace');
  for (const key of ['device', 'folder', 'project', 'language']) assert.deepEqual(selection[key], []);
  assert.deepEqual(selection.agent, ['codex']);
  assert.deepEqual(selection.model, ['a', 'c']);
  assert.deepEqual(rows.filter((row) => matchesFacets(row, selection)), [rows[0], rows[2]]);
  assert.deepEqual([...facetOptions(rows, changeFacet(rows, selection, 'agent', ['claude']), 'model').keys()], ['b']);
});

test('list search is instant, case-insensitive and independent of session selection; queries survive redraws', (t) => {
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.events = {}; }
    append(...nodes) { this.children.push(...nodes); }
    setAttribute(key, value) { this.attrs[key] = value; }
    addEventListener(name, handler) { this.events[name] = handler; }
    fire(name) { this.events[name]({ target: this }); }
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: (tag) => new Element(tag) } });
  t.after(() => previous ? Object.defineProperty(globalThis, 'document', previous) : delete globalThis.document);
  const selection = { model: ['b'] }, searches = {}, changes = [];
  const context = { rows, selection, searches, label: (key, value) => key === 'project' ? value.split('/').at(-1) : value, onChange: (...change) => changes.push(change) };
  const find = (browser, title) => browser.children.find((field) => field.children[0].textContent === title);
  // controls are located by what they are (search box, option list, labelled checkbox), not by their position
  const searchOf = (column) => column.children.find((node) => node.type === 'search');
  const listOf = (column) => column.children.find((node) => node.className === 'facet-list');
  const labels = (list) => list.children.filter((node) => node.tag === 'label');
  const checkbox = (list, text) => labels(list).map((node) => node.children.find((c) => c.type === 'checkbox')).find((c) => c.attrs['aria-label'].endsWith(`: ${text}`));
  const emptyOf = (list) => list.children.find((node) => node.className === 'facet-empty');
  const model = find(renderFacetBrowser(context), 'Model');
  const search = searchOf(model), list = listOf(model);
  const visible = () => labels(list).filter((node) => !node.hidden).map((node) => node.children.find((c) => c.tag === 'span').textContent);
  search.value = ' A '; search.fire('input');
  assert.deepEqual(visible(), ['All', 'a']);
  assert.equal(checkbox(list, 'a').checked, false);
  assert.equal(checkbox(list, 'b').checked, true, 'hidden selected values remain selected');
  assert.deepEqual(selection, { model: ['b'] }); assert.deepEqual(changes, []);
  checkbox(list, 'a').checked = true; checkbox(list, 'a').fire('change');
  assert.deepEqual(changes, [['model', ['b', 'a']]], 'only an explicit checkbox selection changes the session filters');
  search.value = 'missing'; search.fire('input');
  assert.deepEqual(visible(), ['All']); assert.equal(emptyOf(list).hidden, false);
  assert.equal(searchOf(find(renderFacetBrowser(context), 'Model')).value, 'missing');
  search.value = ''; search.fire('input'); assert.deepEqual(visible(), ['All', 'a', 'b', 'c', 'd']);
  assert.equal(emptyOf(list).hidden, true);
  const projects = find(renderFacetBrowser(context), 'Projects');
  searchOf(projects).value = '/WORK/APPS/ONE'; searchOf(projects).fire('input');
  assert.deepEqual(labels(listOf(projects)).filter((node) => !node.hidden).map((node) => node.children.find((c) => c.tag === 'span').textContent), ['All', 'one'], 'full paths match even when labels show only project names');
});
