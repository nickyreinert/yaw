// github (Y-5.5, ADR-0027): rendering, guarded actions need authorisation, issue-type detection with label
// fallback, branch / commit / pr / release against real git (local bare origin) and a `gh` stand-in,
// path safety, removal with zero residue. The `gh` shapes are invented (not recorded), see the later issue
// about live fixtures.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../../../core/cli/main.js';
import { parse } from '../../../core/lib/yaml.js';
import { schemas } from '../../../core/render/kit.js';
import { readManifest } from '../../../core/render/manifest.js';
import { addModule, initProject, readAnswers, removeModule, updateProject } from '../../../core/render/project.js';
import { KIT_ROOT, capture, cleanEnv, hasTool, read, readTree, run, tmp, writeAnswers } from '../../../test/helpers/fixtures.js';
import { GUARDED, VERBS } from '../lib/cli.js';
import { branchName, checkIdForMode, parseTaskId, prBody, commitMessage, slugify, taskFromBranch } from '../lib/names.js';

const MODULES = ['core', 'security', 'tasks', 'github'];

function answersText({ mode = 'local', team = 'solo', modules = MODULES } = {}) {
  const tasks = team === 'solo' ? `  tasks.mode: ${mode}\n` : '';
  return `mode: standard\nanswers:\n  user.agents: [claude, codex, copilot]\n  idea.text: A tiny command-line tool.\n  idea.team: ${team}\n${tasks}proposal:\n  status: confirmed\n  summary: test project\n  profiles: [node-cli]\n  modules: [${modules.join(', ')}]\n`;
}

async function project(options = {}) {
  const root = tmp('yaw-github-');
  await initProject({ root, answersFile: writeAnswers(tmp('yaw-ans-'), answersText(options)), modules: options.modules ?? MODULES });
  return root;
}

const ENV = () => cleanEnv(tmp('yaw-home-'), { PATH: process.env.PATH });

// A project inside a git repo whose origin is a local bare repository, one commit pushed to main.
async function repo(options = {}) {
  const root = await project(options);
  const env = ENV();
  const origin = tmp('yaw-origin-');
  const git = (cwd, ...args) => {
    const r = run('git', args, { cwd, env });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  git(origin, 'init', '--quiet', '--bare', '-b', 'main');
  git(root, 'init', '--quiet', '-b', 'main');
  git(root, 'add', '-A');
  git(root, 'commit', '--quiet', '-m', 'initial');
  git(root, 'remote', 'add', 'origin', origin);
  git(root, 'push', '--quiet', '-u', 'origin', 'main');
  git(root, 'remote', 'set-head', 'origin', 'main');
  return { root, origin, env, git: (...a) => git(root, ...a), gitIn: git };
}

// gh stand-in: records every call, answers the reads, and keeps what the tests need to see.
function fakeGh({ native = [], labels = [], rulesets = [], prs = [], repoView = { nameWithOwner: 'octo/demo', visibility: 'PRIVATE' }, failGraphql = false } = {}) {
  const calls = [];
  const state = { rulesets: [...rulesets] };
  const gh = (args, opts = {}) => {
    calls.push({ args, input: opts.input });
    const key = args.slice(0, 2).join(' ');
    if (key === 'repo view') return JSON.stringify(repoView);
    if (key === 'api graphql') {
      if (failGraphql) throw new Error('gh api graphql failed: not found');
      return JSON.stringify({ data: { repository: { issueTypes: { nodes: native.map((name) => ({ name })) } } } });
    }
    if (key === 'label list') return JSON.stringify(labels);
    if (key === 'label create' || key === 'label edit') return '';
    if (args[0] === 'api') {
      const method = args.includes('--method') ? args[args.indexOf('--method') + 1] : 'GET';
      const path = args.find((a) => a.startsWith('repos/'));
      if (path.endsWith('/rulesets') && method === 'GET') return JSON.stringify(state.rulesets);
      if (path.endsWith('/rulesets') && method === 'POST') {
        const body = JSON.parse(opts.input);
        state.rulesets.push({ ...body, id: 77 });
        return JSON.stringify({ id: 77 });
      }
      if (/rulesets\/\d+$/.test(path) && method === 'PUT') {
        const body = JSON.parse(opts.input);
        const id = Number(path.split('/').pop());
        state.rulesets = state.rulesets.map((r) => (r.id === id ? { ...body, id } : r));
        return JSON.stringify({ id });
      }
      if (/rulesets\/\d+$/.test(path)) return JSON.stringify(state.rulesets.find((r) => r.id === Number(path.split('/').pop())));
      if (path.endsWith('/issues') && method === 'POST') return JSON.stringify({ html_url: 'https://github.com/octo/demo/issues/9' });
    }
    if (key === 'issue create') return 'https://github.com/octo/demo/issues/8\n';
    if (key === 'pr list') return JSON.stringify(prs);
    if (key === 'pr create') return 'https://github.com/octo/demo/pull/5\n';
    if (key === 'repo create' || key === 'release create') return '';
    if (key === 'project item-add') return JSON.stringify({ id: 'PVTI_item' });
    if (key === 'project view') return JSON.stringify({ id: 'PVT_project' });
    if (key === 'project field-list') {
      return JSON.stringify({ fields: [{ id: 'PVTSSF_status', name: 'Status', options: [{ id: 'o1', name: 'Todo' }, { id: 'o2', name: 'In progress' }] }] });
    }
    if (key === 'project item-edit') return '';
    throw new Error(`unexpected gh call: ${args.join(' ')}`);
  };
  gh.calls = calls;
  gh.state = state;
  gh.writes = () => calls.filter((c) => !['repo view', 'api graphql', 'label list', 'pr list'].includes(c.args.slice(0, 2).join(' '))
    && !(c.args[0] === 'api' && !c.args.includes('--method')));
  return gh;
}

async function yaw(root, args, { gh, env, confirm, now } = {}) {
  const stdout = capture();
  const stderr = capture();
  const code = await main(['gh', ...args], { stdout, stderr, cwd: root, gh, env: env ?? ENV(), confirm, now });
  return { code, out: stdout.text(), err: stderr.text() };
}

const writeConfig = (root, text) => writeFileSync(join(root, '.yaw', 'github.yaml'), text);

// ------------------------------------------------------------------------------------ pure names

test('ids, branch names, commit messages and the PR body', () => {
  assert.deepEqual(parseTaskId('T-012'), { kind: 'task', id: 'T-012', number: null });
  assert.deepEqual(parseTaskId('#34'), { kind: 'issue', id: '34', number: 34 });
  assert.deepEqual(parseTaskId('034'), { kind: 'issue', id: '34', number: 34 });
  for (const bad of ['', 'T-', 'T-1; rm -rf /', '#0', '34abc', '../x', '-5', 'T-1234567', '9999999999']) assert.throws(() => parseTaskId(bad), /not a task id/, bad);
  assert.throws(() => checkIdForMode(parseTaskId('#3'), 'local'), /T-NNN/);
  assert.throws(() => checkIdForMode(parseTaskId('T-3'), 'github'), /issue number/);
  checkIdForMode(parseTaskId('T-3'), 'both');
  checkIdForMode(parseTaskId('T-3'), undefined);
  assert.equal(branchName({ type: 'feat', task: parseTaskId('T-012'), slug: 'Invite Flow!' }), 'feat/T-012-invite-flow');
  assert.equal(branchName({ type: 'fix', task: parseTaskId('#34'), slug: 'login crash' }), 'fix/34-login-crash');
  assert.equal(slugify('../../etc/passwd -rf'), 'etc-passwd-rf');
  assert.equal(slugify('x'.repeat(80)).length, 40);
  assert.throws(() => slugify('***'), /empty/);
  assert.throws(() => branchName({ type: 'rm', task: parseTaskId('#3'), slug: 'x' }), /unknown commit type/);
  assert.equal(taskFromBranch('feat/T-012-invite-flow').id, 'T-012');
  assert.equal(taskFromBranch('fix/34-x').id, '34');
  assert.equal(taskFromBranch('main'), null);
  assert.equal(taskFromBranch('feature/abc'), null);
  assert.equal(commitMessage({ type: 'feat', scope: 'ui', subject: 'add flow', task: parseTaskId('T-012') }), 'feat(ui): add flow\n\nRefs T-012');
  assert.equal(commitMessage({ type: 'fix', subject: 'crash', task: parseTaskId('#34') }), 'fix: crash\n\nRefs #34');
  assert.throws(() => commitMessage({ type: 'fix', subject: 'a\nb', task: null }), /one line/);
  assert.throws(() => commitMessage({ type: 'fix', subject: '', task: null }), /empty/);
  assert.throws(() => commitMessage({ type: 'fix', scope: 'A B', subject: 'x' }), /invalid scope/);
  const body = prBody({ template: 'S\n<!-- yaw:summary -->\nL\n<!-- yaw:closes -->\nrest\n', commits: ['one', 'two'], task: parseTaskId('#34') });
  assert.equal(body, 'S\n- one\n- two\nL\nCloses #34\nrest\n');
  assert.equal(prBody({ template: 'plain\n', commits: ['one'], task: parseTaskId('T-1') }), '- one\n\nRefs T-1\n\nplain\n');
  // "$&" and friends in a commit subject are literal text
  assert.match(prBody({ template: '<!-- yaw:summary -->', commits: ['a $& b'], task: null }), /- a \$& b/);
});

// ------------------------------------------------------------------------------------- rendering

test('renders the recipes, the PR template, github.yaml and the ask rules; manifest entries are right', async () => {
  const root = await project();
  const tree = readTree(root);
  for (const f of ['just/github.just', '.github/pull_request_template.md', '.yaw/github.yaml']) assert.ok(Object.hasOwn(tree, f), f);
  for (const recipe of ['gh-init', 'gh-labels', 'gh-protect', 'gh-issue', 'branch', 'commit', 'pr', 'pr-status', 'release', 'project-add']) {
    assert.match(tree['just/github.just'], new RegExp(`^${recipe} \\*args:`, 'm'), recipe);
  }
  assert.match(tree.justfile, /# yaw:github\nimport 'just\/github.just'\n# \/yaw:github/);
  assert.match(tree['AGENTS.md'], /<!-- yaw:github -->\n- Git and GitHub work goes through/);
  assert.match(tree['AGENTS.md'], /There is no recipe to merge, force-push, delete a branch or change repo visibility/);
  const settings = JSON.parse(tree['.claude/settings.json']);
  assert.ok(settings.permissions.deny.includes('Read(**/.env)'), 'the security rules stay');
  for (const rule of ['Bash(just gh-protect:*)', 'Bash(gh pr merge:*)', 'Bash(gh repo edit:*)', 'Bash(just release:*)', 'Bash(just pr:*)']) {
    assert.ok(settings.permissions.ask.includes(rule), rule);
  }
  const manifest = readManifest(root);
  const byPath = Object.fromEntries(manifest.files.map((f) => [f.path, f]));
  for (const f of ['just/github.just', '.github/pull_request_template.md', '.yaw/github.yaml']) assert.ok(byPath[f] !== undefined && /^sha256:[0-9a-f]{64}$/.test(byPath[f].hash), f);
  assert.equal(byPath['just/github.just'].module, 'github');
  assert.equal(byPath['.yaw/github.yaml'].module, 'github');
  assert.ok(byPath['.claude/settings.json'].fragments.some((x) => x.module === 'github'));
  assert.ok(byPath.justfile.fragments.some((x) => x.module === 'github'));
  assert.equal(manifest.modules.github.enabled, true);
});

test('.yaw/github.yaml validates; team mode requires an issue and one approval', async () => {
  for (const [team, approvals, requireIssue] of [['solo', 0, false], ['team', 1, true]]) {
    const root = await project({ team });
    const doc = parse(read(root, '.yaw/github.yaml'));
    const errors = schemas().validate('github.schema.json', doc);
    assert.deepEqual(errors, [], JSON.stringify(errors));
    assert.equal(doc.rules.approvals, approvals);
    assert.equal(doc.rules.requireIssue, requireIssue);
    assert.deepEqual(doc.rules.requiredChecks, ['quality-gate', 'secret-scan']);
    assert.ok(doc.labels.some((l) => l.name === 'type:feature') && doc.labels.some((l) => l.name === 'status:in-progress'));
  }
});

test('the module has no hooks and nothing in setup, update or remove calls gh', async () => {
  const def = readFileSync(join(KIT_ROOT, 'modules', 'github', 'module.yaml'), 'utf8');
  assert.doesNotMatch(def, /^\s*hooks:/m);
  // a gh and a git-push look-alike on the PATH that log every call
  const bin = tmp('yaw-bin-');
  const log = join(bin, 'calls.log');
  for (const tool of ['gh']) {
    writeFileSync(join(bin, tool), `#!/bin/sh\necho "${tool} $*" >> '${log}'\nexit 1\n`);
    chmodSync(join(bin, tool), 0o755);
  }
  const env = { ...ENV(), PATH: `${bin}:${process.env.PATH}` };
  const root = tmp('yaw-github-');
  const answers = writeAnswers(tmp('yaw-ans-'), answersText({ modules: ['core'] }));
  const r = await runMain(['init', '--answers', answers, '--yes', '--skip-verify'], root, env);
  assert.equal(r.code, 0, r.err);
  for (const args of [['add', 'github', '--yes'], ['update', '--yes'], ['remove', 'github', '--yes']]) {
    const x = await runMain(args, root, env);
    assert.equal(x.code, 0, `${args.join(' ')}: ${x.err}`);
  }
  assert.equal(existsSync(log), false, existsSync(log) ? readFileSync(log, 'utf8') : '');
});

async function runMain(args, cwd, env) {
  const stdout = capture();
  const stderr = capture();
  const code = await main(args, { stdout, stderr, cwd, env });
  return { code, out: stdout.text(), err: stderr.text() };
}

// ------------------------------------------------------------------ guarded actions: authorisation

test('every guarded verb refuses without authorisation and changes nothing; --yes or a typed y lets it through', async () => {
  const { root, git, env } = await repo();
  git('switch', '--quiet', '-c', 'feat/T-001-x');
  writeFileSync(join(root, 'a.txt'), 'x\n');
  git('add', '-A');
  git('commit', '--quiet', '-m', 'work');
  writeConfig(root, 'labels:\n  - { name: "type:bug", color: D73A4A }\nproject:\n  number: 3\n');
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(root, '.github', 'workflows', 'quality-gate.yml'), 'name: quality-gate\n');
  git('remote', 'remove', 'origin');
  const cases = [
    ['init', 'demo'],
    ['labels'],
    ['protect'],
    ['project-add', '9'],
  ];
  for (const args of cases) {
    const gh = fakeGh();
    const r = await yaw(root, args, { gh, env });
    assert.equal(r.code, 1, args.join(' '));
    assert.match(r.err, /not authorised; nothing was changed/, args.join(' '));
    assert.match(r.out, /guarded action|changes|creates|updates/);
    assert.deepEqual(gh.writes(), [], `${args[0]} wrote without authorisation`);
    // a "no" at the prompt is the same
    const gh2 = fakeGh();
    const no = await yaw(root, args, { gh: gh2, env, confirm: async () => false });
    assert.equal(no.code, 1);
    assert.deepEqual(gh2.writes(), []);
  }
  // typed y, and --yes
  const a = fakeGh();
  assert.equal((await yaw(root, ['labels'], { gh: a, env, confirm: async () => true })).code, 0);
  assert.equal(a.writes().length, 1);
  const b = fakeGh();
  assert.equal((await yaw(root, ['labels', '--yes'], { gh: b, env })).code, 0);
  assert.equal(b.writes().length, 1);
});

test('release and the first push of pr are guarded too', async () => {
  const { root, git, env } = await repo();
  const gh = fakeGh();
  const rel = await yaw(root, ['release', '0.1.0'], { gh, env });
  assert.equal(rel.code, 1);
  assert.match(rel.err, /not authorised/);
  assert.equal(git('tag', '--list'), '', 'no tag without authorisation');
  assert.deepEqual(gh.writes(), []);

  git('switch', '--quiet', '-c', 'feat/T-002-y');
  writeFileSync(join(root, 'b.txt'), 'y\n');
  git('add', '-A');
  git('commit', '--quiet', '-m', 'feat: y');
  const pr = await yaw(root, ['pr'], { gh, env });
  assert.equal(pr.code, 1);
  assert.match(pr.err, /not authorised/);
  assert.equal(run('git', ['ls-remote', '--heads', 'origin', 'feat/T-002-y'], { cwd: root, env }).stdout, '', 'nothing was pushed');
  assert.deepEqual(gh.writes(), []);
});

test('there is no verb that merges, force-pushes, deletes or changes visibility', () => {
  const source = readFileSync(join(KIT_ROOT, 'modules', 'github', 'lib', 'cli.js'), 'utf8');
  const code = source.split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n');
  for (const forbidden of [/'merge'/, /--force/, /--delete/, /'delete'/, /--visibility/, /--no-verify/, /'--admin'/, /push.*\+refs/]) assert.doesNotMatch(code, forbidden);
  const recipes = readFileSync(join(KIT_ROOT, 'modules', 'github', 'templates', 'just', 'github.just'), 'utf8');
  assert.doesNotMatch(recipes.split('\n').filter((l) => l.startsWith('    ')).join('\n'), /merge|force|visibility|delete/);
});

// ------------------------------------------------------------------------ labels and issue types

const LABELS = '  - { name: "type:feature", color: 1D76DB, description: Feature }\n  - { name: "type:bug", color: D73A4A }\n  - { name: "priority:P0", color: B60205 }\n';

test('labels: creates the missing ones, skips type labels that exist as native issue types, is idempotent', async () => {
  const { root, env } = await repo();
  writeConfig(root, `labels:\n${LABELS}`);
  const gh = fakeGh({ native: ['Feature', 'Bug'], labels: [{ name: 'priority:P0', color: 'b60205', description: '' }] });
  const r = await yaw(root, ['labels', '--yes'], { gh, env });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /native issue types exist for type:feature, type:bug/);
  assert.match(r.out, /labels: up to date/);
  assert.deepEqual(gh.writes(), []); // nothing to change, and no authorisation was asked

  const fallback = fakeGh({ native: [], labels: [{ name: 'priority:P0', color: 'b60205', description: '' }, { name: 'type:bug', color: 'ffffff', description: '' }] });
  const second = await yaw(root, ['labels'], { gh: fallback, env });
  assert.equal(second.code, 1); // changes pending, not authorised
  const third = await yaw(root, ['labels', '--yes'], { gh: fallback, env });
  assert.equal(third.code, 0, third.err);
  const writes = fallback.writes().map((c) => c.args.join(' '));
  assert.deepEqual(writes, [
    'label create --color 1D76DB --description Feature -- type:feature',
    'label edit --color D73A4A --description  -- type:bug',
  ]);
  assert.match(third.out, /1 created, 1 updated/);
});

test('labels: a failing issue-type query falls back to the labels', async () => {
  const { root, env } = await repo();
  writeConfig(root, `labels:\n${LABELS}`);
  const gh = fakeGh({ failGraphql: true });
  const r = await yaw(root, ['labels', '--yes'], { gh, env });
  assert.equal(r.code, 0, r.err);
  assert.equal(gh.writes().length, 3);
});

test('issue: native issue type when the repository has it, otherwise the type:* label', async () => {
  const { root, env } = await repo();
  const native = fakeGh({ native: ['Feature', 'Bug'] });
  const a = await yaw(root, ['issue', 'feature', 'Add', 'login', '--priority', 'P1', '--estimate', 'S', '--body', 'why'], { gh: native, env });
  assert.equal(a.code, 0, a.err);
  assert.match(a.out, /issues\/9 \(issue type Feature\)/);
  const post = native.calls.find((c) => c.args[0] === 'api' && c.args.includes('POST'));
  assert.deepEqual(post.args.slice(0, 4), ['api', '--method', 'POST', 'repos/octo/demo/issues']);
  assert.ok(post.args.includes('type=Feature') && post.args.includes('title=Add login') && post.args.includes('labels[]=priority:P1') && post.args.includes('labels[]=estimate:S'));
  assert.ok(!post.args.some((x) => x === 'labels[]=type:feature'));

  const fallback = fakeGh({ native: ['Bug'] }); // org has Bug but not Feature: per type
  const b = await yaw(root, ['issue', 'feature', 'Add login'], { gh: fallback, env });
  assert.match(b.out, /issues\/8 \(label type:feature\)/);
  const create = fallback.calls.find((c) => c.args[1] === 'create');
  assert.deepEqual(create.args, ['issue', 'create', '--title', 'Add login', '--body', '', '--label', 'type:feature']);

  assert.match((await yaw(root, ['issue', 'story', 'x'], { gh: fakeGh(), env })).err, /unknown issue type/);
  assert.match((await yaw(root, ['issue', 'bug', 'x', '--priority', 'P9'], { gh: fakeGh(), env })).err, /--priority/);
  assert.match((await yaw(root, ['issue', 'bug', 'x', '--estimate', 'huge'], { gh: fakeGh(), env })).err, /--estimate/);
});

// ----------------------------------------------------------------------------------- protect

test('protect: creates the ruleset, verifies it, updates it on the second run', async () => {
  const { root, env } = await repo();
  mkdirSync(join(root, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(root, '.github', 'workflows', 'quality-gate.yml'), 'name: quality-gate\n');
  const gh = fakeGh();
  const r = await yaw(root, ['protect', '--approvals', '2', '--yes'], { gh, env });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /ruleset "yaw-default-branch" is active on octo\/demo and verified/);
  const post = gh.calls.find((c) => c.args.includes('POST'));
  assert.ok(post.args.includes('--input') && post.args.includes('-'));
  const body = JSON.parse(post.input);
  assert.equal(body.enforcement, 'active');
  assert.deepEqual(body.conditions.ref_name.include, ['~DEFAULT_BRANCH']);
  assert.deepEqual(body.bypass_actors, []);
  assert.deepEqual(body.rules.map((x) => x.type).sort(), ['deletion', 'non_fast_forward', 'pull_request', 'required_status_checks']);
  assert.equal(body.rules.find((x) => x.type === 'pull_request').parameters.required_approving_review_count, 2);
  assert.deepEqual(body.rules.find((x) => x.type === 'required_status_checks').parameters.required_status_checks, [{ context: 'quality-gate' }, { context: 'secret-scan' }]);

  const again = await yaw(root, ['protect', '--yes'], { gh, env });
  assert.equal(again.code, 0, again.err);
  assert.ok(gh.calls.some((c) => c.args.includes('PUT') && c.args.includes('repos/octo/demo/rulesets/77')));
  assert.equal(gh.state.rulesets.length, 1);
});

test('protect: refuses a required check no workflow reports, a bad --approvals, and a ruleset that does not read back', async () => {
  const { root, env } = await repo();
  const noCi = await yaw(root, ['protect', '--yes'], { gh: fakeGh(), env });
  assert.equal(noCi.code, 1);
  assert.match(noCi.err, /quality-gate\.yml is missing/);
  writeConfig(root, 'rules:\n  requiredChecks: [lint]\n');
  const custom = fakeGh();
  assert.equal((await yaw(root, ['protect', '--yes'], { gh: custom, env })).code, 0);
  assert.match((await yaw(root, ['protect', '--approvals', 'many', '--yes'], { gh: fakeGh(), env })).err, /--approvals/);
  assert.match((await yaw(root, ['protect', '--check', 'a;b', '--yes'], { gh: fakeGh(), env })).err, /not a valid check name/);
  // the server stores something else than we sent
  const lying = fakeGh();
  const real = lying.state;
  const wrapped = (args, opts) => {
    const out = lying(args, opts);
    if (args.includes('POST')) real.rulesets = real.rulesets.map((r) => ({ ...r, enforcement: 'disabled' }));
    return out;
  };
  wrapped.calls = lying.calls;
  const bad = await yaw(root, ['protect', '--yes'], { gh: wrapped, env });
  assert.equal(bad.code, 1);
  assert.match(bad.err, /does not read back as requested/);
});

// ---------------------------------------------------------------------------- branch and commit

test('branch: from the fresh origin default branch, named by the task id of the mode', async () => {
  const { root, origin, env, git, gitIn } = await repo();
  // origin moves on after our clone: the new branch must start there
  const other = tmp('yaw-other-');
  gitIn(other, 'clone', '--quiet', origin, '.');
  writeFileSync(join(other, 'new.txt'), 'n\n');
  gitIn(other, 'add', '-A');
  gitIn(other, 'commit', '--quiet', '-m', 'upstream work');
  gitIn(other, 'push', '--quiet', 'origin', 'main');
  const r = await yaw(root, ['branch', 'T-012', 'Invite', 'flow'], { env });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^feat\/T-012-invite-flow \(from origin\/main\)$/m);
  assert.equal(git('branch', '--show-current'), 'feat/T-012-invite-flow');
  assert.equal(git('rev-parse', 'HEAD'), git('rev-parse', 'origin/main'));
  assert.ok(existsSync(join(root, 'new.txt')));
  assert.equal(run('git', ['config', '--get', 'branch.feat/T-012-invite-flow.remote'], { cwd: root, env }).status, 1, 'no upstream is set');

  git('switch', '--quiet', 'main');
  assert.match((await yaw(root, ['branch', 'T-012', 'Invite', 'flow'], { env })).err, /exists already/);
  assert.match((await yaw(root, ['branch', '#34', 'x'], { env })).err, /T-NNN/);
  assert.match((await yaw(root, ['branch', 'T-013', '***'], { env })).err, /slug is empty/);
  assert.match((await yaw(root, ['branch', 'T-013'], { env })).err, /missing task id and slug/);
  assert.match((await yaw(root, ['branch', 'T-013', 'x', '--type', 'nope'], { env })).err, /unknown commit type/);
  assert.equal((await yaw(root, ['branch', 'T-014', 'fix', 'it', '--type', 'fix'], { env })).code, 0);
  assert.equal(git('branch', '--show-current'), 'fix/T-014-fix-it');
});

test('branch: issue numbers in GitHub mode and in team mode', async () => {
  for (const options of [{ mode: 'github' }, { team: 'team' }]) {
    const { root, env, git } = await repo(options);
    assert.match((await yaw(root, ['branch', 'T-1', 'x'], { env })).err, /issue number/);
    const r = await yaw(root, ['branch', '#34', 'login crash', '--type', 'fix'], { env });
    assert.equal(r.code, 0, r.err);
    assert.equal(git('branch', '--show-current'), 'fix/34-login-crash');
  }
});

test('branch: without a remote it starts from the local default branch and says so', async () => {
  const { root, env, git } = await repo();
  git('remote', 'remove', 'origin');
  const r = await yaw(root, ['branch', 'T-001', 'solo'], { env });
  assert.equal(r.code, 0, r.err);
  assert.match(r.err, /no remote "origin"/);
  assert.equal(git('branch', '--show-current'), 'feat/T-001-solo');
});

test('commit: Conventional Commit with the task footer; the git hooks run and can block', async () => {
  const { root, env, git } = await repo();
  await yaw(root, ['branch', 'T-012', 'flow'], { env });
  assert.match((await yaw(root, ['commit', 'feat', 'nothing staged'], { env })).err, /nothing is staged/);
  writeFileSync(join(root, 'a.txt'), 'a\n');
  git('add', 'a.txt');
  const r = await yaw(root, ['commit', 'feat', 'add', 'the', 'flow', '--scope', 'ui'], { env });
  assert.equal(r.code, 0, r.err + r.out);
  assert.equal(git('log', '-1', '--format=%B'), 'feat(ui): add the flow\n\nRefs T-012');

  // a failing pre-commit hook blocks the commit and the recipe never bypasses it
  mkdirSync(join(root, '.git', 'hooks'), { recursive: true });
  writeFileSync(join(root, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\necho "hook says no" >&2\nexit 1\n');
  chmodSync(join(root, '.git', 'hooks', 'pre-commit'), 0o755);
  writeFileSync(join(root, 'b.txt'), 'b\n');
  git('add', 'b.txt');
  const blocked = await yaw(root, ['commit', 'fix', 'blocked'], { env });
  assert.equal(blocked.code, 1);
  assert.match(blocked.err, /hook says no/);
  assert.equal(git('rev-list', '--count', 'HEAD'), '2');

  // off a task branch the task has to be named
  git('switch', '--quiet', 'main');
  unlinkSync(join(root, '.git', 'hooks', 'pre-commit'));
  git('add', 'b.txt');
  assert.match((await yaw(root, ['commit', 'fix', 'x'], { env })).err, /carries no task id/);
  assert.equal((await yaw(root, ['commit', 'fix', 'x', '--task', '#34'], { env })).code, 0);
  assert.equal(git('log', '-1', '--format=%B'), 'fix: x\n\nRefs #34');
  assert.match((await yaw(root, ['commit', 'fix', 'x', '--task', 'T-1; rm -rf /'], { env })).err, /not a task id/);
  assert.match((await yaw(root, ['commit', 'wip', 'x'], { env })).err, /unknown commit type/);
});

// -------------------------------------------------------------------------------------- pr

test('pr: the first push is authorised, the PR is a draft filled from the template, a second run only pushes', async () => {
  const { root, env, git } = await repo({ mode: 'both' });
  await yaw(root, ['branch', 'T-012', 'flow'], { env });
  writeFileSync(join(root, 'a.txt'), 'a\n');
  git('add', 'a.txt');
  await yaw(root, ['commit', 'feat', 'add the flow'], { env });
  // the issue link of T-012 comes from TASKS.md
  writeFileSync(join(root, 'TASKS.md'), '# Tasks\n\n## Active\n### T-012 (#34) Flow — in progress\n- **Brief:** x\n\n## Backlog\n\n## Done → TASKS.archive.md\n');
  const gh = fakeGh();
  const r = await yaw(root, ['pr', '--yes'], { gh, env });
  assert.equal(r.code, 0, r.err + r.out);
  assert.match(r.out, /pull\/5/);
  assert.match(run('git', ['ls-remote', '--heads', 'origin', 'feat/T-012-flow'], { cwd: root, env }).stdout, /refs\/heads\/feat\/T-012-flow/);
  assert.match(git('rev-parse', '--abbrev-ref', 'feat/T-012-flow@{upstream}'), /origin\/feat\/T-012-flow/);
  const create = gh.calls.find((c) => c.args[1] === 'create').args;
  assert.ok(create.includes('--draft'));
  assert.equal(create[create.indexOf('--title') + 1], 'feat: add the flow');
  assert.equal(create[create.indexOf('--base') + 1], 'main');
  assert.equal(create[create.indexOf('--head') + 1], 'feat/T-012-flow');
  const body = create[create.indexOf('--body') + 1];
  assert.match(body, /- feat: add the flow\n/);
  assert.match(body, /\nCloses #34\n/);
  assert.match(body, /- \[ \] `just check` is green/);
  assert.doesNotMatch(body, /<!-- yaw:(summary|closes) -->/);

  // second run: the branch has an upstream (no authorisation needed) and the PR exists (no second one)
  writeFileSync(join(root, 'c.txt'), 'c\n');
  git('add', 'c.txt');
  await yaw(root, ['commit', 'fix', 'more'], { env });
  const gh2 = fakeGh({ prs: [{ number: 5, url: 'https://github.com/octo/demo/pull/5' }] });
  const again = await yaw(root, ['pr'], { gh: gh2, env });
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /pull request #5 is updated by the push/);
  assert.equal(gh2.calls.some((c) => c.args[1] === 'create'), false);
  assert.match(run('git', ['ls-remote', 'origin', 'feat/T-012-flow'], { cwd: root, env }).stdout.split('\t')[0], new RegExp(`^${git('rev-parse', 'HEAD')}$`));
});

test('pr: an issue-number branch closes the issue; ready skips draft; tasks.md garbage is not trusted', async () => {
  const { root, env, git } = await repo({ mode: 'github' });
  await yaw(root, ['branch', '#34', 'login'], { env });
  writeFileSync(join(root, 'a.txt'), 'a\n');
  git('add', 'a.txt');
  await yaw(root, ['commit', 'fix', 'login'], { env });
  const gh = fakeGh();
  assert.equal((await yaw(root, ['pr', '--yes', '--ready', '--title', 'Fix login'], { gh, env })).code, 0);
  const create = gh.calls.find((c) => c.args[1] === 'create').args;
  assert.equal(create.includes('--draft'), false);
  assert.equal(create[create.indexOf('--title') + 1], 'Fix login');
  assert.match(create[create.indexOf('--body') + 1], /Closes #34/);
});

test('pr: both mode ignores a TASKS.md that does not parse or carries a silly issue number', async () => {
  for (const tasks of ['not a ledger', '# Tasks\n\n## Active\n### T-012 (#99999999999999999999) Flow — in progress\n\n## Backlog\n\n## Done → TASKS.archive.md\n']) {
    const { root, env, git } = await repo({ mode: 'both' });
    await yaw(root, ['branch', 'T-012', 'flow'], { env });
    writeFileSync(join(root, 'a.txt'), 'a\n');
    git('add', 'a.txt');
    await yaw(root, ['commit', 'feat', 'flow'], { env });
    writeFileSync(join(root, 'TASKS.md'), tasks);
    const gh = fakeGh();
    assert.equal((await yaw(root, ['pr', '--yes'], { gh, env })).code, 0);
    const all = gh.calls.find((c) => c.args[1] === 'create').args.join('\n');
    assert.match(all, /Refs T-012/);
    assert.doesNotMatch(all, /Closes/);
  }
});

test('pr: refuses on the default branch, without origin and on a branch without commits of its own', async () => {
  const { root, env, git } = await repo();
  assert.match((await yaw(root, ['pr', '--yes'], { gh: fakeGh(), env })).err, /you are on main/);
  await yaw(root, ['branch', 'T-001', 'empty'], { env });
  assert.match((await yaw(root, ['pr', '--yes'], { gh: fakeGh(), env })).err, /no commits of its own/);
  git('remote', 'remove', 'origin');
  assert.match((await yaw(root, ['pr', '--yes'], { gh: fakeGh(), env })).err, /no remote "origin"/);
});

test('pr-status prints the review state and the checks', async () => {
  const { root, env } = await repo();
  await yaw(root, ['branch', 'T-001', 'x'], { env });
  const none = await yaw(root, ['pr-status'], { gh: fakeGh(), env });
  assert.match(none.out, /no pull request for feat\/T-001-x/);
  const gh = fakeGh({ prs: [{ number: 5, title: 'T', state: 'OPEN', isDraft: true, reviewDecision: 'APPROVED', url: 'https://github.com/octo/demo/pull/5', statusCheckRollup: [{ name: 'quality-gate', conclusion: 'SUCCESS' }, { context: 'legacy', state: 'PENDING' }] }] });
  const r = await yaw(root, ['pr-status'], { gh, env });
  assert.match(r.out, /#5 T \[OPEN, draft\] review: APPROVED/);
  assert.match(r.out, /quality-gate: SUCCESS/);
  assert.match(r.out, /legacy: PENDING/);
});

// ----------------------------------------------------------------------------------- release

test('release: tag, push the tag, GitHub release; refuses a dirty tree, another branch, a behind branch and an existing tag', async () => {
  const { root, env, git } = await repo();
  assert.match((await yaw(root, ['release', 'one', '--yes'], { gh: fakeGh(), env })).err, /not a version/);
  const gh = fakeGh();
  const r = await yaw(root, ['release', 'v0.1.0', '--yes'], { gh, env });
  assert.equal(r.code, 0, r.err);
  assert.equal(git('tag', '--list'), 'v0.1.0');
  assert.match(run('git', ['ls-remote', '--tags', 'origin'], { cwd: root, env }).stdout, /refs\/tags\/v0\.1\.0/);
  assert.deepEqual(gh.calls.at(-1).args, ['release', 'create', 'v0.1.0', '--verify-tag', '--generate-notes', '--title', 'v0.1.0']);
  assert.match((await yaw(root, ['release', '0.1.0', '--yes'], { gh, env })).err, /tag v0\.1\.0 exists already/);

  const pre = fakeGh();
  assert.equal((await yaw(root, ['release', '0.2.0-rc.1', '--yes'], { gh: pre, env })).code, 0);
  assert.ok(pre.calls.at(-1).args.includes('--prerelease'));

  writeFileSync(join(root, 'dirty.txt'), 'x\n');
  assert.match((await yaw(root, ['release', '0.3.0', '--yes'], { gh, env })).err, /working tree has changes/);
  unlinkSync(join(root, 'dirty.txt'));
  git('commit', '--quiet', '--allow-empty', '-m', 'local only');
  assert.match((await yaw(root, ['release', '0.3.0', '--yes'], { gh, env })).err, /differs from origin\/main/);
  git('switch', '--quiet', '-c', 'feat/T-001-x');
  assert.match((await yaw(root, ['release', '0.3.0', '--yes'], { gh, env })).err, /cut from main/);
});

// ------------------------------------------------------------------------------ project-add

test('project-add: adds the issue and sets the Status option', async () => {
  const { root, env } = await repo();
  assert.match((await yaw(root, ['project-add', '9', '--yes'], { gh: fakeGh(), env })).err, /set project\.number/);
  writeConfig(root, 'project:\n  number: 3\n');
  const gh = fakeGh();
  const r = await yaw(root, ['project-add', '#9', '--status', 'in progress', '--yes'], { gh, env });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /#9 is on project 3 \(Status: in progress\)/);
  const names = gh.calls.map((c) => c.args.slice(0, 2).join(' '));
  assert.deepEqual(names.filter((n) => n.startsWith('project')), ['project item-add', 'project view', 'project field-list', 'project item-edit']);
  const edit = gh.calls.find((c) => c.args[1] === 'item-edit').args;
  assert.deepEqual(edit.slice(2), ['--id', 'PVTI_item', '--project-id', 'PVT_project', '--field-id', 'PVTSSF_status', '--single-select-option-id', 'o2']);
  assert.match((await yaw(root, ['project-add', '9', '--status', 'Nope', '--yes'], { gh: fakeGh(), env })).err, /no Status option "Nope"/);
  assert.match((await yaw(root, ['project-add', 'T-3', '--yes'], { gh: fakeGh(), env })).err, /takes an issue number/);
});

// ----------------------------------------------------------------------------------- init

test('init: private by default, public only when asked, refuses an existing origin or a repo without a commit', async () => {
  const { root, env, git } = await repo();
  assert.match((await yaw(root, ['init', 'demo', '--yes'], { gh: fakeGh(), env })).err, /"origin" exists already/);
  git('remote', 'remove', 'origin');
  const gh = fakeGh({ labels: [] });
  const r = await yaw(root, ['init', 'demo', '--owner', 'octo', '--yes'], { gh, env });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(gh.calls.find((c) => c.args[1] === 'create' && c.args[0] === 'repo').args, ['repo', 'create', 'octo/demo', '--private', '--source', '.', '--remote', 'origin', '--push']);
  assert.ok(gh.calls.some((c) => c.args.join(' ').endsWith('-- type:feature')), 'labels follow');

  const pub = fakeGh();
  const noPublic = await yaw(root, ['init', 'demo', '--public'], { gh: pub, env });
  assert.equal(noPublic.code, 1);
  assert.match(noPublic.out, /PUBLIC \(anyone on the internet can read it\)/);
  assert.deepEqual(pub.writes(), []);
  assert.equal((await yaw(root, ['init', 'demo', '--public', '--yes'], { gh: pub, env })).code, 0);
  assert.ok(pub.calls.find((c) => c.args[1] === 'create' && c.args[0] === 'repo').args.includes('--public'));

  assert.match((await yaw(root, ['init', '../evil', '--yes'], { gh: fakeGh(), env })).err, /not a valid repository name/);
  assert.match((await yaw(root, ['init', 'demo', '--owner', 'a/b', '--yes'], { gh: fakeGh(), env })).err, /not a valid owner/);
  assert.match((await yaw(await project(), ['init', 'demo', '--yes'], { gh: fakeGh(), env })).err, /not a git repository with a commit yet/);
});

// -------------------------------------------------------------------------------------- safety

test('files are read only when they are regular files inside the project (no symlinks)', async () => {
  const { root, env } = await repo();
  const outside = join(tmp('yaw-outside-'), 'x.yaml');
  writeFileSync(outside, 'labels:\n  - { name: "type:bug", color: D73A4A }\n');
  unlinkSync(join(root, '.yaw', 'github.yaml'));
  symlinkSync(outside, join(root, '.yaw', 'github.yaml'));
  const gh = fakeGh();
  const r = await yaw(root, ['labels', '--yes'], { gh, env });
  assert.equal(r.code, 1);
  assert.match(r.err, /escapes the project/);
  assert.deepEqual(gh.calls, []);
  // a link that stays inside the project is refused as well
  unlinkSync(join(root, '.yaw', 'github.yaml'));
  writeFileSync(join(root, 'real.yaml'), 'labels: []\n');
  symlinkSync(join(root, 'real.yaml'), join(root, '.yaw', 'github.yaml'));
  const inside = await yaw(root, ['labels', '--yes'], { gh, env });
  assert.equal(inside.code, 1);
  assert.match(inside.err, /must be a regular file, not a symbolic link/);
  assert.deepEqual(gh.calls, []);

  // a PR template that is a link to somewhere else
  const { root: r2, env: e2, git } = await repo();
  await yaw(r2, ['branch', 'T-001', 'x'], { env: e2 });
  writeFileSync(join(r2, 'a.txt'), 'a\n');
  git('add', 'a.txt');
  await yaw(r2, ['commit', 'feat', 'x'], { env: e2 });
  unlinkSync(join(r2, '.github', 'pull_request_template.md'));
  symlinkSync(outside, join(r2, '.github', 'pull_request_template.md'));
  const pr = fakeGh();
  const bad = await yaw(r2, ['pr', '--yes'], { gh: pr, env: e2 });
  assert.equal(bad.code, 1);
  assert.match(bad.err, /escapes the project/);
  assert.equal(pr.calls.some((c) => c.args[1] === 'create'), false);
});

test('a github.yaml that breaks the schema is reported with file and line', async () => {
  const { root, env } = await repo();
  writeConfig(root, 'labels:\n  - { name: "type:bug", color: red }\n');
  const r = await yaw(root, ['labels', '--yes'], { gh: fakeGh(), env });
  assert.equal(r.code, 1);
  assert.match(r.err, /\.yaw\/github\.yaml:2/);
});

test('yaw gh needs the github module and a known verb', async () => {
  const root = await project({ modules: ['core'] });
  assert.match((await yaw(root, ['branch', 'T-1', 'x'])).err, /github module is not installed/);
  const { root: r2, env } = await repo();
  const unknown = await yaw(r2, ['merge', '5'], { env });
  assert.equal(unknown.code, 1);
  assert.match(unknown.err, /unknown verb "merge"/);
  assert.match(unknown.err, /usage: yaw gh init/);
  assert.match((await yaw(r2, [], { env })).err, /missing verb/);
});

// ------------------------------------------------------------------------------------- just

test('just recipes reach yaw gh (quoted arguments survive)', { skip: !hasTool('just') && !process.env.CI && 'just is needed' }, async () => {
  const { root, env, git } = await repo();
  const e = { ...env, YAW_KIT: KIT_ROOT };
  const r = run('just', ['branch', 'T-012', 'Invite flow; echo pwned'], { cwd: root, env: e });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(git('branch', '--show-current'), 'feat/T-012-invite-flow-echo-pwned');
  const blocked = run('just', ['gh-labels'], { cwd: root, env: e });
  assert.notEqual(blocked.status, 0);
  assert.match(String(blocked.stdout) + String(blocked.stderr), /not authorised|gh: the GitHub CLI|gh could not run|gh repo view failed/);
  const missing = run('just', ['gh-init'], { cwd: root, env: { ...env, YAW_KIT: join(root, 'nope') } });
  assert.notEqual(missing.status, 0);
  assert.match(String(missing.stdout) + String(missing.stderr), /the YAW kit is not installed/);
});

// ------------------------------------------------------------------------------------ removal

test('remove leaves zero residue; answers stay; re-add restores the same files', async () => {
  const root = await project();
  const before = readTree(root);
  await removeModule({ root, kitRoot: KIT_ROOT, module: 'github' });
  const left = readTree(root);
  for (const gone of ['just/github.just', '.github/pull_request_template.md', '.yaw/github.yaml']) assert.equal(Object.hasOwn(left, gone), false, gone);
  assert.doesNotMatch(left.justfile, /github/);
  assert.doesNotMatch(left['AGENTS.md'], /yaw:github|just branch/);
  assert.equal(Object.hasOwn(JSON.parse(left['.claude/settings.json']).permissions, 'ask'), false);
  assert.ok(JSON.parse(left['.claude/settings.json']).permissions.deny.length > 0, 'the security rules stay');
  const manifest = readManifest(root);
  assert.equal(manifest.modules.github, undefined);
  assert.equal(manifest.files.some((f) => f.module === 'github'), false);
  assert.equal(manifest.files.some((f) => (f.fragments ?? []).some((x) => x.module === 'github')), false);
  assert.deepEqual(readAnswers(root).proposal.profiles, ['node-cli']);
  await addModule({ root, kitRoot: KIT_ROOT, module: 'github' });
  assert.deepEqual(readTree(root), before);
});

test('an edited github.yaml survives update and removal asks (keep)', async () => {
  const root = await project();
  writeConfig(root, `${read(root, '.yaw/github.yaml')}# mine\n`);
  await updateProject({ root, kitRoot: KIT_ROOT, strategy: 'keep' });
  assert.match(read(root, '.yaw/github.yaml'), /# mine/);
});

test('the Claude ask rules cover every guarded verb, however yaw is called', async () => {
  const ask = JSON.parse(read(await project(), '.claude/settings.json')).permissions.ask;
  const covered = (cmd) => ask.some((r) => {
    const m = /^Bash\((.*):\*\)$/.exec(r);
    if (!m) return false;
    const re = new RegExp(`^${m[1].replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}`);
    return re.test(cmd);
  });
  for (const verb of GUARDED) {
    for (const cmd of [`yaw gh ${verb} --yes`, `yaw gh --yes ${verb}`, `node /home/u/.yaw/kit/bin/yaw gh ${verb} --yes`, `node ~/.yaw/kit/bin/yaw gh --yes ${verb}`, `~/.local/bin/yaw gh ${verb} --yes`, `$HOME/.yaw/kit/bin/yaw gh --yes ${verb}`, `/Users/u/.local/bin/yaw gh ${verb}`]) {
      assert.ok(covered(cmd), cmd);
    }
  }
  assert.ok(!covered('git status'));
});

test('a label name that looks like a flag is passed after --', async () => {
  const { root, env } = await repo();
  writeConfig(root, 'labels:\n  - { name: "--force", color: D73A4A }\n');
  const gh = fakeGh();
  assert.equal((await yaw(root, ['labels', '--yes'], { gh, env })).code, 0);
  assert.deepEqual(gh.writes()[0].args, ['label', 'create', '--color', 'D73A4A', '--description', '', '--', '--force']);
});

test('GUARDED is the list of the authorise call sites in the code', () => {
  const code = readFileSync(join(KIT_ROOT, 'modules', 'github', 'lib', 'cli.js'), 'utf8');
  assert.equal((code.match(/await authorise\(/g) ?? []).length, GUARDED.length);
  for (const verb of GUARDED) assert.ok(VERBS.includes(verb), verb);
});
