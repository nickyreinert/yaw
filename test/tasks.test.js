import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { READ_ONLY_NOTICE, TasksError, parseTasks, parseTasksDocument, renderTasks } from '../core/lib/tasks.js';
import { EXAMPLES_DIR } from '../core/schema/validate.js';

const example = (name) => readFileSync(join(EXAMPLES_DIR, 'tasks', name), 'utf8');

for (const name of ['local.md', 'both.md', 'github-view.md', 'with-rules.md']) {
  test(`${name} round-trips (text -> ledger -> text)`, () => {
    const text = example(name);
    const ledger = parseTasks(text);
    assert.equal(renderTasks(ledger), text);
    assert.deepEqual(parseTasks(renderTasks(ledger)), ledger);
  });
}

test('local example: the doc 10 §2 ledger', () => {
  const l = parseTasks(example('local.md'));
  assert.equal(l.readOnly, false);
  assert.equal(l.archive, 'TASKS.archive.md');
  assert.deepEqual(l.active[0], {
    id: 'T-012',
    title: 'Online invite flow',
    status: 'in progress',
    progress: 60,
    brief: 'Host creates 9-digit token, guest joins with token + name.',
    model: 'strong / high',
    spec: 'docs/plan/invite-flow.md · Issue #34 · ADR-0004',
    resume: 'Signaling server done and tested; next: guest join screen (`src/ui/join.ts`).',
    journal: [
      { date: '2026-10-19', text: 'server token generation + expiry, tests green' },
      { date: '2026-10-20', text: 'WebRTC handshake via PeerJS, manual test OK' },
    ],
  });
  assert.deepEqual(l.backlog, [
    { id: 'T-013', title: 'Prop mode: book → shield', note: 'small / cheap · docs/plan/props.md' },
    { id: 'T-014', title: 'Sound effects', note: 'small / cheap' },
  ]);
});

test('both mode: T-NNN with the linked issue number', () => {
  const l = parseTasks(example('both.md'));
  assert.equal(l.active[0].id, 'T-012');
  assert.equal(l.active[0].issue, 34);
  assert.equal(l.backlog[0].issue, 35);
  assert.equal(l.backlog[1].issue, undefined);
});

test('GitHub view: read-only notice, issue numbers as IDs', () => {
  const l = parseTasks(example('github-view.md'));
  assert.equal(l.readOnly, true);
  assert.equal(l.active[0].id, '#41');
  assert.equal(l.active[0].status, 'in review');
  assert.equal(l.active[0].journal, undefined);
  assert.ok(renderTasks(l).includes(READ_ONLY_NOTICE));
});

test('empty ledger renders and parses', () => {
  const empty = { readOnly: false, active: [], backlog: [] };
  assert.equal(renderTasks(empty), '# Tasks\n\n## Active\n\n## Backlog\n');
  assert.deepEqual(parseTasks(renderTasks(empty)), empty);
});

test('line map points at headings, fields and journal lines', () => {
  const { lines } = parseTasksDocument(example('local.md'));
  assert.equal(lines.get('/active/0'), 4);
  assert.equal(lines.get('/active/0/resume'), 8);
  assert.equal(lines.get('/active/0/journal/1'), 11);
  assert.equal(lines.get('/backlog/1'), 15);
  assert.equal(lines.get('/archive'), 17);
});

const broken = [
  ['missing title', '## Active\n', 1, /# Tasks/],
  ['unknown section', '# Tasks\n\n## Active\n## Doing\n', 4, /unknown section/],
  ['backlog before active', '# Tasks\n\n## Backlog\n', 3, /must follow "## Active"/],
  ['bad heading', '# Tasks\n\n## Active\n### T-001 no status\n', 4, /### <id> <title> — <status>/],
  ['unknown field', '# Tasks\n\n## Active\n### T-001 A — todo\n- **Owner:** me\n', 5, /unknown field "Owner"/],
  ['duplicate field', '# Tasks\n\n## Active\n### T-001 A — todo\n- **Brief:** a\n- **Brief:** b\n', 6, /duplicate field/],
  ['stray text', '# Tasks\n\n## Active\n### T-001 A — todo\nfree text\n', 5, /unexpected line in task T-001/],
  ['bad journal line', '# Tasks\n\n## Active\n### T-001 A — todo\n- **Journal:**\n  - yesterday\n', 6, /YYYY-MM-DD/],
  ['text after done', '# Tasks\n\n## Active\n\n## Backlog\n\n## Done → A.md\nmore\n', 8, /nothing may follow/],
  ['missing backlog', '# Tasks\n\n## Active\n', 3, /missing "## Backlog"/],
];

for (const [name, text, line, re] of broken) {
  test(`rejects ${name} with file and line`, () => {
    assert.throws(() => parseTasks(text, { file: 'TASKS.md' }), (e) => {
      assert.ok(e instanceof TasksError);
      assert.equal(e.line, line, e.message);
      assert.match(e.message, new RegExp(`^TASKS\\.md:${line}: `));
      assert.match(e.message, re);
      return true;
    });
  });
}

test('rules and model lines (#175): kept verbatim, model and effort per backlog item', () => {
  const { value: l, lines } = parseTasksDocument(example('with-rules.md'));
  assert.deepEqual(l.rules, [
    '1. **Track:** `just task start <id>` moves an item to Active as "in progress".',
    '2. **Model and effort:** every item names a suggested model tier and reasoning effort.',
  ]);
  assert.equal(l.active[0].model, 'sonnet · effort: medium');
  assert.deepEqual(l.backlog, [
    { id: 'T-022', title: 'Sound effects', note: 'docs/plan/sound.md', model: 'haiku', effort: 'low' },
    { id: 'T-023', title: 'Release notes', model: 'opus' },
  ]);
  assert.equal(lines.get('/rules'), 3);
  assert.equal(lines.get('/backlog/0/model'), 15);
});

test('rules and model lines: errors name the line', () => {
  const cases = [
    ['rules after Active', '# Tasks\n\n## Active\n\n## How to work with this file\n\n1. x\n\n## Backlog\n', 5, /must come before "## Active"/],
    ['empty rules', '# Tasks\n\n## How to work with this file\n\n## Active\n\n## Backlog\n', 3, /rules section is empty/],
    ['only rules', '# Tasks\n\n## How to work with this file\n\n1. x\n', 5, /missing "## Active"/],
    ['heading inside rules', '# Tasks\n\n## How to work with this file\n\n### x\n', 5, /heading inside the rules/],
    ['model line first', '# Tasks\n\n## Active\n\n## Backlog\n  model: opus\n', 6, /under a backlog line/],
    ['bad effort', '# Tasks\n\n## Active\n\n## Backlog\n- T-001 A\n  model: opus · effort: huge\n', 7, /effort must be one of low, medium, high, xhigh, max/],
    ['two model lines', '# Tasks\n\n## Active\n\n## Backlog\n- T-001 A\n  model: opus\n  model: haiku\n', 8, /duplicate model line for T-001/],
  ];
  for (const [name, text, line, reason] of cases) {
    assert.throws(() => parseTasks(text, { file: 'TASKS.md' }), (e) => e instanceof TasksError && e.line === line && reason.test(e.reason), name);
  }
});

test('priority (T-029): a backlog "priority:" line and an active "Priority" field round-trip; only P0 to P3 parse', () => {
  const text = '# Tasks\n\n## Active\n### T-001 A — in progress\n- **Priority:** P0\n- **Model / effort:** opus · effort: high\n\n## Backlog\n- T-002 B\n  priority: P3\n  model: haiku · effort: low\n';
  const ledger = parseTasks(text);
  assert.equal(ledger.active[0].priority, 'P0');
  assert.deepEqual(ledger.backlog[0], { id: 'T-002', title: 'B', priority: 'P3', model: 'haiku', effort: 'low' });
  assert.equal(renderTasks(ledger), text);
  assert.throws(() => parseTasks('# Tasks\n\n## Active\n\n## Backlog\n- T-001 A\n  priority: urgent\n'), (e) => e instanceof TasksError && e.line === 7 && /priority must be one of P0, P1, P2, P3/.test(e.reason));
  assert.throws(() => parseTasks('# Tasks\n\n## Active\n\n## Backlog\n- T-001 A\n  priority: P1\n  priority: P2\n'), (e) => e instanceof TasksError && /duplicate priority line for T-001/.test(e.reason));
});
