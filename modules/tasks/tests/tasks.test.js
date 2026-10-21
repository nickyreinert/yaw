// tasks (Y-5.3, ADR-0010): local / GitHub / both, `yaw task` and `just task`, hooks (SessionStart re-injection,
// Stop reminder), one-way idempotent sync against recorded `gh` output, removal with zero residue.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../../../core/cli/main.js';
import { parseTasks, renderTasks, tasksMode } from '../../../core/lib/tasks.js';
import { loadModule } from '../../../core/render/kit.js';
import { readManifest } from '../../../core/render/manifest.js';
import { addModule, initProject, moduleQuestions, readAnswers, removeModule } from '../../../core/render/project.js';
import { declaredAgent, fixture, hook } from '../../../test/helpers/hooks.js';
import { KIT_ROOT, capture, cleanEnv, hasTool, read, readTree, run, tmp, writeAnswers } from '../../../test/helpers/fixtures.js';
import { archiveText, doneTask, localDate, logTask, newTask, nextLocalId, startTask } from '../lib/ledger.js';
import { syncBoth, viewFromIssues } from '../lib/github.js';

const GH = join(import.meta.dirname, 'fixtures', 'gh');
const recorded = (name) => readFileSync(join(GH, name), 'utf8');
const NOW = new Date(2026, 9, 21, 12, 0, 0); // 2026-10-21, local time

function answersText({ mode, team = 'solo', agents = 'claude, codex, copilot' } = {}) {
  const tasks = mode ? `  tasks.mode: ${mode}\n` : '';
  return `mode: quick\nanswers:\n  user.agents: [${agents}]\n  idea.text: A tiny command-line tool.\n  idea.team: ${team}\n${tasks}proposal:\n  status: confirmed\n  summary: test project\n  profiles: [node-cli]\n  modules: [core, tasks]\n`;
}

async function project(options = {}) {
  const root = tmp('yaw-tasks-');
  await initProject({ root, answersFile: writeAnswers(tmp('yaw-ans-'), answersText(options)), modules: ['core', 'tasks'] });
  return root;
}

// gh stand-in: replays the recorded list output and keeps issue state for create / edit / close / reopen.
function fakeGh({ seed = recorded('issues-all.json') } = {}) {
  const issues = JSON.parse(seed);
  const calls = [];
  let next = 50;
  const gh = (args) => {
    calls.push(args);
    const [group, verb] = args;
    const flag = (name) => args[args.indexOf(name) + 1];
    assert.equal(group, 'issue', args.join(' '));
    if (verb === 'list') {
      if (args.includes('--assignee')) return recorded('issues-mine.json');
      if (flag('--state') === 'open') return recorded('issues-open.json');
      return JSON.stringify(issues);
    }
    if (verb === 'create') {
      const number = next++;
      issues.push({ number, title: flag('--title'), state: 'OPEN', body: flag('--body') });
      return recorded('issue-create.txt').replace('/50', `/${number}`);
    }
    const issue = issues.find((i) => String(i.number) === args[2]);
    if (verb === 'edit' && issue && args.includes('--title')) Object.assign(issue, { title: flag('--title'), body: flag('--body') });
    if (verb === 'close' && issue) issue.state = 'CLOSED';
    if (verb === 'reopen' && issue) issue.state = 'OPEN';
    return '';
  };
  const writes = () => calls.filter((c) => c[1] !== 'list');
  return { gh, calls, issues, writes };
}

// `yaw task ...` in-process.
async function task(root, args, { gh, now = NOW } = {}) {
  const stdout = capture();
  const stderr = capture();
  const code = await main(['task', ...args], { stdout, stderr, cwd: root, gh, now });
  return { code, out: stdout.text(), err: stderr.text() };
}

const LOCAL_LEDGER = `# Tasks

## Active
### T-012 Online invite flow — in progress (60 %)
- **Brief:** Host creates 9-digit token, guest joins with token + name.
- **Model / effort:** strong / high
- **Spec:** docs/plan/invite-flow.md · ADR-0004
- **Resume point:** Signaling server done and tested; next: guest join screen (\`src/ui/join.ts\`).
- **Journal:**
  - 2026-10-20 WebRTC handshake via PeerJS, manual test OK

## Backlog
- T-013 Prop mode: book → shield — small / cheap · docs/plan/props.md
- T-014 Sound effects — small / cheap

## Done → TASKS.archive.md
`;

// ---------------------------------------------------------------- module definition

test('module: hook kinds follow BUILD.md rule 5 (Stop is comfort, only SessionStart is model-visible)', () => {
  const def = loadModule(KIT_ROOT, 'tasks');
  const hooks = Object.fromEntries(def.outputs.hooks.map((h) => [h.name, h]));
  assert.equal(hooks['stop-resume-point'].kind, 'comfort');
  assert.equal(hooks['stop-resume-point'].event, 'Stop');
  assert.equal(hooks['stop-resume-point'].tokenCost, 'none');
  assert.equal(hooks['session-start-task'].kind, 'context');
  assert.equal(hooks['session-start-task'].event, 'SessionStart');
  assert.equal(def.default.quick, true);
});

test('task mode: team forces github, the answer decides otherwise, local is the default', () => {
  assert.equal(tasksMode({}), 'local');
  assert.equal(tasksMode({ 'tasks.mode': 'both' }), 'both');
  assert.equal(tasksMode({ 'tasks.mode': 'github' }), 'github');
  assert.equal(tasksMode({ 'tasks.mode': 'local', 'idea.team': 'team' }), 'github');
  assert.equal(tasksMode({ 'tasks.mode': 'both', 'idea.team': 'external-reviewers' }), 'github');
  assert.equal(tasksMode({ 'tasks.mode': 'nonsense' }), 'local');
});

// ---------------------------------------------------------------- install per mode

test('install: local and both start with the canonical empty ledger; github with the read-only view', async () => {
  const empty = { active: [], backlog: [] };
  const local = renderTasks({ readOnly: false, ...empty, archive: 'TASKS.archive.md' });
  const view = renderTasks({ readOnly: true, ...empty });
  for (const [options, text] of [[{}, local], [{ mode: 'local' }, local], [{ mode: 'both' }, local], [{ mode: 'github' }, view], [{ mode: 'local', team: 'team' }, view]]) {
    const root = await project(options);
    assert.equal(read(root, 'TASKS.md'), text, JSON.stringify(options));
    assert.deepEqual(parseTasks(read(root, 'TASKS.md')).active, []);
  }
});

test('install: AGENTS.md rules, justfile import, hooks in Claude and Codex settings, manifest entries', async () => {
  const root = await project({ mode: 'both' });
  const tree = readTree(root);
  assert.match(tree['AGENTS.md'], /<!-- yaw:tasks -->\n## Tasks\n/);
  assert.match(tree['AGENTS.md'], /`just task sync` mirrors tasks to GitHub issues/);
  assert.match(tree.justfile, /# yaw:tasks\nimport 'just\/tasks.just'\n# \/yaw:tasks/);
  assert.match(tree['just/tasks.just'], /yaw task "\$@"/);
  assert.doesNotMatch(tree['.gitignore'], /TASKS\.md/);
  for (const file of ['.claude/settings.json', '.codex/hooks.json']) {
    const hooks = JSON.parse(tree[file]).hooks;
    assert.match(hooks.Stop.at(-1).hooks[0].command, /--module tasks/, file);
    assert.match(hooks.SessionStart.at(-1).hooks[0].command, /SessionStart --agent (claude|codex) --module tasks/, file);
  }
  const manifest = readManifest(root);
  const byPath = Object.fromEntries(manifest.files.map((f) => [f.path, f]));
  for (const f of ['TASKS.md', 'just/tasks.just']) assert.equal(byPath[f].module, 'tasks', f);
  for (const f of ['AGENTS.md', 'justfile', '.claude/settings.json', '.codex/hooks.json']) assert.ok(byPath[f].fragments.some((x) => x.module === 'tasks'), f);
  assert.ok(manifest.modules.tasks.enabled);
});

test('install: github mode has its own rules and git-ignores the per-person view', async () => {
  const root = await project({ mode: 'github' });
  assert.match(read(root, 'AGENTS.md'), /read-only view of GitHub issues/);
  assert.match(read(root, '.gitignore'), /# yaw:tasks\nTASKS\.md\n# \/yaw:tasks/);
  assert.doesNotMatch(read(root, 'AGENTS.md'), /mirrors tasks/);
  assert.match(read(root, 'TASKS.md'), /Read-only: change the issues/);
});

test('install: AGENTS.md stays within the 80-line budget with all Quick modules', async () => {
  const root = tmp('yaw-tasks-');
  const modules = ['core', 'communication', 'standards', 'devenv', 'security', 'tasks'];
  const text = answersText({ mode: 'both' }).replace('[core, tasks]', `[${modules.join(', ')}]`);
  await initProject({ root, answersFile: writeAnswers(tmp('yaw-ans-'), text), modules });
  assert.ok(read(root, 'AGENTS.md').split('\n').length <= 80);
});

// ---------------------------------------------------------------- ledger operations (local)

test('ledger: new, start, log, done on the doc 10 example', () => {
  const ledger = parseTasks(LOCAL_LEDGER);
  assert.equal(nextLocalId(ledger, '- T-020 Old — done 2026-10-01\n'), 'T-021');
  const created = newTask(ledger, 'Dark mode — maybe', '');
  assert.deepEqual(created, { id: 'T-015', title: 'Dark mode - maybe' });

  const started = startTask(ledger, 't-13');
  assert.deepEqual(ledger.backlog.map((b) => b.id), ['T-014', 'T-015']);
  assert.deepEqual(started, { id: 'T-013', title: 'Prop mode: book → shield', status: 'in progress', progress: 0, model: 'small / cheap · docs/plan/props.md', resume: 'Started; nothing logged yet.' });

  logTask(ledger, 'T-012', '  guest join\nscreen done ', { now: NOW, resume: 'next: polish', progress: '80' });
  const t = ledger.active[0];
  assert.deepEqual(t.journal.at(-1), { date: '2026-10-21', text: 'guest join screen done' });
  assert.equal(t.resume, 'next: polish');
  assert.equal(t.progress, 80);

  const { line } = doneTask(ledger, 'T-012', { now: NOW });
  assert.equal(line, '- T-012 Online invite flow — done 2026-10-21');
  assert.deepEqual(ledger.active.map((a) => a.id), ['T-013']);
  assert.equal(archiveText('', line), '# Done\n\n- T-012 Online invite flow — done 2026-10-21\n');
  // the result is still a valid ledger
  assert.deepEqual(parseTasks(renderTasks(ledger)), ledger);
});

test('ledger: errors are plain sentences', () => {
  const ledger = parseTasks(LOCAL_LEDGER);
  assert.throws(() => startTask(ledger, 'T-099'), /T-099 is not in TASKS\.md/);
  assert.throws(() => startTask(ledger, 'abc'), /not a task ID/);
  assert.throws(() => logTask(ledger, 'T-013', 'x'), /not active; run: just task start T-013/);
  assert.throws(() => logTask(ledger, 'T-012', 'x', { progress: '120' }), /progress must be/);
  assert.throws(() => logTask(ledger, 'T-012', '  '), /needs text/);
  assert.throws(() => doneTask(ledger, 'T-014'), /not active/);
  assert.throws(() => newTask(ledger, ' '), /needs a title/);
  assert.throws(() => startTask(parseTasks(renderTasks({ readOnly: true, active: [], backlog: [] })), 'T-001'), /generated view/);
  assert.equal(localDate(NOW), '2026-10-21');
});

test('yaw task: a local working day end to end, ledger stays parseable and TASKS.archive.md appears', async () => {
  const root = await project({ mode: 'local' });
  assert.match((await task(root, ['new', 'Online invite flow'])).out, /^T-001 Online invite flow/);
  assert.match((await task(root, ['new', 'Sound effects'])).out, /^T-002/);
  assert.match((await task(root, ['start', 'T-001'])).out, /T-001 Online invite flow — in progress/);
  assert.match((await task(root, ['next'])).out, /^T-002 Sound effects/);
  const log = await task(root, ['log', 'T-001', 'token generation done, tests green', '--resume', 'next: guest join screen', '--progress', '60']);
  assert.equal(log.code, 0, log.err);
  const listing = (await task(root, ['list'])).out;
  assert.match(listing, /T-001 Online invite flow — in progress \(60 %\)\n {4}resume: next: guest join screen/);
  const ledger = parseTasks(read(root, 'TASKS.md'));
  assert.deepEqual(ledger.active[0].journal, [{ date: '2026-10-21', text: 'token generation done, tests green' }]);
  const done = await task(root, ['done', 'T-001']);
  assert.match(done.out, /T-001 done, archived in TASKS\.archive\.md/);
  assert.equal(read(root, 'TASKS.archive.md'), '# Done\n\n- T-001 Online invite flow — done 2026-10-21\n');
  assert.match((await task(root, ['new', 'Third'])).out, /^T-003/, 'IDs are not reused after archiving');
});

test('yaw task: usage errors, sync without GitHub, and a project without the module', async () => {
  const root = await project({ mode: 'local' });
  const missing = await task(root, ['start']);
  assert.equal(missing.code, 1);
  assert.match(missing.err, /missing task ID[\s\S]*usage: yaw task list/);
  assert.match((await task(root, ['frobnicate'])).err, /unknown verb "frobnicate"/);
  assert.match((await task(root, [])).err, /missing verb/);
  const sync = await task(root, ['sync'], { gh: () => assert.fail('local mode must not call gh') });
  assert.equal(sync.code, 1);
  assert.match(sync.err, /tracks tasks locally only/);
  writeFileSync(join(root, 'TASKS.md'), '# Tasks\n\n## Backlog\n');
  assert.match((await task(root, ['list'])).err, /TASKS\.md:3: "## Backlog" must follow "## Active"/);

  const bare = tmp('yaw-bare-');
  await initProject({ root: bare, answersFile: writeAnswers(tmp('yaw-ans-')), modules: ['core'] });
  assert.match((await task(bare, ['list'])).err, /tasks module is not installed; run: yaw add tasks/);
});

// ---------------------------------------------------------------- both: one-way, idempotent sync

test('sync (both): creates, links, updates, closes; recorded gh output; the second run writes nothing', async () => {
  const root = await project({ mode: 'both' });
  writeFileSync(join(root, 'TASKS.md'), LOCAL_LEDGER.replace('### T-012 Online', '### T-012 (#34) Online'));
  writeFileSync(join(root, 'TASKS.archive.md'), '# Done\n\n- T-009 (#30) Lobby screen — done 2026-10-01\n- T-008 (#40) Bug: empty token crashes the host — done 2026-10-02\n');
  const g = fakeGh();

  const first = await task(root, ['sync'], { gh: g.gh });
  assert.equal(first.code, 0, first.err);
  assert.deepEqual(first.out.trim().split('\n'), [
    'sync: updated T-012 -> #34',
    'sync: created T-013 -> #50',
    'sync: created T-014 -> #51',
    'sync: closed T-008 -> #40',
  ]);
  const ledger = parseTasks(read(root, 'TASKS.md'));
  assert.deepEqual([ledger.active[0].issue, ledger.backlog[0].issue, ledger.backlog[1].issue], [34, 50, 51]);
  assert.match(read(root, 'TASKS.md'), /- T-013 \(#50\) Prop mode: book → shield — small \/ cheap/);
  const created = g.issues.find((i) => i.number === 50);
  assert.match(created.body, /^<!-- yaw:task T-013 -->\n\n\*\*Note:\*\* small \/ cheap · docs\/plan\/props\.md/);
  assert.equal(g.issues.find((i) => i.number === 34).title, 'Online invite flow');
  assert.equal(g.issues.find((i) => i.number === 40).state, 'CLOSED');
  assert.equal(g.issues.find((i) => i.number === 30).state, 'CLOSED', 'already closed stays closed');

  // idempotent: same ledger, same issues -> no write call, TASKS.md untouched
  const before = read(root, 'TASKS.md');
  g.calls.length = 0;
  const second = await task(root, ['sync'], { gh: g.gh });
  assert.match(second.out, /nothing to do/);
  assert.deepEqual(g.writes(), []);
  assert.equal(read(root, 'TASKS.md'), before);

  // one way: a change in the ledger reaches the issue, a change on the issue is overwritten
  await task(root, ['log', 'T-012', 'handshake works', '--resume', 'next: join screen']);
  g.issues.find((i) => i.number === 51).title = 'Edited on GitHub';
  g.calls.length = 0;
  const third = await task(root, ['sync'], { gh: g.gh });
  assert.deepEqual(third.out.trim().split('\n'), ['sync: updated T-012 -> #34', 'sync: updated T-014 -> #51']);
  assert.match(g.issues.find((i) => i.number === 34).body, /\*\*Resume point:\*\* next: join screen/);
  assert.equal(g.issues.find((i) => i.number === 51).title, 'Sound effects');
});

test('sync (both): a closed issue of an open task is reopened; a lost number is re-linked by its marker; a missing issue is reported, not recreated', () => {
  const ledger = parseTasks('# Tasks\n\n## Active\n\n## Backlog\n- T-009 Lobby screen\n- T-020 (#99) Ghost\n');
  const g = fakeGh();
  const result = syncBoth({ ledger, gh: g.gh });
  assert.deepEqual(result.actions.map((a) => `${a.kind} ${a.id} #${a.issue}`), ['linked T-009 #30', 'reopened T-009 #30']);
  assert.deepEqual(result.warnings, ['T-020: issue #99 was not found; not recreated']);
  assert.equal(ledger.backlog[0].issue, 30);
  assert.equal(g.calls.filter((c) => c[1] === 'create').length, 0);
});

test('sync: a gh failure is a plain message and leaves TASKS.md alone', async () => {
  const root = await project({ mode: 'both' });
  writeFileSync(join(root, 'TASKS.md'), LOCAL_LEDGER);
  const r = await task(root, ['sync'], { gh: () => { throw Object.assign(new Error('gh issue list failed: not logged in'), { name: 'GhError' }); } });
  assert.equal(r.code, 1);
  assert.match(r.err, /yaw task: gh issue list failed: not logged in/);
  assert.equal(read(root, 'TASKS.md'), LOCAL_LEDGER);
});

// ---------------------------------------------------------------- github: issues are the source

test('github view: my issues are Active (status label, journal comments), others are the Backlog by priority', () => {
  const view = viewFromIssues({ mine: JSON.parse(recorded('issues-mine.json')), open: JSON.parse(recorded('issues-open.json')) });
  assert.deepEqual(view.active[0], {
    id: '#41',
    title: 'Guest join screen',
    status: 'in review',
    brief: 'Guest join screen',
    spec: 'Milestone Phase 1',
    resume: 'PR #52 waits for review.',
    journal: [
      { date: '2026-10-20', text: 'join form and validation done' },
      { date: '2026-10-21', text: 'PR #52 opened' },
    ],
  });
  assert.deepEqual(view.active[1], { id: '#45', title: 'Invite expiry', status: 'in progress' });
  assert.deepEqual(view.backlog, [
    { id: '#43', title: 'Prop mode: book → shield', note: 'P2 · S' },
    { id: '#44', title: 'Sound effects', note: 'P3' },
    { id: '#46', title: 'Unlabelled idea' },
  ]);
  assert.equal(view.readOnly, true);
  assert.deepEqual(parseTasks(renderTasks(view)), view);
});

test('yaw task (github): sync writes the view; list and next read GitHub; start, log, done, new call gh', async () => {
  const root = await project({ mode: 'github' });
  const g = fakeGh();
  const sync = await task(root, ['sync'], { gh: g.gh });
  assert.match(sync.out, /TASKS\.md: 2 active, 3 in the backlog/);
  const ledger = parseTasks(read(root, 'TASKS.md'));
  assert.equal(ledger.readOnly, true);
  assert.equal(ledger.active[0].id, '#41');

  assert.match((await task(root, ['next'], { gh: g.gh })).out, /^#43 Prop mode: book → shield — P2 · S/);
  assert.match((await task(root, ['list'], { gh: g.gh })).out, /#41 Guest join screen — in review/);

  g.calls.length = 0;
  assert.match((await task(root, ['start', '#43'], { gh: g.gh })).out, /#43 assigned to you/);
  assert.deepEqual(g.calls[0], ['issue', 'edit', '43', '--add-assignee', '@me']);

  g.calls.length = 0;
  const log = await task(root, ['log', '#41', 'review fixes pushed', '--resume', 'merge after approval'], { gh: g.gh });
  assert.match(log.out, /#41: journal line posted as a comment/);
  assert.deepEqual(g.calls[0], ['issue', 'comment', '41', '--body', '<!-- yaw:journal -->\n2026-10-21 review fixes pushed\n\nResume point: merge after approval']);

  g.calls.length = 0;
  await task(root, ['done', '41'], { gh: g.gh });
  assert.deepEqual(g.calls[0], ['issue', 'comment', '41', '--body', '<!-- yaw:journal -->\n2026-10-21 ready for review']);

  g.calls.length = 0;
  assert.match((await task(root, ['new', 'Lobby chat'], { gh: g.gh })).out, /^#50 Lobby chat/);
  assert.deepEqual(g.calls[0], ['issue', 'create', '--title', 'Lobby chat', '--body', '']);
});

test('yaw task (github): offline list falls back to the last view; a failed refresh after a change is a warning', async () => {
  const root = await project({ mode: 'github' });
  const g = fakeGh();
  await task(root, ['sync'], { gh: g.gh });
  const offline = () => { throw new Error('gh issue list failed: network'); };
  const list = await task(root, ['list'], { gh: offline });
  assert.equal(list.code, 0);
  assert.match(list.err, /using the last TASKS\.md \(gh issue list failed: network\)/);
  assert.match(list.out, /#41 Guest join screen/);
  let writes = 0;
  const flaky = (args) => (args[1] === 'list' ? offline() : (writes++, ''));
  const log = await task(root, ['log', '#41', 'x'], { gh: flaky });
  assert.equal(log.code, 0);
  assert.equal(writes, 1);
  assert.match(log.err, /could not refresh TASKS\.md/);
  assert.match((await task(root, ['sync'], { gh: offline })).err, /network/);
});

test('team mode forces github even when the answer says local', async () => {
  const root = await project({ mode: 'local', team: 'team' });
  const r = await task(root, ['sync'], { gh: fakeGh().gh });
  assert.equal(r.code, 0, r.err);
  assert.equal(parseTasks(read(root, 'TASKS.md')).readOnly, true);
  assert.deepEqual(moduleQuestions({ root, definition: loadModule(KIT_ROOT, 'tasks') }).map((q) => q.id), ['tasks.mode']);
});

// ---------------------------------------------------------------- hooks

async function sessionStart(root, agent) {
  return hook({ root, agent: declaredAgent(agent), event: 'SessionStart', module: 'tasks', payload: fixture(agent, 'SessionStart') });
}

test('SessionStart: the active task is re-injected (a few lines) for Claude, Codex and Copilot', async () => {
  const root = await project({ mode: 'local' });
  const empty = await sessionStart(root, 'claude');
  assert.deepEqual([empty.code, empty.stdout], [0, ''], 'nothing active: silent');

  writeFileSync(join(root, 'TASKS.md'), LOCAL_LEDGER);
  for (const agent of ['claude', 'codex', 'copilot']) {
    const r = await sessionStart(root, agent);
    assert.equal(r.code, 0);
    assert.equal(r.stderr, '');
    const out = JSON.parse(r.stdout);
    const context = agent === 'copilot' ? out.additionalContext : out.hookSpecificOutput.additionalContext;
    assert.equal(context, 'Active task(s) from TASKS.md; continue from the resume point unless told otherwise:\nT-012 Online invite flow — in progress (60 %)\n  Resume point: Signaling server done and tested; next: guest join screen (`src/ui/join.ts`).', agent);
    assert.ok(context.split('\n').length <= 10);
    assert.doesNotMatch(r.stdout, /systemMessage|permissionDecision/);
  }
});

test('SessionStart: a ledger that does not parse is silent, a long resume point is clipped, extra tasks are counted', async () => {
  const root = await project({ mode: 'local' });
  writeFileSync(join(root, 'TASKS.md'), 'nonsense\n');
  assert.equal((await sessionStart(root, 'claude')).stdout, '');
  const ledger = parseTasks(LOCAL_LEDGER);
  ledger.active = Array.from({ length: 5 }, (_, i) => ({ id: `T-0${i + 1}0`, title: `Task ${i}`, status: 'in progress', resume: 'x'.repeat(500) }));
  writeFileSync(join(root, 'TASKS.md'), renderTasks(ledger));
  const out = JSON.parse((await sessionStart(root, 'claude')).stdout).hookSpecificOutput.additionalContext;
  assert.match(out, /\(\+2 more in TASKS\.md\)/);
  assert.ok(out.length <= 1000);
});

test('Stop: a user-visible reminder only, once per session and task; never model-visible', async () => {
  const root = await project({ mode: 'local' });
  writeFileSync(join(root, 'TASKS.md'), LOCAL_LEDGER); // last journal line is 2026-10-20
  const home = tmp('yaw-home-');
  const stop = (agent, payload = fixture(agent, 'Stop')) => hook({ root, agent: declaredAgent(agent), event: 'Stop', module: 'tasks', payload, env: { HOME: home } });

  const first = await stop('claude');
  assert.equal(first.code, 0);
  const out = JSON.parse(first.stdout);
  assert.deepEqual(Object.keys(out), ['systemMessage']);
  assert.match(out.systemMessage, /^YAW tasks: no journal line for today on T-012\. Log it: just task log T-012 "what changed" --resume "next step"$/);
  assert.doesNotMatch(first.stdout, /additionalContext|decision|block|continue/);

  assert.equal((await stop('claude')).stdout, '', 'same session: told once');
  assert.equal((await stop('claude', { ...fixture('claude', 'Stop'), session_id: 'other-session' })).stdout.includes('T-012'), true, 'new session: told again');
  assert.deepEqual(Object.keys(JSON.parse((await stop('codex')).stdout)), ['systemMessage']);
  assert.equal((await stop('copilot')).stdout, '', 'Copilot has no user message on Stop');
});

test('Stop: silent when today has a journal line, nothing is active, or tasks live in GitHub', async () => {
  const stopOf = (root) => hook({ root, agent: 'claude', event: 'Stop', module: 'tasks', payload: fixture('claude', 'Stop'), env: { HOME: tmp('yaw-home-') } });
  const root = await project({ mode: 'local' });
  assert.equal((await stopOf(root)).stdout, '', 'nothing active');
  // the hook uses the real clock: write a journal line for today
  const today = localDate(new Date());
  writeFileSync(join(root, 'TASKS.md'), LOCAL_LEDGER.replace('  - 2026-10-20 WebRTC', `  - ${today} WebRTC`));
  assert.equal((await stopOf(root)).stdout, '', 'logged today');

  const gh = await project({ mode: 'github' });
  writeFileSync(join(gh, 'TASKS.md'), LOCAL_LEDGER.replace('# Tasks\n', '# Tasks\n\n> Generated by yaw from GitHub issues. Read-only: change the issues, not this file.\n').replace(/T-0(\d\d)/g, '#$1').replace('## Done → TASKS.archive.md\n', ''));
  assert.equal((await stopOf(gh)).stdout, '', 'github mode: journal lines are issue comments');
});

// ---------------------------------------------------------------- just task

test('just task: arguments with spaces and quotes reach yaw task unchanged', { skip: !hasTool('just') && 'just is not installed' }, async () => {
  const root = await project({ mode: 'local' });
  const env = cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH, YAW_KIT: KIT_ROOT });
  const just = (...args) => run('just', args, { cwd: root, env });
  const created = just('task', 'new', `Say "hi" to Bob's guest`);
  assert.equal(created.status, 0, String(created.stderr));
  assert.match(created.stdout, /^T-001 Say "hi" to Bob's guest/);
  assert.equal(just('task', 'start', 'T-001').status, 0);
  const log = just('task', 'log', 'T-001', 'did a thing; then another', '--resume', 'next: the other thing');
  assert.equal(log.status, 0, String(log.stderr));
  assert.match(read(root, 'TASKS.md'), /- \*\*Resume point:\*\* next: the other thing/);
  const list = just('task', 'list');
  assert.match(list.stdout, /T-001 Say "hi" to Bob's guest — in progress/);
  assert.equal(just('task').status, 1, 'no verb is a usage error');
  assert.equal(just('--list').status, 0);
});

// ---------------------------------------------------------------- removal

test('remove: zero residue, answers kept, re-add asks the question again with the previous answer', async () => {
  for (const mode of ['local', 'github']) {
    const root = await project({ mode });
    const before = readTree(root);
    await removeModule({ root, module: 'tasks' });
    const left = readTree(root);
    for (const gone of ['TASKS.md', 'just/tasks.just']) assert.equal(Object.hasOwn(left, gone), false, gone);
    assert.doesNotMatch(left.justfile, /tasks/);
    assert.doesNotMatch(left['AGENTS.md'], /yaw:tasks/);
    assert.doesNotMatch(left['.gitignore'] ?? '', /TASKS/);
    for (const file of ['.claude/settings.json', '.codex/hooks.json']) assert.doesNotMatch(left[file] ?? '', /--module tasks/, file);
    assert.equal(readManifest(root).modules.tasks, undefined);
    assert.ok(!readManifest(root).files.some((f) => f.module === 'tasks'));
    assert.equal(readAnswers(root).answers['tasks.mode'], mode, 'answers.yaml keeps the answer');

    const asked = moduleQuestions({ root, definition: loadModule(KIT_ROOT, 'tasks') });
    assert.deepEqual(asked.map((q) => [q.id, q.default]), [['tasks.mode', mode]]);
    await addModule({ root, module: 'tasks' });
    assert.deepEqual(readTree(root), before);
  }
});

test('remove: a ledger with real tasks is kept (user data), the rest goes', async () => {
  const root = await project({ mode: 'local' });
  writeFileSync(join(root, 'TASKS.md'), LOCAL_LEDGER);
  await removeModule({ root, module: 'tasks' });
  assert.equal(existsSync(join(root, 'TASKS.md')), true);
  assert.equal(read(root, 'TASKS.md'), LOCAL_LEDGER);
  assert.ok(!readManifest(root).files.some((f) => f.path === 'TASKS.md'));
});

test('hook state stays outside the project', async () => {
  const root = await project({ mode: 'local' });
  writeFileSync(join(root, 'TASKS.md'), LOCAL_LEDGER);
  const home = tmp('yaw-home-');
  await hook({ root, agent: 'claude', event: 'Stop', module: 'tasks', payload: fixture('claude', 'Stop'), env: { HOME: home } });
  assert.ok(existsSync(join(home, '.yaw', 'state', 'tasks-stop.json')));
  assert.equal(existsSync(join(root, '.yaw', 'state')), false);
  mkdirSync(join(home, 'x'), { recursive: true });
});
