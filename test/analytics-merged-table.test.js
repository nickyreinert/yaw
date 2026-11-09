// T-039: Analytics shows one Sessions table with the former "Lengths & timing" columns; unmeasured sessions stay listed.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Minimal DOM: enough to render the Analytics page without a browser.
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
function withDom(t, tabs = []) {
  const nodes = new Map();
  const byId = (id) => nodes.get(id) ?? (nodes.set(id, new Element('div')), nodes.get(id));
  const saved = new Map(['document', 'navigator', 'Node', 'window'].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: { createElement: (tag) => new Element(tag), createElementNS: (_ns, tag) => new Element(tag), getElementById: byId,
      querySelectorAll: (selector) => selector.startsWith('#global-settings-tabs') ? tabs : [], addEventListener() {}, body: new Element('body') } },
    navigator: { configurable: true, value: {} },
    Node: { configurable: true, value: Element },
    window: { configurable: true, value: { confirm: () => true, open() {} } },
  });
  t.after(() => { for (const [key, d] of saved) d ? Object.defineProperty(globalThis, key, d) : delete globalThis[key]; });
  return byId;
}

test('Analytics: Sessions and Lengths & timing are one table; unmeasured sessions are marked, not dropped', async (t) => {
  const byId = withDom(t);
  const { createGlobal } = await import('../core/web/assets/global-view.js');
  const base = { agent: 'claude', model: 'm', project: '/work/p', deviceId: 'local', deviceName: 'This device', language: 'javascript', started: Date.now() - 3600000, minutes: 5, tokensIn: 10, tokensOut: 10, cost: null };
  const rows = [
    { ...base, id: 's1', title: 'Measured', prompts: 2, answers: 2, promptChars: 40, answerChars: 80, medianResp: 2, p95Resp: 3, medianAnswer: 40, p95Answer: 50 },
    { ...base, id: 's2', title: 'Unscanned', prompts: null, answers: null, promptChars: null, answerChars: null, medianResp: null, p95Resp: null, medianAnswer: null, p95Answer: null },
  ];
  const body = { available: true, rows, projects: ['/work/p'], tasks: [], current: '/work/p', history: {}, savings: [] };
  const get = async (name) => name === 'sessions' ? body : name === 'preferences' ? { autoRefresh: false, classifier: { endpoint: 'http://127.0.0.1:8000' } } : null;
  const reported = [];
  const view = createGlobal({ get, api: async () => ({}), report: (e) => reported.push(e), openProject() {}, replace() {} });
  for (const route of ['global-analytics', 'analytics']) {
    for (const query of ['table=sessions', 'table=lengths']) {
      await view.show(route, query);
      assert.deepEqual(reported, []);
      const browse = byId('ss-browse');
      const tabs = browse.all((n) => n.tag === 'button' && n.attrs['aria-pressed'] !== undefined).map((n) => n.text);
      assert.ok(tabs.includes('Sessions') && !tabs.includes('Lengths & timing'), `${route}: tabs ${tabs}`);
      assert.ok(tabs.includes('Agents') && tabs.includes('Models'), 'Agents & Models stay');
      const heads = browse.all((n) => n.tag === 'th').map((n) => n.text);
      for (const col of ['Session', 'Started', 'Agent', 'Language', 'Model', 'Prompts', 'Answers', 'Tokens in', 'Tokens out', 'Elapsed', 'Cost',
        'Chars / prompt', 'Answer chars median', 'Answer chars p95', 'Response s median', 'Response s p95', 'Answer chars total', 'Coverage']) {
        assert.ok(heads.some((x) => x.startsWith(col)), `${route} ${query}: column ${col} in ${heads}`);
      }
      const trs = browse.all((n) => n.tag === 'tr' && n.all((c) => c.tag === 'td').length > 0);
      assert.equal(trs.length, 2, 'every session is a row');
      assert.match(trs.find((r) => r.text.includes('Unscanned')).text, /not measured/);
      assert.match(trs.find((r) => r.text.includes('Measured')).text, /complete/);
    }
  }
});
