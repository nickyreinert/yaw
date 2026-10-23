// sessions (Y-5.7, ADR-0029): registry in ~/.yaw/yaw.db, silent evaluation hooks for Claude / Codex / Copilot,
// title from the active task, Agent-Session trailer on `just commit`, `yaw sessions find / for / resume`,
// /handoff skill, path safety, removal with zero residue.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, linkSync, mkdirSync, openSync, renameSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../../../core/cli/main.js';
import { loadModule } from '../../../core/render/kit.js';
import { readManifest } from '../../../core/render/manifest.js';
import { addModule, initProject, moduleQuestions, readAnswers, removeModule } from '../../../core/render/project.js';
import { openYawDb } from '../../../core/lib/db.js';
import { declaredAgent, fixture, hook, listFixtures, shim } from '../../../test/helpers/hooks.js';
import { KIT_ROOT, capture, cleanEnv, hasTool, read, readTree, run, tmp, writeAnswers } from '../../../test/helpers/fixtures.js';
import { branchTask, clean, commitsOf, currentSession, openRegistry, tightenHome, readRegular, realRoot, resumeCommand, sessionId, withRegistry } from '../lib/registry.js';
import { commitMessage } from '../../github/lib/names.js';
import { parseRef } from '../lib/cli.js';

const MODULES = ['core', 'tasks', 'github', 'sessions'];
const LEDGER = `# Tasks

## Active
### T-012 Online invite flow — in progress (60 %)
- **Brief:** Host creates a token, guest joins with it.
- **Resume point:** Signaling server done; next: guest join screen.

## Backlog
- T-013 Prop mode — small / cheap

## Done → TASKS.archive.md
`;
const NATIVE = { claude: '5f2c1a7e-0d3b-4c1e-9a62-1b7f00000001', codex: '019a3c5e-7b21-7d40-9e1a-000000000002', copilot: 'copilot-0f3e9a12-0000-4000-8000-000000000003' };

function answersText({ agents = 'claude, codex, copilot', modules = MODULES } = {}) {
  return `mode: standard\nanswers:\n  user.agents: [${agents}]\n  idea.text: A tiny command-line tool.\n  idea.team: solo\n  tasks.mode: local\nproposal:\n  status: confirmed\n  summary: test project\n  profiles: [node-cli]\n  modules: [${modules.join(', ')}]\n`;
}

async function project(options = {}) {
  const root = tmp('yaw-sessions-');
  await initProject({ root, answersFile: writeAnswers(tmp('yaw-ans-'), answersText(options)), modules: options.modules ?? MODULES });
  return root;
}

const ENV = () => cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH });
const git = (root, env, ...args) => {
  const r = run('git', args, { cwd: root, env });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

async function yaw(root, args, env, now) {
  const stdout = capture();
  const stderr = capture();
  const code = await main(['sessions', ...args], { stdout, stderr, cwd: root, env, now });
  return { code, out: stdout.text(), err: stderr.text() };
}

const start = (root, env, agent = 'claude', over = {}) =>
  hook({ root, agent: declaredAgent(agent), event: 'SessionStart', module: 'sessions', payload: { ...fixture(agent, 'SessionStart'), cwd: root, ...over }, env });
const stop = (root, env, agent = 'claude', over = {}) =>
  hook({ root, agent: declaredAgent(agent), event: 'Stop', module: 'sessions', payload: { ...fixture(agent, 'Stop'), cwd: root, ...over }, env });
const rows = (env) => withRegistry(env, (db) => db.prepare('SELECT * FROM sessions ORDER BY id').all().map((r) => ({ ...r })));
const links = (env, id) => withRegistry(env, (db) => db.prepare('SELECT kind, ref FROM session_links WHERE session_id = ? ORDER BY kind, ref').all(id).map((r) => ({ ...r })));

// ------------------------------------------------------------------------------------------ install

test('module: evaluation hooks only, tokenCost none, no context or comfort hook', () => {
  const def = loadModule(KIT_ROOT, 'sessions');
  assert.deepEqual(def.outputs.hooks.map((h) => [h.name, h.event, h.kind, h.tokenCost]), [
    ['register', 'SessionStart', 'evaluation', 'none'], ['touch', 'Stop', 'evaluation', 'none'], ['end', 'SessionEnd', 'evaluation', 'none'],
  ]);
  assert.equal(def.tokenCost, 'none');
  assert.deepEqual(def.questions, []);
  assert.equal(def.agents.claude.support, 'native');
  assert.equal(def.agents.codex.support, 'native');
  assert.equal(def.agents.copilot.support, 'partial');
});

test('install: files, skill copies, hooks for Claude and Codex, .gitignore, manifest entries', async () => {
  const root = await project();
  const m = readManifest(root);
  const own = m.files.filter((f) => f.module === 'sessions').map((f) => f.path).sort();
  assert.deepEqual(own, ['.agents/skills/handoff/SKILL.md', '.claude/skills/handoff/SKILL.md', 'just/sessions.just']);
  for (const shared of ['AGENTS.md', 'justfile', '.gitignore', '.claude/settings.json', '.codex/hooks.json']) {
    assert.ok(m.files.find((f) => f.path === shared).fragments.some((x) => x.module === 'sessions'), shared);
  }
  assert.equal(read(root, '.claude/skills/handoff/SKILL.md'), read(root, '.agents/skills/handoff/SKILL.md'));
  assert.match(read(root, '.agents/skills/handoff/SKILL.md'), /^name: handoff$/m);
  assert.match(read(root, 'AGENTS.md'), /just sessions for/);
  assert.match(read(root, 'justfile'), /import 'just\/sessions\.just'/);
  const claude = JSON.parse(read(root, '.claude/settings.json')).hooks;
  assert.deepEqual(['SessionStart', 'Stop', 'SessionEnd'].filter((e) => JSON.stringify(claude[e] ?? []).includes('--module sessions')), ['SessionStart', 'Stop', 'SessionEnd']);
  const codex = JSON.parse(read(root, '.codex/hooks.json')).hooks;
  assert.ok(JSON.stringify(codex.SessionStart).includes('--module sessions'));
  assert.ok(JSON.stringify(codex.Stop).includes('--module sessions'));
  assert.ok(!JSON.stringify(codex.SessionEnd ?? []).includes('--module sessions'), 'Codex has no SessionEnd');
});

test('install: Codex only gets the shared skill, no .claude files', async () => {
  const root = await project({ agents: 'codex' });
  assert.ok(existsSync(join(root, '.agents/skills/handoff/SKILL.md')));
  assert.ok(!existsSync(join(root, '.claude')));
});

test('registry is git-ignored: .yaw/sessions/ is ignored, yaw.db lives outside the project', { skip: !hasTool('git') && 'git is not installed' }, async () => {
  const root = await project();
  const env = ENV();
  git(root, env, 'init', '--quiet', '-b', 'main');
  mkdirSync(join(root, '.yaw', 'sessions'), { recursive: true });
  writeFileSync(join(root, '.yaw', 'sessions', 'export.json'), '{}');
  assert.equal(run('git', ['check-ignore', '--quiet', '.yaw/sessions/export.json'], { cwd: root, env }).status, 0);
  await start(root, env);
  assert.equal(existsSync(join(root, 'yaw.db')), false);
  assert.ok(existsSync(join(env.HOME, '.yaw', 'yaw.db')));
  assert.equal(run('git', ['status', '--porcelain', '--ignored'], { cwd: root, env }).stdout.includes('yaw.db'), false);
});

// ------------------------------------------------------------------------------------------ hooks

test('hooks are silent: empty stdout and stderr, exit 0, for every fixture of every agent', async () => {
  const root = await project();
  writeFileSync(join(root, 'TASKS.md'), LEDGER);
  const env = ENV();
  for (const f of listFixtures()) {
    for (const module of ['sessions']) {
      const r = await hook({ root, agent: declaredAgent(f.agent), event: f.event, module, payload: { ...f.payload, cwd: root }, env });
      assert.deepEqual([r.code, r.stdout, r.stderr], [0, '', ''], `${f.agent}/${f.name}`);
    }
  }
  assert.ok(rows(env).length >= 3, 'the session events of the fixtures were registered');
});

test('silent through the real shim as well', async () => {
  const root = await project();
  const env = ENV();
  const r = shim({ root, agent: 'claude', event: 'SessionStart', module: 'sessions', payload: { ...fixture('claude', 'SessionStart'), cwd: root }, env: { ...env, YAW_KIT: KIT_ROOT } });
  assert.deepEqual([r.code, r.stdout, r.stderr], [0, '', '']);
  assert.equal(rows(env).length, 1);
});

test('SessionStart registers the session; title comes from the active task; links and transcript path are stored', async () => {
  const root = await project();
  writeFileSync(join(root, 'TASKS.md'), LEDGER);
  const env = ENV();
  git(root, env, 'init', '--quiet', '-b', 'main');
  git(root, env, 'switch', '--quiet', '-c', 'feat/T-012-invite-flow');
  await start(root, env);
  const [row] = rows(env);
  assert.equal(row.id, `claude:${NATIVE.claude}`);
  assert.equal(row.agent, 'claude');
  assert.equal(row.title, 'T-012 Online invite flow');
  assert.equal(row.branch, 'feat/T-012-invite-flow');
  assert.equal(row.resume, `claude --resume ${NATIVE.claude}`);
  assert.match(row.transcript, /\.jsonl$/);
  assert.equal(row.ended, null);
  assert.deepEqual(links(env, row.id), [{ kind: 'task', ref: 'T-012' }]);
  assert.match(row.project, /yaw-sessions-/);
});

test('Stop stamps the end, keeps the title and does not duplicate rows; a custom title survives', async () => {
  const root = await project();
  writeFileSync(join(root, 'TASKS.md'), LEDGER);
  const env = ENV();
  await start(root, env);
  withRegistry(env, (db) => db.prepare('UPDATE sessions SET title = ?').run('My own title'));
  writeFileSync(join(root, 'TASKS.md'), LEDGER.replace('T-012 Online invite flow', 'T-012 Renamed'));
  await stop(root, env);
  await stop(root, env);
  const all = rows(env);
  assert.equal(all.length, 1);
  assert.equal(all[0].title, 'My own title');
  assert.ok(all[0].ended);
  const sessionEnd = await hook({ root, agent: 'claude', event: 'SessionEnd', module: 'sessions', payload: { session_id: NATIVE.claude, hook_event_name: 'SessionEnd', cwd: root }, env });
  assert.deepEqual([sessionEnd.code, sessionEnd.stdout], [0, '']);
});

test('Codex and Copilot sessions get agent-prefixed ids; Copilot is told apart from Claude by its payload', async () => {
  const root = await project();
  const env = ENV();
  await start(root, env, 'codex');
  await start(root, env, 'copilot');
  assert.deepEqual(rows(env).map((r) => [r.id, r.agent]), [
    [`codex:${NATIVE.codex}`, 'codex'], [`copilot:${NATIVE.copilot}`, 'copilot'],
  ]);
  assert.equal(rows(env)[0].resume, `codex resume ${NATIVE.codex}`);
});

test('a Stop without a SessionStart still registers the session', async () => {
  const root = await project();
  const env = ENV();
  await stop(root, env, 'codex');
  assert.equal(rows(env).length, 1);
  assert.ok(rows(env)[0].ended);
});

test('the hook is skipped when the module is not enabled, and fails open on garbage', async () => {
  const root = await project({ modules: ['core', 'tasks'] });
  const env = ENV();
  const r = await start(root, env);
  assert.deepEqual([r.code, r.stdout], [0, '']);
  assert.equal(existsSync(join(env.HOME, '.yaw', 'yaw.db')), false);
  const ok = await project();
  for (const payload of ['not json', '{}', JSON.stringify({ hook_event_name: 'SessionStart', session_id: '../../etc/passwd', cwd: ok })]) {
    const g = await hook({ root: ok, agent: 'claude', event: 'SessionStart', module: 'sessions', payload, env });
    assert.deepEqual([g.code, g.stdout], [0, ''], payload);
  }
  assert.equal(rows(env).length, 0, 'an id with a path in it is not registered');
});

// ------------------------------------------------------------------------------------------ trailer + links

test('just commit adds the Agent-Session trailer; Stop links the commit and its files; for / find / resume lead back', { skip: !hasTool('git') && 'git is not installed' }, async () => {
  const root = await project();
  writeFileSync(join(root, 'TASKS.md'), LEDGER);
  const env = ENV();
  git(root, env, 'init', '--quiet', '-b', 'main');
  git(root, env, 'add', '-A');
  git(root, env, 'commit', '--quiet', '-m', 'initial');
  git(root, env, 'switch', '--quiet', '-c', 'feat/T-012-invite-flow');
  await start(root, env);
  const id = `claude:${NATIVE.claude}`;

  writeFileSync(join(root, 'join.txt'), 'join\n');
  git(root, env, 'add', 'join.txt');
  const out = capture();
  const err = capture();
  const code = await main(['gh', 'commit', 'feat', 'add', 'join', 'screen'], { stdout: out, stderr: err, cwd: root, env });
  assert.equal(code, 0, err.text() + out.text());
  assert.equal(git(root, env, 'log', '-1', '--format=%B'), `feat: add join screen\n\nRefs T-012\n\nAgent-Session: ${id}`);
  assert.equal(git(root, env, 'log', '-1', '--format=%(trailers:key=Agent-Session,valueonly)').trim(), id, 'git sees it as a trailer');
  const hash = git(root, env, 'rev-parse', 'HEAD');

  await stop(root, env);
  assert.deepEqual(links(env, id), [
    { kind: 'commit', ref: hash.slice(0, 12) }, { kind: 'file', ref: 'join.txt' }, { kind: 'task', ref: 'T-012' },
  ]);

  const forTask = await yaw(root, ['for', 'T-012'], env);
  assert.match(forTask.out, new RegExp(`^${id}  \\d{4}-\\d{2}-\\d{2}  T-012 Online invite flow  \\[feat/T-012-invite-flow\\]$`, 'm'));
  assert.match((await yaw(root, ['for', hash.slice(0, 8)], env)).out, new RegExp(id));
  assert.match((await yaw(root, ['for', 'join.txt'], env)).out, new RegExp(id));
  assert.match((await yaw(root, ['find', 'invite flow'], env)).out, new RegExp(id));
  assert.equal((await yaw(root, ['for', 'T-999'], env)).out, 'no matching session\n');
});

test('parseRef: an all-digit short hash is a commit, #N and short bare numbers are issues', () => {
  assert.deepEqual(parseRef('12345678'), { kind: 'commit', ref: '12345678' });
  assert.deepEqual(parseRef('#123'), { kind: 'task', ref: '#123' });
  assert.deepEqual(parseRef('123'), { kind: 'task', ref: '#123' });
});

test('without a current session (or past 4 h) a commit simply carries no trailer; YAW_SESSION overrides', { skip: !hasTool('git') && 'git is not installed' }, async () => {
  const root = await project();
  const env = ENV();
  git(root, env, 'init', '--quiet', '-b', 'main');
  git(root, env, 'add', '-A');
  git(root, env, 'commit', '--quiet', '-m', 'initial');
  git(root, env, 'switch', '--quiet', '-c', 'feat/T-012-x');
  const commit = async (e, name) => {
    writeFileSync(join(root, name), 'x\n');
    git(root, e, 'add', name);
    const code = await main(['gh', 'commit', 'feat', name], { stdout: capture(), stderr: capture(), cwd: root, env: e });
    assert.equal(code, 0);
    return git(root, e, 'log', '-1', '--format=%B');
  };
  assert.doesNotMatch(await commit(env, 'a.txt'), /Agent-Session/);
  await start(root, env);
  assert.match(await commit(env, 'b.txt'), /Agent-Session: claude:5f2c/);
  const old = new Date(Date.now() + 5 * 60 * 60 * 1000);
  withRegistry(env, (db) => assert.equal(currentSession({ db, root, env, now: old }), null));
  assert.match(await commit({ ...env, YAW_SESSION: 'codex:abc-1' }, 'c.txt'), /Agent-Session: codex:abc-1/);
  assert.doesNotMatch(await commit({ ...env, YAW_SESSION: 'evil; rm -rf' }, 'd.txt'), /Agent-Session/);
});

test('commit message trailers: own paragraph, only well-formed lines', () => {
  assert.equal(commitMessage({ type: 'fix', subject: 'x', trailers: ['Agent-Session: claude:abc'] }), 'fix: x\n\nAgent-Session: claude:abc');
  assert.equal(commitMessage({ type: 'fix', subject: 'x', trailers: ['bad\nline: y', 'no separator'] }), 'fix: x');
});

test('commitsOf reads HEAD only and only since the session started', { skip: !hasTool('git') && 'git is not installed' }, () => {
  const root = tmp('yaw-git-');
  const env = ENV();
  git(root, env, 'init', '--quiet', '-b', 'main');
  const commit = (name, msg, date) => {
    writeFileSync(join(root, name), name);
    git(root, env, 'add', name);
    const e = date ? { ...env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date } : env;
    git(root, e, 'commit', '--quiet', '-m', msg);
  };
  commit('old', 'old\n\nAgent-Session: claude:abc', '2020-01-01T00:00:00Z');
  git(root, env, 'switch', '--quiet', '-c', 'other');
  commit('elsewhere', 'other\n\nAgent-Session: claude:abc');
  git(root, env, 'switch', '--quiet', 'main');
  commit('mine', 'mine\n\nAgent-Session: claude:abc');
  const head = commitsOf(root, 'claude:abc', env, { since: '2025-01-01T00:00:00Z' });
  assert.deepEqual(head.files, ['mine'], 'not the other branch, not before the session');
  assert.equal(head.commits.length, 1);
  assert.equal(commitsOf(root, 'claude:abc', env, { since: '2025-01-01T00:00:00Z', known: new Set(head.commits) }).files.length, 0, 'known commits are not diffed again');
});

test('commitsOf matches the trailer exactly, not a longer id that starts with it', { skip: !hasTool('git') && 'git is not installed' }, () => {
  const root = tmp('yaw-git-');
  const env = ENV();
  git(root, env, 'init', '--quiet', '-b', 'main');
  writeFileSync(join(root, 'a'), '1');
  git(root, env, 'add', 'a');
  git(root, env, 'commit', '--quiet', '-m', 'one\n\nAgent-Session: claude:abcd');
  writeFileSync(join(root, 'b'), '2');
  git(root, env, 'add', 'b');
  git(root, env, 'commit', '--quiet', '-m', 'two\n\nAgent-Session: claude:abc');
  const found = commitsOf(root, 'claude:abc', env);
  assert.equal(found.commits.length, 1);
  assert.deepEqual(found.files, ['b']);
});

// ------------------------------------------------------------------------------------------ CLI

async function seeded() {
  const root = await project();
  writeFileSync(join(root, 'TASKS.md'), LEDGER);
  const env = ENV();
  await start(root, env);
  await start(root, env, 'codex');
  withRegistry(env, (db) => {
    db.prepare('UPDATE sessions SET title = ? WHERE agent = ?').run('Token expiry for the signaling server', 'codex');
    db.prepare("INSERT INTO session_links VALUES (?, 'decision', 'ADR-0004')").run(`codex:${NATIVE.codex}`);
  });
  return { root, env };
}

test('find: ranks by title, branch and links; other projects only with --all; German words work', async () => {
  const { root, env } = await seeded();
  const hit = await yaw(root, ['find', 'token', 'expiry'], env);
  assert.equal(hit.code, 0);
  assert.equal(hit.out.trim().split('\n')[0].split('  ')[0], `codex:${NATIVE.codex}`);
  assert.equal((await yaw(root, ['find', 'lemon cake'], env)).out, 'no matching session\n');
  assert.match((await yaw(root, ['find', 'ADR-0004'], env)).out, /codex:/);
  const other = await project();
  assert.equal((await yaw(other, ['find', 'token expiry'], env)).out, 'no matching session\n');
  assert.match((await yaw(other, ['find', 'token expiry', '--all'], env)).out, /codex:/);
  assert.equal((await yaw(root, ['find'], env)).code, 1);
});

test('for: tasks (T-012, #34 form), decisions, unknown refs, bad refs', async () => {
  const { root, env } = await seeded();
  assert.match((await yaw(root, ['for', 't-012'], env)).out, /claude:.*\n.*codex:|codex:.*\n.*claude:/s);
  assert.match((await yaw(root, ['for', 'ADR-0004'], env)).out, /^codex:/);
  const bad = await yaw(root, ['for', '../../etc/passwd'], env);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /not a task, decision, commit or project-relative file/);
  assert.equal((await yaw(root, ['for'], env)).code, 1);
});

test('resume prints the command and the folder; it never runs anything and ignores the stored command text', async () => {
  const { root, env } = await seeded();
  const r = await yaw(root, ['resume', NATIVE.claude.slice(0, 8)], env);
  assert.equal(r.code, 0, r.err);
  const lines = r.out.trim().split('\n');
  assert.match(lines[1], new RegExp(`^cd '.*yaw-sessions-.*' && claude --resume ${NATIVE.claude}$`));
  assert.match(lines[2], /^transcript: \/home\/user\//);
  withRegistry(env, (db) => db.prepare('UPDATE sessions SET resume = ?').run('rm -rf ~; claude'));
  assert.doesNotMatch((await yaw(root, ['resume', `codex:${NATIVE.codex}`], env)).out, /rm -rf/);
  assert.match((await yaw(root, ['resume', `codex:${NATIVE.codex}`], env)).out, new RegExp(`codex resume ${NATIVE.codex}`));
  assert.match((await yaw(root, ['resume', 'zzzz'], env)).err, /no session/);
  assert.match((await yaw(root, ['resume', 'abc'], env)).err, /at least 4 characters/);
  assert.match((await yaw(root, ['resume', '0'], env)).err, /usage/);
});

test('resume refuses a damaged row and an ambiguous prefix', async () => {
  const { root, env } = await seeded();
  await start(root, env, 'copilot');
  withRegistry(env, (db) => db.prepare('INSERT INTO sessions (id, agent, project, started) VALUES (?, ?, ?, ?)').run('copilot:copilot-0f3e-b', 'copilot', '/tmp/x', '2026-01-01T00:00:00.000Z'));
  const two = await yaw(root, ['resume', 'copilot-0f3e'], env);
  assert.equal(two.code, 1);
  assert.match(two.err, /matches 2 sessions/);
  withRegistry(env, (db) => db.prepare('UPDATE sessions SET project = ? WHERE id = ?').run('/tmp/x\nrm -rf /', `claude:${NATIVE.claude}`));
  assert.match((await yaw(root, ['resume', `claude:${NATIVE.claude}`], env)).err, /looks damaged/);
});

test('list, current and the terminal-safe output', async () => {
  const { root, env } = await seeded();
  withRegistry(env, (db) => db.prepare('UPDATE sessions SET title = ? WHERE agent = ?').run('evil \u001b[31mred\u0007 title', 'claude'));
  const list = await yaw(root, ['list'], env);
  assert.doesNotMatch(list.out, /[\u001b\u0007]/);
  assert.match(list.out, /evil \[31mred title/);
  assert.equal(list.out.trim().split('\n').length, 2);
  const cur = await yaw(root, ['current'], env);
  assert.match(cur.out.trim(), /^(claude|codex):/);
  const nothing = await yaw(await project(), ['current'], env);
  assert.deepEqual([nothing.code, nothing.out, nothing.err], [1, '', 'no current session\n']);
});

test('damaged session ids never emit terminal controls or enter commit trailers', async () => {
  const { root, env } = await seeded();
  withRegistry(env, (db) => db.prepare('INSERT INTO sessions (id, agent, project, started) VALUES (?, ?, ?, ?)').run('claude:bad\u009b31m\u001b[2J', 'claude', realRoot(root), new Date().toISOString()));
  const list = await yaw(root, ['list'], env);
  assert.doesNotMatch(list.out.replaceAll('\n', ''), /[\u0000-\u001f\u007f-\u009f]/);
  const current = await yaw(root, ['current'], { ...env, YAW_SESSION: '' });
  assert.equal(current.code, 1);
  assert.equal(current.out, '');
  assert.match(current.err, /looks damaged/);
});

test('resume refuses C1 controls in stored project paths', async () => {
  const { root, env } = await seeded();
  for (const control of ['\u0085', '\u009b', '\u009f']) {
    withRegistry(env, (db) => db.prepare('UPDATE sessions SET project = ? WHERE agent = ?').run(`/tmp/x${control}bad`, 'claude'));
    const r = await yaw(root, ['resume', `claude:${NATIVE.claude}`], env);
    assert.equal(r.code, 1);
    assert.equal(r.out, '');
    assert.match(r.err, /looks damaged/);
  }
});

test('handoff: sets the title on the current session, or creates one with --agent', async () => {
  const root = await project();
  writeFileSync(join(root, 'TASKS.md'), LEDGER);
  const env = ENV();
  const none = await yaw(root, ['handoff', '--title', 'T-012 invite'], env);
  assert.equal(none.code, 1);
  assert.match(none.err, /pass --agent/);
  const made = await yaw(root, ['handoff', '--agent', 'codex', '--title', 'T-012 invite'], env, new Date('2026-10-21T10:00:00Z'));
  assert.equal(made.code, 0, made.err);
  assert.match(made.out, /^session codex:handoff-20261021100000 recorded: T-012 invite/);
  await start(root, env);
  const done = await yaw(root, ['handoff', '--title', 'T-012 invite flow\u001b[2J done'], env);
  assert.equal(done.code, 0);
  assert.doesNotMatch(done.out, /\u001b/);
  const r = rows(env).find((x) => x.id.startsWith('claude:'));
  assert.equal(r.title, 'T-012 invite flow [2J done');
  assert.ok(r.ended);
  assert.equal((await yaw(root, ['handoff', '--agent', 'bash'], env)).code, 1);
  assert.equal((await yaw(root, ['handoff', '--session', 'x y'], env)).code, 1);
});

test('usage errors: unknown verb, missing verb, module not installed', async () => {
  const root = await project();
  const env = ENV();
  assert.match((await yaw(root, ['frob'], env)).err, /unknown verb "frob"[\s\S]*usage: yaw sessions find/);
  assert.match((await yaw(root, [], env)).err, /missing verb/);
  const off = await project({ modules: ['core', 'tasks'] });
  assert.match((await yaw(off, ['list'], env)).err, /sessions module is not installed/);
});

// ------------------------------------------------------------------------------------------ path safety

test('path safety: a symlinked TASKS.md is never read, a symlinked yaw.db is refused, bad ids and transcripts are not stored', async () => {
  const root = await project();
  const env = ENV();
  const outside = tmp('yaw-outside-');
  writeFileSync(join(outside, 'secret.md'), LEDGER);
  unlinkSync(join(root, 'TASKS.md'));
  symlinkSync(join(outside, 'secret.md'), join(root, 'TASKS.md'));
  await start(root, env, 'claude', { transcript_path: 'relative/../x.jsonl' });
  const [row] = rows(env);
  assert.equal(row.title, null, 'no title from a linked ledger');
  assert.equal(row.transcript, null, 'a relative transcript path is not stored');
  assert.equal(readRegular(root, 'TASKS.md'), null);
  mkdirSync(join(root, 'docs'));
  symlinkSync(outside, join(root, 'linked'));
  writeFileSync(join(outside, 'x.md'), 'x');
  assert.equal(readRegular(root, 'linked/x.md'), null, 'a symlinked directory in the path');
  assert.equal(readRegular(root, '../x'), null);
  assert.equal(readRegular(root, '/etc/passwd'), null);

  const home = tmp('yaw-home2-');
  mkdirSync(join(home, '.yaw'));
  symlinkSync(join(outside, 'planted.db'), join(home, '.yaw', 'yaw.db'));
  assert.throws(() => openRegistry({ HOME: home }), /regular file/);
  assert.equal(existsSync(join(outside, 'planted.db')), false);
  const r = await start(root, { ...env, HOME: home });
  assert.deepEqual([r.code, r.stdout], [0, '']);
});

test('the registry directory is 0700 even when it existed already', () => {
  const home = tmp('yaw-home3-');
  mkdirSync(join(home, '.yaw'), { mode: 0o755 });
  openRegistry({ HOME: home }).close();
  assert.equal(statSync(join(home, '.yaw')).mode & 0o777, 0o700);
});

test('relative registry homes are refused before directory creation or chmod', () => {
  assert.equal(tightenHome('.yaw', true), false, 'the permission helper itself also refuses relative paths');
  for (const env of [{ YAW_HOME: '.yaw' }, { HOME: 'relative-home' }, {}]) {
    assert.throws(() => openRegistry(env), /absolute path/);
  }
});

test('readRegular refuses a file swapped for a symlink between the check and open', () => {
  const root = tmp('yaw-ledger-race-');
  const outside = tmp('yaw-ledger-target-');
  writeFileSync(join(root, 'TASKS.md'), LEDGER);
  writeFileSync(join(outside, 'target.md'), 'not a ledger');
  const text = readRegular(root, 'TASKS.md', { open: (path, flags) => {
    unlinkSync(path);
    symlinkSync(join(outside, 'target.md'), path);
    return openSync(path, flags);
  } });
  assert.equal(text, null);
});

test('readRegular binds reads to the checked inode, including parent and root swaps', () => {
  for (const swap of ['file', 'parent', 'root']) {
    const base = tmp('yaw-ledger-swap-');
    const root = join(base, 'project');
    const outside = join(base, 'outside');
    mkdirSync(join(root, 'docs'), { recursive: true });
    mkdirSync(join(outside, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs', 'TASKS.md'), LEDGER);
    writeFileSync(join(outside, 'docs', 'TASKS.md'), 'outside ledger');
    const result = readRegular(root, 'docs/TASKS.md', { open: (path, flags) => {
      if (swap === 'file') {
        renameSync(path, `${path}.original`);
        writeFileSync(path, 'replacement ledger');
      } else {
        const replaced = swap === 'root' ? root : join(root, 'docs');
        renameSync(replaced, `${replaced}.original`);
        symlinkSync(swap === 'root' ? outside : join(outside, 'docs'), replaced);
      }
      return openSync(path, flags);
    } });
    assert.equal(result, null, swap);
  }
});

test('tightenHome does not chmod a replacement directory or a swapped parent target', () => {
  for (const swap of ['directory', 'parent']) {
    const base = tmp('yaw-chmod-swap-');
    const parent = join(base, 'parent');
    const outside = join(base, 'outside');
    mkdirSync(join(parent, '.yaw'), { recursive: true, mode: 0o755 });
    mkdirSync(join(outside, '.yaw'), { recursive: true, mode: 0o755 });
    const home = join(parent, '.yaw');
    const result = tightenHome(home, true, process.getuid(), { open: (path, flags) => {
      if (swap === 'directory') {
        renameSync(home, `${home}.original`);
        mkdirSync(home, { mode: 0o755 });
      } else {
        renameSync(parent, `${parent}.original`);
        symlinkSync(outside, parent);
      }
      return openSync(path, flags);
    } });
    assert.equal(result, false, swap);
    assert.equal(statSync(home).mode & 0o777, 0o755, 'replacement permissions unchanged');
  }
});

test('registry refuses unsafe homes, writable ancestry, and linked or writable SQLite sidecars', () => {
  const base = tmp('yaw-registry-safety-');
  const publicHome = join(base, 'public');
  mkdirSync(publicHome, { mode: 0o755 });
  assert.throws(() => openRegistry({ YAW_HOME: publicHome }), /private directory/);
  assert.equal(statSync(publicHome).mode & 0o777, 0o755, 'custom permissions unchanged');
  assert.equal(existsSync(join(publicHome, 'yaw.db')), false);
  symlinkSync(publicHome, join(base, 'linked'));
  assert.throws(() => openRegistry({ YAW_HOME: join(base, 'linked') }), /private directory/);

  const shared = join(base, 'shared');
  mkdirSync(shared);
  chmodSync(shared, 0o777);
  assert.throws(() => openRegistry({ YAW_HOME: join(shared, '.yaw') }), /ancestry/);
  assert.equal(existsSync(join(shared, '.yaw')), false, 'refusal precedes mkdir');

  for (const suffix of ['-journal', '-wal', '-shm']) {
    const home = tmp('yaw-sidecar-');
    const target = join(base, `outside${suffix}`);
    writeFileSync(target, 'untouched');
    symlinkSync(target, join(home, `yaw.db${suffix}`));
    assert.throws(() => openRegistry({ YAW_HOME: home }), /regular file/);
    assert.equal(read(base, `outside${suffix}`), 'untouched');
  }
  const home = tmp('yaw-shared-db-');
  writeFileSync(join(home, 'yaw.db'), '');
  chmodSync(join(home, 'yaw.db'), 0o666);
  assert.throws(() => openRegistry({ YAW_HOME: home }), /shared writable file/);
  unlinkSync(join(home, 'yaw.db'));
  const target = join(base, 'linked.db');
  writeFileSync(target, '');
  linkSync(target, join(home, 'yaw.db'));
  assert.throws(() => openRegistry({ YAW_HOME: home }), /regular file/);
});

test('registry detects file replacements before chmod and persistent SQLite-open swaps before migration', () => {
  const home = tmp('yaw-db-open-swap-');
  const file = join(home, 'yaw.db');
  writeFileSync(file, '');
  assert.throws(() => openRegistry({ YAW_HOME: home }, { open: (path, flags) => {
    renameSync(file, `${file}.original`);
    writeFileSync(file, '', { mode: 0o644 });
    return openSync(path, flags);
  } }), /changed while opening the registry/);
  assert.equal(statSync(file).mode & 0o777, 0o644, 'replacement is not chmodded');

  let closed = false;
  let executed = false;
  assert.throws(() => openRegistry({ YAW_HOME: home }, { database: () => {
    renameSync(file, `${file}.replaced`);
    writeFileSync(file, '');
    return { close: () => { closed = true; }, exec: () => { executed = true; } };
  } }), /changed while opening SQLite/);
  assert.equal(closed, true, 'SQLite handle is closed on validation failure');
  assert.equal(executed, false, 'no schema or session writes after a detected swap');
});

test('concurrent creation is rechecked and registry permissions are private', () => {
  const home = tmp('yaw-db-create-race-');
  let calls = 0;
  const db = openRegistry({ YAW_HOME: home }, { open: (path, flags, mode) => {
    if (calls++ === 0) writeFileSync(path, '', { mode: 0o600 });
    return openSync(path, flags, mode);
  } });
  db.close();
  assert.equal(calls, 2);
  assert.equal(statSync(join(home, 'yaw.db')).mode & 0o777, 0o600);
});

test('0700 never follows a link, never touches a foreign or user-chosen directory, never throws', () => {
  const base = tmp('yaw-mode-');
  const target = join(base, 'other');
  mkdirSync(target, { mode: 0o755 });
  symlinkSync(target, join(base, 'linked'));
  mkdirSync(join(base, 'plain'), { mode: 0o755 });
  assert.equal(tightenHome(join(base, 'linked'), true), false);
  assert.equal(tightenHome(`${join(base, 'linked')}/`, true), false, 'a trailing slash does not make lstat follow the link');
  mkdirSync(join(base, 'h'));
  symlinkSync(target, join(base, 'h', '.yaw'));
  assert.equal(tightenHome(`${join(base, 'h', '.yaw')}//`, true), false);
  assert.equal(statSync(target).mode & 0o777, 0o755, 'the link target is untouched');
  assert.equal(tightenHome(join(base, 'plain'), true), false, 'an existing directory not named .yaw (YAW_HOME=$HOME) is left alone');
  assert.equal(statSync(join(base, 'plain')).mode & 0o777, 0o755);
  mkdirSync(join(base, '.yaw'), { mode: 0o755 });
  assert.equal(tightenHome(join(base, '.yaw'), true, process.getuid() + 1), false, 'not owned: no change, no throw');
  assert.equal(statSync(join(base, '.yaw')).mode & 0o777, 0o755);
  assert.equal(tightenHome(join(base, 'missing'), true), false);
  assert.equal(tightenHome(join(base, '.yaw'), true), true);
  assert.equal(statSync(join(base, '.yaw')).mode & 0o777, 0o700);
  // end to end: a foreign YAW_HOME still gives a working registry
  const home = tmp('yaw-foreign-');
  withRegistry({ YAW_HOME: home }, (db) => assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0));
});

test('helpers: ids, branch tasks, resume commands, control characters', () => {
  assert.equal(sessionId('claude', 'abc-1'), 'claude:abc-1');
  for (const bad of ['', '../x', 'a b', 'a;b', '-x', 'x'.repeat(200), null, 5]) assert.equal(sessionId('claude', bad), null, String(bad));
  assert.equal(sessionId('gemini', 'abc'), null);
  assert.equal(branchTask('feat/T-012-invite'), 'T-012');
  assert.equal(branchTask('fix/034-crash'), '#34');
  assert.equal(branchTask('main'), null);
  assert.throws(() => resumeCommand('claude', 'a b'), /unexpected form/);
  assert.equal(clean('a\u001b[0m\n\tb'), 'a [0m b');
});

test('the registry uses the phase-1 tables only and the existing schema', () => {
  const dir = tmp('yaw-db-');
  const db = openYawDb(join(dir, 'yaw.db'));
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name);
  db.close();
  assert.deepEqual(names, ['schema_migrations', 'session_links', 'sessions']);
});

// ------------------------------------------------------------------------------------------ removal

test('remove: zero residue, answers kept, a re-add restores the same files; the registry is user data and stays', async () => {
  const root = await project();
  const env = ENV();
  await start(root, env);
  const before = readTree(root);
  await removeModule({ root, module: 'sessions' });
  const left = readTree(root);
  for (const gone of ['just/sessions.just', '.agents/skills/handoff/SKILL.md', '.claude/skills/handoff/SKILL.md']) assert.equal(Object.hasOwn(left, gone), false, gone);
  assert.doesNotMatch(left.justfile, /sessions/);
  assert.doesNotMatch(left['AGENTS.md'], /yaw:sessions|just sessions/);
  assert.doesNotMatch(left['.gitignore'] ?? '', /\.yaw\/sessions/);
  for (const file of ['.claude/settings.json', '.codex/hooks.json']) assert.doesNotMatch(left[file] ?? '', /--module sessions/, file);
  assert.equal(readManifest(root).modules.sessions, undefined);
  assert.ok(!readManifest(root).files.some((f) => f.module === 'sessions'));
  assert.deepEqual(Object.keys(left).filter((p) => p.includes('session')), []);
  assert.deepEqual(readAnswers(root).answers['user.agents'], ['claude', 'codex', 'copilot']);

  assert.deepEqual(moduleQuestions({ root, definition: loadModule(KIT_ROOT, 'sessions') }), []);
  await addModule({ root, module: 'sessions' });
  assert.deepEqual(readTree(root), before);
  assert.equal(rows(env).length, 1, 'removing the module leaves ~/.yaw/yaw.db alone');
});

test('after removal the hooks do nothing: the registry is not written', async () => {
  const root = await project();
  const env = ENV();
  await removeModule({ root, module: 'sessions' });
  const r = await start(root, env);
  assert.deepEqual([r.code, r.stdout], [0, '']);
  assert.equal(existsSync(join(env.HOME, '.yaw', 'yaw.db')), false);
});
