// T-036: optional features under Global → Settings → Features. "Settings Sync" is the Sync tab; "Profiling" is
// Classification (local Laya labels) plus the reviews of selected sessions. Off hides every way to reach them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { KIT_ROOT, tmp } from './helpers/fixtures.js';
import { createWorkspaceApi } from '../core/web/workspace-api.js';
import { readUserData } from '../core/lib/user-store.js';

const asset = (name) => readFileSync(join(KIT_ROOT, 'core/web/assets', name), 'utf8');

// Minimal DOM: enough to render the Features card and the Analytics page without a browser.
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
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('features: one route guard hides Settings Sync and every Profiling page, tab and link', async () => {
  const { FEATURE_ROUTES, featureOn, routeHidden, setFeatures } = await import('../core/web/assets/ui-state.js');
  try {
    assert.deepEqual(setFeatures({}), { sync: true, profiling: true }, 'both default to on (current behaviour)');
    for (const route of ['global-settings/sync', 'global-improve', 'global-settings/classification', 'global-settings/improve']) assert.equal(routeHidden(route), false, route);
    setFeatures({ sync: false, profiling: true });
    assert.equal(featureOn('sync'), false);
    assert.equal(routeHidden('#global-settings/sync?q=device'), true);
    assert.equal(routeHidden('global-improve'), false);
    setFeatures({ sync: true, profiling: false });
    for (const route of ['global-improve', 'global-improve?improveView=sessions', 'global-settings/classification', 'global-settings/improve']) assert.equal(routeHidden(route), true, route);
    // Server Mode (Features), Analytics and the other settings tabs stay reachable.
    for (const route of ['global-settings/sync', 'global-settings/features', 'global-settings', 'global-analytics', 'analytics', 'global-settings/sessions']) assert.equal(routeHidden(route), false, route);
    assert.deepEqual(Object.keys(FEATURE_ROUTES), ['sync', 'profiling']);
  } finally { setFeatures({}); }
});

test('features: the toggles are personal preferences, default on, validated and separate from Server Mode', async () => {
  const env = { HOME: realpathSync(tmp('yaw-feature-toggles-')) }, root = realpathSync(tmp('yaw-feature-root-'));
  const api = createWorkspaceApi({ env, root, kitRoot: KIT_ROOT });
  try {
    assert.deepEqual(api.get['/api/preferences']().features, { sync: true, profiling: true });
    assert.deepEqual(api.get['/api/global/features']().features, { sync: true, profiling: true });
    const saved = await api.action('features-save', { sync: false, profiling: false, workspace: root });
    assert.deepEqual(saved.features, { sync: false, profiling: false });
    assert.deepEqual(readUserData(env, 'web-preferences.json').features, { sync: false, profiling: false });
    assert.deepEqual(api.get['/api/preferences']().features, { sync: false, profiling: false });
    await assert.rejects(api.action('features-save', { sync: 'no', profiling: true }), /Settings Sync and Profiling/);
    assert.equal(api.get['/api/global/features']().remoteControl.enabled, false, 'Server Mode is untouched');
  } finally { api.close(); }
});

test('features: the Features card has Settings Sync and Profiling checkboxes; off hides their Settings tabs', async (t) => {
  const tabs = ['interview', 'classification', 'improve', 'sync', 'features'].map((tab) => { const b = new Element('button'); b.dataset.tab = tab; return b; });
  const byId = withDom(t, tabs);
  const { setFeatures } = await import('../core/web/assets/ui-state.js');
  t.after(() => setFeatures({}));
  const { createGlobalSettings } = await import('../core/web/assets/global-settings-view.js');
  const calls = [], applied = [];
  const get = async (name) => {
    if (name === 'global/features') return { remoteControl: { enabled: false, port: 4318 }, interfaces: ['127.0.0.1'], defaultInterface: '127.0.0.1', root: '/work', hubMigrated: false, folderSync: false, features: { sync: true, profiling: true } };
    throw new Error(`not loaded in this test: ${name}`);
  };
  const api = async (name, input) => { calls.push([name, input]); return name === 'features-save' ? { features: { sync: input.sync, profiling: input.profiling } } : {}; };
  const ui = createGlobalSettings({ api, get, report: () => {}, notifications: async () => {}, onFile: () => {}, onFeatures: (f) => { applied.push(f); setFeatures(f); } });
  assert.equal(ui.show('features'), 'features');
  await tick();
  const card = byId('gs-features');
  const toggle = (name) => card.all((n) => n.tag === 'label' && n.text.includes(name))[0]?.all((n) => n.tag === 'input' && n.type === 'checkbox')[0];
  assert.ok(toggle('Server mode'), 'Server mode stays');
  assert.equal(toggle('Settings Sync')?.checked, true, 'Settings Sync checkbox, on by default');
  assert.equal(toggle('Profiling')?.checked, true, 'one Profiling checkbox, on by default');
  assert.ok(!card.text.includes('Session Intelligence'));
  toggle('Profiling').checked = false;
  await card.all((n) => n.tag === 'button' && n.textContent === 'Save features')[0].click();
  assert.deepEqual(calls[0], ['features-save', { sync: true, profiling: false }]);
  assert.deepEqual(applied, [{ sync: true, profiling: false }]);
  assert.equal(calls[1][0], 'remote-settings', 'Server Mode is still saved as before');
  // Profiling off: Classification and Profiling Settings tabs are hidden and cannot be opened by route.
  assert.equal(ui.show('features'), 'features');
  const hidden = Object.fromEntries(tabs.map((b) => [b.dataset.tab, b.hidden]));
  assert.deepEqual(hidden, { interview: false, classification: true, improve: true, sync: false, features: false });
  assert.equal(ui.show('classification'), 'interview');
  assert.equal(ui.show('improve'), 'interview');
  setFeatures({ sync: false, profiling: true });
  assert.equal(ui.show('sync'), 'interview');
  assert.equal(tabs.find((b) => b.dataset.tab === 'sync').hidden, true);
  assert.equal(tabs.find((b) => b.dataset.tab === 'classification').hidden, false);
});

test('features: links to a hidden page are not shown anywhere', async (t) => {
  withDom(t);
  const { setFeatures } = await import('../core/web/assets/ui-state.js');
  t.after(() => setFeatures({}));
  const { link } = await import('../core/web/assets/settings-view.js');
  assert.equal(link('Edit in Classification', 'global-settings/classification').hidden, false);
  setFeatures({ profiling: false });
  assert.equal(link('Edit in Classification', 'global-settings/classification').hidden, true);
  assert.equal(link('Edit in Profiling Settings', 'global-settings/improve').hidden, true);
  assert.equal(link('Analytics', 'global-analytics').hidden, false);
});

test('features: Analytics names the table Classification; Profiling off hides the whole Classification block', async (t) => {
  const byId = withDom(t);
  const { setFeatures } = await import('../core/web/assets/ui-state.js');
  t.after(() => setFeatures({}));
  const { createGlobal } = await import('../core/web/assets/global-view.js');
  const row = { id: 's1', title: 'One', agent: 'claude', model: 'm', project: '/work/p', deviceId: 'local', deviceName: 'This device', language: 'javascript', started: Date.now() - 3600000,
    minutes: 5, prompts: 2, answers: 2, promptChars: 40, answerChars: 80, tokensIn: 10, tokensOut: 10, cost: null, medianResp: 2, p95Resp: 3, medianAnswer: 40, p95Answer: 50,
    outcome: 'success', evaluation: { classified: 2, counts: { outcome: { success: 2 } } } };
  const body = { available: true, rows: [row], projects: ['/work/p'], tasks: [], current: '/work/p', history: {}, savings: [] };
  const get = async (name) => name === 'sessions' ? body : name === 'preferences' ? { autoRefresh: false, classifier: { endpoint: 'http://127.0.0.1:8000' } } : null;
  const reported = [];
  const view = createGlobal({ get, api: async () => ({}), report: (e) => reported.push(e), openProject() {}, replace() {} });
  const page = () => ({
    tabs: byId('ss-browse').all((n) => n.tag === 'button' && n.attrs['aria-pressed'] !== undefined).map((n) => n.text),
    buttons: byId('ss-filter').all((n) => n.tag === 'button').map((n) => n.text),
    charts: byId('ss-charts').text,
  });
  for (const route of ['global-analytics', 'analytics']) {
    await view.show(route, 'table=outcomes');
    assert.deepEqual(reported, []);
    let shown = page();
    assert.ok(shown.tabs.includes('Classification'), `${route}: tables ${shown.tabs}`);
    assert.ok(!shown.tabs.includes('Outcomes'), `${route}: no Outcomes tab`);
    assert.ok(!shown.buttons.includes('Classify'), `${route}: Classify moved to the Profiling controller`);
    assert.match(shown.charts, /Experimental outcomes/);
    assert.match(byId('ss-browse').text, /Classified turns/, 'the Classification table opens from its old URL');
    setFeatures({ profiling: false });
    await view.show(route, 'table=outcomes');
    assert.deepEqual(reported, []);
    shown = page();
    assert.ok(!shown.tabs.includes('Classification') && !shown.tabs.includes('Outcomes'), `${route}: tables ${shown.tabs}`);
    assert.doesNotMatch(shown.charts, /outcomes/i);
    assert.doesNotMatch(byId('ss-browse').text, /Classified turns/, 'an old Classification URL falls back to Sessions');
    setFeatures({});
  }
});

test('features: the workspace applies the toggles to the sidebar, the router and the sidebar search; both pages have Features', () => {
  const workspace = asset('workspace.js');
  assert.match(workspace, /import \{[^}]*routeHidden[^}]*\} from '\.\/ui-state\.js'/);
  // Router: a hidden page falls back instead of opening (typed URL, link, back button).
  assert.match(workspace, /routeHidden\(sub \? `\$\{name\}\/\$\{sub\}` : name\)/);
  // Sidebar entries (the Profiling entries) and sidebar search hits follow the toggles.
  assert.match(workspace, /#side-nav \[data-route\]/);
  assert.match(workspace, /filter\(\(entry\) => !routeHidden\(entry\.route\)\)/);
  assert.match(workspace, /get\('preferences'\)[^\n]*applyFeatures/);
  for (const name of ['index.html', 'dashboard.html']) {
    const page = asset(name);
    assert.match(page, /data-tab="features">Features</, `${name}: Features tab`);
    assert.match(page, /id="gs-features"/, `${name}: Features panel`);
  }
});
