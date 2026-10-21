// team (Y-5.9, ADR-0031): team-mode enforcement. Agent guards (edits, git commit/push) in Claude, Codex and Copilot,
// lefthook commit-msg / pre-push, the pr-policy workflow, `gh protect --verify`, the session-start sync (fetch, safe
// fast-forward, gh reads cached for 5 minutes, offline fail-open), token-free output per hook, path safety of the
// cache, removal with zero residue. git is real (a local bare "origin"); gh is a stand-in, never GitHub.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../../../core/cli/main.js';
import { parse } from '../../../core/lib/yaml.js';
import { loadModule } from '../../../core/render/kit.js';
import { readManifest } from '../../../core/render/manifest.js';
import { addModule, initProject, moduleQuestions, readAnswers, removeModule, selectModules } from '../../../core/render/project.js';
import { declaredAgent, fixture, hook, listFixtures, shim, toolCall } from '../../../test/helpers/hooks.js';
import { KIT_ROOT, capture, cleanEnv, hasTool, readTree, run, tmp, writeAnswers } from '../../../test/helpers/fixtures.js';
import { commitSkipsHooks, editDecision, gitCalls, gitDecision, parsePush, pushTarget, simpleCommands, touchesProject } from '../lib/guards.js';
import { CACHE_MS, cacheFile, clean, digest, readCache, sessionStart, writeCache } from '../lib/sync.js';

const MODULES = ['core', 'security', 'tasks', 'github', 'git-hooks', 'ci', 'team'];

function answersText({ modules = MODULES, team = 'team', extra = '' } = {}) {
  return `mode: standard\nanswers:\n  user.agents: [claude, codex, copilot]\n  idea.text: A tiny command-line tool.\n  idea.team: ${team}\n${extra}proposal:\n  status: confirmed\n  summary: test project\n  profiles: [node-cli]\n  modules: [${modules.join(', ')}]\n`;
}

async function project(options = {}) {
  const root = tmp('yaw-team-');
  await initProject({ root, answersFile: writeAnswers(tmp('yaw-ans-'), answersText(options)), modules: options.modules ?? MODULES });
  return root;
}

// ------------------------------------------------------------------------- gh stand-in on the PATH

// A `gh` executable that logs its arguments and answers from a JSON file; the PATH puts it before any real gh.
function fakeGhBin(data = {}) {
  const dir = tmp('yaw-fakegh-');
  const log = join(dir, 'calls.jsonl');
  const file = join(dir, 'data.json');
  writeFileSync(file, JSON.stringify(data));
  writeFileSync(join(dir, 'gh'), `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
const data = JSON.parse(fs.readFileSync(${JSON.stringify(file)}, 'utf8'));
if (data.fail) { process.stderr.write('HTTP 502: Bad Gateway\\n'); process.exit(1); }
const key = args.slice(0, 2).join(' ');
const out = (v) => process.stdout.write(typeof v === 'string' ? v : JSON.stringify(v));
if (key === 'issue list') out(data.mine ?? []);
else if (key === 'pr list') out(args.includes('--author') ? (data.authored ?? []) : (data.reviews ?? []));
else if (key === 'issue view') out(data.view ?? { title: 'x', labels: [] });
else if (key === 'issue edit') out('');
else { process.stderr.write('unexpected gh call ' + args.join(' ') + '\\n'); process.exit(1); }
`, { mode: 0o755 });
  return {
    dir,
    calls: () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []),
    set: (next) => writeFileSync(file, JSON.stringify(next)),
  };
}

const GH_DATA = {
  mine: [
    { number: 7, title: 'Low one', labels: [{ name: 'priority:P3' }], milestone: null },
    { number: 34, title: 'Login crash\u001b[31m on start', labels: [{ name: 'priority:P1' }, { name: 'estimate:S' }], milestone: { title: 'v1.0', dueOn: '2026-11-01T00:00:00Z' } },
    { number: 12, title: 'Urgent', labels: [{ name: 'priority:P0' }], milestone: null },
  ],
  reviews: [{ number: 40, title: 'Add invite flow' }],
  authored: [
    { number: 38, title: 'Fix x', reviewDecision: 'REVIEW_REQUIRED', statusCheckRollup: [{ name: 'quality-gate', conclusion: 'FAILURE' }] },
    { number: 39, title: 'Y', reviewDecision: 'CHANGES_REQUESTED', statusCheckRollup: [] },
    { number: 41, title: 'Fine', reviewDecision: 'APPROVED', statusCheckRollup: [{ name: 'quality-gate', conclusion: 'SUCCESS' }] },
  ],
};

// Env for real git with a temporary HOME and the gh stand-in first on the PATH.
function envWith(gh) {
  return cleanEnv(tmp('yaw-home-'), { PATH: `${gh.dir}:${process.env.PATH}` });
}

// A project in a git repo whose origin is a local bare repository; main is pushed and origin/HEAD set.
async function repo(options = {}) {
  const root = await project(options);
  const gh = fakeGhBin(options.ghData ?? GH_DATA);
  const env = envWith(gh);
  const origin = tmp('yaw-origin-');
  const g = (cwd, ...args) => {
    const r = run('git', args, { cwd, env });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  g(origin, 'init', '--quiet', '--bare', '-b', 'main');
  g(root, 'init', '--quiet', '-b', 'main');
  g(root, 'add', '-A');
  g(root, 'commit', '--quiet', '-m', 'initial');
  g(root, 'remote', 'add', 'origin', origin);
  g(root, 'push', '--quiet', '-u', 'origin', 'main');
  g(root, 'remote', 'set-head', 'origin', 'main');
  // a second clone, to move origin ahead like a teammate would
  const mate = tmp('yaw-mate-');
  g(mate, 'clone', '--quiet', origin, '.');
  const teammate = (branch, file) => {
    g(mate, 'fetch', '--quiet', 'origin');
    g(mate, 'switch', '--quiet', '-C', branch, `origin/${branch}`);
    writeFileSync(join(mate, file), `${file}\n`);
    g(mate, 'add', file);
    g(mate, 'commit', '--quiet', '-m', `teammate ${file} #1`);
    g(mate, 'push', '--quiet', 'origin', branch);
  };
  return { root, origin, env, gh, git: (...a) => g(root, ...a), teammate };
}

// ------------------------------------------------------------------------------------------ module

test('module: guards, a user-only session sync, one context hook on SessionStart; depends on tasks, github, git-hooks', () => {
  const def = loadModule(KIT_ROOT, 'team');
  assert.deepEqual(def.depends, ['tasks', 'github', 'git-hooks']);
  assert.deepEqual(def.outputs.hooks.map((h) => [h.name, h.event, h.kind]), [
    ['guard-edit', 'PreToolUse', 'guard'], ['guard-git', 'PreToolUse', 'guard'],
    ['session-sync', 'SessionStart', 'comfort'], ['session-issue', 'SessionStart', 'context'],
  ]);
  assert.equal(def.outputs.hooks.find((h) => h.kind === 'context').tokenCost, 'low');
  assert.deepEqual(def.questions.map((q) => [q.id, q.type, q.default]), [['team.session-context', 'boolean', true]]);
  assert.ok(def.agentsMd.trim().split('\n').length <= 3);
});

test('selection: preselected in Standard and Full for a team, never in Quick or for a solo project', () => {
  assert.ok(selectModules({ mode: 'standard', facts: { team: true } }).includes('team'));
  assert.ok(selectModules({ mode: 'full', facts: { team: true } }).includes('team'));
  assert.ok(!selectModules({ mode: 'quick', facts: { team: true } }).includes('team'));
  assert.ok(!selectModules({ mode: 'standard', facts: { team: false } }).includes('team'));
  assert.ok(!selectModules({ mode: 'standard', facts: {} }).includes('team'));
});

test('install: lefthook commit-msg / pre-push in a team block, pr-policy workflow, just start, pr-policy required; manifest entries', async () => {
  const root = await project();
  const tree = readTree(root);
  assert.match(tree['lefthook.yml'], /^pre-commit:/m, 'the git-hooks frame stays');
  assert.match(tree['lefthook.yml'], /# yaw:team\n[\s\S]*^commit-msg:[\s\S]*^pre-push:[\s\S]*# \/yaw:team/m);
  const lefthook = parse(tree['lefthook.yml']);
  assert.deepEqual(Object.keys(lefthook), ['pre-commit', 'commit-msg', 'pre-push']);
  assert.equal(lefthook['pre-push'].jobs[0].use_stdin, true);
  assert.match(tree['just/team.just'], /^start:/m);
  assert.match(tree.justfile, /# yaw:team\nimport 'just\/team.just'\n# \/yaw:team/);
  assert.deepEqual(parse(tree['.yaw/github.yaml']).rules.requiredChecks, ['quality-gate', 'secret-scan', 'pr-policy']);
  assert.ok(tree['AGENTS.md'].split('\n').length <= 80);
  assert.match(tree['AGENTS.md'], /<!-- yaw:team -->\n- Team mode: no change without an issue/);
  const files = Object.fromEntries(readManifest(root).files.map((f) => [f.path, f]));
  assert.equal(files['lefthook.yml'].module, 'git-hooks');
  assert.deepEqual(files['lefthook.yml'].fragments.map((f) => f.module), ['team']);
  assert.equal(files['.github/workflows/pr-policy.yml'].module, 'team');
  assert.equal(files['.lefthook/pre-push/yaw-default-branch.sh'].module, 'team');
  assert.equal(files['just/team.just'].module, 'team');
  for (const shared of ['justfile', 'AGENTS.md', '.claude/settings.json', '.codex/hooks.json']) {
    assert.ok(files[shared].fragments.some((f) => f.module === 'team'), shared);
  }
  const claude = JSON.parse(tree['.claude/settings.json']).hooks;
  assert.ok(claude.PreToolUse.some((e) => e.matcher === 'Edit|Write|MultiEdit|NotebookEdit|Bash' && /--module team/.test(e.hooks[0].command)));
  assert.ok(claude.SessionStart.some((e) => /--module team/.test(e.hooks[0].command) && e.matcher === undefined));
  const codex = JSON.parse(tree['.codex/hooks.json']).hooks;
  assert.ok(codex.PreToolUse.some((e) => e.matcher === 'apply_patch|Bash' && /--module team/.test(e.hooks[0].command)));
});

test('remove: zero residue (lefthook, github.yaml, settings back to the pre-add state); answers kept; re-add asks again', async () => {
  const root = await project({ modules: MODULES.filter((m) => m !== 'team') });
  const before = readTree(root);
  await addModule({ root, module: 'team', newAnswers: { 'team.session-context': false } });
  const added = readTree(root);
  assert.notDeepEqual(added, before);
  await removeModule({ root, module: 'team' });
  // Everything but the answers (the new answer is kept) and the manifest (which hashes the answers) is as before.
  const strip = (tree) => Object.fromEntries(Object.entries(tree).filter(([k]) => !['.yaw/answers.yaml', '.yaw/manifest.json', '.yaw/base/.yaw/answers.yaml'].includes(k)));
  assert.deepEqual(strip(readTree(root)), strip(before));
  assert.equal(readManifest(root).modules.team, undefined);
  assert.ok(!readManifest(root).files.some((f) => f.module === 'team' || (f.fragments ?? []).some((x) => x.module === 'team')));
  assert.equal(readAnswers(root).answers['team.session-context'], false, 'the answer is kept');
  const asked = moduleQuestions({ root, definition: loadModule(KIT_ROOT, 'team') });
  assert.deepEqual(asked.map((q) => [q.id, q.default]), [['team.session-context', false]]);
  await addModule({ root, module: 'team' });
  assert.deepEqual(readTree(root), added);
});

test('dependencies: team needs tasks, github and git-hooks; git-hooks cannot be removed under it', async () => {
  const root = await project({ modules: ['core', 'security', 'tasks', 'github'] });
  await assert.rejects(addModule({ root, module: 'team' }), /depends on git-hooks/);
  const full = await project();
  await assert.rejects(removeModule({ root: full, module: 'git-hooks' }), /team depends on git-hooks/);
});

// ------------------------------------------------------------------------------------- guards (pure)

test('shell words: quotes, separators and git options are read; text inside quotes is not a command', () => {
  assert.deepEqual(simpleCommands(`git commit -m "push to main" && git push origin 'feat/1-x'; echo a|b`), [
    ['git', 'commit', '-m', 'push to main'], ['git', 'push', 'origin', 'feat/1-x'], ['echo', 'a'], ['b'],
  ]);
  assert.deepEqual(gitCalls('GIT_DIR=x sudo git -C sub -c a=b push origin main').map((c) => c.sub), ['push']);
  assert.deepEqual(gitCalls('echo "git push origin main"'), []);
  assert.deepEqual(gitCalls('/usr/bin/git commit -q').map((c) => c.sub), ['commit']);
  assert.deepEqual(gitCalls('$(git push origin main)').map((c) => c.sub), ['push']);
  assert.deepEqual(parsePush(['-u', 'origin', 'feat/1-x']), { force: false, all: false, noVerify: false, remote: 'origin', refspecs: ['feat/1-x'] });
  for (const f of [['--force'], ['-f'], ['-uf'], ['--force-with-lease'], ['--force-with-lease=main'], ['--force-if-includes'], ['origin', '+feat/1-x']]) assert.equal(parsePush(f).force, true, f.join(' '));
  assert.equal(parsePush(['-o', 'ci.skip', 'origin']).force, false);
  assert.equal(parsePush(['--mirror']).all, true);
  assert.equal(pushTarget('HEAD:refs/heads/main', 'feat/1-x'), 'main');
  assert.equal(pushTarget('HEAD', 'feat/1-x'), 'feat/1-x');
  assert.equal(pushTarget('+x:main', 'feat/1-x'), 'main');
  assert.equal(commitSkipsHooks(['--no-verify']), true);
  assert.equal(commitSkipsHooks(['-n']), true);
  assert.equal(commitSkipsHooks(['-anm', 'x']), true);
  assert.equal(commitSkipsHooks(['-m', '-n']), false, 'a message "-n" is not the flag');
  assert.equal(commitSkipsHooks(['-am', 'fix n things']), false);
});

test('decisions: edits need an issue branch that has not diverged; commits and pushes stay off the default branch', () => {
  const s = (over) => ({ branch: 'feat/34-x', defaultBranch: 'main', issue: 34, upstream: null, ahead: null, behind: null, ...over });
  assert.equal(editDecision(null), null, 'not a git work tree: allowed');
  assert.equal(editDecision(s()), null);
  assert.match(editDecision(s({ branch: 'main', issue: null })), /default branch main.*just task start <#>/);
  assert.match(editDecision(s({ branch: '', issue: null })), /detached/);
  assert.match(editDecision(s({ branch: 'feature/abc', issue: null })), /carries no issue number/);
  assert.match(editDecision(s({ upstream: 'origin/feat/34-x', ahead: 1, behind: 2 })), /diverged.*rebases or merges/);
  assert.equal(editDecision(s({ upstream: 'origin/feat/34-x', ahead: 0, behind: 2 })), null, 'only behind: the session start pulls');
  for (const r of [editDecision(s({ branch: 'main', issue: null })), gitDecision('git push --force', s())]) assert.ok(r.length <= 300 && !r.includes('\n'));

  assert.equal(gitDecision('git commit -m "x"', s()), null);
  assert.match(gitDecision('git commit -m "x"', s({ branch: 'main', issue: null })), /commits on the default branch/);
  assert.match(gitDecision('git commit --no-verify -m x', s()), /--no-verify/);
  assert.equal(gitDecision('git push', s()), null);
  assert.equal(gitDecision('git push -u origin feat/34-x', s()), null);
  assert.match(gitDecision('git push', s({ branch: 'main', issue: null })), /pushing to the default branch main/);
  assert.match(gitDecision('git push origin HEAD:main', s()), /pushing to the default branch/);
  assert.match(gitDecision('git push origin --delete main', s()), /pushing to the default branch/);
  assert.match(gitDecision('npm test && git push --force-with-lease', s()), /force pushes/);
  assert.match(gitDecision('git push --all origin', s()), /--all/);
  assert.match(gitDecision('git push --no-verify', s()), /--no-verify/);
  assert.equal(gitDecision('git log main && git status', s({ branch: 'main', issue: null })), null);
  assert.equal(gitDecision('git push origin main', null), null, 'not a git work tree: allowed');
});

test('edits outside the project are not affected; a patch without readable paths counts as inside', () => {
  const root = tmp('yaw-root-');
  assert.equal(touchesProject(root, []), true);
  assert.equal(touchesProject(root, ['src/a.js']), true);
  assert.equal(touchesProject(root, [join(root, 'src', 'a.js')]), true);
  assert.equal(touchesProject(root, ['/tmp/elsewhere/notes.md']), false);
  assert.equal(touchesProject(root, [join(root, '..', 'sibling', 'x')]), false);
});

// ------------------------------------------------------------------------- guards through the dispatcher

const editCall = (agent, path = 'src/index.js') => (agent === 'codex'
  ? toolCall('codex', { command: `*** Begin Patch\n*** Update File: ${path}\n@@\n-a\n+b\n*** End Patch\n` }, 'apply_patch')
  : toolCall(agent, { file_path: path, old_string: 'a', new_string: 'b' }, 'Edit'));

async function decide({ root, env }, agent, payload) {
  const r = await hook({ root, agent: declaredAgent(agent), event: 'PreToolUse', module: 'team', payload: { ...payload, cwd: root }, env });
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
  if (r.stdout === '') return null;
  const out = JSON.parse(r.stdout);
  return agent === 'copilot' ? out.permissionDecisionReason : out.hookSpecificOutput.permissionDecisionReason;
}

test('edit guard: denied on main and on a branch without an issue, allowed on an issue branch (Claude, Codex, Copilot)', async () => {
  const r = await repo();
  for (const agent of ['claude', 'codex', 'copilot']) {
    r.git('switch', '--quiet', 'main');
    assert.match(await decide(r, agent, editCall(agent)), /YAW team mode: edits on the default branch main are blocked/, agent);
    assert.equal(await decide(r, agent, editCall(agent, '/tmp/outside-the-project.md')), null, `${agent}: outside the project`);
    r.git('switch', '--quiet', '-C', 'feature/abc');
    assert.match(await decide(r, agent, editCall(agent)), /carries no issue number/, agent);
    r.git('switch', '--quiet', '-C', 'feat/34-login-crash');
    assert.equal(await decide(r, agent, editCall(agent)), null, agent);
  }
  r.git('switch', '--quiet', '--detach');
  assert.match(await decide(r, 'claude', editCall('claude')), /detached/);
});

test('edit guard: a branch that has diverged from its upstream is blocked until it is rebased or merged', async () => {
  const r = await repo();
  r.git('switch', '--quiet', '-c', 'feat/34-x');
  r.git('push', '--quiet', '-u', 'origin', 'feat/34-x');
  r.teammate('feat/34-x', 'theirs.txt');
  writeFileSync(join(r.root, 'mine.txt'), 'mine\n');
  r.git('add', 'mine.txt');
  r.git('commit', '--quiet', '-m', 'mine #34');
  r.git('fetch', '--quiet', 'origin');
  assert.match(await decide(r, 'claude', editCall('claude')), /diverged from origin\/feat\/34-x \(1 ahead, 1 behind\)/);
  r.git('merge', '--quiet', '--no-edit', 'origin/feat/34-x');
  assert.equal(await decide(r, 'claude', editCall('claude')), null);
});

test('git guard: commit on main, push to main, force push and --no-verify are denied; issue-branch work passes', async () => {
  const r = await repo();
  const bash = (agent, command) => decide(r, agent, toolCall(agent, { command }));
  for (const agent of ['claude', 'codex', 'copilot']) {
    r.git('switch', '--quiet', 'main');
    assert.match(await bash(agent, 'git add -A && git commit -m "fix"'), /commits on the default branch main/, agent);
    assert.match(await bash(agent, 'git push'), /pushing to the default branch main/, agent);
    r.git('switch', '--quiet', '-C', 'feat/34-x');
    assert.equal(await bash(agent, 'git commit -m "fix: x" -m "Refs #34"'), null, agent);
    assert.equal(await bash(agent, 'git push -u origin feat/34-x'), null, agent);
    assert.match(await bash(agent, 'git push origin feat/34-x:main'), /pushing to the default branch/, agent);
    assert.match(await bash(agent, 'git push -f'), /force pushes/, agent);
    assert.match(await bash(agent, 'git commit --no-verify -m x'), /--no-verify/, agent);
    assert.equal(await bash(agent, 'npm test'), null, agent);
  }
});

test('git guard: long-option prefixes, short refspecs, hook overrides, shell keywords and wrappers are read (review of #132)', async () => {
  const r = await repo();
  const bash = (command) => decide(r, 'claude', toolCall('claude', { command }));
  r.git('switch', '--quiet', '-C', 'feat/34-x');
  // 1. unambiguous prefixes of long options
  assert.match(await bash('git commit --no-verif -m x'), /--no-verify/);
  assert.match(await bash('git push --no-verif'), /--no-verify/);
  assert.match(await bash('git push --force-w'), /force pushes/);
  assert.match(await bash('git push --mirro origin'), /--all \/ --mirror/);
  assert.match(await bash('git push --al origin'), /--all \/ --mirror/);
  // 3. switching the hooks off
  assert.match(await bash('git -c core.hooksPath=/dev/null commit -m x'), /core\.hooksPath/);
  assert.match(await bash('git --config-env=core.hooksPath=EMPTY push'), /core\.hooksPath/);
  assert.match(await bash('git --config-env core.hooksPath=EMPTY push'), /core\.hooksPath/);
  assert.match(await bash('GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null git commit -m x'), /core\.hooksPath/);
  assert.match(await bash('git config core.hooksPath /dev/null'), /core\.hooksPath/);
  assert.equal(await bash('git -c user.name=x commit -m "fix: y" -m "Refs #34"'), null);
  r.git('switch', '--quiet', 'main');
  // 2. short destinations of a refspec
  assert.match(await bash('git push origin HEAD:heads/main'), /pushing to the default branch main/);
  assert.match(await bash('git push origin HEAD:refs/heads/main'), /pushing to the default branch main/);
  // 4. behind shell keywords and wrapper options
  for (const command of [
    'if true; then git commit -m x; fi',
    'for f in a; do git commit -m x; done',
    'if false; then :; else git commit -m x; fi',
    'if false; then :; elif git commit -m x; then :; fi',
    '! git commit -m x',
    '{ git commit -m x; }',
    'env -u FOO git commit -m x',
    'env -S "git commit -m x"',
    'nice -n 5 git commit -m x',
    'sudo -u bob git commit -m x',
    'timeout 30 git commit -m x',
    'timeout -s KILL 30 git push',
    'bash -c "git push origin main"',
  ]) assert.match(await bash(command) ?? '', /YAW team mode/, command);
});

test('git guard: while the branch has diverged, rebase, pull, merge, reset and upstream changes are for the user', async () => {
  const r = await repo();
  r.git('switch', '--quiet', '-c', 'feat/34-x');
  r.git('push', '--quiet', '-u', 'origin', 'feat/34-x');
  const bash = (command) => decide(r, 'claude', toolCall('claude', { command }));
  assert.equal(await bash('git pull --rebase'), null, 'not diverged: allowed');
  r.teammate('feat/34-x', 'theirs.txt');
  writeFileSync(join(r.root, 'mine.txt'), 'mine\n');
  r.git('add', 'mine.txt');
  r.git('commit', '--quiet', '-m', 'mine #34');
  r.git('fetch', '--quiet', 'origin');
  for (const command of ['git branch --unset-upstream', 'git branch -u origin/main', 'git branch --set-upstream-to=origin/main', 'git rebase origin/feat/34-x', 'git pull --rebase', 'git pull', 'git merge origin/feat/34-x', 'git reset --hard @{u}']) {
    assert.match(await bash(command) ?? '', /has diverged from origin\/feat\/34-x; the user decides how to settle it/, command);
  }
  assert.equal(await bash('git status && git log --oneline -3'), null);
});

test('guards fail open: no git repository, no git on the PATH, a missing kit module', async () => {
  const root = await project();
  const env = cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH });
  assert.equal(await decide({ root, env }, 'claude', editCall('claude')), null, 'not a git repository');
  const r = await repo();
  r.git('switch', '--quiet', 'main');
  const noGit = { ...r.env, PATH: tmp('yaw-empty-bin-') };
  assert.equal(await decide({ root: r.root, env: noGit }, 'claude', editCall('claude')), null, 'git is missing');
  await removeModule({ root: r.root, module: 'team' });
  assert.equal(await decide(r, 'claude', editCall('claude')), null, 'module removed: no guard');
});

// ------------------------------------------------------------------------------------- git hooks (lefthook)

// The commit-msg run script of the team block ({1} is filled in the way lefthook does) and the pre-push script file.
function lefthookScripts(root) {
  const doc = parse(readFileSync(join(root, 'lefthook.yml'), 'utf8'));
  assert.deepEqual(doc['pre-push'].jobs[0], { name: 'no-push-to-default-branch', script: 'yaw-default-branch.sh', runner: 'sh', use_stdin: true });
  return { commitMsg: doc['commit-msg'].jobs[0].run, prePush: join(root, '.lefthook', 'pre-push', 'yaw-default-branch.sh') };
}

test('commit-msg: a message must name an issue; merges, reverts and fixups pass; comment lines do not count', async () => {
  const root = await project();
  const { commitMsg } = lefthookScripts(root);
  const check = (message) => {
    const file = join(tmp('yaw-msg-'), 'COMMIT_EDITMSG');
    writeFileSync(file, message);
    return run('/bin/sh', ['-c', commitMsg.replaceAll('{1}', file)], { cwd: root }).status;
  };
  assert.equal(check('feat: login\n\nRefs #34\n'), 0);
  assert.equal(check('fix: crash (#12)\n'), 0);
  assert.equal(check('feat: login\n'), 1);
  assert.equal(check('feat: login\n# Refs #34 (a comment git strips)\n'), 1);
  assert.equal(check("Merge branch 'main' into feat/34-x\n"), 0);
  assert.equal(check('Revert "feat: login"\n\nThis reverts commit abc.\n'), 0);
  assert.equal(check('fixup! feat: login\n'), 0);
});

test('pre-push: updating or deleting the default branch is refused; issue branches and creating main pass', async () => {
  const r = await repo();
  const { prePush } = lefthookScripts(r.root);
  const sha = 'a'.repeat(40);
  const zero = '0'.repeat(40);
  const push = (lines, remote = 'origin') => run('/bin/sh', [prePush, remote, 'url'], { cwd: r.root, env: r.env, input: lines }).status;
  assert.equal(push(`refs/heads/main ${sha} refs/heads/main ${sha}\n`), 1);
  assert.equal(push(`refs/heads/feat/34-x ${sha} refs/heads/main ${sha}\n`), 1, 'HEAD:main');
  assert.equal(push(`(delete) ${zero} refs/heads/main ${sha}\n`), 1, 'deleting main');
  assert.equal(push(`refs/heads/feat/34-x ${sha} refs/heads/feat/34-x ${zero}\n`), 0);
  assert.equal(push(`refs/heads/main ${sha} refs/heads/main ${zero}\n`), 0, 'first push of a new repository');
  assert.equal(push(`refs/heads/feat/34-x ${sha} refs/heads/feat/34-x ${sha}\nrefs/heads/main ${sha} refs/heads/main ${sha}\n`), 1);
  // without origin/HEAD, main and master are the default branch candidates
  r.git('remote', 'set-head', 'origin', '--delete');
  assert.equal(push(`refs/heads/master ${sha} refs/heads/master ${sha}\n`), 1);
  assert.equal(push(`refs/heads/develop ${sha} refs/heads/develop ${sha}\n`), 0);
});

const lefthookReady = hasTool('lefthook') && hasTool('git');
test('lefthook end to end: a commit without an issue and a push to main are refused', { skip: !lefthookReady && !process.env.CI && 'lefthook is needed' }, async () => {
  const r = await repo();
  // the frame's pre-commit jobs need `just fmt` / `just lint` and gitleaks; this test is about the team block only
  writeFileSync(join(r.root, 'lefthook-local.yml'), 'pre-commit:\n  skip: true\n');
  const lh = run('lefthook', ['install'], { cwd: r.root, env: r.env });
  assert.equal(lh.status, 0, String(lh.stderr));
  r.git('switch', '--quiet', '-c', 'feat/34-x');
  writeFileSync(join(r.root, 'a.txt'), 'a\n');
  r.git('add', 'a.txt');
  const noIssue = run('git', ['commit', '-q', '-m', 'no issue here'], { cwd: r.root, env: r.env });
  assert.notEqual(noIssue.status, 0, String(noIssue.stdout) + String(noIssue.stderr));
  assert.equal(run('git', ['commit', '-q', '-m', 'feat: a', '-m', 'Refs #34'], { cwd: r.root, env: r.env }).status, 0);
  assert.equal(run('git', ['push', '-q', '-u', 'origin', 'feat/34-x'], { cwd: r.root, env: r.env }).status, 0);
  // the branch is on origin already, so this push brings no new files (lefthook would skip a `run` job here)
  const toMain = run('git', ['push', '-q', 'origin', 'feat/34-x:main'], { cwd: r.root, env: r.env });
  assert.notEqual(toMain.status, 0, String(toMain.stdout) + String(toMain.stderr));
  assert.match(String(toMain.stdout) + String(toMain.stderr), /pushing to the default branch main is blocked/);
});

// ------------------------------------------------------------------------------------------ pr-policy

test('pr-policy.yml: job pr-policy, read-only token, no action and no expression inside the script', async () => {
  const root = await project();
  const text = readFileSync(join(root, '.github', 'workflows', 'pr-policy.yml'), 'utf8');
  const wf = parse(text);
  assert.deepEqual(Object.keys(wf.jobs), ['pr-policy']);
  assert.equal(wf.jobs['pr-policy'].name, 'pr-policy');
  assert.deepEqual(wf.permissions, { contents: 'read', issues: 'read', 'pull-requests': 'read' });
  assert.ok(!/uses:/.test(text), 'no third-party action and no checkout');
  assert.ok(!wf.on.pull_request_target && wf.on.pull_request);
  for (const step of wf.jobs['pr-policy'].steps) assert.ok(!String(step.run).includes('${{'), 'event data reaches the script through env only');
});

// The workflow's own --jq filter runs through the real jq on a GraphQL answer, so the selection is tested too.
test('pr-policy: passes for an open issue of this repository; fails for none, a closed one, or one elsewhere', { skip: !hasTool('jq') && !process.env.CI && 'jq is needed' }, async () => {
  const root = await project();
  const script = parse(readFileSync(join(root, '.github', 'workflows', 'pr-policy.yml'), 'utf8')).jobs['pr-policy'].steps[0].run;
  const bin = tmp('yaw-prbin-');
  const answer = join(bin, 'answer.json');
  // gh stand-in: applies the --jq filter of the call to the canned GraphQL answer, like gh does (raw output)
  writeFileSync(join(bin, 'gh'), '#!/bin/sh\nwhile [ $# -gt 0 ]; do if [ "$1" = "--jq" ]; then exec jq -r "$2" "$GH_ANSWER"; fi; shift; done\nexit 1\n', { mode: 0o755 });
  const policy = (nodes) => {
    writeFileSync(answer, JSON.stringify({ data: { repository: { pullRequest: { closingIssuesReferences: { nodes } } } } }));
    return run('bash', ['-c', script], { env: { PATH: `${bin}:${process.env.PATH}`, GH_TOKEN: 'not-a-token', GH_ANSWER: answer, REPO: 'octo/demo', PR: '5' }, encoding: 'utf8' });
  };
  const here = (number, state = 'OPEN', repo = 'Octo/Demo') => ({ number, state, repository: { nameWithOwner: repo } });
  const ok = policy([here(33, 'CLOSED'), here(34)]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /links the open issue\(s\) #34$/m);
  for (const [nodes, why] of [[[], 'none'], [[here(34, 'CLOSED')], 'closed'], [[here(34, 'OPEN', 'someone/else')], 'another repository']]) {
    const bad = policy(nodes);
    assert.equal(bad.status, 1, why);
    assert.match(bad.stdout, /links no open issue/, why);
  }
});

// ------------------------------------------------------------------------------------------ gh protect

const fakeApi = ({ rulesets = [] } = {}) => {
  const calls = [];
  const gh = (args, opts = {}) => {
    calls.push({ args, input: opts.input });
    if (args[0] === 'repo') return JSON.stringify({ nameWithOwner: 'octo/demo', visibility: 'PRIVATE' });
    const path = args.find((a) => a.startsWith('repos/'));
    if (path.endsWith('/rulesets')) return JSON.stringify(rulesets);
    return JSON.stringify(rulesets.find((r) => r.id === Number(path.split('/').pop())));
  };
  gh.calls = calls;
  return gh;
};

async function yawGh(root, args, { gh, confirm } = {}) {
  const stdout = capture();
  const stderr = capture();
  const code = await main(['gh', ...args], { stdout, stderr, cwd: root, gh, env: cleanEnv(tmp('yaw-home-')), confirm });
  return { code, out: stdout.text(), err: stderr.text() };
}

test('gh protect: the team ruleset requires pr-policy; --verify compares without a person and changes nothing', async () => {
  const { rulesetBody } = await import('../../github/lib/cli.js');
  const root = await project();
  const want = { ...rulesetBody({ approvals: 1, checks: ['quality-gate', 'secret-scan', 'pr-policy'], linearHistory: false }), id: 5 };
  const ok = fakeApi({ rulesets: [want] });
  const verified = await yawGh(root, ['protect', '--verify'], { gh: ok });
  assert.equal(verified.code, 0, verified.err);
  assert.match(verified.out, /matches \.yaw\/github\.yaml/);
  assert.ok(ok.calls.every((c) => !c.args.includes('--method')), 'only reads');
  const loose = fakeApi({ rulesets: [{ ...want, rules: want.rules.map((r) => (r.type === 'required_status_checks' ? { ...r, parameters: { ...r.parameters, required_status_checks: [{ context: 'quality-gate' }] } } : r)) }] });
  const differs = await yawGh(root, ['protect', '--verify'], { gh: loose });
  assert.equal(differs.code, 1);
  assert.match(differs.err, /differs from \.yaw\/github\.yaml; a person runs: just gh-protect/);
  const none = await yawGh(root, ['protect', '--verify'], { gh: fakeApi() });
  assert.equal(none.code, 1);
  assert.match(none.err, /does not exist/);
  // applying stays guarded: without a terminal nothing is written
  const apply = fakeApi();
  const refused = await yawGh(root, ['protect'], { gh: apply });
  assert.equal(refused.code, 1);
  assert.match(refused.err, /not authorised/);
  assert.ok(apply.calls.every((c) => !c.args.includes('--method')));
});

test('gh protect refuses to require pr-policy when its workflow is missing', async () => {
  const root = await project();
  renameSync(join(root, '.github', 'workflows', 'pr-policy.yml'), join(root, 'pr-policy.yml.bak'));
  const r = await yawGh(root, ['protect'], { gh: fakeApi(), confirm: async () => true });
  assert.equal(r.code, 1);
  assert.match(r.err, /pr-policy\.yml is missing.*yaw add team/);
});

// ------------------------------------------------------------------------------------------ session start

test('digest: issues sorted by priority then due date, failing or blocked PRs only, text cleaned', () => {
  const d = digest(GH_DATA);
  assert.deepEqual(d.issues.map((i) => i.number), [12, 34, 7]);
  assert.deepEqual(d.issues[1], { number: 34, title: 'Login crash [31m on start', priority: 'P1', estimate: 'S', milestone: 'v1.0', due: '2026-11-01' });
  assert.deepEqual(d.review, [{ number: 40, title: 'Add invite flow' }]);
  assert.deepEqual(d.attention.map((p) => [p.number, p.why]), [[38, ['checks failing']], [39, ['changes requested']]]);
  assert.equal(clean('a‮b\nc'), 'a b c');
  assert.equal(clean('x'.repeat(200)).length, 80);
  assert.deepEqual(digest({ mine: [{ number: -1 }, { number: '3' }, null], reviews: 'x', authored: {} }), { issues: [], review: [], attention: [] });
});

test('sync: main, clean and behind is fast-forwarded; my issues and PRs are listed', async () => {
  const r = await repo();
  r.teammate('main', 'theirs.txt');
  // a post-merge hook of the project must not run inside the session-start hook
  const marker = join(tmp('yaw-marker-'), 'ran');
  writeFileSync(join(r.root, '.git', 'hooks', 'post-merge'), `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
  const before = r.git('rev-parse', 'HEAD');
  const result = await sessionStart({ root: r.root, env: r.env });
  assert.notEqual(r.git('rev-parse', 'HEAD'), before);
  assert.equal(existsSync(marker), false, 'no git hook ran during the fast-forward');
  assert.ok(existsSync(join(r.root, 'theirs.txt')));
  const text = result.lines.join('\n');
  assert.match(text, /^YAW team · main: pulled 1 commit from origin\/main \(fast-forward\); edits need an issue branch: just task start <#>/);
  assert.match(text, /My open issues \(3\):\n {2}#12 \[P0\] Urgent\n {2}#34 \[P1, S\] Login crash \[31m on start · v1\.0 due 2026-11-01\n {2}#7 \[P3\] Low one/);
  assert.match(text, /Waiting for my review: #40 Add invite flow/);
  assert.match(text, /My pull requests: #38 Fix x \(checks failing\); #39 Y \(changes requested\)/);
  assert.ok(!text.includes('\u001b'), 'no control characters from GitHub reach the terminal');
  assert.equal(r.gh.calls().length, 3);
});

test('sync: a dirty tree is not pulled; a diverged branch is reported; a feature branch is told how far main moved', async () => {
  const r = await repo();
  r.teammate('main', 'one.txt');
  writeFileSync(join(r.root, 'package.json'), '{}\n'); // a tracked file changed
  const dirty = await sessionStart({ root: r.root, env: r.env });
  assert.match(dirty.lines[0], /1 commit behind origin\/main; not pulled because the tree has changes/);
  r.git('checkout', '--quiet', '--', 'package.json');

  r.git('switch', '--quiet', '-c', 'feat/34-x');
  r.git('push', '--quiet', '-u', 'origin', 'feat/34-x');
  r.teammate('feat/34-x', 'theirs.txt');
  r.teammate('main', 'two.txt');
  const behind = await sessionStart({ root: r.root, env: r.env });
  assert.match(behind.lines[0], /^YAW team · feat\/34-x \(#34\): pulled 1 commit from origin\/feat\/34-x \(fast-forward\); 2 commits behind main: rebase or merge when it suits you \(never automatic\)$/);

  writeFileSync(join(r.root, 'mine.txt'), 'mine\n');
  r.git('add', 'mine.txt');
  r.git('commit', '--quiet', '-m', 'mine #34');
  r.teammate('feat/34-x', 'more.txt');
  const head = r.git('rev-parse', 'HEAD');
  const diverged = await sessionStart({ root: r.root, env: r.env });
  assert.match(diverged.lines[0], /diverged from origin\/feat\/34-x \(1 ahead, 1 behind\): rebase or merge it yourself; agent edits are blocked until then/);
  assert.equal(r.git('rev-parse', 'HEAD'), head, 'nothing automatic');
});

test('sync: gh results are cached for 5 minutes; offline the last result is shown with its time (fail open)', async () => {
  const r = await repo();
  const t0 = new Date('2026-10-21T10:00:00Z');
  const first = await sessionStart({ root: r.root, env: r.env, now: t0 });
  assert.equal(r.gh.calls().length, 3);
  const cached = await sessionStart({ root: r.root, env: r.env, now: new Date(t0.getTime() + CACHE_MS - 1000) });
  assert.equal(r.gh.calls().length, 3, 'inside 5 minutes: no gh call');
  assert.deepEqual(cached.lines.slice(1), first.lines.slice(1));
  await sessionStart({ root: r.root, env: r.env, now: new Date(t0.getTime() + CACHE_MS + 1000) });
  assert.equal(r.gh.calls().length, 6, 'after 5 minutes: read again');

  // GitHub fails: the last result, its time, nothing thrown
  r.gh.set({ fail: true });
  const t1 = new Date(t0.getTime() + 3 * CACHE_MS);
  const failing = await sessionStart({ root: r.root, env: r.env, now: t1 });
  assert.match(failing.lines[1], /^GitHub not reachable \(gh (issue|pr) list failed: HTTP 502: Bad Gateway\), last sync 2026-10-21 10:05$/);
  assert.match(failing.lines.join('\n'), /#12 \[P0\] Urgent/);

  // offline: origin cannot be fetched, so gh is not even tried
  renameSync(r.origin, `${r.origin}-gone`);
  const before = r.gh.calls().length;
  const offline = await sessionStart({ root: r.root, env: r.env, now: new Date(t1.getTime() + CACHE_MS) });
  assert.match(offline.lines[0], /offline: could not fetch origin/);
  assert.match(offline.lines[1], /^offline, last sync 2026-10-21 10:05$/);
  assert.equal(r.gh.calls().length, before);

  // a first start without any cache, offline: one line, no error
  const fresh = await sessionStart({ root: r.root, env: envWith(r.gh), now: t1 });
  assert.equal(fresh.lines[1], 'offline, no earlier sync to show');
});

test('sync: not a git repository -> nothing; no origin -> no fetch and no gh call', async () => {
  const gh = fakeGhBin(GH_DATA);
  const root = await project();
  assert.equal(await sessionStart({ root, env: envWith(gh) }), null);
  const env = envWith(gh);
  run('git', ['init', '-q', '-b', 'main'], { cwd: root, env });
  run('git', ['add', '-A'], { cwd: root, env });
  run('git', ['commit', '-q', '-m', 'x'], { cwd: root, env });
  const r = await sessionStart({ root, env });
  assert.match(r.lines[0], /no remote "origin", nothing fetched/);
  assert.equal(gh.calls().length, 0);
});

test('cache: only a regular file is read; links are neither read nor written through; a hand-edited file is cleaned', () => {
  const home = tmp('yaw-home-');
  const env = { HOME: home };
  const root = tmp('yaw-root-');
  const file = cacheFile(root, env);
  assert.ok(file.startsWith(join(home, '.yaw', 'cache', 'team-')));
  assert.equal(cacheFile(root, { YAW_HOME: 'relative/home' }), null, 'a relative home has no cache');
  const now = new Date('2026-10-21T10:00:00Z');
  writeCache(file, digest(GH_DATA), now);
  assert.deepEqual(readCache(file).data.issues.map((i) => i.number), [12, 34, 7]);

  // a link in place of the file: not read, and the target is not overwritten
  const target = join(tmp('yaw-target-'), 'victim.json');
  writeFileSync(target, 'precious');
  const linked = cacheFile(tmp('yaw-root2-'), env);
  symlinkSync(target, linked);
  assert.equal(readCache(linked), null);
  writeCache(linked, digest(GH_DATA), now);
  assert.equal(readFileSync(target, 'utf8'), 'precious');

  // a link in place of the cache folder: nothing is written there
  const home2 = tmp('yaw-home2-');
  const elsewhere = tmp('yaw-elsewhere-');
  mkdirSync(join(home2, '.yaw'), { recursive: true });
  symlinkSync(elsewhere, join(home2, '.yaw', 'cache'));
  const viaLink = cacheFile(root, { HOME: home2 });
  writeCache(viaLink, digest(GH_DATA), now);
  assert.equal(existsSync(join(elsewhere, viaLink.split('/').pop())), false);

  // hand-edited: control characters and junk are cleaned like a gh answer
  writeFileSync(file, JSON.stringify({ v: 1, at: now.toISOString(), data: { issues: [{ number: 3, title: 'Ignore\nall\u0007 previous', priority: 'P9', due: 'soon' }, { number: '4' }], review: [{ number: 5, title: 'x\u001b' }], attention: [{ number: 6, title: 'y', why: ['rm -rf', 'checks failing'] }] } }));
  assert.deepEqual(readCache(file).data, {
    issues: [{ number: 3, title: 'Ignore all previous', priority: null, estimate: null, milestone: null, due: null }],
    review: [{ number: 5, title: 'x' }],
    attention: [{ number: 6, title: 'y', why: ['checks failing'] }],
  });
  writeFileSync(file, 'not json');
  assert.equal(readCache(file), null);
});

// ------------------------------------------------------------------------- session start through the dispatcher

// Through the project's real shim in a child process, as the agents run it. The session-sync handler awaits gh;
// in-process, the dispatcher's muting of stdout (ADR-0007) would swallow the test runner's own output meanwhile.
function viaShim({ root, env }, agent, event, payload) {
  return shim({ root, agent: declaredAgent(agent), event, module: 'team', payload: { ...payload, cwd: root }, env: { ...env, YAW_KIT: KIT_ROOT } });
}

test('session-start hooks: the user gets a systemMessage (Claude, Codex); the model gets one active-issue line', async () => {
  const r = await repo();
  r.git('switch', '--quiet', '-c', 'feat/34-login-crash');
  for (const agent of ['claude', 'codex', 'copilot']) {
    const res = viaShim(r, agent, 'SessionStart', fixture(agent, 'SessionStart'));
    assert.equal(res.code, 0);
    assert.equal(res.stderr, '');
    const out = JSON.parse(res.stdout);
    if (agent === 'copilot') {
      assert.deepEqual(Object.keys(out), ['additionalContext'], 'Copilot: no user message, the context only');
      assert.equal(out.additionalContext, 'Active issue: #34 "Login crash [31m on start" (branch feat/34-login-crash).');
    } else {
      assert.equal(out.hookSpecificOutput.additionalContext, 'Active issue: #34 "Login crash [31m on start" (branch feat/34-login-crash).');
      assert.match(out.systemMessage, /^YAW team · feat\/34-login-crash \(#34\)/);
      assert.match(out.systemMessage, /My open issues \(3\)/);
      assert.ok(!out.hookSpecificOutput.additionalContext.includes('My open issues'), 'the issue list is for the user only');
    }
  }
});

test('session-issue: off with team.session-context: false; nothing on main; no title without a cache', async () => {
  const off = await repo({ extra: '  team.session-context: false\n' });
  off.git('switch', '--quiet', '-c', 'feat/34-x');
  const a = viaShim(off, 'claude', 'SessionStart', fixture('claude', 'SessionStart'));
  assert.doesNotMatch(a.stdout, /additionalContext/);
  assert.match(JSON.parse(a.stdout).systemMessage, /YAW team/);

  const r = await repo();
  const onMain = viaShim(r, 'claude', 'SessionStart', fixture('claude', 'SessionStart'));
  assert.doesNotMatch(onMain.stdout, /additionalContext/);
  r.git('switch', '--quiet', '-c', 'feat/99-new');
  const { default: sessionIssue } = await import('../hooks/session-issue.js');
  assert.deepEqual(sessionIssue({}, { root: r.root, env: envWith(r.gh) }), { context: 'Active issue: #99 (branch feat/99-new).' });
});

test('token-free: every team hook, every recorded fixture of every agent', async () => {
  const r = await repo();
  r.git('switch', '--quiet', 'main');
  const def = loadModule(KIT_ROOT, 'team');
  const events = new Set(def.outputs.hooks.map((h) => h.event));
  for (const f of listFixtures()) {
    const res = viaShim(r, f.agent, f.event, f.payload);
    assert.equal(res.code, 0);
    assert.equal(res.stderr, '');
    if (!events.has(f.event)) {
      assert.equal(res.stdout, '', `${f.agent} ${f.name}: silent`);
      continue;
    }
    if (res.stdout === '') continue;
    const out = JSON.parse(res.stdout);
    const keys = Object.keys(out).sort();
    if (f.event === 'PreToolUse') {
      assert.ok(f.agent === 'copilot' ? out.permissionDecision === 'deny' : out.hookSpecificOutput.permissionDecision === 'deny', `${f.agent} ${f.name}: only a deny`);
      assert.ok(!JSON.stringify(out).includes('additionalContext'));
    } else {
      assert.equal(f.event, 'SessionStart');
      assert.ok(!res.stdout.includes('permissionDecision'));
      assert.deepEqual(keys.filter((k) => !['systemMessage', 'hookSpecificOutput', 'additionalContext'].includes(k)), []);
    }
  }
});

// ------------------------------------------------------------------------------------------ CLI

test('yaw session-start prints the sync for the terminal; it needs the team module', async () => {
  const r = await repo();
  const stdout = capture();
  const stderr = capture();
  const code = await main(['session-start'], { stdout, stderr, cwd: r.root, env: r.env });
  assert.equal(code, 0, stderr.text());
  assert.match(stdout.text(), /^YAW team · main: up to date with origin\/main/);
  const solo = await project({ team: 'solo', modules: ['core', 'tasks'], extra: '  tasks.mode: local\n' });
  const err = capture();
  assert.equal(await main(['session-start'], { stdout: capture(), stderr: err, cwd: solo, env: r.env }), 1);
  assert.match(err.text(), /the team module is not installed/);
});

test('just task start #n assigns the issue and switches to its branch: created from origin/main, reused later', async () => {
  const r = await repo({ ghData: { ...GH_DATA, view: { title: 'Login crash on start!', labels: [{ name: 'type:bug' }] } } });
  const yawTask = async (...args) => {
    const stdout = capture();
    const stderr = capture();
    const code = await main(['task', ...args], { stdout, stderr, cwd: r.root, env: r.env });
    return { code, out: stdout.text(), err: stderr.text() };
  };
  const first = await yawTask('start', '#34');
  assert.equal(first.code, 0, first.err);
  assert.match(first.out, /#34 assigned to you\nfix\/34-login-crash-on-start \(from origin\/main\)/);
  assert.equal(r.git('branch', '--show-current'), 'fix/34-login-crash-on-start');
  assert.ok(r.gh.calls().some((c) => c.join(' ') === 'issue edit 34 --add-assignee @me'));
  r.git('switch', '--quiet', 'main');
  const again = await yawTask('start', '34');
  assert.match(again.out, /switched to fix\/34-login-crash-on-start/);
  const same = await yawTask('start', '34');
  assert.match(same.out, /already on fix\/34-login-crash-on-start/);
});
