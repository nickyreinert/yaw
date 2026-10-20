// Agent adapters: skill copies + yaw sync --check (Y-4.6, ADR-0012), yaw agents (Y-4.7), the Codex trust
// note in init and doctor (Y-4.4), the shim check in doctor (ADR-0019), `sync-check` in `just check`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { main } from '../core/cli/main.js';
import { readManifest } from '../core/render/manifest.js';
import { removeModule } from '../core/render/project.js';
import { KIT_ROOT, capture, cleanEnv, hasTool, makeKit, run, scripted, tmp, writeAnswers, writeTree } from './helpers/fixtures.js';
import { answersText, makeProject } from './helpers/hooks.js';

async function yaw(args, { cwd, kitRoot = KIT_ROOT, env = { HOME: tmp('yaw-home-'), PATH: dirname(process.execPath) } } = {}) {
  const stdout = capture();
  const stderr = capture();
  const code = await main(args, { stdout, stderr, cwd, env, kitRoot, prompter: { ...scripted(), interactive: false } });
  return { code, out: stdout.text(), err: stderr.text() };
}

// Fixture kit: core + module "helper" with a skill (two files) and one hook.
function skillKit() {
  const kitRoot = makeKit(tmp('yaw-skillkit-'), { modules: { core: { templates: { 'AGENTS.md.tmpl': '# Agents\n' } } } });
  writeTree(kitRoot, {
    'modules/helper/module.yaml': [
      'name: helper',
      'description: Fixture module with a skill and a hook.',
      'depends: [core]',
      'default: { quick: false, standard: false, full: false }',
      'outputs:',
      '  skills: [greet]',
      '  hooks:',
      '    - { name: note, event: Stop, kind: evaluation }',
      'agents:',
      '  claude: { support: native }',
      '  codex: { support: native }',
      '  copilot: { support: partial, note: skill seen twice }',
      'tokenCost: none',
      'lastVerified: 2026-10-20',
      '',
    ].join('\n'),
    'modules/helper/skills/greet/SKILL.md': '---\nname: greet\ndescription: Say hello.\n---\nSay hello.\n',
    'modules/helper/skills/greet/reference/phrases.md': '- hello\n',
    'modules/helper/hooks/note.js': 'export default function () { return null; }\n',
    'adapters/capabilities.yaml': readFileSync(join(KIT_ROOT, 'adapters', 'capabilities.yaml'), 'utf8'),
  });
  return kitRoot;
}

test('skills: authored once in the module, rendered to .agents/skills/ and copied to .claude/skills/ (ADR-0012)', async () => {
  const kitRoot = skillKit();
  const root = await makeProject({ kitRoot, agents: ['claude', 'codex'], modules: ['core', 'helper'] });
  for (const p of ['SKILL.md', 'reference/phrases.md']) {
    const a = readFileSync(join(root, '.agents/skills/greet', p));
    assert.deepEqual(a, readFileSync(join(kitRoot, 'modules/helper/skills/greet', p)));
    assert.deepEqual(readFileSync(join(root, '.claude/skills/greet', p)), a, 'a byte-identical copy, not a symlink');
  }
  const m = readManifest(root);
  for (const p of ['.agents/skills/greet/SKILL.md', '.claude/skills/greet/SKILL.md', '.agents/skills/greet/reference/phrases.md']) {
    assert.equal(m.files.find((f) => f.path === p)?.module, 'helper', p);
  }
  // without Claude there is no .claude/ copy
  const codexOnly = await makeProject({ kitRoot, agents: ['codex'], modules: ['core', 'helper'] });
  assert.ok(existsSync(join(codexOnly, '.agents/skills/greet/SKILL.md')));
  assert.ok(!existsSync(join(codexOnly, '.claude')));
});

test('yaw sync --check: passes when in sync, fails on an edited copy, a missing file or a stale one', async () => {
  const kitRoot = skillKit();
  const root = await makeProject({ kitRoot, agents: ['claude', 'codex'], modules: ['core', 'helper'] });
  let r = await yaw(['sync', '--check'], { cwd: root, kitRoot });
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /agent adapter files match their source/);

  writeFileSync(join(root, '.claude/skills/greet/SKILL.md'), 'hand-edited copy\n');
  unlinkSync(join(root, '.codex/hooks.json'));
  r = await yaw(['sync', '--check'], { cwd: root, kitRoot });
  assert.equal(r.code, 1);
  assert.match(r.out, /^drift: \.claude\/skills\/greet\/SKILL\.md differs from its source$/m);
  assert.match(r.out, /^drift: \.codex\/hooks\.json is missing$/m);
  assert.match(r.out, /run yaw update/);

  // a file the kit no longer renders (module dropped from the kit's outputs) is drift too
  const root2 = await makeProject({ kitRoot, agents: ['claude'], modules: ['core', 'helper'] });
  writeFileSync(join(kitRoot, 'modules/helper/module.yaml'), readFileSync(join(kitRoot, 'modules/helper/module.yaml'), 'utf8').replace('  skills: [greet]\n', ''));
  r = await yaw(['sync', '--check'], { cwd: root2, kitRoot });
  assert.equal(r.code, 1);
  assert.match(r.out, /^drift: \.agents\/skills\/greet\/SKILL\.md is no longer rendered by any enabled module$/m);

  // phase 1: --check only; outside a project: error
  assert.equal((await yaw(['sync'], { cwd: root, kitRoot })).code, 1);
  assert.match((await yaw(['sync'], { cwd: root, kitRoot })).err, /only yaw sync --check; yaw update re-renders/);
  assert.equal((await yaw(['sync', '--check'], { cwd: tmp('yaw-empty-'), kitRoot })).code, 1);
});

test('removing the module removes its skills, its hook registrations and the shim', async () => {
  const kitRoot = skillKit();
  const root = await makeProject({ kitRoot, agents: ['claude', 'codex'], modules: ['core', 'helper'] });
  assert.ok(existsSync(join(root, '.yaw/bin/yaw-hook')));
  await removeModule({ root, kitRoot, module: 'helper' });
  for (const p of ['.agents', '.claude', '.codex', '.yaw/bin']) assert.ok(!existsSync(join(root, p)), p);
  assert.equal((await yaw(['sync', '--check'], { cwd: root, kitRoot })).code, 0);
});

test('just check runs sync-check: green in sync, red on drift, a note without the kit', { skip: !hasTool('just') && 'just is not installed' }, async () => {
  const root = await makeProject({ agents: ['claude', 'codex'] });
  const env = cleanEnv(tmp('yaw-home-'), { PATH: [dirname(process.execPath), dirname(run('sh', ['-c', 'command -v just']).stdout.trim()), '/usr/bin', '/bin'].join(':') });
  assert.match(readFileSync(join(root, 'just/node-cli.just'), 'utf8'), /^check: lint typecheck test audit sync-check$/m);
  let r = run('just', ['sync-check'], { cwd: root, env: { ...env, YAW_KIT: KIT_ROOT } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /match their source/);
  r = run('just', ['sync-check'], { cwd: root, env });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /the YAW kit is not installed/);
  writeFileSync(join(root, '.claude/settings.json'), '{}\n');
  r = run('just', ['sync-check'], { cwd: root, env: { ...env, YAW_KIT: KIT_ROOT } });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /drift: \.claude\/settings\.json differs from its source/);
});

test('yaw agents: matrix of the enabled modules for the selected agents, with notes', async () => {
  const root = await makeProject();
  const r = await yaw(['agents'], { cwd: root });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^yaw agents: 2 enabled modules, agents claude, codex, copilot$/m);
  assert.match(r.out, /^ +Claude Code +Codex +Copilot$/m);
  assert.match(r.out, /^security +native +native +partial \[1\]$/m);
  assert.match(r.out, /^ {2}hook guard-secret-read \(guard, PreToolUse\) +native +native +partial \[1\]$/m);
  assert.match(r.out, /^\[1\] copilot: runs the \.claude\/settings\.json hooks; deny shape from the Copilot CLI docs/m);
  assert.match(r.out, /Codex: Hooks must be trusted once via \/hooks/);
  const one = await yaw(['agents'], { cwd: await makeProject({ agents: ['codex'] }) });
  assert.match(one.out, /^ +Codex$/m);
  assert.doesNotMatch(one.out, /Claude Code|Copilot/);
  // outside a project: every kit module, phase-1 agents
  const all = await yaw(['agents'], { cwd: tmp('yaw-empty-') });
  assert.match(all.out, /no project here; every module of the kit/);
  assert.match(all.out, /^core /m);
  assert.match(all.out, /^security /m);
  // skills get a row of their own
  const kitRoot = skillKit();
  const s = await yaw(['agents'], { cwd: await makeProject({ kitRoot, modules: ['core', 'helper'] }), kitRoot });
  assert.match(s.out, /^ {2}skill greet +native +native +partial \[3\]$/m);
  assert.match(s.out, /^\[3\] copilot: skill seen twice$/m);
});

test('Codex trust note in yaw init and yaw doctor; doctor checks that the shim finds the kit', async () => {
  const cwd = tmp('yaw-proj-');
  const answers = writeAnswers(tmp('yaw-ans-'), answersText({ agents: ['claude', 'codex'] }));
  const init = await yaw(['init', '--answers', answers, '--yes', '--skip-verify'], { cwd });
  assert.equal(init.code, 0, init.err);
  assert.match(init.out, /note: Codex runs \.codex\/hooks\.json only after you trust it: open Codex in this project and review the hooks with \/hooks/);
  const home = tmp('yaw-home-');
  const doc = await yaw(['doctor'], { cwd, env: { HOME: home, PATH: dirname(process.execPath) } });
  assert.match(doc.out, /^note +Codex runs \.codex\/hooks\.json only after you trust it/m);
  assert.match(doc.out, /^warn +\.yaw\/bin\/yaw-hook finds no kit at .*: agent hooks \(incl\. the security guards\) do nothing/m);
  const withKit = await yaw(['doctor'], { cwd, env: { HOME: home, PATH: dirname(process.execPath), YAW_KIT: KIT_ROOT } });
  assert.match(withKit.out, /^ok +\.yaw\/bin\/yaw-hook finds the kit at /m);
  // no Codex selected: no note
  const claudeOnly = await yaw(['init', '--answers', writeAnswers(tmp('yaw-ans-'), answersText({ agents: ['claude'] })), '--yes', '--skip-verify'], { cwd: tmp('yaw-proj-') });
  assert.doesNotMatch(claudeOnly.out, /Codex runs/);
});
