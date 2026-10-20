import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HEADER, YamlError, parse, parseDocument, stringify } from '../core/lib/yaml.js';
import { listExamples } from '../core/schema/validate.js';

const y = (lines) => lines.join('\n') + '\n';

test('block mappings, nested mappings and key order', () => {
  const v = parse(y(['a: 1', 'b:', '  c: x', '  d:', '    e: true', 'f: last']));
  assert.deepEqual(v, { a: 1, b: { c: 'x', d: { e: true } }, f: 'last' });
  assert.deepEqual(Object.keys(v), ['a', 'b', 'f']);
});

test('keys are always strings, quoted keys allowed', () => {
  assert.deepEqual(parse(y(['0.1: a', 'true: b', '"x y": c', "'z': d"])), { '0.1': 'a', true: 'b', 'x y': 'c', z: 'd' });
});

test('__proto__ is an ordinary key', () => {
  const v = parse('__proto__: 1\n');
  assert.equal(Object.getPrototypeOf(v), Object.prototype);
  assert.deepEqual(Object.keys(v), ['__proto__']);
});

test('block sequences: under a key at the same or deeper indent, compact forms', () => {
  assert.deepEqual(parse(y(['a:', '- 1', '- 2', 'b:', '  - x'])), { a: [1, 2], b: ['x'] });
  assert.deepEqual(parse(y(['- k: v', '  k2: v2', '- - a', '  - b', '-', '  n: 1', '- '])), [
    { k: 'v', k2: 'v2' },
    ['a', 'b'],
    { n: 1 },
    null,
  ]);
  assert.deepEqual(parse(y(['- key:', '  - x', '  other: y'])), [{ key: ['x'], other: 'y' }]);
});

test('scalars: plain, single-quoted, double-quoted with escapes', () => {
  const v = parse(y([
    'plain: hello world',
    'url: http://example.com/a#b',
    "single: 'it''s # not a comment'",
    'double: "tab\\tnl\\nq\\"bs\\\\sl\\/u\\u00e9"',
    'hash: a#b',
  ]));
  assert.deepEqual(v, {
    plain: 'hello world',
    url: 'http://example.com/a#b',
    single: "it's # not a comment",
    double: 'tab\tnl\nq"bs\\sl/ué',
    hash: 'a#b',
  });
});

test('typing follows the YAML 1.2 core schema', () => {
  const v = parse(y([
    'n1: null', 'n2: ~', 'n3:', 'n4: NULL',
    'b1: true', 'b2: False', 'b3: TRUE',
    'i1: 42', 'i2: -7', 'i3: 0o17', 'i4: 0x1F', 'i5: +3',
    'f1: 1.5', 'f2: -0.25', 'f3: 1e3', 'f4: .5', 'f5: 2.',
    's1: yes', 's2: no', 's3: on', 's4: off', 's5: y', 's6: 2026-10-20', 's7: 0.3.0', 's8: "42"', 's9: 1_000',
  ]));
  assert.deepEqual(v, {
    n1: null, n2: null, n3: null, n4: null,
    b1: true, b2: false, b3: true,
    i1: 42, i2: -7, i3: 15, i4: 31, i5: 3,
    f1: 1.5, f2: -0.25, f3: 1000, f4: 0.5, f5: 2,
    s1: 'yes', s2: 'no', s3: 'on', s4: 'off', s5: 'y', s6: '2026-10-20', s7: '0.3.0', s8: '42', s9: '1_000',
  });
  assert.ok(Object.is(parse('a: -0\n').a, 0));
});

test('flow collections: nested, multi-line, trailing comma, comments, empty', () => {
  const v = parse(y([
    'a: [1, "two", { k: v, n: [x, y] }]',
    'b: {}',
    'c: []',
    'd: [',
    '  one,   # first',
    '  two,',
    ']',
    'e: { "q": 1, url: http://x/y, empty: }',
  ]));
  assert.deepEqual(v, {
    a: [1, 'two', { k: 'v', n: ['x', 'y'] }],
    b: {},
    c: [],
    d: ['one', 'two'],
    e: { q: 1, url: 'http://x/y', empty: null },
  });
});

test('literal block scalars with chomping and trailing comment', () => {
  const v = parse(y([
    'clip: |   # comment after the indicator',
    '  line 1',
    '    indented',
    '',
    '  line 3',
    'strip: |-',
    '  x',
    '',
    'keep: |+',
    '  y',
    '',
    'next: 1',
  ]));
  assert.equal(v.clip, 'line 1\n  indented\n\nline 3\n');
  assert.equal(v.strip, 'x');
  assert.equal(v.keep, 'y\n\n');
  assert.equal(v.next, 1);
});

test('folded block scalars', () => {
  const v = parse(y([
    'f: >',
    '  a',
    '  b',
    '',
    '  c',
    '    more',
    '  d',
    'g: >-',
    '  one',
    '  two',
  ]));
  assert.equal(v.f, 'a b\nc\n  more\nd\n');
  assert.equal(v.g, 'one two');
});

test('block scalar in a sequence entry and at the end of the file', () => {
  assert.deepEqual(parse('- |\n  a\n  b\n- x\n'), ['a\nb\n', 'x']);
  assert.equal(parse('k: |\n  last').k, 'last\n');
});

test('comments, blank lines, BOM, CRLF and empty documents', () => {
  assert.deepEqual(parse('\ufeff# c\r\na: 1 # trailing\r\n\r\n  # indented comment\r\nb: 2\r\n'), { a: 1, b: 2 });
  assert.equal(parse(''), null);
  assert.equal(parse('# only a comment\n'), null);
  assert.equal(parse('just text\n'), 'just text');
});

test('parseDocument maps JSON pointers to source lines', () => {
  const { lines } = parseDocument(y(['# c', 'a:', '  b: [1,', '    2]', 'c:', '  - x: 1', '  - y', 'd/e~f: 1']));
  assert.equal(lines.get(''), 2);
  assert.equal(lines.get('/a'), 2);
  assert.equal(lines.get('/a/b'), 3);
  assert.equal(lines.get('/a/b/1'), 4);
  assert.equal(lines.get('/c/0'), 6);
  assert.equal(lines.get('/c/0/x'), 6);
  assert.equal(lines.get('/c/1'), 7);
  assert.equal(lines.get('/d~1e~0f'), 8);
});

const rejected = [
  ['anchor', 'a: &x 1', 1, /anchors/],
  ['alias', 'a: 1\nb: *x', 2, /aliases/],
  ['tag', 'a: !!str 1', 1, /tags/],
  ['tag in sequence', '- !foo x', 1, /tags/],
  ['anchor in flow', 'a: [&x 1]', 1, /anchors/],
  ['document start marker', '---\na: 1', 1, /document markers/],
  ['multi-document', 'a: 1\n---\nb: 2', 2, /document markers/],
  ['document end marker', 'a: 1\n...', 2, /document markers/],
  ['directive', '%YAML 1.2\na: 1', 1, /directives/],
  ['complex key', '? a\n: b', 1, /complex keys/],
  ['merge key', 'a: 1\n<<: {b: 2}', 2, /merge keys/],
  ['multi-line plain scalar', 'a: one\n  two', 2, /multi-line/],
  ['multi-line quoted scalar', 'a: "one\n  two"', 1, /multi-line quoted/],
  ['indentation indicator', 'a: |2\n  x', 1, /indentation indicators/],
  ['tab indentation', 'a:\n\tb: 1', 2, /tabs/],
  ['duplicate key', 'a: 1\nb: 2\na: 3', 3, /duplicate key "a"/],
  ['duplicate flow key', 'a: {x: 1, x: 2}', 1, /duplicate key "x"/],
  ['mapping on the key line', 'a: b: c', 1, /same line/],
  ['pair in flow sequence', 'a: [b: c]', 1, /flow sequences/],
  ['flow key', '[a]: b', 1, /after flow collection/],
  ['reserved indicator', 'a: @x', 1, /cannot start with "@"/],
  ['unknown escape', 'a: "\\q"', 1, /unsupported escape/],
  ['unterminated flow', 'a: [1, 2', 1, /unterminated flow/],
  ['non-finite number', 'a: .inf', 1, /\.inf/],
  ['unsafe integer', 'a: 123456789012345678901', 1, /safe range/],
  ['bad indentation', 'a:\n    b: 1\n  c: 2', 3, /indentation/],
  ['sequence where key expected', 'a: 1\n  - b', 2, /multi-line|indentation/],
];

for (const [name, src, line, re] of rejected) {
  test(`rejects ${name} with file and line`, () => {
    assert.throws(() => parse(src, { file: 'x.yaml' }), (e) => {
      assert.ok(e instanceof YamlError, e.message);
      assert.equal(e.file, 'x.yaml');
      assert.equal(e.line, line, e.message);
      assert.match(e.message, new RegExp(`^x\\.yaml:${line}: `));
      assert.match(e.message, re);
      return true;
    });
  });
}

test('emitter writes the header comment and block style', () => {
  const text = stringify({ a: 1, list: ['x', { k: 'v', n: [1, 2] }, ['p', 'q']], empty: [], none: {}, s: 'multi\nline\n', u: undefined });
  assert.equal(text, y([
    HEADER,
    'a: 1',
    'list:',
    '  - x',
    '  - k: v',
    '    n:',
    '      - 1',
    '      - 2',
    '  - - p',
    '    - q',
    'empty: []',
    'none: {}',
    's: |',
    '  multi',
    '  line',
  ]));
  assert.equal(stringify({ a: 1 }, { header: false }), 'a: 1\n');
});

test('emitter quotes strings that would change meaning', () => {
  const tricky = ['true', 'null', '~', '42', '1.5', '0x10', '', ' lead', 'trail ', 'a: b', 'a #b', '- x', '#x', '&a', '*a', '!t',
    '@x', '`x`', '[x]', '{x}', '"q"', "'q'", '%x', '...', '---', 'tab\there', 'cr\rhere', 'nul\u0000', 'emoji 😀', 'é',
    '  \n', '\n', 'x\n  \ny', ' first\nsecond', 'a\n\n\n', 'no trailing\nnewline', 'yes', 'on', '2026-10-20', 'x:', '\ud800'];
  for (const s of tricky) {
    const out = stringify({ s }, { header: false });
    assert.deepEqual(parse(out), { s }, `round trip of ${JSON.stringify(s)} via ${JSON.stringify(out)}`);
  }
  assert.equal(stringify({ s: 'yes' }, { header: false }), 's: yes\n');
  assert.equal(stringify({ s: 'true' }, { header: false }), 's: "true"\n');
});

test('emitter handles numbers, keys and unsupported values', () => {
  assert.deepEqual(parse(stringify({ big: 2 ** 60, neg: -0, f: 0.1, k: { 'a b': 1, '0.1': 2, '-x': 3 } })), {
    big: 2 ** 60, neg: 0, f: 0.1, k: { 'a b': 1, '0.1': 2, '-x': 3 },
  });
  assert.throws(() => stringify({ a: NaN }), TypeError);
  assert.throws(() => stringify({ a: () => 1 }), TypeError);
  assert.throws(() => stringify({ a: new Date(0) }), TypeError);
});

test('every YAML example round-trips through the emitter', () => {
  const files = listExamples().filter((e) => e.file.endsWith('.yaml'));
  assert.ok(files.length >= 10);
  for (const { file } of files) {
    const value = parse(readFileSync(file, 'utf8'), { file });
    const once = stringify(value);
    assert.ok(once.startsWith(`${HEADER}\n`));
    assert.deepEqual(parse(once, { file }), value, file);
    assert.equal(stringify(parse(once)), once, `${file}: emitting twice gives the same text`);
  }
});
