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
  assert.equal(host.all((n) => n.tag === 'input' && n.attrs.type === 'number').length, 0);
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

test('changing Review with keeps the page and shows a sensitive-data warning', async (t) => {
  const { host, context } = environment(t);
  const view = createInsights({ api: async () => response });
  view.render(host, context);
  await button(host, 'Read conversation →').fire('click');
  await button(host, 'Review this conversation →').fire('click');
  assert.match(host.text, /sensitive data/); assert.doesNotMatch(host.text, /Actionable review options/);
  const before = host.children, select = field(host, 'Review destination');
  select.value = 'browser:Claude'; await select.fire('change');
  assert.equal(host.children, before, 'no full redraw, so the page does not jump to the top');
  assert.ok(host.all((n) => n.tag === 'a' && n.text === 'Open Claude ↗').length);
});

test('a workspace profiling view lists sessions without folder navigation', (t) => {
  const { host, context } = environment(t);
  const view = createInsights({ api: () => { throw new Error('No transcript read'); } });
  view.render(host, { ...context, view: 'folders', workspace: true });
  assert.equal(field(host, 'View'), undefined); assert.equal(button(host, '← Back'), undefined);
  assert.match(host.text, /Fix parser/);
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

test('a View switch replaces the Projects and Sessions buttons', (t) => {
  const { host, context } = environment(t);
  let changes;
  const view = createInsights({ api: () => { throw new Error('No transcript read'); } });
  view.render(host, { ...context, view: 'folders', set: (next) => { changes = next; } });
  assert.ok(field(host, 'View'), 'labelled View switch');
  assert.equal(button(host, 'Projects'), undefined); assert.equal(button(host, 'Sessions'), undefined);
  assert.equal(button(host, 'Folder Browser').attrs['aria-pressed'], 'true');
  assert.equal(button(host, 'All Sessions').attrs['aria-pressed'], 'false');
  button(host, 'All Sessions').fire('click');
  assert.deepEqual(changes, { improveView: 'sessions' });
});

test('Folder Browser walks the project hierarchy and Back always returns one level', (t) => {
  const { host, context } = environment(t);
  const calls = [], tables = [];
  const mk = (id, project) => ({ ...row, id, title: `Title ${id}`, project });
  const rows = [mk('a', '/w/app/api'), mk('b', '/w/app/web'), mk('c', '/w/tools'), mk('d', '/w/app')];
  const view = createInsights({ api: () => { throw new Error('No transcript read'); } });
  const render = (at) => view.render(host, { ...context, view: 'folders', rows, root: '/w', at, set: (next) => calls.push(next),
    table: (id, columns, list) => { tables.push(id); return context.table(id, columns, list); } });
  render('');
  assert.ok(button(host, 'app/') && button(host, 'tools'), 'top level lists folders and projects');
  assert.equal(button(host, '← Back').disabled, true, 'nothing above the top level');
  assert.doesNotMatch(host.text, /Title a/, 'sessions appear only inside their project');
  button(host, 'app/').fire('click');
  assert.deepEqual(calls.at(-1), { improveAt: '/w/app' });
  render('/w/app');
  assert.ok(button(host, 'api') && button(host, 'web'), 'sub-projects listed');
  assert.match(host.text, /Title d/, 'sessions of the folder that is itself a project');
  assert.ok(tables.includes('improve-folder-sessions'));
  button(host, '← Back').fire('click');
  assert.deepEqual(calls.at(-1), { improveAt: '' });
  render('/w/app/api');
  assert.match(host.text, /Title a/); assert.doesNotMatch(host.text, /Title b/);
  button(host, '← Back').fire('click');
  assert.deepEqual(calls.at(-1), { improveAt: '/w/app' }, 'one level up, not to the top');
  render('/gone');
  assert.match(host.text, /Nothing here/); button(host, '← Back').fire('click');
  assert.deepEqual(calls.at(-1), { improveAt: '' }, 'a stale location can still be left');
});

test('Folder Browser and All Sessions show the same sessions for the same filters', (t) => {
  const { host, context } = environment(t);
  const rows = [{ ...row, title: 'Alpha', project: '/w/p' }, { ...row, id: 'x', title: 'Beta', project: '/w/p' }];
  const view = createInsights({ api: () => { throw new Error('No transcript read'); } });
  view.render(host, { ...context, rows, view: 'sessions', focus: 'all' });
  const flat = host.text;
  view.render(host, { ...context, rows, view: 'folders', focus: 'all', root: '/w', at: '/w/p' });
  for (const title of ['Alpha', 'Beta']) { assert.match(flat, new RegExp(title)); assert.match(host.text, new RegExp(title)); }
  assert.match(host.text, /Needs attention/); assert.match(flat, /Needs attention/);
});

test('Read Conversation drills down into the conversation in place of the list; Back returns without changing the page', async (t) => {
  const { host, context } = environment(t);
  let sets = 0;
  const view = createInsights({ api: async () => response });
  view.render(host, { ...context, set: () => { sets++; } });
  assert.equal(host.all((n) => n.tag === 'aside').length, 0);
  await button(host, 'Read conversation →').fire('click');
  const aside = host.all((n) => n.tag === 'aside' && n.attrs['aria-label'] === 'Conversation preview')[0];
  assert.ok(aside, 'conversation level');
  assert.equal(host.all((n) => n.tag === 'table').length, 0, 'the list is replaced');
  assert.equal(field(host, 'Signal'), undefined, 'list filters are hidden on the conversation level');
  assert.match(aside.text, /I changed the renderer/);
  await button(host, '← Back to sessions').fire('click');
  assert.equal(host.all((n) => n.tag === 'aside').length, 0);
  assert.equal(sets, 0, 'Back never navigates');
  assert.match(host.text, /Fix parser/);
});

test('the Signal filter narrows the session list to one saved label', (t) => {
  const { host, context } = environment(t);
  const calm = { ...row, id: 'codex:calm', title: 'Calm session', evaluation: { classified: 1, skipped: 0, counts: { sentiment: { aggressive: 1 } } } };
  const view = createInsights({ api: () => { throw new Error('No transcript read'); } });
  view.render(host, { ...context, rows: [row, calm], focus: 'all' });
  assert.match(host.text, /Fix parser/); assert.match(host.text, /Calm session/);
  button(host, 'Aggressive (1)').fire('click');
  assert.doesNotMatch(host.text, /Fix parser/); assert.match(host.text, /Calm session/);
  button(host, 'Admitted error (1)').fire('click');
  assert.match(host.text, /Fix parser/); assert.doesNotMatch(host.text, /Calm session/);
});

test('the conversation Show filter keeps matching turns with one turn of context and counts the hidden messages', async (t) => {
  const { host, context } = environment(t);
  const messages = [1, 2, 3, 4, 5].flatMap((turn) => [
    { index: (turn - 1) * 2, turn, role: 'user', text: `ask ${turn}`, highlights: [] },
    { index: (turn - 1) * 2 + 1, turn, role: 'assistant', text: turn === 5 ? 'Sorry, my mistake' : `answer ${turn}`, highlights: turn === 5 ? [{ start: 0, end: 5, kind: 'admission', reason: 'Possible admission' }] : [] }]);
  const view = createInsights({ api: async () => ({ sessions: [{ id: row.id, turns: 5, candidates: [], messages }] }) });
  view.render(host, context);
  await button(host, 'Read conversation →').fire('click');
  await button(host, 'Apology / mistake (1)').fire('click');
  assert.doesNotMatch(host.text, /ask 3/); assert.match(host.text, /ask 4/); assert.match(host.text, /my mistake/);
  assert.match(host.text, /… 6 messages hidden …/);
  assert.equal(button(host, 'Corrections (0)').disabled, true);
  await button(host, 'All (10)').fire('click');
  assert.match(host.text, /ask 1/); assert.doesNotMatch(host.text, /hidden/);
});

test('the session preview is a reusable component for any session list', async (t) => {
  const { host } = environment(t);
  const { createSessionPreview } = await import('../core/web/assets/session-preview.js');
  let changes = 0, closed = 0;
  const preview = createSessionPreview({ api: async (action, input) => { assert.equal(action, 'insights-review'); assert.deepEqual(input.ids, [row.id]); return response; },
    onChange: () => { changes++; host.replaceChildren(preview.layout(new Element('table'))); }, onClose: () => { closed++; }, rel: (s) => s, extra: () => new Element('div') });
  assert.equal(preview.isOpen(), false);
  await preview.open(row);
  assert.equal(preview.isOpen(), true); assert.equal(preview.row, row); assert.ok(preview.session.messages.length);
  assert.match(host.text, /My mistake/);
  preview.close();
  assert.equal(preview.isOpen(), false); assert.equal(closed, 1);
  assert.doesNotMatch(host.text, /My mistake/);
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
  assert.doesNotMatch(host.text, /Saved verdicts|No saved verdicts|Save this verdict|Import a verdict|Set retention/);
  assert.ok(!calls.some((c) => /history/.test(c.action)), 'a review never touches stored history');
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

test('Profiling explains UNKNOWN causes and tells users how to update older results', (t) => {
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

test('folder levels list the next folders or projects, keep other sessions at the top, and walk up one level', async () => {
  const { folderLevel, folderParent } = await import('../core/web/assets/insights-model.js');
  const at = (project, extra = {}) => ({ id: project, project, source: 'local', started: 1, ...extra });
  const rows = [at('/w/a/x'), at('/w/a/y'), at('/w/a'), at('/w/b'), at('/other/z'), at('', { id: 's', source: 'synced', deviceName: 'Laptop' })];
  const top = folderLevel(rows, '', '/w');
  assert.deepEqual(top.kids.map((k) => [k.name, k.rows.length, k.deeper]).sort(), [['/other/z', 1, false], ['Synced · Laptop', 1, false], ['a', 3, true], ['b', 1, false]]);
  assert.deepEqual(top.direct, []);
  const inside = folderLevel(rows, '/w/a', '/w');
  assert.deepEqual(inside.kids.map((k) => k.name).sort(), ['x', 'y']); assert.deepEqual(inside.direct.map((r) => r.id), ['/w/a']);
  assert.deepEqual(folderLevel(rows, 'Synced · Laptop', '/w').direct.map((r) => r.id), ['s']);
  assert.equal(folderParent('/w/a/x', '/w'), '/w/a'); assert.equal(folderParent('/w/a', '/w'), ''); assert.equal(folderParent('/other/z', '/w'), ''); assert.equal(folderParent('Synced · Laptop', '/w'), '');
});
