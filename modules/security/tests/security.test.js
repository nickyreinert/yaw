// Minimal security module (Y-5.0, ADR-0022): every guard blocks in Claude and Codex (and Copilot through
// .claude/settings.json); harmless calls pass silently; the module is removable with zero residue.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readManifest } from '../../../core/render/manifest.js';
import { removeModule } from '../../../core/render/project.js';
import { loadRules, secretRule, commandRule } from '../lib/guards.js';
import { declaredAgent, hook, makeProject, toolCall } from '../../../test/helpers/hooks.js';
import { KIT_ROOT, readTree } from '../../../test/helpers/fixtures.js';

const root = await makeProject();

// Run a PreToolUse payload through `yaw hook`; -> { decision, reason } or null (allowed, empty stdout).
async function decide(agent, payload) {
  const r = await hook({ root, agent: declaredAgent(agent), event: 'PreToolUse', payload });
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
  if (r.stdout === '') return null;
  const out = JSON.parse(r.stdout);
  if (agent === 'copilot') return { decision: out.permissionDecision, reason: out.permissionDecisionReason, raw: out };
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  return { decision: out.hookSpecificOutput.permissionDecision, reason: out.hookSpecificOutput.permissionDecisionReason, raw: out };
}

const bash = (agent, command) => toolCall(agent, agent === 'claude' ? { command, description: 'x' } : { command });

const DENIED_COMMANDS = [
  ['rm-rf', 'rm -rf dist'],
  ['rm-rf', 'rm -fr ./build'],
  ['rm-rf', 'rm -r -f node_modules'],
  ['rm-rf', 'cd /tmp && rm --recursive --force x'],
  ['rm-rf', 'sudo rm -Rf /var/www'],
  ['force-push', 'git push --force origin main'],
  ['force-push', 'git push -f'],
  ['force-push', 'git push --force-with-lease origin feat/x'],
  ['force-push', 'git push origin +main'],
  ['force-push', 'git -C repo push -uf origin main'],
  ['prod-deploy', 'just deploy prod'],
  ['prod-deploy', 'npm run deploy:production'],
  ['prod-deploy', 'netlify deploy --prod'],
  ['prod-deploy', 'vercel --prod'],
  ['prod-deploy', 'wrangler deploy --env production'],
  ['npm-publish', 'npm publish --access public'],
  ['dotenv', 'cat .env'],
  ['dotenv', 'source ./config/.env.local && npm start'],
  ['dotenv', 'grep API_KEY .env.production'],
  ['dotenv', 'less .env*'],
  ['private-key', 'cat ~/.ssh/id_ed25519'],
  ['private-key', 'openssl rsa -in server.key -text'],
  ['credentials', 'cat ~/.aws/credentials'],
];

const ALLOWED_COMMANDS = [
  'npm test',
  'rm -r dist',
  'rm -f build.log',
  'git push -u origin feat/y-4',
  'git push --follow-tags',
  'just deploy staging',
  'cat .env.example',
  'cp .env.example .env.sample',
  'ls -la',
  'cat ~/.ssh/id_ed25519.pub',
  'git status && npm test',
];

for (const agent of ['claude', 'codex', 'copilot']) {
  test(`${agent}: each guard denies its commands (permissionDecision: deny)`, async () => {
    for (const [id, command] of DENIED_COMMANDS) {
      const d = await decide(agent, bash(agent, command));
      assert.ok(d, `${agent}: "${command}" was allowed`);
      assert.equal(d.decision, 'deny', command);
      assert.match(d.reason, new RegExp(`^YAW security \\(${id}\\): `), `${command}: ${d.reason}`);
    }
  });

  test(`${agent}: harmless commands pass with empty output`, async () => {
    for (const command of ALLOWED_COMMANDS) assert.equal(await decide(agent, bash(agent, command)), null, command);
  });
}

test('claude: Read, Edit and Grep of secret files are denied; .env.example and code are fine', async () => {
  const deny = [
    ['Read', { file_path: '/home/user/projects/photo-renamer/.env' }],
    ['Read', { file_path: '/home/user/projects/photo-renamer/config/.env.development' }],
    ['Edit', { file_path: '.env.local', old_string: 'A', new_string: 'B', replace_all: false }],
    ['MultiEdit', { file_path: 'certs/server.pem', edits: [] }],
    ['Grep', { pattern: 'KEY', path: '.env' }],
    ['Grep', { pattern: 'KEY', glob: '.env' }],
  ];
  for (const [tool, input] of deny) {
    const d = await decide('claude', toolCall('claude', input, tool));
    assert.equal(d?.decision, 'deny', `${tool} ${JSON.stringify(input)}`);
    assert.match(d.reason, /^YAW security \((dotenv|private-key)\)/);
  }
  for (const [tool, input] of [['Read', { file_path: '.env.example' }], ['Read', { file_path: 'src/index.js' }], ['Grep', { pattern: 'TODO', path: 'src' }], ['Write', { file_path: 'README.md', content: 'x' }]]) {
    assert.equal(await decide('claude', toolCall('claude', input, tool)), null, `${tool} ${JSON.stringify(input)}`);
  }
});

test('codex: apply_patch touching a secret file is denied; other patches pass (Y-4.4)', async () => {
  const patch = (path) => `*** Begin Patch\n*** Update File: ${path}\n@@\n-A=1\n+A=2\n*** End Patch\n`;
  const add = '*** Begin Patch\n*** Add File: config/.env.production\n+DEBUG=0\n*** End Patch\n';
  for (const body of [patch('.env'), patch('deploy/id_rsa'), add]) {
    const d = await decide('codex', toolCall('codex', { command: body }, 'apply_patch'));
    assert.equal(d?.decision, 'deny', body);
  }
  assert.equal(await decide('codex', toolCall('codex', { command: patch('src/index.js') }, 'apply_patch')), null);
  assert.equal(await decide('codex', toolCall('codex', { command: patch('.env.example') }, 'apply_patch')), null);
});

test('deny output shape per agent (Claude/Codex hookSpecificOutput, Copilot top level)', async () => {
  const c = await decide('claude', bash('claude', 'rm -rf dist'));
  assert.deepEqual(Object.keys(c.raw), ['hookSpecificOutput']);
  assert.deepEqual(Object.keys(c.raw.hookSpecificOutput), ['hookEventName', 'permissionDecision', 'permissionDecisionReason']);
  const x = await decide('codex', bash('codex', 'rm -rf dist'));
  assert.deepEqual(x.raw, c.raw);
  const p = await decide('copilot', bash('copilot', 'rm -rf dist'));
  assert.deepEqual(Object.keys(p.raw), ['permissionDecision', 'permissionDecisionReason']);
  assert.ok(c.reason.length <= 300);
  assert.ok(!/\n/.test(c.reason));
});

test('rules: guards.yaml validates; profile guards are included; the allow list wins', () => {
  const rules = loadRules({ kitRoot: KIT_ROOT, profiles: ['node-cli'] });
  assert.ok(rules.commands.some((r) => r.id === 'npm-publish' && r.source === 'node-cli'));
  assert.equal(secretRule(rules, '.env.example'), null);
  assert.equal(secretRule(rules, 'a/b/.env.sample'), null);
  assert.equal(secretRule(rules, '.envrc'), null);
  assert.equal(secretRule(rules, 'src/env.js'), null);
  assert.equal(secretRule(rules, '/x/.env').id, 'dotenv');
  assert.equal(commandRule(rules, 'echo hi'), null);
  assert.equal(commandRule(loadRules({ kitRoot: KIT_ROOT, profiles: ['python-cli'] }), 'uv publish').id, 'uv-publish');
});

test('rendered settings: Claude hooks + permissions.deny, Codex hooks, shim; Copilot uses the Claude file', () => {
  const claude = JSON.parse(readFileSync(join(root, '.claude/settings.json'), 'utf8'));
  assert.deepEqual(Object.keys(claude.hooks), ['PreToolUse']);
  assert.equal(claude.hooks.PreToolUse.length, 1, 'one registration per module and event');
  assert.equal(claude.hooks.PreToolUse[0].matcher, 'Read|Edit|MultiEdit|Grep|Bash');
  assert.deepEqual(claude.hooks.PreToolUse[0].hooks, [{
    type: 'command',
    command: 'f="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.yaw/bin/yaw-hook"; [ ! -f "$f" ] || sh "$f" PreToolUse --agent claude --module security',
    timeout: 10,
  }]);
  assert.ok(claude.permissions.deny.includes('Read(**/.env)'));
  assert.ok(!JSON.stringify(claude).includes('"async"'), 'no async hooks (ADR-0007)');
  const codex = JSON.parse(readFileSync(join(root, '.codex/hooks.json'), 'utf8'));
  assert.equal(codex.hooks.PreToolUse[0].matcher, 'apply_patch|Bash');
  assert.match(codex.hooks.PreToolUse[0].hooks[0].command, / PreToolUse --agent codex --module security$/);
  assert.equal(codex.permissions, undefined);
  assert.ok(!JSON.stringify(codex).includes('"async"'), 'no async hooks (ADR-0007)');
  assert.ok(!existsSync(join(root, '.github/hooks')), 'no Copilot hook file (no double firing, ADR-0021)');
  assert.match(readFileSync(join(root, '.yaw/bin/yaw-hook'), 'utf8'), /^#!\/bin\/sh\n/);
  const m = readManifest(root);
  for (const p of ['.claude/settings.json', '.codex/hooks.json', '.yaw/bin/yaw-hook']) assert.ok(m.files.some((f) => f.path === p && f.hash.startsWith('sha256:')), p);
  assert.deepEqual(m.files.find((f) => f.path === '.claude/settings.json').fragments.map((f) => f.module), ['security']);
  assert.match(readFileSync(join(root, 'AGENTS.md'), 'utf8'), /<!-- yaw:security -->\n- Never read `.env\*`/);
});

test('agents decide what is written: Codex only -> no .claude/; Copilot only -> .claude/settings.json', async () => {
  const codexOnly = await makeProject({ agents: ['codex'] });
  assert.ok(!existsSync(join(codexOnly, '.claude')));
  assert.ok(existsSync(join(codexOnly, '.codex/hooks.json')));
  const copilotOnly = await makeProject({ agents: ['copilot'] });
  assert.ok(existsSync(join(copilotOnly, '.claude/settings.json')));
  assert.ok(!existsSync(join(copilotOnly, '.codex')));
});

test('security is removable: zero residue compared with a core-only project (BD6, rule 4)', async () => {
  const withSecurity = await makeProject();
  const coreOnly = await makeProject({ modules: ['core'] });
  const result = await removeModule({ root: withSecurity, kitRoot: KIT_ROOT, module: 'security', strategy: 'take' });
  assert.equal(result.conflicts.length, 0);
  // the answers file is yours and lists the modules chosen at init, so it is the one expected difference
  const ignored = ['.yaw/manifest.json', '.yaw/answers.yaml'];
  const strip = (tree) => Object.fromEntries(Object.entries(tree).filter(([p]) => !ignored.includes(p)));
  assert.deepEqual(strip(readTree(withSecurity)), strip(readTree(coreOnly)));
  const files = (r) => readManifest(r).files.filter((f) => !ignored.includes(f.path));
  assert.deepEqual(files(withSecurity), files(coreOnly));
  assert.deepEqual(Object.keys(readManifest(withSecurity).modules), ['core']);
});
