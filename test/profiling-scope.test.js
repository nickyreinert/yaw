// T-042: "Learn" is now Profiling, available globally and inside a workspace through the same components.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { KIT_ROOT } from './helpers/fixtures.js';

const read = (path) => readFileSync(join(KIT_ROOT, path), 'utf8');
const asset = (name) => read(`core/web/assets/${name}`);

// Minimal DOM: enough to render the Profiling page without a browser (same shape as test/feature-toggles.test.js).
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
}
function withDom(t) {
  const nodes = new Map();
  const byId = (id) => nodes.get(id) ?? (nodes.set(id, new Element('div')), nodes.get(id));
  const saved = new Map(['document', 'navigator', 'Node', 'window'].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  Object.defineProperties(globalThis, {
    document: { configurable: true, value: { createElement: (tag) => new Element(tag), createElementNS: (_ns, tag) => new Element(tag), getElementById: byId,
      querySelectorAll: () => [], addEventListener() {}, activeElement: null, body: new Element('body') } },
    navigator: { configurable: true, value: {} },
    Node: { configurable: true, value: Element },
    window: { configurable: true, value: { confirm: () => true, open() {} } },
  });
  t.after(() => { for (const [key, d] of saved) d ? Object.defineProperty(globalThis, key, d) : delete globalThis[key]; });
  return byId;
}

test('Learn is gone as a feature name from menus, labels, settings, docs and the site', () => {
  const files = ['index.html', 'dashboard.html', 'workspace.js', 'global-view.js', 'global-settings-view.js', 'insights-view.js', 'settings-view.js'].map((f) => `core/web/assets/${f}`)
    .concat(['core/web/global-settings.js', 'core/web/improve-agents.js', 'core/web/README.md', 'docs/workspace-dashboard.md', 'README.md', 'website/index.html']);
  for (const file of files) {
    // The slogan "Define. Run. Learn." is about the product loop, not the feature.
    const text = read(file).replaceAll('Define. Run. Learn.', '');
    assert.doesNotMatch(text, /\bLearn(ing)?\b/, `${file} still names the feature Learn`);
  }
  for (const name of ['index.html', 'dashboard.html']) {
    const page = asset(name);
    assert.match(page, /data-route="global-improve">[\s\S]{0,400}<\/svg><\/span> Profiling<\/button>/, `${name}: global menu entry`);
    assert.match(page, /<h1 tabindex="-1">Profiling<\/h1>/, `${name}: page heading`);
    assert.match(page, /data-tab="improve">Profiling Settings</, `${name}: settings tab`);
    assert.match(page, /data-tab="classification">Classification</, `${name}: Classification stays the process`);
  }
});

test('the workspace menu has a Profiling entry that the Profiling feature toggle controls', async () => {
  for (const name of ['index.html', 'dashboard.html']) {
    const nav = asset(name).split('<nav id="side-nav"')[1].split('</nav>')[0];
    const [workspace, global] = nav.split('<span class="nav-label">GLOBAL</span>');
    assert.match(workspace, /data-route="profiling"[^>]*>[\s\S]*Profiling<\/button>/, `${name}: Workspace → Profiling`);
    assert.match(global, /data-route="global-improve"/, `${name}: Global → Profiling`);
    assert.ok(workspace.indexOf('data-route="analytics"') < workspace.indexOf('data-route="profiling"'), `${name}: next to Analytics`);
  }
  const { FEATURE_ROUTES, routeHidden, setFeatures } = await import('../core/web/assets/ui-state.js');
  try {
    assert.ok(FEATURE_ROUTES.profiling.includes('profiling'));
    assert.equal(routeHidden('profiling?agent=claude'), false);
    setFeatures({ profiling: false });
    for (const route of ['profiling', 'profiling?improveView=sessions', 'global-improve']) assert.equal(routeHidden(route), true, route);
    assert.equal(routeHidden('analytics'), false);
  } finally { setFeatures({}); }
  // The workspace route shares the Global page section instead of adding a second one, and it no longer aliases Analytics.
  const workspace = asset('workspace.js');
  assert.match(workspace, /const SECTIONS = \{[^}]*profiling: 'global-improve'/);
  assert.match(workspace, /const views = \[[^\]]*'profiling'/);
  assert.match(workspace, /GLOBAL_VIEWS = \[[^\]]*'profiling'/);
  assert.doesNotMatch(workspace, /profiling: 'global-analytics'/);
});

test('Profiling uses one component: the workspace route shows only the open workspace, the global route all', async (t) => {
  const byId = withDom(t);
  const { createGlobal } = await import('../core/web/assets/global-view.js');
  const row = (id, project, title) => ({ id, title, agent: 'claude', model: 'm', project, deviceId: 'local', deviceName: 'This device', language: 'javascript', started: Date.now() - 3600000,
    minutes: 5, prompts: 2, answers: 2, promptChars: 40, answerChars: 80, tokensIn: 10, tokensOut: 10, cost: null, medianResp: 2, p95Resp: 3, medianAnswer: 40, p95Answer: 50,
    outcome: 'success', evaluation: { classified: 2, counts: { outcome: { success: 2 } } } });
  const body = { available: true, rows: [row('a', '/work/p', 'Mine one'), row('b', '/work/p', 'Mine two'), row('c', '/work/other', 'Elsewhere')], projects: ['/work/p', '/work/other'], tasks: [], current: '/work/p', history: {}, savings: [] };
  const get = async (name) => name === 'sessions' ? body : name === 'preferences' ? { autoRefresh: false, classifier: { endpoint: 'http://127.0.0.1:8000' } } : name === 'improve/settings' ? { enabledAgents: [] } : null;
  const reported = [], urls = [];
  const view = createGlobal({ get, api: async () => ({}), report: (e) => reported.push(e), openProject() {}, replace: (u) => urls.push(u) });
  const bar = () => byId('improve-filter').text;
  await view.show('global-improve', 'improveView=sessions&improveFocus=all');
  assert.deepEqual(reported, []);
  assert.match(bar(), /3 sessions/);
  assert.match(byId('improve-content').text, /Elsewhere/);
  await view.show('profiling', 'improveView=sessions&improveFocus=all');
  assert.deepEqual(reported, []);
  assert.match(bar(), /2 sessions/, 'only the open workspace');
  assert.match(byId('improve-content').text, /Mine one/);
  assert.doesNotMatch(byId('improve-content').text, /Elsewhere/);
  assert.equal(urls.at(-1), '#profiling?improveView=sessions&improveFocus=all', 'the workspace page keeps its own URL');
});
