// Kickoff guidance (#173): planning prompt, plan parser, `yaw kickoff [import <plan.md> [--dry-run]]`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { main } from '../core/cli/main.js';
import { kickoffGuide, kickoffPrompt, parsePlan, PlanError } from '../core/lib/kickoff.js';
import { parseTasks } from '../core/lib/tasks.js';
import { KIT_ROOT, capture, scripted, tmp } from './helpers/fixtures.js';

const EXAMPLE = join(KIT_ROOT, 'examples', 'node-cli', 'answers.yaml');
const NODE_ONLY = [dirname(process.execPath), '/usr/bin', '/bin'].join(':');

async function yaw(args, cwd) {
  const stdout = capture();
  const stderr = capture();
  const code = await main(args, { stdout, stderr, cwd, env: { PATH: NODE_ONLY, HOME: tmp('yaw-home-') }, kitRoot: KIT_ROOT, prompter: { ...scripted(), interactive: false } });
  return { code, out: stdout.text(), err: stderr.text() };
}

const PLAN = `# Plan: Photo renamer

Some intro text.

## Phase 1: Walking skeleton
model: sonnet · effort: medium
Goal: a CLI that runs.

- [ ] Add the CLI entry point
- [ ] Read EXIF dates (model: opus · effort: high)
- [ ] Write the README
  model: haiku · effort: low
- [x] Already done
  model: opus · effort: max

\`\`\`
- [ ] not a task, inside a code block
\`\`\`

## Phase 2 - Polish
- [ ] Add --dry-run
* Handle missing dates
`;

test('parsePlan: phases, phase model, task overrides, sub-lines, code blocks, done items', () => {
  assert.deepEqual(parsePlan(PLAN), [
    { phase: 'Walking skeleton', title: 'Add the CLI entry point', model: 'sonnet', effort: 'medium' },
    { phase: 'Walking skeleton', title: 'Read EXIF dates', model: 'opus', effort: 'high' },
    { phase: 'Walking skeleton', title: 'Write the README', model: 'haiku', effort: 'low' },
    { phase: 'Polish', title: 'Add --dry-run' },
    { phase: 'Polish', title: 'Handle missing dates' },
  ]);
});

test('parsePlan: a plan without tasks or with a bad effort is refused', () => {
  assert.throws(() => parsePlan('# Plan\n\nJust prose.\n- [ ] a task before any phase\n'), PlanError);
  assert.throws(() => parsePlan('## Phase 1: X\nmodel: opus · effort: huge\n- [ ] t\n'), /effort "huge" must be one of low, medium, high, xhigh, max/);
});

test('kickoffPrompt: carries the idea, the stack and the task store; asks for the parseable format', () => {
  const p = kickoffPrompt({ answers: { 'idea.text': 'Rename photos.', 'arch.language': 'javascript', 'arch.runs-on': 'auto', 'idea.team': 'solo' }, summary: 'node-cli - Node CLI', tasksMode: 'github' });
  assert.match(p, /Idea:\nRename photos\.\n/);
  assert.match(p, /- Stack: node-cli - Node CLI\n- Language: javascript\n- Team: solo\n- Work items become GitHub issues/);
  assert.doesNotMatch(p, /Runs on/);
  assert.match(p, /## Phase 1: <phase name>\nmodel: <tier> · effort: <effort>/);
  assert.match(p, /low, medium, high, xhigh, max/);
  // the format the prompt asks for is the one the parser reads
  const example = p.slice(p.indexOf('# Plan:')).replaceAll('<tier>', 'opus').replaceAll('<effort>', 'high');
  assert.equal(parsePlan(example).length, 2);
  assert.match(kickoffGuide({ hasTasks: false }).join('\n'), /yaw add tasks/);
});

async function project({ tasks = true } = {}) {
  const dir = tmp('yaw-kick-');
  const file = join(tmp('yaw-ans-'), 'answers.yaml');
  writeFileSync(file, readFileSync(EXAMPLE, 'utf8').replace('modules: [core]', tasks ? 'modules: [core, tasks]' : 'modules: [core]'));
  const r = await yaw(['init', '--answers', file, '--yes', '--skip-verify'], dir);
  assert.equal(r.code, 0, r.err);
  return dir;
}

test('yaw kickoff prints the guide and the prompt; without the tasks module import is refused', async () => {
  const dir = await project({ tasks: false });
  const r = await yaw(['kickoff'], dir);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^Kickoff\n {2}1\. /);
  assert.match(r.out, /A small command-line tool that renames photos by their EXIF date\./);
  assert.match(r.out, /Work items become local tasks in TASKS\.md/);
  assert.match(r.out, /add the tasks module \(yaw add tasks\)/);
  const refused = await yaw(['kickoff', 'import', 'plan.md'], dir);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /needs the tasks module; run: yaw add tasks/);
  const bad = await yaw(['kickoff', 'nope'], dir);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /unknown verb "nope"/);
});

test('yaw kickoff import: --dry-run writes nothing; import adds tasks with model and effort; a second import skips them', async () => {
  const dir = await project();
  mkdirSync(join(dir, 'docs', 'plan'), { recursive: true });
  writeFileSync(join(dir, 'docs/plan/kickoff.md'), PLAN);
  const before = readFileSync(join(dir, 'TASKS.md'), 'utf8');

  const dry = await yaw(['kickoff', 'import', 'docs/plan/kickoff.md', '--dry-run'], dir);
  assert.equal(dry.code, 0, dry.err);
  assert.match(dry.out, /would add {2}\[Walking skeleton\] Read EXIF dates \(opus · effort: high\)/);
  assert.match(dry.out, /would add 5 task\(s\), skipped 0; nothing was written/);
  assert.equal(readFileSync(join(dir, 'TASKS.md'), 'utf8'), before);

  const r = await yaw(['kickoff', 'import', 'docs/plan/kickoff.md'], dir);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /added 5 task\(s\), skipped 0/);
  const backlog = parseTasks(readFileSync(join(dir, 'TASKS.md'), 'utf8')).backlog;
  assert.deepEqual(backlog.slice(-5).map((t) => [t.title, t.model, t.effort]), [
    ['Add the CLI entry point', 'sonnet', 'medium'],
    ['Read EXIF dates', 'opus', 'high'],
    ['Write the README', 'haiku', 'low'],
    ['Add --dry-run', undefined, undefined],
    ['Handle missing dates', undefined, undefined],
  ]);

  const again = await yaw(['kickoff', 'import', 'docs/plan/kickoff.md'], dir);
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /added 0 task\(s\), skipped 5/);

  const missing = await yaw(['kickoff', 'import', 'docs/plan/none.md'], dir);
  assert.equal(missing.code, 1);
  assert.match(missing.err, /does not exist/);
  writeFileSync(join(dir, 'docs/plan/empty.md'), '# nothing\n');
  const empty = await yaw(['kickoff', 'import', 'docs/plan/empty.md'], dir);
  assert.equal(empty.code, 1);
  assert.match(empty.err, /no tasks found/);
});
