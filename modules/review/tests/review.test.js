// review module (ADR-0055): reviewer files per trigger, the shared pre-push key, the push gate (findings stop,
// a pass is cached per commit, YAW_REVIEW=skip), `yaw review install` without lefthook, and the Stop hint.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { initProject } from '../../../core/render/project.js';
import { KIT_ROOT, readTree, tmp, writeAnswers } from '../../../test/helpers/fixtures.js';
import { buildPrompt, pushedCommits, runReview, verdict } from '../lib/cli.js';
import { allPrompts, effectivePrompt, kitPrompt, removePrompt, savePrompt } from '../lib/prompts.js';
import stopReviewHint from '../hooks/stop-review-hint.js';

function answers(modules, extra = '', agents = 'claude, copilot') {
  return `mode: full\nanswers:\n  user.agents: [${agents}]\n  idea.text: A tiny tool.\n${['quality', 'logic', 'feature'].filter((kind) => !extra.includes('quality.review-' + kind + ':')).map((kind) => '  quality.review-' + kind + ': ' + (kind === 'feature' ? 'request' : 'push') + '\n').join('')}${extra}proposal:\n  status: confirmed\n  summary: test project\n  profiles: [node-cli]\n  modules: [${modules.join(', ')}]\n`;
}

async function project(modules, extra) {
  const root = tmp('yaw-review-');
  await initProject({ root, kitRoot: KIT_ROOT, answersFile: writeAnswers(tmp('yaw-ans-'), answers(modules, extra)), modules });
  return root;
}

function git(root, ...args) {
  const r = spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', ...args], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

function io(root, env = {}) {
  const out = { stdout: '', stderr: '' };
  return {
    out,
    io: { root, cwd: root, kitRoot: KIT_ROOT, env: { PATH: process.env.PATH, HOME: tmp('yaw-home-'), ...env },
      stdout: { write: (s) => { out.stdout += s; } }, stderr: { write: (s) => { out.stderr += s; } } },
  };
}

function committed(root) {
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'init');
  return `refs/heads/main ${git(root, 'rev-parse', 'HEAD')} refs/heads/main ${'0'.repeat(40)}\n`;
}

test('renders sub-agents only for reviewers that are on, and the gate in the shared pre-push key', async () => {
  const root = await project(['core', 'git-hooks', 'team', 'tasks', 'github', 'review'], '  quality.review-ux: "off"\n  quality.review-feature: request\n');
  const tree = readTree(root);
  for (const k of ['quality', 'logic', 'feature']) {
    assert.match(tree[`.claude/agents/review-${k}.md`], new RegExp(`name: review-${k}`));
    assert.match(tree[`.github/agents/review-${k}.agent.md`], /VERDICT: PASS/);
  }
  assert.equal(tree['.claude/agents/review-ux.md'], undefined);
  // prompts are not copied into the skill; agents fetch the layered prompt
  assert.equal(Object.keys(tree).some((f) => f.includes('skills/review/reviewers/')), false);
  assert.match(tree['.claude/agents/review-logic.md'], /just review-prompt logic/);
  assert.match(tree['.agents/skills/review/SKILL.md'], /just review-prompt rules/);
  assert.match(tree['just/review.just'], /^review-prompt \*args:/m);
  // one pre-push key for the team job and the review gate
  assert.equal(tree['lefthook.yml'].match(/^pre-push:/gm).length, 1);
  assert.match(tree['lefthook.yml'], /no-push-to-default-branch/);
  assert.match(tree['lefthook.yml'], /script: yaw-review.sh/);
  assert.match(tree['.lefthook/pre-push/yaw-review.sh'], /review gate "\$@"/);
  assert.doesNotMatch(tree['just/review.just'], /review-install/);
});

test('without push reviewers or git-hooks: no gate in lefthook, review-install instead', async () => {
  const off = await project(['core', 'git-hooks', 'review'], '  quality.review-quality: request\n  quality.review-logic: suggest\n');
  assert.doesNotMatch(readTree(off)['lefthook.yml'], /pre-push/);
  assert.equal(readTree(off)['.lefthook/pre-push/yaw-review.sh'], undefined);
  const plain = await project(['core', 'review']);
  assert.match(readTree(plain)['just/review.just'], /^review-install:/m);
});

test('verdict reads the last VERDICT line; the prompt carries the diff and the task list for feature fit', () => {
  assert.equal(verdict('a\nVERDICT: findings\nVERDICT: PASS\n'), 'PASS');
  assert.equal(verdict('no verdict'), null);
  // only an exact final line counts: no trailing text, other case, markup or a later line
  assert.equal(verdict('VERDICT: PASS\n\n'), 'PASS');
  assert.equal(verdict('VERDICT: PASS because nothing changed'), null);
  assert.equal(verdict('verdict: pass'), null);
  assert.equal(verdict('**VERDICT: PASS**'), null);
  assert.equal(verdict('VERDICT: PASS\nOne more thing: a.js:1 is broken'), null);
  const root = tmp('yaw-review-p-');
  writeFileSync(join(root, 'TASKS.md'), '# Tasks\n\n## Active\n\n- [ ] T-001 CSV export\n');
  const prompt = buildPrompt({ root, kind: 'feature', range: 'a..b', diff: '+x', env: { HOME: tmp('yaw-home-') } });
  assert.match(prompt, /Feature-fit reviewer/);
  assert.match(prompt, /At most 7 findings/);
  assert.match(prompt, /never edit, stage, commit or push/);
  assert.match(prompt, /T-001 CSV export/);
  assert.match(prompt, /```diff\n\+x\n```/);
});

test('gate: findings stop the push, a pass is cached per commit, YAW_REVIEW=skip lets it through', async () => {
  const root = await project(['core', 'review']);
  const stdin = committed(root);
  const findings = io(root, { YAW_REVIEW_CMD: 'cat >/dev/null; echo "a.js:1 x"; echo "VERDICT: FINDINGS"', YAW_REVIEW_NO_TTY: '1' });
  assert.equal(runReview({ verb: 'gate', io: findings.io, stdin }), 1);
  assert.match(findings.out.stderr, /YAW_REVIEW=skip git push/);

  const skip = io(root, { YAW_REVIEW: 'skip' });
  assert.equal(runReview({ verb: 'gate', io: skip.io, stdin }), 0);

  const pass = io(root, { YAW_REVIEW_CMD: 'cat >/dev/null; echo "VERDICT: PASS"' });
  assert.equal(runReview({ verb: 'gate', io: pass.io, stdin }), 0);
  const cache = JSON.parse(readFileSync(join(root, '.git', 'yaw', 'reviews.json'), 'utf8'));
  assert.deepEqual(Object.keys(Object.values(cache)[0]).sort(), ['logic', 'quality']);

  const again = io(root, { YAW_REVIEW_CMD: 'exit 9' });
  assert.equal(runReview({ verb: 'gate', io: again.io, stdin }), 0);
  assert.match(again.out.stderr, /already reviewed/);
});

test('gate: warn mode without a terminal behaves like block; no output verdict counts as findings', async () => {
  const root = await project(['core', 'review'], '  quality.review-gate: warn\n');
  const stdin = committed(root);
  const run = io(root, { YAW_REVIEW_CMD: 'cat >/dev/null; echo looks fine', YAW_REVIEW_NO_TTY: '1' });
  assert.equal(runReview({ verb: 'gate', io: run.io, stdin }), 1);
  assert.match(run.out.stderr, /no VERDICT line/);
});

test('pushedCommits skips deletions and only lists commits the remote does not have', async () => {
  const root = await project(['core', 'review']);
  committed(root);
  const first = git(root, 'rev-parse', 'HEAD');
  writeFileSync(join(root, 'x.txt'), 'x\n');
  git(root, 'add', 'x.txt');
  git(root, 'commit', '-qm', 'two');
  const second = git(root, 'rev-parse', 'HEAD');
  const { commits } = pushedCommits(root, `refs/heads/main ${second} refs/heads/main ${first}\nrefs/heads/old ${'0'.repeat(40)} refs/heads/old ${first}\n`);
  assert.deepEqual(commits, [second]);
});

test('pushedCommits throws when git cannot list the commits (unknown remote sha)', async () => {
  const root = await project(['core', 'review']);
  const stdin = committed(root);
  const local = git(root, 'rev-parse', 'HEAD');
  assert.throws(() => pushedCommits(root, `refs/heads/main ${local} refs/heads/main ${'1'.repeat(40)}\n`), /git rev-list/);
});

test('gate: a git error stops the push without running the reviewers; YAW_REVIEW=skip still lets it through', async () => {
  const root = await project(['core', 'review']);
  const stdin = committed(root);
  const local = git(root, 'rev-parse', 'HEAD');
  const unknown = `refs/heads/main ${local} refs/heads/main ${'1'.repeat(40)}\n`;
  const marker = join(root, 'agent-ran');
  const cmd = `cat >/dev/null; touch ${marker}; echo "VERDICT: PASS"`;
  const bad = io(root, { YAW_REVIEW_CMD: cmd });
  assert.equal(runReview({ verb: 'gate', io: bad.io, stdin: unknown }), 2);
  assert.match(bad.out.stderr, /review gate: git failed/);
  assert.equal(existsSync(marker), false);

  const skip = io(root, { YAW_REVIEW: 'skip', YAW_REVIEW_CMD: cmd });
  assert.equal(runReview({ verb: 'gate', io: skip.io, stdin: unknown }), 0);

  // a diff that git cannot produce is not an empty diff
  git(root, 'config', 'diff.external', 'false');
  const diff = io(root, { YAW_REVIEW_CMD: cmd });
  assert.equal(runReview({ verb: 'gate', io: diff.io, stdin }), 2);
  assert.match(diff.out.stderr, /review gate: git failed/);
  assert.equal(existsSync(marker), false);
});

test('install writes an executable pre-push hook and refuses to overwrite a foreign one', async () => {
  const root = await project(['core', 'review']);
  committed(root);
  const first = io(root);
  assert.equal(runReview({ verb: 'install', io: first.io }), 0);
  const hook = join(root, '.git', 'hooks', 'pre-push');
  assert.match(readFileSync(hook, 'utf8'), /review gate "\$@"/);
  assert.ok(statSync(hook).mode & 0o100);
  writeFileSync(hook, '#!/bin/sh\necho mine\n');
  const second = io(root);
  assert.equal(runReview({ verb: 'install', io: second.io }), 2);
  assert.match(second.out.stderr, /is not YAW's/);
});

test('Stop hint: only with "suggest" reviewers and pending work, once per session', async () => {
  const root = await project(['core', 'review'], '  quality.review-feature: suggest\n');
  committed(root);
  const env = { HOME: tmp('yaw-home-'), YAW_HOME: tmp('yaw-state-') };
  const manifest = {};
  assert.equal(stopReviewHint({ sessionId: 's1' }, { root, env, manifest })?.systemMessage.includes('just review feature'), true);
  assert.equal(stopReviewHint({ sessionId: 's1' }, { root, env, manifest }), null);
  const none = await project(['core', 'review']);
  committed(none);
  assert.equal(stopReviewHint({ sessionId: 's2' }, { root: none, env, manifest }), null);
  assert.equal(existsSync(join(none, '.git')), true);
});

test('prompts: project overrides the global blueprint, which overrides the kit default; removing falls back', () => {
  const root = tmp('yaw-review-l-');
  const env = { HOME: tmp('yaw-home-') };
  const ctx = { root, env };
  assert.equal(effectivePrompt('logic', ctx).source, 'kit');
  assert.equal(effectivePrompt('logic', ctx).text, kitPrompt('logic'));

  const g = savePrompt({ scope: 'global', kind: 'logic', text: 'Blueprint logic', expected: null, ...ctx });
  assert.equal(g.path, '~/.yaw/review/logic.md');
  assert.equal(statSync(join(env.HOME, '.yaw', 'review', 'logic.md')).mode & 0o777, 0o600);
  assert.deepEqual(effectivePrompt('logic', ctx), { text: 'Blueprint logic\n', source: 'global' });

  savePrompt({ scope: 'project', kind: 'logic', text: 'Project logic\n', ...ctx });
  assert.equal(effectivePrompt('logic', ctx).source, 'project');
  assert.equal(readFileSync(join(root, '.yaw', 'review', 'logic.md'), 'utf8'), 'Project logic\n');
  // a project without a root (Global settings) only sees the blueprint
  assert.equal(effectivePrompt('logic', { env }).source, 'global');

  const layers = allPrompts(ctx).find((p) => p.kind === 'logic');
  assert.throws(() => savePrompt({ scope: 'project', kind: 'logic', text: 'x', expected: 'sha256:stale', ...ctx }), { status: 409 });
  assert.deepEqual(removePrompt({ scope: 'project', kind: 'logic', expected: layers.project.hash, ...ctx }), { removed: true });
  assert.equal(effectivePrompt('logic', ctx).source, 'global');
  removePrompt({ scope: 'global', kind: 'logic', ...ctx });
  assert.equal(effectivePrompt('logic', ctx).source, 'kit');
});

test('prompts: refuses unknown kinds, empty text, secrets and symbolic links', () => {
  const root = tmp('yaw-review-s-');
  const ctx = { root, env: { HOME: tmp('yaw-home-') } };
  assert.throws(() => savePrompt({ scope: 'project', kind: 'nope', text: 'x', ...ctx }), /unknown review prompt/);
  assert.throws(() => savePrompt({ scope: 'project', kind: 'ux', text: '  \n', ...ctx }), /empty/);
  assert.throws(() => savePrompt({ scope: 'project', kind: 'ux', text: 'use key AKIAIOSFODNN7EXAMPLE now', ...ctx }), /secret/);
  assert.equal(existsSync(join(root, '.yaw', 'review', 'ux.md')), false);
  const elsewhere = tmp('yaw-review-elsewhere-');
  mkdirSync(join(root, '.yaw'), { recursive: true });
  symlinkSync(elsewhere, join(root, '.yaw', 'review'));
  assert.throws(() => savePrompt({ scope: 'project', kind: 'ux', text: 'x', ...ctx }), /symbolic link/);
  assert.equal(existsSync(join(elsewhere, 'ux.md')), false);
});

test('gate and `yaw review prompt` use the project prompt', async () => {
  const root = await project(['core', 'review']);
  const stdin = committed(root);
  const home = tmp('yaw-home-');
  savePrompt({ scope: 'project', kind: 'quality', text: 'PROJECT-QUALITY-MARKER', root, env: { HOME: home } });
  const seen = tmp('yaw-review-seen-');
  const run = io(root, { HOME: home, YAW_REVIEW_CMD: `cat >> "${seen}/p.txt"; echo "VERDICT: PASS"` });
  assert.equal(runReview({ verb: 'gate', io: run.io, stdin }), 0);
  assert.match(readFileSync(join(seen, 'p.txt'), 'utf8'), /PROJECT-QUALITY-MARKER/);

  const one = io(root, { HOME: home });
  assert.equal(runReview({ verb: 'prompt', args: ['quality'], io: one.io }), 0);
  assert.equal(one.out.stdout, 'PROJECT-QUALITY-MARKER\n');
  const list = io(root, { HOME: home });
  assert.equal(runReview({ verb: 'prompt', io: list.io }), 0);
  assert.match(list.out.stdout, /quality\s+\.yaw\/review\/quality\.md/);
  assert.match(list.out.stdout, /logic\s+kit default/);
});

test('security reviewer renders agent adapters, participates in the gate and honors layered prompts', async () => {
  const root = await project(['core', 'review'], '  quality.review-quality: "off"\n  quality.review-logic: "off"\n  quality.review-feature: "off"\n  quality.review-security: push\n  quality.review-gate: block\n');
  const tree = readTree(root);
  for (const path of ['.claude/agents/review-security.md', '.github/agents/review-security.agent.md']) assert.match(tree[path], /just review-prompt security/);
  assert.match(kitPrompt('security'), /ASVS 5\.0\.0/);
  const ctx = { root, env: { HOME: tmp('yaw-security-prompt-') }, kitRoot: KIT_ROOT };
  const layers = allPrompts(ctx).find((p) => p.kind === 'security');
  savePrompt({ ...ctx, scope: 'project', kind: 'security', text: 'Check object-level authorization in changed handlers.', expected: layers.project?.hash ?? null });
  assert.match(effectivePrompt('security', ctx).text, /object-level authorization/);
  const stdin = committed(root);
  const findings = io(root, { YAW_REVIEW_CMD: 'cat >/dev/null; echo "handler.js:8 missing authorization"; echo "VERDICT: FINDINGS"', YAW_REVIEW_NO_TTY: '1' });
  assert.equal(runReview({ verb: 'gate', io: findings.io, stdin }), 1);
  assert.match(findings.out.stderr, /Security/);
  const pass = io(root, { YAW_REVIEW_CMD: 'cat >/dev/null; echo "VERDICT: PASS"' });
  assert.equal(runReview({ verb: 'gate', io: pass.io, stdin }), 0);
  const cache = JSON.parse(readFileSync(join(root, '.git/yaw/reviews.json'), 'utf8'));
  assert.deepEqual(Object.keys(Object.values(cache)[0]), ['security']);
});

// A stored PASS only covers the exact requirements it was given: prompt text, rules, range and configuration.
async function approvedProject(extra = '') {
  const root = await project(['core', 'review'], extra);
  const first = committed(root);
  const home = tmp('yaw-home-');
  const seen = join(tmp('yaw-review-seen-'), 'runs.txt');
  const pass = (stdin) => {
    const r = io(root, { HOME: home, YAW_REVIEW_CMD: `cat >/dev/null; echo run >> "${seen}"; echo "VERDICT: PASS"` });
    assert.equal(runReview({ verb: 'gate', io: r.io, stdin }), 0);
    return r.out.stderr;
  };
  const runs = () => (existsSync(seen) ? readFileSync(seen, 'utf8').split('\n').filter(Boolean).length : 0);
  return { root, home, first, pass, runs };
}

test('gate: a changed project prompt or reporting rules invalidate a stored PASS', async () => {
  const { root, home, first, pass, runs } = await approvedProject();
  pass(first);
  assert.equal(runs(), 2); // quality and logic
  assert.match(pass(first), /already reviewed/);
  assert.equal(runs(), 2);

  savePrompt({ scope: 'project', kind: 'quality', text: 'Stricter quality prompt.', root, env: { HOME: home } });
  pass(first);
  assert.equal(runs(), 3); // only quality again
  assert.match(pass(first), /already reviewed/);

  savePrompt({ scope: 'global', kind: 'rules', text: 'New reporting rules.', root, env: { HOME: home } });
  pass(first);
  assert.equal(runs(), 5); // every reviewer reads the rules
});

test('gate: a changed relevant configuration or reviewed range invalidates a stored PASS', async () => {
  const { root, first, pass, runs } = await approvedProject('  quality.unit-tests: false\n');
  pass(first);
  assert.equal(runs(), 2);
  const file = join(root, '.yaw', 'answers.yaml');
  writeFileSync(file, readFileSync(file, 'utf8').replace('quality.unit-tests: false', 'quality.unit-tests: true'));
  pass(first);
  assert.equal(runs(), 4); // every reviewer's prompt carries the setup constraints, including quality.unit-tests

  // the same commit approved inside a larger range is not approved for a different range
  const one = git(root, 'rev-parse', 'HEAD');
  writeFileSync(join(root, 'x.txt'), 'x\n');
  git(root, 'add', 'x.txt');
  git(root, 'commit', '-qm', 'two');
  const two = git(root, 'rev-parse', 'HEAD');
  pass(`refs/heads/main ${two} refs/heads/main ${'0'.repeat(40)}\n`);
  const before = runs();
  assert.match(pass(`refs/heads/main ${two} refs/heads/main ${'0'.repeat(40)}\n`), /already reviewed/);
  assert.equal(runs(), before);
  pass(`refs/heads/main ${two} refs/heads/main ${one}\n`);
  assert.ok(runs() > before);
});
