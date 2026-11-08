import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { chooseInitModules } from '../core/cli/init-modules.js';
import { main } from '../core/cli/main.js';
import { collectQuestions, loadModule, hasModule } from '../core/render/kit.js';
import { selectModules } from '../core/render/project.js';
import { KIT_ROOT, capture, scripted, tmp } from './helpers/fixtures.js';

const definitions = ['core', 'git-hooks', 'security', 'standards', 'decisions', 'github'].map((name) => loadModule(KIT_ROOT, name));
const answers = { 'tasks.use-github': false };

test('module chooser groups numbered choices with purposes and adds required dependencies through shared policy', async () => {
  const p = scripted(['1, 2, 4, 2']);
  const result = await chooseInitModules({ prompter: p, definitions, answers });
  assert.deepEqual(result.modules, ['git-hooks', 'security', 'decisions']);
  const shown = p.shown.join('');
  assert.match(shown, /Git & GitHub[\s\S]*1\) Checks before every commit/);
  assert.match(shown, /2\) Safety guard \(security\)\n {9}Blocks secret reads and destructive commands\n {9}Requires: standards/);
  assert.match(shown, /– GitHub workflow \(github\) · needs GitHub/);
  assert.deepEqual(new Set(selectModules({ kitRoot: KIT_ROOT, mode: 'pro', answers, defaults: result.modules })),
    new Set(['core', 'git-hooks', 'security', 'decisions', 'standards']));
});

test('module chooser supports defaults, all, none, names, validation retries and browser switching', async () => {
  for (const [replies, expected] of [
    [[''], ['security']], [['all'], ['git-hooks', 'security', 'standards', 'decisions']],
    [['none'], []], [['security, 4'], ['security', 'decisions']],
    [['0', '500', 'github', '2oops', '?', 'none'], []],
  ]) {
    const p = scripted(replies), ask = p.ask;
    p.ask = async (prompt, keys) => {
      assert.ok(p.shown.at(-1).endsWith('      (? help, w switch to browser)\n'));
      return ask(prompt, keys);
    };
    assert.deepEqual((await chooseInitModules({ prompter: p, definitions, answers, defaults: ['security', 'github'] })).modules, expected);
  }
  assert.deepEqual(await chooseInitModules({ prompter: scripted(['w']), definitions, answers }), { web: true });
});

function allPrompter({ web = false } = {}) {
  const questions = collectQuestions(KIT_ROOT, readdirSync(join(KIT_ROOT, 'modules')).filter((name) => hasModule(KIT_ROOT, name)));
  const p = scripted(), order = [];
  p.ask = async (prompt) => {
    p.asked.push(prompt);
    if (/Setup depth/.test(prompt)) return '3';
    if (/Modules \[/.test(prompt)) {
      order.push('modules');
      const screen = p.shown.join('');
      const numbers = ['security', 'decisions', ...(web ? ['comfort'] : [])].map((name) => screen.match(new RegExp(`(\\d+)\\) [^\\n]+\\(${name}\\)`))[1]);
      return numbers.join(', ');
    }
    if (/Write these files/.test(prompt)) return 'n';
    const screen = [...p.shown].reverse().find((text) => /^  \d+\/\d+ /.test(text));
    const q = questions.find((q) => screen?.split('\n')[0].endsWith(q.label));
    assert.ok(q, prompt);
    order.push(q.id);
    if (web && q.id === 'user.comfort') return 'w';
    return ({ 'idea.text': 'A local photo sorter.', 'arch.language': 'python', 'arch.runs-on': 'local', 'tasks.use-github': 'n' })[q.id] ?? '';
  };
  return { p, order };
}
const fixture = () => ({ cwd: tmp('yaw-cli-order-'), kitRoot: KIT_ROOT, env: { HOME: tmp('yaw-cli-home-'), PATH: [dirname(process.execPath), '/usr/bin', '/bin'].join(':') }, stdout: capture(), stderr: capture() });

test('All starts with agents, puts stack before Workflow modules, and preserves explicit file review', async () => {
  const io = fixture(), { p, order } = allPrompter();
  assert.equal(await main(['init', '--skip-verify'], { ...io, prompter: p }), 1, io.stderr.text());
  assert.equal(order[0], 'user.agents');
  assert.ok(order.indexOf('arch.runs-on') < order.indexOf('tasks.use-github'));
  assert.ok(order.indexOf('tasks.use-github') < order.indexOf('modules'));
  assert.ok(!order.includes('user.comfort'), 'unselected comfort questions stay defaulted');
  assert.ok(!order.includes('quality.review-quality'), 'unselected review questions stay defaulted');
  assert.match(io.stdout.text(), /modules: core, decisions, security, standards/);
  assert.deepEqual(readdirSync(io.cwd), []);
});

test('All browser handoff retains numbered module choices and their dependencies', async () => {
  const io = fixture(), { p } = allPrompter({ web: true });
  let opened;
  const running = main(['init', '--skip-verify'], { ...io, prompter: p, openBrowser: async (url) => { opened = url; return true; } });
  try {
    for (let i = 0; i < 100 && !opened; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(opened, io.stderr.text());
    const cookie = (await fetch(opened, { redirect: 'manual' })).headers.get('set-cookie').split(';')[0];
    const boot = await (await fetch(new URL('/api/bootstrap', opened), { headers: { cookie } })).json();
    assert.deepEqual(new Set(boot.handoff.modules), new Set(['core', 'comfort', 'decisions', 'security', 'standards']));
    assert.equal(boot.handoff.answers['arch.language'], 'python');
    assert.equal(boot.handoff.answers['tasks.use-github'], false);
    assert.deepEqual(readdirSync(io.cwd), []);
  } finally {
    process.emit('SIGINT');
    await running;
  }
});

test('Task List sits directly below Collaboration (Git & GitHub), outside Advanced Coding Rules, marked Local only (T-029)', async () => {
  const { GROUPS } = await import('../core/interview/module-groups.js');
  const ids = GROUPS.map(([id]) => id);
  assert.equal(ids[ids.indexOf('github') + 1], 'tasks');
  assert.equal(GROUPS.find(([id]) => id === 'tasks')[1], 'Task List');
  const tasks = loadModule(KIT_ROOT, 'tasks');
  assert.equal(tasks.group, 'tasks');
  assert.equal(tasks.title, 'Task List');
  assert.match(tasks.what, /backlog[\s\S]*in progress[\s\S]*done/i);
  assert.match(tasks.what, /priorit/i);
  assert.doesNotMatch(GROUPS.find(([id]) => id === 'memory')[2], /tasks/i);
  const cards = readFileSync(join(KIT_ROOT, 'core/web/assets/setup-cards.js'), 'utf8');
  assert.match(cards, /GROUP_ICONS = \{[^}]*tasks: /);
  assert.match(cards, /'Local only'/);
  assert.ok(JSON.parse(readFileSync(join(KIT_ROOT, 'core/schema/module.schema.json'), 'utf8')).properties.group.enum.includes('tasks'));
});
