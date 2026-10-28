// CLI <-> form parity (Y-7.5, BUILD.md step 7 "done when"): the same choices give a byte-identical answers.yaml.
// Each scenario is written once by question ID; the CLI is driven through its prompts, the form through the real
// local server (handshake, CSRF header, POST /api/apply) with the payload the browser sends.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { main } from '../core/cli/main.js';
import { collectQuestions, hasModule } from '../core/render/kit.js';
import { createFormApi } from '../core/web/init.js';
import { startFormServer } from '../core/web/form-server.js';
import { KIT_ROOT, capture, readTree, scripted, tmp } from './helpers/fixtures.js';
import { saveSetup } from '../core/lib/user-store.js';

const NODE_ONLY = [dirname(process.execPath), '/usr/bin', '/bin'].join(':');
const MODULES = readdirSync(join(KIT_ROOT, 'modules')).filter((n) => hasModule(KIT_ROOT, n));
const QUESTIONS = collectQuestions(KIT_ROOT, MODULES);
const BY_LABEL = new Map(QUESTIONS.map((q) => [q.label, q]));
const available = (c) => !(typeof c === 'object' && c.phase > 1);
const valueOf = (c) => typeof c === 'object' ? c.value : c;
const reply = (v) => Array.isArray(v) ? v.join(',') : String(v);

// Every question answered away from its default, so a skipped or reordered answer cannot hide behind a default.
function nonDefaults(overrides = {}) {
  const answers = {};
  for (const q of QUESTIONS) {
    if (q.type === 'boolean') answers[q.id] = !q.default;
    else if (q.type === 'multi') answers[q.id] = q.choices.filter(available).map(valueOf);
    else if (q.type === 'choice') answers[q.id] = q.choices.filter(available).map(valueOf).find((v) => v !== q.default);
    else if (q.type === 'number') answers[q.id] = (q.default ?? 0) + 1;
    else answers[q.id] = `${q.id} answer`;
  }
  return { ...answers, ...overrides };
}

const BASE = { 'idea.text': 'A small tool.', 'arch.language': 'javascript', 'arch.runs-on': 'local' };
const SCENARIOS = [
  { name: 'Quick, defaults', mode: 'quick', answers: BASE },
  ...['local', 'self-hosted', 'serverless', 'edge', 'static'].map((host) => ({ name: `Quick browser frontend on ${host}`, mode: 'quick', answers: { ...BASE, 'arch.language': 'html', 'arch.runs-on': host } })),
  { name: 'Pro, self-managed with open-source libraries and a paid cap', mode: 'pro', answers: { ...BASE, 'arch.hosting-control': 'self-hosted', 'arch.libraries': 'open-source', 'arch.services': 'approved-only', 'arch.cost': 'capped', 'arch.cost-limit': 'EUR 20 per month, no overage' } },
  { name: 'Full solo, defaults', mode: 'full', answers: BASE },
  { name: 'Full solo without GitHub', mode: 'full', answers: { ...BASE, 'tasks.use-github': false } },
  { name: 'Full team', mode: 'full', answers: { ...BASE, 'idea.team': 'team', 'team.session-context': false } },
  { name: 'Full team with local Git', mode: 'full', answers: { ...BASE, 'idea.team': 'team', 'tasks.use-github': false } },
  { name: 'Basic team with local Git', mode: 'basic', answers: { ...BASE, 'idea.team': 'team', 'tasks.use-github': false } },
  { name: 'Full external reviewers', mode: 'full', answers: { ...BASE, 'idea.team': 'external-reviewers' } },
  { name: 'Full external reviewers with local Git', mode: 'full', answers: { ...BASE, 'idea.team': 'external-reviewers', 'tasks.use-github': false } },
  { name: 'Basic team', mode: 'basic', answers: { ...BASE, 'idea.team': 'team' } },
  { name: 'Full, all agents, expert, both task stores', mode: 'full', answers: { ...BASE, 'user.agents': ['claude', 'codex', 'copilot'], 'user.expertise': 'expert', 'user.language': 'en', 'tasks.mode': 'both' } },
  { name: 'Full, every answer non-default (layperson)', mode: 'full', answers: nonDefaults({ ...BASE, 'user.language': 'en', 'user.expertise': 'layperson' }) },
  { name: 'Full, every answer non-default (expert, solo)', mode: 'full', answers: nonDefaults({ ...BASE, 'user.language': 'en', 'user.expertise': 'expert', 'idea.team': 'solo', 'tasks.mode': 'github' }) },
  { name: 'Pro, every answer non-default', mode: 'pro', answers: nonDefaults({ ...BASE, 'user.language': 'en' }) },
];

async function viaCli({ mode, answers }) {
  const cwd = tmp('yaw-parity-cli-');
  const p = scripted();
  p.ask = async (question) => {
    p.asked.push(question);
    if (/Setup depth \[/.test(question)) return mode;
    if (/^Modules \(comma-separated/.test(question)) return 'none';
    if (/create one now \(git init\)\?/.test(question)) return 'n';
    if (/Write these files\?/.test(question)) return 'y';
    if (/Save /.test(question)) return 'n';
    if (/guidance to kick off/.test(question)) return 'n';
    const line = [...p.shown].reverse().join('').split('\n').find((l) => /^ {2}\d+\/\d+ /.test(l));
    const q = line && BY_LABEL.get(line.replace(/^ {2}\d+\/\d+ /, ''));
    if (!q || !/\(\? help, skip\) > $/.test(question)) throw new Error(`unexpected prompt: ${question}`);
    return Object.hasOwn(answers, q.id) ? reply(answers[q.id]) : '';
  };
  const stderr = capture();
  const env = { PATH: NODE_ONLY, HOME: tmp('yaw-parity-home-') };
  saveSetup({ env, kitRoot: KIT_ROOT, answers: Object.fromEntries(Object.entries(answers).filter(([id]) => id.startsWith('user.'))), mode, projectRoot: cwd, kit: '0.1.0', preset: false, profile: true });
  const code = await main(['init', '--skip-verify'], { stdout: capture(), stderr, cwd, env, kitRoot: KIT_ROOT, prompter: p });
  assert.equal(code, 0, stderr.text());
  return cwd;
}

async function viaForm({ mode, answers }) {
  const root = tmp('yaw-parity-web-');
  const home = tmp('yaw-parity-home-');
  const api = createFormApi({ root, kitRoot: KIT_ROOT, env: { PATH: NODE_ONLY, HOME: home }, skipVerify: true, verify: async () => true, stderr: capture() });
  const server = await startFormServer({ api, signals: false });
  try {
    const origin = `http://127.0.0.1:${server.port}`;
    const cookie = (await fetch(server.url, { redirect: 'manual' })).headers.get('set-cookie').split(';')[0];
    const csrf = (await (await fetch(origin, { headers: { cookie } })).text()).match(/name="yaw-csrf" content="([a-f0-9]+)"/)[1];
    const response = await fetch(`${origin}/api/apply`, {
      method: 'POST',
      headers: { cookie, origin, 'Content-Type': 'application/json', 'X-YAW-Token': csrf },
      body: JSON.stringify({ mode, answers, modules: null }), // what app.js posts when no module was toggled
    });
    const events = (await response.text()).trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(response.status, 200, JSON.stringify(events));
    assert.deepEqual(events.at(-1), { type: 'done', ok: true, message: 'Applied; verification skipped.' });
    assert.match(events.filter((e) => e.type === 'log').map((e) => e.text).join(''), /Next steps[\s\S]*Dashboard: yaw web/);
  } finally {
    await server.close();
  }
  return root;
}

test('labels are unique, so the CLI side can find each question by its prompt', () => {
  assert.equal(BY_LABEL.size, QUESTIONS.length);
});

for (const scenario of SCENARIOS) {
  test(`parity: ${scenario.name}`, async () => {
    const cli = await viaCli(scenario);
    const web = await viaForm(scenario);
    const cliAnswers = readFileSync(join(cli, '.yaw/answers.yaml'));
    const webAnswers = readFileSync(join(web, '.yaw/answers.yaml'));
    assert.equal(webAnswers.toString('utf8'), cliAnswers.toString('utf8'));
    assert.ok(cliAnswers.equals(webAnswers), 'answers.yaml is byte-identical');
    // Same answers must also render the same project (manifest included; it records hashes, not paths or times).
    assert.deepEqual(readTree(web), readTree(cli));
  });
}
