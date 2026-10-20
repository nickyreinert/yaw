import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KEYWORDS, SchemaError, SchemaSet, formatError } from '../core/lib/schema.js';
import { parseDocument } from '../core/lib/yaml.js';

const check = (schema, data) => new SchemaSet().add('t.json', schema).checkRefs().validate('t.json', data);
const ok = (schema, data) => assert.deepEqual(check(schema, data), [], JSON.stringify(data));
const bad = (schema, data, pointer, re) => {
  const errors = check(schema, data);
  assert.ok(errors.length > 0, `expected an error for ${JSON.stringify(data)}`);
  assert.equal(errors[0].pointer, pointer);
  if (re) assert.match(errors[0].message, re);
};

// One test per supported keyword (ADR-0005).
const perKeyword = {
  type: () => {
    ok({ type: 'integer' }, 3);
    bad({ type: 'integer' }, 3.5, '', /must be integer/);
    ok({ type: ['string', 'null'] }, null);
    bad({ type: 'object' }, [], '', /must be object/);
    bad({ type: 'number' }, '1', '');
    ok({ type: 'boolean' }, false);
    ok({ type: 'array' }, []);
  },
  enum: () => {
    ok({ enum: ['a', 1, null] }, null);
    bad({ enum: ['a', 'b'] }, 'c', '', /one of: "a", "b"/);
  },
  const: () => {
    ok({ const: { a: [1] } }, { a: [1] });
    bad({ const: 1 }, 2, '', /must be 1/);
  },
  minLength: () => {
    ok({ minLength: 2 }, 'ab');
    bad({ minLength: 2 }, '😀', '', /at least 2/);
  },
  maxLength: () => {
    ok({ maxLength: 1 }, '😀');
    bad({ maxLength: 1 }, 'ab', '', /at most 1/);
  },
  pattern: () => {
    ok({ pattern: '^T-[0-9]{3}$' }, 'T-012');
    bad({ pattern: '^T-[0-9]{3}$' }, 'T-12', '', /pattern/);
    ok({ pattern: 'x' }, 5); // only applies to strings
  },
  minimum: () => {
    ok({ minimum: 0 }, 0);
    bad({ minimum: 0 }, -1, '', />= 0/);
  },
  maximum: () => {
    ok({ maximum: 100 }, 100);
    bad({ maximum: 100 }, 101, '', /<= 100/);
  },
  items: () => {
    ok({ items: { type: 'string' } }, ['a', 'b']);
    bad({ items: { type: 'string' } }, ['a', 2], '/1');
  },
  minItems: () => {
    bad({ minItems: 1 }, [], '', /at least 1 items/);
  },
  maxItems: () => {
    bad({ maxItems: 1 }, [1, 2], '', /at most 1 items/);
  },
  uniqueItems: () => {
    ok({ uniqueItems: true }, [1, '1', { a: 1 }, { a: 2 }]);
    bad({ uniqueItems: true }, [{ a: 1, b: 2 }, { b: 2, a: 1 }], '/1', /duplicates item 0/);
  },
  properties: () => {
    ok({ properties: { a: { type: 'string' } } }, { a: 'x', b: 1 });
    bad({ properties: { a: { type: 'string' } } }, { a: 1 }, '/a');
  },
  required: () => {
    bad({ required: ['a', 'b'] }, { a: 1 }, '', /missing required property "b"/);
  },
  additionalProperties: () => {
    bad({ properties: { a: {} }, additionalProperties: false }, { a: 1, b: 2 }, '/b', /unknown property "b"/);
    bad({ additionalProperties: { type: 'integer' } }, { x: 'no' }, '/x');
  },
  patternProperties: () => {
    const s = { patternProperties: { '^x-': { type: 'string' } }, additionalProperties: false };
    ok(s, { 'x-a': 'v' });
    bad(s, { 'x-a': 1 }, '/x-a');
    bad(s, { y: 'v' }, '/y', /unknown property/);
    bad({ patternProperties: { secret: false } }, { 'my-secret': 1 }, '/my-secret', /not allowed/);
  },
  allOf: () => {
    bad({ allOf: [{ type: 'integer' }, { minimum: 5 }] }, 3, '', />= 5/);
  },
  anyOf: () => {
    const s = { anyOf: [{ type: 'boolean' }, { type: 'array', items: { type: 'boolean' } }] };
    ok(s, true);
    ok(s, [true]);
    bad(s, 'x', '', /does not match any allowed form/);
    // A single closest alternative is reported with its own, deeper pointer.
    bad({ anyOf: [{ type: 'string' }, { type: 'object', properties: { a: { enum: [1] } } }] }, { a: 2 }, '/a', /one of/);
  },
  oneOf: () => {
    const s = { oneOf: [{ type: 'integer' }, { minimum: 0 }] };
    ok(s, -1);
    bad(s, 1, '', /more than one/);
  },
  not: () => {
    ok({ not: { const: 'x' } }, 'y');
    bad({ not: { const: 'x' } }, 'x', '', /not allowed/);
  },
  $ref: () => {
    const s = { $defs: { id: { type: 'string' } }, properties: { a: { $ref: '#/$defs/id' } } };
    ok(s, { a: 'x' });
    bad(s, { a: 1 }, '/a');
  },
  $defs: () => {
    // $defs alone does not validate anything.
    ok({ $defs: { never: false } }, 1);
  },
};

test('every supported keyword has a test', () => {
  assert.deepEqual(Object.keys(perKeyword).sort(), [...KEYWORDS].sort());
});

for (const [name, fn] of Object.entries(perKeyword)) test(`keyword ${name}`, fn);

test('boolean schemas', () => {
  ok(true, 1);
  bad(false, 1, '', /not allowed/);
});

test('annotations are accepted and ignored', () => {
  ok({ $schema: 'x', $id: 't', $comment: 'c', title: 't', description: 'd', default: 1, examples: [1] }, 'anything');
});

test('unsupported keywords are rejected when the schema is added', () => {
  for (const k of ['format', 'if', 'propertyNames', 'exclusiveMinimum', 'minProperties', 'dependentRequired', 'prefixItems']) {
    assert.throws(() => new SchemaSet().add('t.json', { [k]: {} }), (e) => e instanceof SchemaError && e.message.includes(k));
  }
  assert.throws(() => new SchemaSet().add('t.json', { properties: { a: { typo: 1 } } }), /\/properties\/a\/typo/);
  assert.throws(() => new SchemaSet().add('t.json', { pattern: '(' }), /invalid pattern/);
  assert.throws(() => new SchemaSet().add('t.json', { type: 'date' }), /invalid type/);
});

test('cross-file $ref and unresolved refs', () => {
  const set = new SchemaSet()
    .add('common.json', { $defs: { name: { type: 'string', pattern: '^[a-z]+$' } } })
    .add('main.json', { properties: { n: { $ref: 'common.json#/$defs/name' }, all: { $ref: 'common.json' } } })
    .checkRefs();
  assert.deepEqual(set.validate('main.json', { n: 'abc' }), []);
  assert.equal(set.validate('main.json', { n: 'ABC' })[0].pointer, '/n');
  assert.throws(() => new SchemaSet().add('m.json', { $ref: 'missing.json#/x' }).checkRefs(), /unknown schema "missing.json"/);
  assert.throws(() => new SchemaSet().add('m.json', { $ref: '#/$defs/nope' }).checkRefs(), /does not resolve/);
});

test('errors carry the JSON pointer and the YAML source line', () => {
  const schema = {
    type: 'object',
    required: ['name', 'list'],
    properties: {
      name: { type: 'string' },
      list: { type: 'array', items: { type: 'object', properties: { k: { enum: ['a'] } }, required: ['k'] } },
      'a/b': { type: 'integer' },
    },
    additionalProperties: false,
  };
  const text = ['# comment', 'name: 1', 'list:', '  - k: a', '  - k: b', '  - other: 1', 'a/b: x', 'extra: 1', ''].join('\n');
  const { value, lines } = parseDocument(text, { file: 'f.yaml' });
  const errors = new SchemaSet().add('s.json', schema).validate('s.json', value, { lines });
  const got = errors.map((e) => formatError(e, 'f.yaml'));
  assert.deepEqual(got, [
    'f.yaml:2: /name must be string',
    'f.yaml:5: /list/1/k must be one of: "a"',
    'f.yaml:6: /list/2 missing required property "k"',
    'f.yaml:7: /a~1b must be integer',
    'f.yaml:8: /extra unknown property "extra"',
  ]);
  const missing = new SchemaSet().add('s.json', schema).validate('s.json', parseDocument('\nname: x\n').value, {
    lines: parseDocument('\nname: x\n').lines,
  });
  assert.deepEqual(missing.map((e) => formatError(e, 'g.yaml')), ['g.yaml:2: / missing required property "list"']);
});

test('without a line map the error has line null', () => {
  const [e] = check({ type: 'string' }, 1);
  assert.equal(e.line, null);
  assert.equal(formatError(e, 'x.json'), 'x.json: / must be string');
});
