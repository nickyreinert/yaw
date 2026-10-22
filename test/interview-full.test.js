// Full CLI interview (Y-7.1): setup depth, agents, solo/team, expertise levels; scripted runs with the resulting answers.yaml.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { main } from '../core/cli/main.js';
import { parseDocument } from '../core/lib/yaml.js';
import { KIT_ROOT, capture, scripted, tmp } from './helpers/fixtures.js';

const NODE_ONLY = [dirname(process.execPath), '/usr/bin', '/bin'].join(':');

// Prompter that answers by the label of the question on screen; unlisted questions take Enter (the default).
function byLabel(replies) {
  const p = scripted();
  const left = new Map(Object.entries(replies));
  p.ask = async (question) => {
    p.asked.push(question);
    if (p.asked.length > 100) throw new Error(`too many questions; last: ${p.shown.at(-1)}`);
    const screen = [...p.shown].reverse().find((t) => /^ {2}\d+\/\d+ /.test(t)) ?? '';
    if (/Write these files\?/.test(question)) return 'y';
    if (/Setup depth \[/.test(question)) return left.get('depth') ?? '';
    if (/Profile/.test(question)) return left.get('profile') ?? '';
    for (const [label, reply] of left) if (label !== 'depth' && label !== 'profile' && screen.includes(label)) return reply;
    return '';
  };
  return p;
}

async function init(replies) {
  const cwd = tmp('yaw-proj-');
  const prompter = byLabel(replies);
  const stdout = capture();
  const stderr = capture();
  const code = await main(['init', '--skip-verify'], { stdout, stderr, cwd, env: { PATH: NODE_ONLY, HOME: tmp('yaw-home-') }, kitRoot: KIT_ROOT, prompter });
  const text = code === 0 ? readFileSync(join(cwd, '.yaw/answers.yaml'), 'utf8') : '';
  return { code, out: stdout.text(), err: stderr.text(), prompter, cwd, doc: text ? parseDocument(text).value : null, text };
}

const IDEA = { 'Describe the idea': 'A small tool.', 'Preferred or required language': 'javascript', 'Where should it run': 'local' };

const SOLO_FULL = {
  'user.agents': ['claude'],
  'user.expertise': 'intermediate',
  'user.language': 'de',
  'user.autonomy': 'ask-risky',
  'idea.text': 'A small tool.',
  'idea.team': 'solo',
  'arch.language': 'javascript',
  'arch.runs-on': 'local',
  'user.comfort': ['hygiene', 'status-line'],
  'user.length': 'balanced',
  'user.register': 'professional',
  'user.examples': 'when-helpful',
  'user.explain': 'short-paragraph',
  'tasks.use-github': true,
  'tasks.mode': 'local',
};
const QUICK = {
  'user.agents': ['claude'],
  'user.expertise': 'intermediate',
  'user.language': 'de',
  'user.autonomy': 'ask-risky',
  'idea.text': 'A small tool.',
  'idea.team': 'solo',
  'arch.language': 'javascript',
  'arch.runs-on': 'local',
  'user.length': 'balanced',
  'user.register': 'professional',
  'user.examples': 'when-helpful',
  'user.explain': 'short-paragraph',
  'tasks.mode': 'local',
};
const QUICK_MODULES = ['core', 'communication', 'devenv', 'security', 'standards', 'tasks'];
const FULL_MODULES = ['core', 'ci', 'code-map', 'comfort', 'communication', 'decisions', 'devenv', 'git-hooks', 'github', 'security', 'sessions', 'standards', 'tasks'];

test('Quick: depth is the first question; answers.yaml holds the Q answers and the Quick modules', async () => {
  const r = await init({ depth: 'quick', ...IDEA });
  assert.equal(r.code, 0, r.err);
  assert.match(r.prompter.shown.join(''), /^\nSetup depth\n/);
  assert.deepEqual(r.doc.mode, 'quick');
  assert.deepEqual(r.doc.answers, QUICK);
  assert.deepEqual(r.doc.proposal.modules, QUICK_MODULES);
  assert.equal(r.doc.proposal.profiles[0], 'node-cli');
});

test('Quick is the default depth; "1" and "2" work', async () => {
  assert.equal((await init({ depth: '', ...IDEA })).doc.mode, 'quick');
  assert.equal((await init({ depth: '1', ...IDEA })).doc.mode, 'quick');
  assert.equal((await init({ depth: '2', ...IDEA })).doc.mode, 'full');
});

test('Full solo: Q, S and F answers, GitHub modules on', async () => {
  const r = await init({ depth: 'full', ...IDEA });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.doc.mode, 'full');
  assert.deepEqual(r.doc.answers, SOLO_FULL);
  assert.deepEqual(r.doc.proposal.modules, FULL_MODULES);
  assert.deepEqual(Object.keys(r.doc.answers), Object.keys(SOLO_FULL), 'order follows the question list');
});

test('Full solo without GitHub: github and ci are off and the answer is recorded', async () => {
  const r = await init({ depth: 'full', ...IDEA, 'Use GitHub for the repo': 'n' });
  assert.deepEqual(r.doc.answers['tasks.use-github'], false);
  assert.deepEqual(r.doc.proposal.modules, FULL_MODULES.filter((m) => m !== 'github' && m !== 'ci'));
});

test('Full team: team questions appear, tasks.mode and GitHub question do not, github stays on', async () => {
  const r = await init({ depth: 'full', ...IDEA, 'Solo or team': 'team', 'Tell the agent the active issue': 'n' });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.doc.answers, {
    ...Object.fromEntries(Object.entries(SOLO_FULL).filter(([k]) => k !== 'tasks.use-github' && k !== 'tasks.mode')),
    'idea.team': 'team',
    'team.session-context': false,
  });
  assert.deepEqual(r.doc.proposal.modules, ['core', ...[...FULL_MODULES.slice(1), 'team'].sort()]);
});

test('Quick team: the choice is recorded; no team questions, Quick modules', async () => {
  const r = await init({ depth: 'quick', ...IDEA, 'Solo or team': 'team' });
  assert.equal(r.doc.answers['idea.team'], 'team');
  assert.ok(!('team.session-context' in r.doc.answers));
  assert.deepEqual(r.doc.proposal.modules, QUICK_MODULES);
});

test('agents: each of Claude, Codex and Copilot is selectable alone and together', async () => {
  for (const agents of [['claude'], ['codex'], ['copilot'], ['codex', 'copilot'], ['claude', 'codex', 'copilot']]) {
    const r = await init({ depth: 'quick', ...IDEA, 'Which coding agents': agents.join(', ') });
    assert.equal(r.code, 0, `${agents}: ${r.err}`);
    assert.deepEqual(r.doc.answers['user.agents'], agents);
  }
});

test('agents: the others are shown as phase 3 and cannot be picked', async () => {
  const r = await init({ depth: 'quick', ...IDEA, 'Which coding agents': 'gemini' });
  const shown = r.prompter.shown.join('');
  for (const a of ['gemini', 'antigravity', 'pi', 'hermes']) assert.match(shown, new RegExp(`\\) ${a} .*\\(phase 3, not available yet\\)`));
  assert.match(shown, /"Gemini CLI \(enterprise \/ API key\)" is not available yet/);
});

test('expertise: each level is recorded; the level changes how the interview is shown', async () => {
  const runs = {};
  for (const level of ['layperson', 'intermediate', 'expert']) {
    runs[level] = await init({ depth: 'full', ...IDEA, 'Solo or team': 'team', 'Your experience with software': level });
    assert.equal(runs[level].code, 0, runs[level].err);
    assert.equal(runs[level].doc.answers['user.expertise'], level);
  }
  const shown = (level) => runs[level].prompter.shown.join('');
  // layperson: help of a question is shown without asking; F questions take their default
  assert.match(shown('layperson'), /It goes into AGENTS.md as one line/);
  assert.doesNotMatch(shown('expert'), /It goes into AGENTS.md as one line/);
  assert.equal(runs.layperson.doc.answers['team.session-context'], true);
  assert.doesNotMatch(shown('layperson'), /Tell the agent the active issue/);
  assert.match(shown('intermediate'), /Tell the agent the active issue/);
  assert.match(shown('expert'), /Tell the agent the active issue/);
  // expert: hints collapsed
  assert.match(shown('intermediate'), /Team mode makes issues and PRs mandatory/);
  assert.doesNotMatch(shown('expert'), /Team mode makes issues and PRs mandatory/);
  // the summary lists the layperson default
  assert.match(runs.layperson.out, /team\.session-context +true +\(default\)/);
  assert.doesNotMatch(runs.expert.out, /team\.session-context +true +\(default\)/);
});
