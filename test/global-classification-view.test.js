import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGlobalSettings } from '../core/web/assets/global-settings-view.js';

// Minimal DOM: enough to render the Global Settings Classification tab without a browser.
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.events = {}; this.style = {}; this.hidden = false; this.dataset = {}; this.classList = { add() {}, remove() {} }; this.value = ''; }
  append(...kids) { this.children.push(...kids); }
  replaceChildren(...kids) { this.children = kids; }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener(name, fn) { (this.events[name] ??= []).push(fn); }
  querySelectorAll() { return []; }
  get lastChild() { return this.children.at(-1); }
  get text() { return [this.textContent ?? '', ...this.children.map((n) => n instanceof Element ? n.text : String(n))].join(''); }
  all(test) { return [...(test(this) ? [this] : []), ...this.children.flatMap((n) => n instanceof Element ? n.all(test) : [])]; }
}

test('Classification tab renders without a temporal dead zone error on the link helper', async (t) => {
  const nodes = new Map();
  const byId = (id) => nodes.get(id) ?? (nodes.set(id, new Element('div')), nodes.get(id));
  const descriptors = new Map(['document', 'navigator'].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: { createElement: (tag) => new Element(tag), getElementById: byId, querySelectorAll: () => [], body: new Element('body') } },
    navigator: { configurable: true, value: {} },
  });
  t.after(() => { for (const [key, d] of descriptors) d ? Object.defineProperty(globalThis, key, d) : delete globalThis[key]; });

  const endpoint = 'http://127.0.0.1:8000';
  const defaults = { endpoint, threshold: 0.5, maxTurnBytes: 4000, maxLen: 512, timeoutSeconds: 10, prompt: 'Classify.' };
  const limits = { threshold: [0, 1], maxTurnBytes: [100, 65536], maxLen: [256, 65536], timeoutSeconds: [1, 300] };
  const get = async (name) => {
    if (name === 'preferences') return { classifier: { ...defaults }, defaults, limits };
    if (name === 'classifier-samples') return [];
    throw new Error(`unexpected ${name}`);
  };
  const reported = [];
  const ui = createGlobalSettings({ api: async () => ({}), get, report: (e) => reported.push(e), notifications: async () => {}, onFile: () => {} });
  ui.show('classification');
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(reported.map((e) => e.message), [], 'opening Classification must not throw');
  const root = byId('gs-classification');
  assert.ok(root.children.length >= 2, 'classification cards are rendered');
  assert.ok(root.all((n) => n.tag === 'a' && n.href === '#global-analytics').length >= 1, 'Analytics link is rendered');
});
