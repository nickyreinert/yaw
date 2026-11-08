// T-034: one card layout. The five Coding Style cards sit in one grid in a logical order, question labels read
// "Category: question", and the stack step does not ask a stack question twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CARD_ORDER, orderCards } from '../core/interview/module-groups.js';
import { loadBaseQuestions, loadModule } from '../core/render/kit.js';
import { KIT_ROOT } from './helpers/fixtures.js';

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.classList = { add() {} }; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener() {}
  all(test) { return [...(test(this) ? [this] : []), ...this.children.flatMap((n) => n instanceof Element ? n.all(test) : [])]; }
}

test('the Coding Style cards share one grid in a logical order', async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: (tag) => new Element(tag), createElementNS: (_ns, tag) => new Element(tag), createTextNode: (text) => text } });
  t.after(() => previous ? Object.defineProperty(globalThis, 'document', previous) : delete globalThis.document);
  const { renderModuleGroups } = await import('../core/web/assets/setup-cards.js');
  const root = new Element('div');
  const unit = new Element('div'); unit.attrs['data-card'] = 'unit-tests';
  const modules = ['core', 'devenv', 'security'].map((name) => ({ name, title: name, group: 'basics', short: name }));
  renderModuleGroups(root, { modules, selected: modules.map((m) => m.name), answers: {}, questions: [], groupNodes: (g) => g === 'basics' ? [unit] : [], questionNodes: () => [], compact: true });
  const section = root.all((n) => n.tag === 'section' && n.attrs['aria-label'] === 'Coding Style')[0];
  const grids = section.all((n) => n.attrs.class === 'module-grid');
  assert.equal(grids.length, 1, 'one grid, no separate container for Unit Tests');
  const cards = grids[0].children.map((card) => card.all((n) => n.tag === 'code')[0]?.textContent ?? 'unit-tests');
  assert.deepEqual(cards, ['core', 'unit-tests', 'devenv', 'security']);
});

test('orderCards keeps unknown cards last, in their given order', () => {
  assert.deepEqual(CARD_ORDER.basics, ['core', 'unit-tests', 'devenv', 'security']);
  assert.deepEqual(orderCards('basics', ['x', 'security', 'core', 'y']), ['core', 'security', 'x', 'y']);
  assert.deepEqual(orderCards('github', ['b', 'a']), ['b', 'a']);
});

test('question labels read "Category: question"', () => {
  const modules = readdirSync(join(KIT_ROOT, 'modules'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const all = [...loadBaseQuestions(KIT_ROOT), ...modules.flatMap((m) => loadModule(KIT_ROOT, m).questions ?? [])];
  // Retired questions are never asked; Docker and Unit Tests are switches whose label is the card title.
  const switches = new Set(['arch.docker', 'quality.unit-tests']);
  const asked = all.filter((q) => q.mode !== 'F' && !switches.has(q.id));
  assert.ok(asked.length > 15);
  for (const q of asked) assert.match(q.label, /^[A-Z][^:?]{1,30}: \S/, `${q.id}: ${q.label}`);
});

test('the stack step asks language and destination once and nothing else about them', () => {
  const base = loadBaseQuestions(KIT_ROOT);
  const stack = base.filter((q) => q.help === 'stack').map((q) => q.id);
  assert.deepEqual(stack, ['arch.language', 'arch.runs-on']);
  const cards = readFileSync(join(KIT_ROOT, 'core/web/assets/setup-cards.js'), 'utf8');
  assert.match(cards, /CARD_QUESTIONS = new Set\(\['arch\.language', 'arch\.runs-on'/);
  // The generic list never repeats the two cards; the unsupported-pair message is the only second prompt.
  const view = readFileSync(join(KIT_ROOT, 'core/web/assets/interview-view.js'), 'utf8');
  assert.equal((view.match(/Choose a language and destination/g) ?? []).length, 0, 'one message, owned by the stack card');
});
