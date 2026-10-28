import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInsights } from '../core/web/assets/insights-view.js';

// Minimal DOM for interaction-state tests, without a browser dependency or access to real session history.
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.events = {}; this.style = {}; }
  append(...kids) { this.children.push(...kids); }
  replaceChildren(...kids) { this.children = kids; }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener(name, fn) { (this.events[name] ??= []).push(fn); }
  async fire(name) { for (const fn of this.events[name] ?? []) await fn({ target: this }); }
  get text() { return [this.textContent ?? '', ...this.children.map((n) => n instanceof Element ? n.text : String(n))].join(''); }
  all(test) { return [...(test(this) ? [this] : []), ...this.children.flatMap((n) => n instanceof Element ? n.all(test) : [])]; }
  querySelector(selector) { return this.all((n) => Object.hasOwn(n.attrs, selector.slice(1, -1)))[0]; }
  scrollIntoView() {}
}
const button = (root, text) => root.all((n) => n.tag === 'button' && n.text === text)[0];
const field = (root, label) => root.all((n) => n.attrs['aria-label'] === label)[0];
const row = { id: 'codex:demo', source: 'local', title: 'Fix parser', agent: 'codex', model: 'Example', project: '/private/demo', started: Date.now(), prompts: 2, answers: 2, promptChars: 100,
  evaluation: { classified: 2, skipped: 0, counts: { behaviour: { admits_error: 1 }, outcome: { fulfilled: 1, unknown: 1 } } } };
const response = { sessions: [{ id: row.id, turns: 2, candidates: [
  { turn: 2, reasons: ['Possible admission or apology'], notes: [], excerpt: 'user: Parser please. assistant: My mistake.' },
], messages: [
  { index: 0, turn: 1, role: 'user', text: 'Fix /Users/example/parser.js', highlights: [] },
  { index: 1, turn: 1, role: 'assistant', text: 'I changed the renderer.', highlights: [] },
  { index: 2, turn: 2, role: 'user', text: 'Parser please.', highlights: [] },
  { index: 3, turn: 2, role: 'assistant', text: 'My mistake. Fixed.', highlights: [{ start: 0, end: 10, kind: 'admission', reason: 'Possible admission' }] },
] }] };
function environment(t) {
  const descriptors = new Map(['document', 'confirm', 'navigator'].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  let clipboard = '';
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: { createElement: (tag) => new Element(tag) } },
    confirm: { configurable: true, writable: true, value: () => true },
    navigator: { configurable: true, value: { clipboard: { writeText: async (text) => { clipboard = text; } } } },
  });
  t.after(() => { for (const [key, d] of descriptors) d ? Object.defineProperty(globalThis, key, d) : delete globalThis[key]; });
  const host = new Element('article');
  const context = { rows: [row], scope: 'workspace', period: 'Last 30 days', view: 'sessions', focus: 'attention', rel: (s) => s, set: () => {},
    table: (_id, columns, rows) => {
      const table = new Element('table');
      for (const r of rows) for (const c of columns) table.append(c.show ? c.show(r) : String(c.value(r)));
      return table;
    }, settings: { enabledAgents: [], defaultTarget: 'browser:ChatGPT', agents: [] } };
  return { host, context, clipboard: () => clipboard };
}

test('Improve starts from saved classified sessions and opens the actual highlighted conversation in one action', async (t) => {
  const { host, context, clipboard } = environment(t);
  let calls = 0;
  const view = createInsights({ api: async (action, input) => { calls++; assert.equal(action, 'insights-review'); assert.equal(input.conversation, true); assert.equal(input.confirm, true); return response; } });
  view.render(host, context);
  assert.equal(calls, 0, 'browsing saved labels never reads transcripts');
  assert.match(host.text, /Fix parser/);
  assert.match(host.text, /Needs attention/);
  await button(host, 'Read conversation →').fire('click');
  assert.equal(calls, 1);
  assert.match(host.text, /I changed the renderer/); assert.match(host.text, /My mistake/);
  assert.doesNotMatch(host.text, /Users\/example/);
  assert.equal(host.all((n) => n.tag === 'mark' && n.attrs.title === 'Possible admission').length, 1);
  assert.equal(host.all((n) => n.tag === 'input' && ['number', 'checkbox'].includes(n.attrs.type)).length, 0);
  await button(host, 'Review this conversation →').fire('click');
  const prompt = field(host, 'Review prompt');
  assert.match(prompt.value, /150 words maximum/); assert.match(prompt.value, /Parser please/);
  const link = host.all((n) => n.tag === 'a' && n.text === 'Open ChatGPT ↗')[0];
  assert.equal(link.attrs.href, 'https://chatgpt.com/'); assert.equal(link.attrs.rel, 'noopener noreferrer');
  prompt.value = 'Edited and redacted review'; await prompt.fire('input');
  await button(host, 'Copy review prompt').fire('click');
  assert.equal(clipboard(), 'Edited and redacted review');
  view.render(host, { ...context, scope: 'changed-project' });
  assert.equal(field(host, 'Review prompt'), undefined); assert.doesNotMatch(host.text, /My mistake/);
});

test('discarded reviews ignore in-flight conversation results after changing filters', async (t) => {
  const { host, context } = environment(t);
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  const view = createInsights({ api: () => waiting });
  view.render(host, context);
  const read = button(host, 'Read conversation →').fire('click');
  view.render(host, { ...context, scope: 'another-project' });
  release(response); await read;
  assert.equal(field(host, 'Review prompt'), undefined);
  assert.doesNotMatch(host.text, /I changed the renderer/);
});

test('project selection uses the same table sorting contract and narrows to that project’s sessions', (t) => {
  const { host, context } = environment(t);
  let changes, table;
  const view = createInsights({ api: () => { throw new Error('No transcript read'); } });
  view.render(host, { ...context, view: 'projects', set: (next) => { changes = next; }, table: (id, columns, rows, options) => {
    table = { id, columns, rows, options }; const node = new Element('div'); node.append(columns[0].show(rows[0])); return node;
  } });
  assert.equal(table.id, 'improve-projects'); assert.equal(table.options.sort, 'attention');
  button(host, '/private/demo').fire('click');
  assert.deepEqual(changes, { project: '/private/demo', improveView: 'sessions' });
});

test('a configured installed CLI receives only the inspected prompt and renders its temporary verdict', async (t) => {
  const { host, context } = environment(t), calls = [];
  const view = createInsights({ api: async (action, input) => {
    calls.push({ action, input });
    if (action === 'insights-review') return response;
    if (action === 'improve-agent-start') return { id: 'review-1', agent: 'claude', status: 'completed', output: 'Verdict: Possible scope confusion.', message: 'Review complete.' };
    return null;
  } });
  view.render(host, { ...context, settings: { enabledAgents: ['claude'], defaultTarget: 'cli:claude', agents: [{ id: 'claude', name: 'Claude Code', installed: true }] } });
  await button(host, 'Read conversation →').fire('click');
  await button(host, 'Review this conversation →').fire('click');
  field(host, 'Review prompt').value = 'Inspected, redacted prompt'; await field(host, 'Review prompt').fire('input');
  await button(host, 'Run review with CLI').fire('click');
  assert.deepEqual(calls.find((c) => c.action === 'improve-agent-start').input, { agent: 'claude', prompt: 'Inspected, redacted prompt', confirm: true });
  assert.match(host.text, /Verdict: Possible scope confusion/);
  field(host, 'Review prompt').value = 'Changed evidence'; await field(host, 'Review prompt').fire('input');
  assert.doesNotMatch(host.text, /Verdict: Possible scope confusion/);
  assert.equal(calls.at(-1).action, 'improve-agent-clear');
});

test('chart splitting uses the selected series rather than ignoring the shared split control', (t) => {
  const { host, context } = environment(t);
  const view = createInsights({ api: () => { throw new Error('Metadata only'); } });
  const other = { ...row, id: 'claude:other', agent: 'claude' };
  view.render(host, { ...context, rows: [row, other], series: { keys: ['codex', 'claude'], keyOf: (r) => r.agent, color: () => '#173e49' } });
  const bars = host.all((n) => n.className === 'improve-stacked-bar');
  assert.ok(bars.length > 0);
  assert.equal(bars[0].children.length, 2);
  assert.equal(bars[0].children[0].style.width, '50%');
});

test('Learn explains UNKNOWN causes and tells users how to update older results', (t) => {
  const { host, context } = environment(t);
  const fresh = { ...row, evaluation: { classified: 3, skipped: 0, counts: { outcome: { unknown: 3 } }, outcomeUnknown: { model: 1, lowConfidence: 2 } } };
  const view = createInsights({ api: () => { throw new Error('Metadata only'); } });
  view.render(host, { ...context, rows: [row, fresh] });
  assert.match(host.text, /Each label estimates one request and its response/);
  assert.match(host.text, /Unknown: 1 model uncertain · 2 below confidence threshold/);
  assert.match(host.text, /1 reason unavailable from older or synced results/);
  assert.match(host.text, /Reclassify local sessions to update/);
  view.render(host, { ...context, rows: [fresh] });
  assert.doesNotMatch(host.text, /reason unavailable/);
});
