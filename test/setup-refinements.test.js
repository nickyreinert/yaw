import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFormApi } from '../core/web/init.js';
import { createFormModel } from '../core/web/form-model.js';
import { readAnswers } from '../core/render/project.js';
import { initProject } from '../core/render/project.js';
import { RETIRED_ARCHITECTURE } from '../core/interview/depth.js';
import { planningFacts } from '../core/lib/kickoff.js';
import { KIT_ROOT, tmp, readTree } from './helpers/fixtures.js';
const base = { 'idea.text': 'A reading tracker.', 'arch.language': 'typescript', 'arch.runs-on': 'local' };
const fixture = () => ({ root: tmp('yaw-refinements-'), kitRoot: KIT_ROOT, env: { HOME: tmp('yaw-refinements-home-') } });

test('lean architecture and code practices survive normalization, rendering and prompt generation without optional standards', async () => {
  const f = fixture(), model = createFormModel(f);
  const input = { mode: 'basic', modules: ['core'], answers: { ...base, 'arch.library-strategy': 'prefer-libraries', 'arch.docker': true } };
  const prepared = model.normalize(input);
  for (const key of RETIRED_ARCHITECTURE) assert.ok(!Object.hasOwn(prepared.doc.answers, key), key);
  await initProject({ root: f.root, kitRoot: KIT_ROOT, answers: { doc: prepared.doc, text: prepared.text }, modules: prepared.modules });
  const saved = readAnswers(f.root).answers, tree = readTree(f.root), rules = tree['docs/engineering.md'];
  assert.match(tree['AGENTS.md'], /Follow `docs\/engineering.md`/);
  assert.equal(saved['arch.docker'], true);
  assert.ok(!Object.hasOwn(saved, 'quality.log-output'));
  assert.match(rules, /Docker is required/); assert.match(rules, /suitable maintained libraries/);
  assert.match(rules, /structured console logs/); assert.match(rules, /concise, actionable and consistent/);
  assert.match(rules, /non-obvious decisions/); assert.match(rules, /regression tests for bugs/);
  assert.ok(!Object.hasOwn(tree, 'docs/standards.md'));
  const api = createFormApi({ ...fixture(), skipVerify: true });
  try {
    const prompts = await api.action('setup-prompts', input);
    assert.match(prompts.kickoff, /Docker is required/); assert.match(prompts.kickoff, /structured console logs/);
    assert.match(prompts.kickoff, /regression tests for bugs/);
    const catalogue = prompts.interview.split('Available settings:')[1].split('Available modules:')[0];
    assert.match(catalogue, /arch.library-strategy/); assert.match(catalogue, /arch.docker/);
    for (const key of RETIRED_ARCHITECTURE) assert.ok(!catalogue.includes(key), key);
    await assert.rejects(api.action('setup-prompts', { ...input, answers: { ...input.answers, 'arch.docker': 'yes' } }), /Invalid answer/);
    const changed = await api.action('setup-prompts', { ...input, answers: { ...input.answers, 'arch.docker': false } });
    assert.match(changed.kickoff, /Docker is not required/); assert.match(changed.kickoff, /structured console logs/);
    assert.doesNotMatch(changed.kickoff, /Docker is required/);
  } finally { api.close(); }
});

test('explicit legacy architecture facts remain readable and new practice changes invalidate the planning basis', () => {
  const model = createFormModel(fixture());
  const prepared = model.normalize({ mode: 'pro', answers: { ...base, 'arch.framework': 'Existing Express', 'arch.libraries': 'standard-only' } });
  assert.equal(prepared.doc.answers['arch.framework'], 'Existing Express');
  assert.equal(prepared.doc.answers['arch.libraries'], 'standard-only');
  assert.notDeepEqual(planningFacts(base), planningFacts({ ...base, 'arch.docker': true }));
  assert.deepEqual(planningFacts(base), planningFacts({ ...base, 'quality.documentation': 'detailed' }));
});

test('unit-test opt-in reaches generated rules, help and Quality review requirements', async () => {
  const { buildPrompt } = await import('../modules/review/lib/cli.js');
  for (const enabled of [false, true]) {
    const f = fixture(), model = createFormModel(f);
    const input = { mode: 'basic', modules: ['core'], answers: { ...base, 'quality.unit-tests': enabled } };
    const prepared = model.normalize(input);
    assert.equal(prepared.doc.answers['quality.unit-tests'], enabled);
    const preview = model.preview(input, true);
    const rules = preview.instructions.find((file) => file.path === 'docs/engineering.md');
    assert.match(rules.content, enabled ? /Unit tests are required/ : /Unit tests are optional/);
    assert.ok(preview.instructions.every((file) => !file.path.includes('.env')));
    await initProject({ root: f.root, kitRoot: KIT_ROOT, answers: { doc: prepared.doc, text: prepared.text }, modules: prepared.modules });
    const prompt = buildPrompt({ root: f.root, kind: 'quality', range: 'a..b', diff: '+behavior', env: f.env });
    assert.match(prompt, enabled ? /missing, empty or failing suite is FINDINGS/ : /Do not require a unit-test suite/);
    assert.notDeepEqual(planningFacts(base), planningFacts({ ...base, 'quality.unit-tests': true }));
  }
});

test('Docker is normalized and rendered only for applicable runtime choices', () => {
  const model = createFormModel(fixture());
  for (const runsOn of ['local', 'self-hosted', 'serverless', 'edge', 'static', 'wordpress', 'app-store', 'browser-extension']) {
    const answers = { ...base, 'arch.runs-on': runsOn, 'arch.docker': true };
    const applicable = ['local', 'self-hosted', 'serverless'].includes(runsOn);
    // Use HTML's basic profile for static hosting; JavaScript supports the other hosts.
    if (runsOn === 'wordpress') answers['arch.language'] = 'php';
    if (['static', 'browser-extension'].includes(runsOn)) answers['arch.language'] = 'html';
    const result = model.normalize({ mode: 'basic', answers, modules: ['core'] });
    assert.equal(Object.hasOwn(result.doc.answers, 'arch.docker'), applicable, runsOn);
    const preview = model.preview({ mode: 'basic', answers, modules: ['core'] });
    assert.equal(preview.instructions.find((file) => file.path === 'docs/engineering.md').content.includes('Docker is required'), applicable, runsOn);
  }
});
