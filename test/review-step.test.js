import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderReview, filePurpose } from '../core/web/assets/review-step.js';
import { createProjectTree, fileTreeEntries, filesForStep } from '../core/web/assets/project-tree.js';

// A minimal DOM verifies the shared review interactions without a browser dependency.
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.events = {}; this.dataset = {}; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attrs[key] = value; }
  addEventListener(name, handler) { this.events[name] = handler; }
  fire(name) { return this.events[name]?.({ target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} }); }
  all(test) { return [...(test(this) ? [this] : []), ...this.children.flatMap((node) => node instanceof Element ? node.all(test) : [])]; }
  get text() { return [this.textContent ?? '', ...this.children.map((node) => node instanceof Element ? node.text : String(node))].join(' '); }
}
function fixture(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: (tag) => new Element(tag), createElementNS: (_ns, tag) => new Element(tag) } });
  t.after(() => previous ? Object.defineProperty(globalThis, 'document', previous) : delete globalThis.document);
  const root = new Element('div'), jumps = [];
  const questions = [
    { id: 'user.agents', label: 'Agents?', type: 'multi', choices: ['gemini'] },
    { id: 'user.expertise', label: 'Experience?', type: 'choice', choices: ['intermediate'] },
    { id: 'idea.text', label: 'Purpose?', type: 'text' },
    { id: 'arch.language', label: 'Language?', type: 'choice', choices: ['typescript'] },
    { id: 'arch.runs-on', label: 'Runtime?', type: 'choice', choices: ['local'] },
    { id: 'tasks.use-github', label: 'GitHub?', type: 'boolean' },
  ];
  const context = { questions, jump: (target) => jumps.push(target), modules: [{ name: 'core', title: 'Project rules', group: 'basics' }, { name: 'github', title: 'GitHub workflow', group: 'github' }],
    preview: { profile: 'node-cli', modules: ['core', 'github'], visible: questions.filter((q) => q.id !== 'user.expertise').map((q) => q.id), sources: {},
      answers: { 'user.agents': ['gemini'], 'user.expertise': 'intermediate', 'idea.text': 'A small app.', 'arch.language': 'typescript', 'arch.runs-on': 'local', 'tasks.use-github': true },
      files: [
        { path: 'AGENTS.md', module: 'core', action: 'create', excerpt: '<script>untrusted example</script>' },
        { path: '.yaw/manifest.json', module: 'core', action: 'write' },
        { path: '.github/ISSUE_TEMPLATE/bug.yml', module: 'github', action: 'create' },
        { path: 'src/main.js', module: 'profile:node-cli', action: 'kept', excerpt: 'export const value = 1;' },
      ] } };
  renderReview(root, context);
  const branch = (key) => root.all((node) => node.attrs['data-review-key'] === key)[0];
  const search = () => root.all((node) => node.attrs['aria-label'] === 'Search review')[0];
  return { root, context, jumps, branch, search };
}

test('review starts collapsed and shows the complete folder plan without content previews and covers every file, including stack-owned outputs', (t) => {
  const { root, branch } = fixture(t);
  for (const key of ['project', 'agents', 'workflow', 'tools', 'defaults']) assert.equal(branch(key).open, false, key);
  for (const detail of root.all((node) => node.tag === 'details')) assert.equal(detail.open, false);
  const paths = root.all((node) => node.attrs['data-review-file']).map((node) => node.attrs['data-review-file']);
  assert.deepEqual(paths.sort(), ['.github/ISSUE_TEMPLATE/bug.yml', '.yaw/manifest.json', 'AGENTS.md', 'src/main.js'].sort());
  assert.equal(root.all((node) => node.tag === 'script').length, 0);
  assert.ok(!root.text.includes('<script>untrusted example</script>'));
  assert.equal(root.all((node) => node.tag === 'pre').length, 0);
  assert.ok(root.text.includes('GitHub collaboration'));
  assert.ok(root.text.includes('Issue forms'));
  assert.equal(filePurpose('AGENTS.md'), 'Agent entry point'); assert.equal(filePurpose('justfile'), 'Project commands');
});

test('review search expands matching branches, survives redraws and restores manual expansion when cleared', (t) => {
  const { root, branch, search, context } = fixture(t);
  branch('project').children[0].fire('click'); branch('project').open = true;
  search().value = 'MAIN.JS'; search().fire('input');
  assert.equal(branch('project').hidden, true); assert.equal(branch('tools').open, true); assert.equal(branch('folder/src').open, true);
  renderReview(root, context); assert.equal(search().value, 'MAIN.JS'); assert.equal(branch('folder/src').open, true);
  search().value = 'no-such-result'; search().fire('input');
  assert.equal(root.all((node) => node.attrs.role === 'status' && node.textContent === 'No matches')[0].hidden, false);
  search().value = ''; search().fire('input');
  assert.equal(branch('project').open, true); assert.equal(branch('tools').open, false);
});

test('review pencil actions retain accessible names and jump to the relevant shared control', (t) => {
  const { root, jumps } = fixture(t);
  const edit = (name) => root.all((node) => node.tag === 'button' && node.attrs['aria-label'] === name)[0];
  edit('Edit Runtime').fire('click'); edit('Edit GitHub').fire('click'); edit('Edit GitHub workflow').fire('click');
  assert.deepEqual(jumps, [{ stack: true }, { question: 'tasks.use-github' }, { module: 'github' }]);
  assert.equal(edit('Edit Runtime').all((node) => node.tag === 'svg').length, 1);
  assert.equal(edit('Edit Runtime').text.trim(), '');
});


test('console shows only affected folders, shares review rows and previews full file text on selection', async (t) => {
  const { context } = fixture(t);
  const root = new Element('section'), requests = [];
  const content = Array.from({ length: 80 }, (_, index) => `Line ${index + 1}`).join('\n');
  const console = createProjectTree(root, { readFile: async (path) => { requests.push(path); return { path, content, source: 'Planned content' }; } });
  console.highlight({}, { question: 'arch.language' });
  console.update(context.preview.files);
  const rows = () => root.all((node) => node.attrs['data-review-file']);
  assert.deepEqual(rows().map((node) => node.attrs['data-review-file']), ['src/main.js']);
  assert.equal(root.all((node) => node.attrs['data-plan-folder'] === '.github').length, 0);
  assert.equal(root.all((node) => node.attrs['data-plan-folder'] === 'src')[0].open, true);
  assert.equal(root.all((node) => node.tag === 'h2')[0].text, 'Project structure');
  assert.equal(root.all((node) => node.tag === 'h2')[0].all((node) => node.tag === 'svg').length, 0);
  const clicked = rows()[0];
  await clicked.fire('click');
  assert.equal(rows()[0], clicked, 'file selection preserves the focused button');
  assert.deepEqual(requests, ['src/main.js']);
  assert.equal(root.all((node) => node.tag === 'pre')[0].textContent, content);
  const shared = fileTreeEntries(filesForStep(context.preview.files, { question: 'arch.language' }));
  assert.equal(shared[0].node.attrs.class, root.all((node) => node.attrs['data-plan-folder'] === 'src')[0].attrs.class);
  console.highlight({}, { question: 'idea.text' });
  assert.deepEqual(rows().map((node) => node.attrs['data-review-file']), ['AGENTS.md']);
  assert.equal(root.all((node) => node.tag === 'pre')[0].textContent, 'Select a file to preview its content.');
});

test('console ignores an obsolete file response after changing steps', async (t) => {
  const { context } = fixture(t), root = new Element('section');
  let complete;
  const console = createProjectTree(root, { readFile: () => new Promise((resolve) => { complete = resolve; }) });
  console.highlight({}, { question: 'arch.language' }); console.update(context.preview.files);
  const pending = root.all((node) => node.attrs['data-review-file'] === 'src/main.js')[0].fire('click');
  console.highlight({}, { question: 'idea.text' });
  complete({ content: 'Stale content', source: 'Planned content' }); await pending;
  assert.equal(root.all((node) => node.tag === 'pre')[0].textContent, 'Select a file to preview its content.');
});
