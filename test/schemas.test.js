import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, parseDocument } from '../core/lib/yaml.js';
import { EXAMPLES_DIR, SCHEMA_DIR, listExamples, loadSchemas, readData, validateFile } from '../core/schema/validate.js';

const set = loadSchemas();
const ROOT = join(SCHEMA_DIR, '..', '..');

test('every schema file loads, uses only supported keywords and resolves its refs', () => {
  const files = readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.schema.json'));
  assert.equal(set.schemas.size, files.length);
  for (const f of files) assert.equal(JSON.parse(readFileSync(join(SCHEMA_DIR, f), 'utf8')).$id, f);
});

test('every schema except the shared definitions has at least one example', () => {
  const withExamples = new Set(readdirSync(EXAMPLES_DIR));
  for (const id of set.schemas.keys()) {
    if (id === 'common.schema.json') continue;
    assert.ok(withExamples.has(id.replace('.schema.json', '')), `no examples for ${id}`);
  }
  for (const dir of withExamples) assert.ok(set.schemas.has(`${dir}.schema.json`), `examples/${dir} has no schema`);
});

for (const { schema, file } of listExamples()) {
  test(`example ${schema}/${file.slice(file.lastIndexOf('/') + 1)} validates`, () => {
    assert.deepEqual(validateFile(set, schema, file), []);
  });
}

test('required example sets exist', () => {
  const names = listExamples().map((e) => `${e.schema}/${e.file.slice(e.file.lastIndexOf('/') + 1)}`);
  for (const n of [
    'manifest/quick.json', 'manifest/standard.json',
    'module/core.yaml', 'module/security.yaml', 'item/session-hygiene.yaml',
    'profile/python-cli.yaml', 'profile/node-cli.yaml',
    'tasks/local.md', 'tasks/github-view.md', 'tasks/both.md',
  ]) assert.ok(names.includes(n), n);
});

// Each schema rejects at least one realistic mistake, reported with pointer and source line.
const negatives = [
  ['module', 'module/core.yaml', (t) => t.replace('tokenCost: low', 'tokenCost: high'), /:\d+: \/tokenCost must be one of/],
  ['module', 'module/core.yaml', (t) => t.replace('codex:   { support: native', 'codex:   { support: maybe'), /\/agents\/codex\/support/],
  ['module', 'module/core.yaml', (t) => t.replace('agents:\n', 'agents:\n  cursor: { support: native }\n'), /\/agents\/cursor unknown property/],
  ['module', 'module/core.yaml', (t) => t.replace('  - Run', '  - a\n  - b\n  - c\n  - d\n  - Run'), /\/agentsMd must match/],
  ['module', 'module/security.yaml', (t) => t.replace('kind: guard', 'kind: chatty'), /\/outputs\/hooks\/0\/kind/],
  ['item', 'item/session-hygiene.yaml', (t) => t.replace('tokenCost: none ', 'tokenCost: lots '), /\/tokenCost/],
  ['profile', 'profile/python-cli.yaml', (t) => t.replace('runsOn: [local]', 'runsOn: [moon]'), /\/suggestWhen\/runsOn/],
  ['profile', 'profile/python-web.yaml', (t) => t.replace('ui-design: auto', 'ui-design: maybe'), /\/defaults\/modules\/ui-design/],
  ['questions', 'questions/base.yaml', (t) => t.replace('mode: Q\n    type: multi', 'mode: X\n    type: multi'), /\/questions\/0\/mode/],
  ['questions', 'questions/base.yaml', (t) => t.replace('type: number', 'type: secret'), /\/questions\/8\/type/],
  ['questions', 'questions/base.yaml', (t) => t.replace('id: idea.text', 'id: vendors.api-token'), /\/questions\/4\/id must match/],
  ['answers', 'answers/quick-python.yaml', (t) => t.replace('idea.team: solo', 'vendors.password: x'), /\/answers\/vendors.password unknown property/],
  ['answers', 'answers/quick-python.yaml', (t) => t.replace('user.agents: [claude]', 'user.agents: [gemini]'), /\/answers\/user.agents\/0/],
  ['answers', 'answers/quick-python.yaml', (t) => t.replace('status: confirmed', 'status: maybe'), /\/proposal\/status/],
  ['user-profile', 'user-profile/user-profile.yaml', (t) => t.replace('user.length: brief', 'user.length: endless'), /\/answers\/user.length/],
  ['preset', 'preset/my-flask-default.yaml', (t) => t.replace('name: my-flask-default', 'name: My Preset'), /\/name must match/],
  ['capabilities', 'capabilities/capabilities.yaml', (t) => t.replace('phase: 1', 'phase: 4'), /\/agents\/claude\/phase/],
  ['config', 'config/config.yaml', (t) => t.replace('namespaces: [personal]', 'namespaces: personal'), /\/knowledge\/namespaces/],
  ['comfort', 'comfort/comfort.yaml', (t) => t.replace('drift: 0.9', 'drift: 9'), /\/hygiene\/drift must be <= 1/],
  ['comfort', 'comfort/comfort.yaml', (t) => t.replace('topic: replace-with-a-long-random-topic', 'topic: not a valid topic!'), /\/notify\/ntfy\/topic/],
  ['github', 'github/github.yaml', (t) => t.replace('color: a2eeef', 'color: blue'), /\/labels\/0\/color/],
];

for (const [schema, example, mutate, re] of negatives) {
  test(`${schema} schema rejects a broken ${example}`, () => {
    const file = join(EXAMPLES_DIR, example);
    const text = mutate(readFileSync(file, 'utf8'));
    assert.notEqual(text, readFileSync(file, 'utf8'), 'mutation did not apply');
    const { value, lines } = parseDocument(text, { file: example });
    const errors = set.validate(`${schema}.schema.json`, value, { lines });
    assert.ok(errors.length > 0);
    assert.ok(errors.every((e) => Number.isInteger(e.line)), 'every YAML error has a line');
    assert.match(errors.map((e) => `${example}:${e.line}: ${e.pointer} ${e.message}`).join('\n'), re);
  });
}

const jsonNegatives = [
  ['manifest', 'manifest/quick.json', (m) => { m.modules.tasks.mode = 'jira'; }, '/modules/tasks/mode'],
  ['manifest', 'manifest/quick.json', (m) => { delete m.modules.tasks.mode; }, '/modules/tasks'],
  ['manifest', 'manifest/quick.json', (m) => { m.files[0].path = '../outside'; }, '/files/0/path'],
  ['manifest', 'manifest/quick.json', (m) => { m.files[0].hash = 'md5:abc'; }, '/files/0/hash'],
  ['manifest', 'manifest/quick.json', (m) => { m.agents = ['gemini']; }, '/agents/0'],
  ['manifest', 'manifest/standard.json', (m) => { m.kit = 'v0.1'; }, '/kit'],
  ['hook-event', 'hook-event/codex-user-prompt-submit.json', (e) => { e.prompt = 'secret text'; }, '/prompt'],
  ['hook-event', 'hook-event/claude-pre-tool-use.json', (e) => { e.tool.input = { command: 'ls' }; }, '/tool/input'],
  ['hook-event', 'hook-event/claude-pre-tool-use.json', (e) => { e.event = 'BeforeTool'; }, '/event'],
  ['hook-event', 'hook-event/copilot-session-start.json', (e) => { delete e.modelId; }, ''],
];

for (const [schema, example, mutate, pointer] of jsonNegatives) {
  test(`${schema} schema rejects ${example} with ${pointer || '/'} broken`, () => {
    const data = JSON.parse(readFileSync(join(EXAMPLES_DIR, example), 'utf8'));
    mutate(data);
    const errors = set.validate(`${schema}.schema.json`, data);
    assert.ok(errors.some((e) => e.pointer === pointer), JSON.stringify(errors));
  });
}

test('tasks schema enforces IDs per mode', () => {
  const local = readData(join(EXAMPLES_DIR, 'tasks/local.md')).value;
  local.active[0].id = '#12';
  assert.ok(set.validate('tasks.schema.json', local).some((e) => e.pointer === '/active/0/id'));
  const view = readData(join(EXAMPLES_DIR, 'tasks/github-view.md')).value;
  view.active[0].issue = 41;
  assert.ok(set.validate('tasks.schema.json', view).some((e) => e.pointer === '/active/0/issue'));
  const both = readData(join(EXAMPLES_DIR, 'tasks/both.md')).value;
  both.active[0].status = 'done';
  assert.ok(set.validate('tasks.schema.json', both).some((e) => e.pointer === '/active/0/status'));
});

test('YAML examples in the concept docs validate (docs stay the source of truth)', () => {
  for (const [doc, schema] of [['kickoff/04-modules.md', 'module'], ['kickoff/05-profiles.md', 'profile'], ['kickoff/09-agents-and-adapters.md', 'item']]) {
    const block = /```yaml\n([\s\S]*?)```/.exec(readFileSync(join(ROOT, doc), 'utf8'))[1];
    const { value, lines } = parseDocument(block, { file: doc });
    assert.deepEqual(set.validate(`${schema}.schema.json`, value, { lines }), [], doc);
  }
});

test('profile option defaults are among their choices', () => {
  for (const { schema, file } of listExamples()) {
    if (schema !== 'profile') continue;
    for (const [name, o] of Object.entries(parse(readFileSync(file, 'utf8')).options ?? {})) {
      assert.ok(o.choices.includes(o.default), `${file}: options.${name}.default`);
    }
  }
});

test('no secret-looking values in examples and fixtures', () => {
  const secret = /(sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_|AKIA[0-9A-Z]{16}|xox[baprs]-|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
  for (const { file } of listExamples()) assert.doesNotMatch(readFileSync(file, 'utf8'), secret, file);
});

test('zero runtime dependencies and the Node floor', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.engines.node, '>=22.13');
});
