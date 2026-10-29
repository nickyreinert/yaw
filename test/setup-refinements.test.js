import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFormApi } from '../core/web/init.js';
import { createFormModel } from '../core/web/form-model.js';
import { readAnswers } from '../core/render/project.js';
import { initProject } from '../core/render/project.js';
import { RETIRED_ARCHITECTURE } from '../core/interview/depth.js';
import { planningFacts } from '../core/lib/kickoff.js';
import { KIT_ROOT, tmp, readTree } from './helpers/fixtures.js';
const base = { 'idea.text': 'A reading tracker.', 'arch.language': 'javascript', 'arch.runs-on': 'local' };
const fixture = () => ({ root: tmp('yaw-refinements-'), kitRoot: KIT_ROOT, env: { HOME: tmp('yaw-refinements-home-') } });

test('lean architecture and code practices survive normalization, rendering and prompt generation without optional standards', async () => {
  const f = fixture(), model = createFormModel(f);
  const input = { mode: 'basic', modules: ['core'], answers: { ...base, 'arch.library-strategy': 'prefer-libraries', 'arch.docker': true,
    'quality.error-detail': 'detailed', 'quality.log-output': 'file', 'quality.documentation': 'detailed' } };
  const prepared = model.normalize(input);
  for (const key of RETIRED_ARCHITECTURE) assert.ok(!Object.hasOwn(prepared.doc.answers, key), key);
  await initProject({ root: f.root, kitRoot: KIT_ROOT, answers: { doc: prepared.doc, text: prepared.text }, modules: prepared.modules });
  const saved = readAnswers(f.root).answers, tree = readTree(f.root), rules = tree['docs/engineering.md'];
  assert.match(tree['AGENTS.md'], /Follow `docs\/engineering.md`/);
  assert.equal(saved['arch.docker'], true);
  assert.equal(saved['quality.log-output'], 'file');
  assert.match(rules, /Docker is required/); assert.match(rules, /suitable maintained libraries/);
  assert.match(rules, /structured log files/); assert.match(rules, /impact and recovery steps/);
  assert.match(rules, /internal architecture, contracts/); assert.match(rules, /regression tests for bugs/);
  assert.ok(!Object.hasOwn(tree, 'docs/standards.md'));
  const api = createFormApi({ ...fixture(), skipVerify: true });
  try {
    const prompts = await api.action('setup-prompts', input);
    assert.match(prompts.kickoff, /Docker is required/); assert.match(prompts.kickoff, /structured log files/);
    assert.match(prompts.kickoff, /regression tests for bugs/);
    const catalogue = prompts.interview.split('Available settings:')[1].split('Available modules:')[0];
    assert.match(catalogue, /arch.library-strategy/); assert.match(catalogue, /arch.docker/);
    for (const key of RETIRED_ARCHITECTURE) assert.ok(!catalogue.includes(key), key);
    await assert.rejects(api.action('setup-prompts', { ...input, answers: { ...input.answers, 'arch.docker': 'yes' } }), /Invalid answer/);
    const changed = await api.action('setup-prompts', { ...input, answers: { ...input.answers, 'arch.docker': false, 'quality.log-output': 'console' } });
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
  assert.notDeepEqual(planningFacts(base), planningFacts({ ...base, 'quality.documentation': 'detailed' }));
});
