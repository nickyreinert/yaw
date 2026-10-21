// ci (Y-5.5, ADR-0027): quality-gate.yml for every profile, kit install at the manifest tag (BD10, run for real
// against a local kit repository), pinned actions, gitleaks with a SHA-256 check (issue #109), dependabot,
// removal with zero residue.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '../../../core/lib/yaml.js';
import { profileCi } from '../../../core/render/kit.js';
import { readManifest } from '../../../core/render/manifest.js';
import { addModule, initProject, removeModule } from '../../../core/render/project.js';
import { KIT_ROOT, cleanEnv, makeKitRepo, read, readTree, run, tmp, writeAnswers } from '../../../test/helpers/fixtures.js';

const MODULES = ['core', 'github', 'ci'];
const WORKFLOW = '.github/workflows/quality-gate.yml';

async function project(profile = 'node-cli') {
  const text = `mode: standard\nanswers:\n  user.agents: [claude, codex, copilot]\n  idea.text: A tiny command-line tool.\nproposal:\n  status: confirmed\n  summary: test project\n  profiles: [${profile}]\n  modules: [${MODULES.join(', ')}]\n`;
  const root = tmp('yaw-ci-');
  await initProject({ root, answersFile: writeAnswers(tmp('yaw-ans-'), text), modules: MODULES });
  return root;
}

const steps = (doc, job) => doc.jobs[job].steps;
const allUses = (doc) => Object.values(doc.jobs).flatMap((j) => j.steps).map((s) => s.uses).filter(Boolean);

for (const profile of ['node-cli', 'python-cli']) {
  test(`${profile}: quality-gate.yml parses, is least-privilege, pinned and ends with just setup / just check`, async () => {
    const root = await project(profile);
    const text = read(root, WORKFLOW);
    const doc = parse(text, { file: WORKFLOW });
    assert.equal(doc.name, 'quality-gate');
    assert.deepEqual(Object.keys(doc.jobs), ['quality-gate', 'secret-scan']);
    assert.equal(doc.jobs['quality-gate'].name, 'quality-gate');
    assert.equal(doc.jobs['secret-scan'].name, 'secret-scan');
    assert.deepEqual(doc.permissions, { contents: 'read' });
    assert.match(doc.concurrency.group, /github\.ref/);
    assert.equal(doc.concurrency['cancel-in-progress'].includes('pull_request'), true);
    for (const job of Object.values(doc.jobs)) assert.ok(job['timeout-minutes'] > 0 && job['timeout-minutes'] <= 30);
    assert.ok(Object.hasOwn(doc.on, 'pull_request') && Object.hasOwn(doc.on, 'push'));

    // every action is pinned by a full commit SHA, with the verified version in a comment
    const uses = allUses(doc);
    assert.ok(uses.length >= 3);
    for (const u of uses) assert.match(u, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, u);
    assert.equal((text.match(/uses: .*@[0-9a-f]{40} # v\d+\.\d+\.\d+/g) ?? []).length, uses.length, 'each pin names its version');
    assert.doesNotMatch(text, /@v\d|@main|@master|@latest/);
    // the checkouts do not keep the token
    for (const job of Object.keys(doc.jobs)) assert.equal(steps(doc, job)[0].with['persist-credentials'], false);

    const gate = steps(doc, 'quality-gate');
    assert.match(gate[0].uses, /^actions\/checkout@/);
    assert.deepEqual(gate.slice(-2).map((s) => s.run), ['just setup', 'just check']);
    const install = gate.findIndex((s) => s.name === 'Install the YAW kit at the manifest tag');
    assert.ok(install > 0 && install === gate.length - 3, 'the kit is installed right before just setup');
    // node (the kit needs >= 22.13) comes from the profile or from the workflow, exactly once, before the kit install
    const nodeSteps = gate.map((s, i) => [s, i]).filter(([s]) => s.uses?.startsWith('actions/setup-node@'));
    assert.equal(nodeSteps.length, 1);
    assert.ok(nodeSteps[0][1] < install);
    assert.equal(nodeSteps[0][0].with['node-version'], '22.13');
    assert.equal(gate.some((s) => s.uses?.startsWith('extractions/setup-just@')), true);
    assert.equal(gate.some((s) => s.uses?.startsWith('astral-sh/setup-uv@')), profile === 'python-cli');
    assert.equal(gate.filter((s) => s.run === 'just check').length, 1);

    // the run blocks are valid shell
    for (const job of Object.values(doc.jobs)) {
      for (const s of job.steps.filter((x) => x.run)) {
        const r = run('bash', ['-n'], { input: s.run });
        assert.equal(r.status, 0, `${s.name ?? s.run}: ${r.stderr}`);
      }
    }
    assert.doesNotMatch(text, /secrets\.|GITHUB_TOKEN|ghp_|password/i, 'no secret is referenced or written');
  });
}

test('gitleaks runs in CI: pinned version, SHA-256 verified before it is unpacked, whole history (issue #109)', async () => {
  const root = await project();
  const doc = parse(read(root, WORKFLOW));
  const scan = steps(doc, 'secret-scan');
  assert.equal(scan[0].with['fetch-depth'], 0);
  const install = scan.find((s) => s.name?.startsWith('Install gitleaks')).run;
  assert.match(install, /version=8\.30\.1/);
  assert.match(install, /echo "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb  \$RUNNER_TEMP\/\$archive" \| sha256sum -c -/);
  assert.ok(install.indexOf('sha256sum -c') < install.indexOf('tar -xzf'), 'verified before unpacking');
  assert.match(install, /set -euo pipefail/);
  assert.equal(scan.at(-1).run, 'gitleaks git --redact --no-banner --exit-code 1 .');
  // the same pin as the kit's own CI (ADR-0026)
  const kitCi = readFileSync(join(KIT_ROOT, '.github', 'workflows', 'kit-ci.yml'), 'utf8');
  assert.ok(kitCi.includes('551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb'));
});

test('dependabot keeps the pinned actions current', async () => {
  const root = await project();
  const doc = parse(read(root, '.github/dependabot.yml'));
  assert.equal(doc.version, 2);
  assert.equal(doc.updates[0]['package-ecosystem'], 'github-actions');
  assert.equal(doc.updates[0].directory, '/');
});

// The kit-install step, run as GitHub would run it, against a local kit repository tagged with the manifest's kit version.
async function installStep(root) {
  const doc = parse(read(root, WORKFLOW));
  const step = steps(doc, 'quality-gate').find((s) => s.name === 'Install the YAW kit at the manifest tag');
  return step;
}

test('the kit install step installs the kit at the tag pinned in .yaw/manifest.json', async () => {
  const root = await project();
  const home = tmp('yaw-home-');
  const env = cleanEnv(home);
  const kitVersion = readManifest(root).kit;
  const src = makeKitRepo(tmp('yaw-src-'), { env, tag: `v${kitVersion}` });
  // a later commit that must not be installed
  writeFileSync(join(src, 'LATER'), 'x\n');
  run('git', ['add', '-A'], { cwd: src, env });
  run('git', ['commit', '--quiet', '-m', 'later'], { cwd: src, env });
  const tagged = run('git', ['rev-parse', `v${kitVersion}^{commit}`], { cwd: src, env }).stdout.trim();
  const step = await installStep(root);
  const runner = tmp('yaw-runner-');
  const pathFile = join(runner, 'github_path');
  writeFileSync(pathFile, '');
  const r = run('bash', ['-c', step.run], { cwd: root, env: { ...env, YAW_REPO: `file://${src}`, RUNNER_TEMP: runner, GITHUB_PATH: pathFile } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(run('git', ['-C', join(home, '.yaw', 'kit'), 'rev-parse', 'HEAD'], { env }).stdout.trim(), tagged);
  assert.equal(readFileSync(pathFile, 'utf8').trim(), join(home, '.local', 'bin'));
  const v = run(join(home, '.local', 'bin', 'yaw'), ['--version'], { env });
  assert.equal(v.stdout.trim(), `yaw ${kitVersion}`);
});

test('the kit install step: a vendored kit installs nothing; an odd kit version is refused; a missing tag fails loudly', async () => {
  const root = await project();
  const home = tmp('yaw-home-');
  const env = cleanEnv(home);
  const step = await installStep(root);
  const runner = tmp('yaw-runner-');
  const base = { ...env, RUNNER_TEMP: runner, GITHUB_PATH: join(runner, 'p'), YAW_REPO: join(runner, 'nowhere') };
  const manifestPath = join(root, '.yaw', 'manifest.json');
  const original = readFileSync(manifestPath, 'utf8');

  writeFileSync(manifestPath, original.replace('"vendored": false', '"vendored": true'));
  const vendored = run('bash', ['-c', step.run], { cwd: root, env: base });
  assert.equal(vendored.status, 0, vendored.stderr);
  assert.match(vendored.stdout, /vendored in \.yaw\/lib/);

  const kit = readManifest(root).kit;
  for (const odd of ['../evil', '1.0.0; touch pwned', '$(id)', '']) {
    writeFileSync(manifestPath, original.replace(`"kit": "${kit}"`, `"kit": ${JSON.stringify(odd)}`));
    const r = run('bash', ['-c', step.run], { cwd: root, env: base });
    assert.notEqual(r.status, 0, odd);
    assert.match(r.stderr, /Unexpected kit version/, odd);
  }
  writeFileSync(manifestPath, original);
  const missing = run('bash', ['-c', step.run], { cwd: root, env: base });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /nowhere|not found|does not exist|Could not read/i);
});

test('manifest entries are right; AGENTS.md says not to rename the jobs', async () => {
  const root = await project();
  const manifest = readManifest(root);
  const byPath = Object.fromEntries(manifest.files.map((f) => [f.path, f]));
  for (const f of [WORKFLOW, '.github/dependabot.yml']) {
    assert.equal(byPath[f].module, 'ci', f);
    assert.match(byPath[f].hash, /^sha256:[0-9a-f]{64}$/);
  }
  assert.equal(manifest.modules.ci.enabled, true);
  assert.match(read(root, 'AGENTS.md'), /<!-- yaw:ci -->\n- CI \(`\.github\/workflows\/quality-gate\.yml`\)/);
  assert.ok(manifest.files.find((f) => f.path === 'AGENTS.md').fragments.some((x) => x.module === 'ci'));
});

test('ci depends on github: github cannot be removed first', async () => {
  const root = await project();
  await assert.rejects(removeModule({ root, kitRoot: KIT_ROOT, module: 'github' }), /ci depends on github/);
});

test('remove leaves zero residue; re-add restores the same files', async () => {
  const root = await project();
  const before = readTree(root);
  await removeModule({ root, kitRoot: KIT_ROOT, module: 'ci' });
  const left = readTree(root);
  for (const gone of [WORKFLOW, '.github/dependabot.yml']) assert.equal(Object.hasOwn(left, gone), false, gone);
  assert.doesNotMatch(left['AGENTS.md'], /yaw:ci|quality-gate/);
  assert.equal(readManifest(root).files.some((f) => f.module === 'ci'), false);
  assert.equal(Object.keys(left).some((p) => p.startsWith('.github/workflows')), false, 'the empty folder is pruned');
  assert.equal(Object.hasOwn(left, '.github/pull_request_template.md'), true, 'the github module keeps its file');
  await addModule({ root, kitRoot: KIT_ROOT, module: 'ci' });
  assert.deepEqual(readTree(root), before);
});

// ------------------------------------------------------------------------ profile fragments

function fixtureKit(profiles) {
  const kit = tmp('yaw-kit-');
  for (const [name, fragment] of Object.entries(profiles)) {
    mkdirSync(join(kit, 'profiles', name, 'ci'), { recursive: true });
    writeFileSync(join(kit, 'profiles', name, 'profile.yaml'), `name: ${name}\nsummary: x\n`);
    writeFileSync(join(kit, 'profiles', name, 'ci', 'check.yml'), fragment);
  }
  return kit;
}

test('profileCi: drops checkout / setup / check, keeps toolchain steps once, keeps the pin comments', () => {
  const a = '# c\nsteps:\n  - uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # v4.4.0\n  - uses: actions/setup-node@bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb # v4.4.0\n    with:\n      node-version: "22.13"\n  - uses: extractions/setup-just@cccccccccccccccccccccccccccccccccccccccc # v2.0.0\n  - run: just setup\n  - run: just check\n';
  const b = 'steps:\n  - uses: actions/checkout@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa # v4.4.0\n  - uses: extractions/setup-just@cccccccccccccccccccccccccccccccccccccccc # v2.0.0\n  - uses: astral-sh/setup-uv@dddddddddddddddddddddddddddddddddddddddd # v5.4.2\n  - run: just setup\n  - run: just check\n';
  const kit = fixtureKit({ a, b });
  const one = profileCi(kit, ['a']);
  assert.equal(one.needsNode, false);
  assert.equal(one.steps, [
    '- uses: actions/setup-node@bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb # v4.4.0',
    '  with:',
    '    node-version: "22.13"',
    '- uses: extractions/setup-just@cccccccccccccccccccccccccccccccccccccccc # v2.0.0',
  ].join('\n      '));
  const both = profileCi(kit, ['a', 'b']);
  assert.equal(both.steps.split('\n').filter((l) => l.includes('setup-just')).length, 1);
  assert.match(both.steps, /astral-sh\/setup-uv@d{40} # v5\.4\.2$/);
  assert.equal(profileCi(kit, ['b']).needsNode, true);
  assert.deepEqual(profileCi(kit, []), { steps: '', needsNode: true });
});

test('profileCi: a malformed fragment is reported', () => {
  const kit = fixtureKit({ bad: 'steps:\n- uses: x\n', worse: 'steps: nope\n' });
  assert.throws(() => profileCi(kit, ['bad']), /cannot read the step|steps/);
  assert.throws(() => profileCi(kit, ['worse']), /"steps" must be a list/);
});
