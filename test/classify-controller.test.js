// T-043: the shared filter bar only filters and refreshes; classification starts from its own controller on the
// Profiling pages (Global → Profiling and Workspace → Profiling): 5 / 10 / All sessions, a start button and a link
// to Profiling Settings. The controller reuses the existing selection: unclassified local sessions first, and the
// filtered local sessions only when everything is already classified.
import { test } from 'node:test';
import assert from 'node:assert/strict';

class Element {
  constructor(tag) {
    this.tag = tag; this.children = []; this.attrs = {}; this.events = {}; this.style = {}; this.dataset = {};
    this.hidden = false; this.value = ''; this.className = ''; this.textContent = ''; this.checked = false; this.disabled = false;
    this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
  }
  append(...kids) { this.children.push(...kids); }
  prepend(...kids) { this.children.unshift(...kids); }
  replaceChildren(...kids) { this.children = kids; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] ?? null; }
  removeAttribute(key) { delete this.attrs[key]; }
  addEventListener(name, fn) { (this.events[name] ??= []).push(fn); }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  closest() { return null; }
  get lastChild() { return this.children.at(-1); }
  get firstChild() { return this.children[0]; }
  get text() { return [this.textContent, ...this.children.map((n) => n instanceof Element ? n.text : String(n))].join(''); }
  all(match) { return [...(match(this) ? [this] : []), ...this.children.flatMap((n) => n instanceof Element ? n.all(match) : [])]; }
  async click() { for (const fn of this.events.click ?? []) await fn(); }
}
function withDom(t) {
  const nodes = new Map();
  const byId = (id) => nodes.get(id) ?? (nodes.set(id, new Element('div')), nodes.get(id));
  const keys = ['document', 'navigator', 'Node', 'window', 'confirm'];
  const saved = new Map(keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: { createElement: (tag) => new Element(tag), createElementNS: (_ns, tag) => new Element(tag), getElementById: byId,
      querySelectorAll: () => [], addEventListener() {}, body: new Element('body') } },
    navigator: { configurable: true, value: {} },
    Node: { configurable: true, value: Element },
    window: { configurable: true, value: { confirm: () => true, open() {} } },
    confirm: { configurable: true, value: () => true },
  });
  t.after(() => { for (const [key, d] of saved) d ? Object.defineProperty(globalThis, key, d) : delete globalThis[key]; });
  return byId;
}

const NOW = Date.now();
// Twelve local sessions, one per hour: s0 is the newest. s0-s2 and s11 are classified, s3-s10 are not. s5 is synced
// (cannot be classified here); s6 has no readable messages (prompts: null).
const rows = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, title: `Session ${i}`, agent: 'claude', model: 'm', project: '/work/p', deviceId: 'local', deviceName: 'This device',
  language: 'javascript', started: NOW - (i + 1) * 3600000, minutes: 5, prompts: i === 6 ? null : 2, answers: 2, promptChars: 40, answerChars: 80, tokensIn: 10, tokensOut: 10, cost: null,
  medianResp: 2, p95Resp: 3, medianAnswer: 40, p95Answer: 50, source: i === 5 ? 'synced' : 'local',
  ...(i <= 2 || i === 11 ? { outcome: 'success', evaluation: { classified: 2, skipped: 0, counts: { outcome: { success: 2 } } } } : {}) }));
const UNCLASSIFIED = ['s3', 's4', 's7', 's8', 's9', 's10'];

async function open(t, route, data = rows) {
  const byId = withDom(t);
  const { createGlobal } = await import('../core/web/assets/global-view.js');
  const body = { available: true, rows: data, projects: ['/work/p'], tasks: [], current: '/work/p', history: {}, savings: [] };
  const calls = [], reported = [];
  const get = async (name) => name === 'sessions' ? body : name === 'preferences' ? { autoRefresh: false, classifier: { endpoint: 'http://127.0.0.1:8000' } } : null;
  const api = async (name, input) => { calls.push({ name, input }); return { message: 'ok' }; };
  const view = createGlobal({ get, api, report: (e) => reported.push(e), openProject() {}, replace() {} });
  await view.show(route, route.endsWith('analytics') ? 'table=sessions' : '');
  assert.deepEqual(reported, []);
  return { byId, calls, view };
}
const buttons = (node) => node.all((n) => n.tag === 'button');
const named = (node, label) => buttons(node).find((n) => n.text === label);

test('the shared filter bar has no Classify, Classify unclassified or Classification settings control', async (t) => {
  for (const [route, slot] of [['global-analytics', 'ss-filter'], ['analytics', 'ss-filter'], ['global-improve', 'improve-filter'], ['profiling', 'improve-filter']]) {
    const { byId } = await open(t, route);
    const bar = byId(slot);
    const labels = [...buttons(bar).map((n) => n.text), ...bar.all((n) => n.tag === 'a').map((n) => n.text)];
    assert.ok(labels.includes('↻ Refresh'), `${route}: Refresh stays (${labels})`);
    assert.ok(labels.includes('Reset'), `${route}: Reset stays`);
    assert.ok(labels.some((l) => /Expand filters|Collapse filters/.test(l)), `${route}: filter toggle stays`);
    assert.deepEqual(labels.filter((l) => /classif/i.test(l)), [], `${route}: no classification control in the filter bar`);
  }
});

test('Profiling pages show a controller with 5 / 10 / All, a start button and a link to Profiling Settings', async (t) => {
  for (const route of ['global-improve', 'profiling']) {
    const { byId } = await open(t, route);
    const controller = byId('improve-classify');
    const sizes = buttons(controller).filter((n) => n.attrs['aria-pressed'] !== undefined);
    assert.deepEqual(sizes.map((n) => n.text), ['5', '10', 'All'], route);
    assert.equal(sizes.filter((n) => n.attrs['aria-pressed'] === 'true').length, 1, `${route}: one size is selected`);
    assert.ok(buttons(controller).some((n) => /^Classify /.test(n.text)), `${route}: start button`);
    assert.ok(controller.all((n) => n.tag === 'a' && n.attrs.href === '#global-settings/improve').length === 1, `${route}: link to Profiling Settings`);
  }
});

test('the controller classifies the newest 5 or 10 unclassified local sessions, and All means every one the existing logic selects', async (t) => {
  for (const route of ['global-improve', 'profiling']) {
    const { byId, calls } = await open(t, route);
    const start = () => buttons(byId('improve-classify')).find((n) => /^Classify |^Reclassify /.test(n.text));
    const size = (label) => named(byId('improve-classify'), label);
    // The default is the smallest size.
    await start().click();
    assert.deepEqual(calls.map((c) => c.name), ['evaluate'], route);
    assert.deepEqual(calls[0].input.ids, UNCLASSIFIED.slice(0, 5), `${route}: 5 newest unclassified; synced and unreadable sessions are never selected`);
    assert.equal(calls[0].input.confirm, true);
    await size('10').click();
    await start().click();
    assert.deepEqual(calls[1].input.ids, UNCLASSIFIED, `${route}: 10 is capped by what is unclassified`);
    await size('All').click();
    await start().click();
    assert.deepEqual(calls[2].input.ids, UNCLASSIFIED, `${route}: All = the existing unclassified selection`);
  }
});

test('when everything is classified, All reclassifies the filtered local sessions and 5 only the newest five', async (t) => {
  const done = rows.filter((r) => r.source !== 'synced' && r.prompts !== null).map((r) => ({ ...r, evaluation: { classified: 1, skipped: 0, counts: {} } }));
  const { byId, calls } = await open(t, 'global-improve', done);
  const start = () => buttons(byId('improve-classify')).find((n) => /^Classify |^Reclassify /.test(n.text));
  assert.match(start().text, /^Reclassify 5 /);
  await start().click();
  assert.deepEqual(calls[0].input.ids, done.slice(0, 5).map((r) => r.id));
  await named(byId('improve-classify'), 'All').click();
  assert.match(start().text, /^Reclassify 10 /);
  await start().click();
  assert.deepEqual(calls[1].input.ids, done.map((r) => r.id));
});
