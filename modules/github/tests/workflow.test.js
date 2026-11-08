// Synthetic CLI responses: no network calls or claim of live GitHub certification.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../../../core/cli/main.js';
import { parse } from '../../../core/lib/yaml.js';
import { initProject } from '../../../core/render/project.js';
import { readManifest } from '../../../core/render/manifest.js';
import { capture, cleanEnv, read, tmp, writeAnswers } from '../../../test/helpers/fixtures.js';
import { prepareTaskWorkflow } from '../lib/cli.js';
import { planEpicMilestones, planProjectStatus } from '../lib/workflow.js';

const repo = { slug: 'octo/demo', owner: 'octo' };
const issue = (number, extra = {}) => ({
  number, html_url: `https://github.com/octo/demo/issues/${number}`, labels: [], ...extra,
});

function fake() {
  const state = {
    calls: [], milestones: [], issues: new Map([[1, issue(1, { labels: [{ name: 'type:epic' }] })], [2, issue(2)]]),
    children: [issue(2)], status: true, fail: false,
  };
  const gh = (args) => {
    state.calls.push(args);
    const key = args.slice(0, 2).join(' ');
    if (key === 'repo view') return JSON.stringify({ nameWithOwner: repo.slug, owner: { login: repo.owner } });
    if (key === 'issue list') return '[]';
    if (key === 'issue edit' || key === 'issue comment') return '';
    if (key === 'project view') return '{"id":"project"}';
    if (key === 'project field-list') return JSON.stringify({ fields: state.status
      ? [{ id: 'status', name: 'Status', options: [{ id: 'progress', name: 'In progress' }, { id: 'review', name: 'In review' }] }] : [] });
    if (key === 'project item-add') return '{"id":"item"}';
    if (key === 'project item-edit') return '';
    const path = args.find((a) => a.startsWith('repos/'));
    if (args.includes('POST')) {
      if (state.fail) throw new Error('permission denied');
      const title = args.find((a) => a.startsWith('title=')).slice(6);
      const milestone = { number: state.milestones.length + 1, title };
      state.milestones.push(milestone);
      return JSON.stringify(milestone);
    }
    if (args.includes('PATCH')) {
      const n = Number(path.split('/').at(-1));
      const number = Number(args.find((a) => a.startsWith('milestone=')).slice(10));
      const milestone = state.milestones.find((m) => m.number === number);
      state.issues.get(n).milestone = milestone;
      for (const child of state.children) if (child.number === n) child.milestone = milestone;
      return '{}';
    }
    if (path?.includes('/milestones?')) return JSON.stringify([state.milestones.slice(0, 1), state.milestones.slice(1)]);
    if (path?.includes('/sub_issues?')) return JSON.stringify([state.children.slice(0, 1), state.children.slice(1)]);
    if (/\/issues\/\d+$/.test(path ?? '')) return JSON.stringify(state.issues.get(Number(path.split('/').at(-1))));
    throw new Error(`unexpected synthetic call: ${args.join(' ')}`);
  };
  const writes = () => state.calls.filter((a) => a.includes('POST') || a.includes('PATCH')
    || ['issue edit', 'issue comment', 'project item-add', 'project item-edit'].includes(a.slice(0, 2).join(' ')));
  return { gh, state, writes };
}

async function project(mode = 'github', config = '') {
  const root = tmp('yaw-workflow-');
  const modules = ['core', 'tasks', 'github'];
  const text = `mode: full\nanswers:\n  user.agents: [claude, codex, copilot]\n  idea.text: CLI\n  tasks.mode: ${mode}\nproposal:\n  status: confirmed\n  summary: Test CLI\n  profiles: [node-cli]\n  modules: [core, tasks, github]\n`;
  await initProject({ root, modules, answersFile: writeAnswers(tmp('yaw-answers-'), text) });
  writeFileSync(join(root, '.yaw/github.yaml'), config || '{}\n');
  return root;
}

test('issue forms and skills are valid, installed for each adapter and tracked for removal', async () => {
  const root = await project();
  const manifest = readManifest(root);
  for (const type of ['feature', 'bug', 'chore', 'spike', 'epic']) {
    const path = `.github/ISSUE_TEMPLATE/${type}.yml`;
    const form = parse(read(root, path));
    assert.deepEqual(form.labels, [`type:${type}`, 'status:todo']);
    for (const id of ['priority', 'estimate', 'acceptance', 'milestone']) {
      const field = form.body.find((f) => f.id === id);
      assert.equal(field.validations.required, true, `${type}/${id}`);
      assert.ok(field.attributes.description.length > 10);
    }
    assert.ok(manifest.files.some((f) => f.path === path && f.module === 'github'));
  }
  for (const name of ['issue-create', 'issue-triage', 'epic-plan']) {
    const path = `.agents/skills/${name}/SKILL.md`;
    const text = read(root, path);
    const header = parse(text.split('---')[1]);
    assert.equal(header.name, name);
    assert.ok(header.description.length > 20);
    assert.equal(read(root, `.claude/skills/${name}/SKILL.md`), text);
    assert.ok(manifest.files.some((f) => f.path === path && f.module === 'github'));
  }
});

test('Project field resolution completes before any write; missing Status refuses the plan', () => {
  const f = fake();
  const op = planProjectStatus({ gh: f.gh, repo, project: { number: 3 }, issue: 2, status: 'In progress' });
  assert.deepEqual(f.writes(), []);
  op.apply();
  assert.ok(f.writes().at(-1).includes('progress'));
  f.state.calls.length = 0;
  f.state.status = false;
  assert.throws(() => planProjectStatus({ gh: f.gh, repo, project: { number: 3 }, issue: 2, status: 'In review' }), /no Status option/);
  assert.deepEqual(f.writes(), []);
});

test('epic sync uses all pages, creates each milestone once, assigns direct children and is idempotent', () => {
  const f = fake();
  f.state.children.push(issue(3));
  f.state.issues.set(3, issue(3));
  const epics = [{ issue: 1, milestone: 'Phase 1' }];
  const plan = () => planEpicMilestones({ gh: f.gh, repo, epics });
  const operations = plan();
  assert.equal(operations.length, 4);
  assert.deepEqual(f.writes(), []);
  for (const op of operations) op.apply();
  assert.equal(f.state.milestones.length, 1);
  assert.equal(f.state.issues.get(3).milestone.title, 'Phase 1');
  f.state.calls.length = 0;
  assert.deepEqual(plan(), []);
  assert.deepEqual(f.writes(), []);
});

test('epic sync supports native types and refuses foreign children, conflicting mappings and non-epics before writes', () => {
  const f = fake();
  f.state.issues.set(1, issue(1, { type: { name: 'Epic' } }));
  assert.equal(planEpicMilestones({ gh: f.gh, repo, epics: [{ issue: 1, milestone: 'Release' }] }).length, 3);
  f.state.children = [issue(2, { html_url: 'https://github.com/other/repo/issues/2' })];
  assert.throws(() => planEpicMilestones({ gh: f.gh, repo, epics: [{ issue: 1, milestone: 'Release' }] }), /outside/);
  f.state.children = [issue(2)];
  assert.throws(() => planEpicMilestones({ gh: f.gh, repo, epics: [{ issue: 1, milestone: 'A' }, { issue: 1, milestone: 'B' }] }), /conflicting/);
  f.state.issues.get(1).type = null;
  assert.throws(() => planEpicMilestones({ gh: f.gh, repo, epics: [{ issue: 1, milestone: 'Release' }] }), /must be an Epic/);
  assert.deepEqual(f.writes(), []);
});

test('task workflow requires confirmation; disabled configuration makes no gh calls; errors are explicit', async () => {
  const root = await project();
  const f = fake();
  const io = { stdout: capture() };
  assert.equal(await prepareTaskWorkflow({ root, verb: 'sync', gh: f.gh, io }), undefined);
  assert.equal(f.state.calls.length, 0);
  writeFileSync(join(root, '.yaw/github.yaml'), 'epics: [{ issue: 1, milestone: Release }]\n');
  await assert.rejects(prepareTaskWorkflow({ root, verb: 'sync', gh: f.gh, io }), /not authorised/);
  await assert.rejects(prepareTaskWorkflow({ root, verb: 'sync', gh: f.gh, io: { ...io, confirm: async () => false } }), /not authorised/);
  assert.deepEqual(f.writes(), []);
  const apply = await prepareTaskWorkflow({ root, verb: 'sync', gh: f.gh, io: { ...io, confirm: async () => true } });
  assert.deepEqual(f.writes(), []);
  f.state.fail = true;
  assert.throws(apply, /permission denied.*earlier operations may have succeeded/);
});

test('real CLI task start/done update configured Status only after confirmation, never close the issue', async () => {
  const root = await project('github', 'project: { number: 3 }\n');
  const f = fake();
  const call = async (verb, confirm) => {
    const stderr = capture();
    const code = await main(['task', verb, '#2'], {
      cwd: root, gh: f.gh, stdout: capture(), stderr, confirm, env: cleanEnv(tmp('yaw-home-')),
    });
    return { code, err: stderr.text() };
  };
  assert.equal((await call('start')).code, 1);
  assert.deepEqual(f.writes(), [], 'refusal precedes issue assignment');
  assert.equal((await call('start', async () => false)).code, 1);
  assert.deepEqual(f.writes(), []);
  for (const [verb, option] of [['start', 'progress'], ['done', 'review']]) {
    f.state.calls.length = 0;
    const result = await call(verb, async () => true);
    assert.equal(result.code, 0, result.err);
    assert.ok(f.writes().some((args) => args.includes('--single-select-option-id') && args.includes(option)));
    assert.ok(!f.state.calls.some((a) => a[0] === 'issue' && a[1] === 'close'));
  }
});

test('real CLI sync integrates guarded epic mappings in both GitHub and local-first modes', async () => {
  for (const mode of ['github', 'both']) {
    const root = await project(mode, 'epics: [{ issue: 1, milestone: Release }]\n');
    const f = fake();
    const stderr = capture();
    const io = { cwd: root, gh: f.gh, stdout: capture(), stderr, env: cleanEnv(tmp('yaw-home-')) };
    const original = read(root, 'TASKS.md');
    assert.equal(await main(['task', 'sync'], io), 1);
    assert.deepEqual(f.writes(), []);
    assert.equal(read(root, 'TASKS.md'), original);
    assert.equal(await main(['task', 'sync'], { ...io, confirm: async () => true }), 0, stderr.text());
    assert.equal(f.state.issues.get(2).milestone.title, 'Release');
  }
});
