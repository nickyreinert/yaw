// Test helpers for hooks: recorded fixtures, projects with hook modules, running `yaw hook` in-process
// and through the real shim. Not a test file.

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { main } from '../../core/cli/main.js';
import { initProject } from '../../core/render/project.js';
import { KIT_ROOT, capture, makeKit, tmp, writeAnswers, writeTree } from './fixtures.js';

export const FIXTURES = join(KIT_ROOT, 'test', 'fixtures');
export const AGENTS = ['claude', 'codex', 'copilot'];

// -> [{ agent, name, event, payload }] for every test/fixtures/<agent>/<name>.json
export function listFixtures() {
  const out = [];
  for (const agent of AGENTS) {
    for (const f of readdirSync(join(FIXTURES, agent)).filter((n) => n.endsWith('.json')).sort()) {
      const payload = JSON.parse(readFileSync(join(FIXTURES, agent, f), 'utf8'));
      out.push({ agent, name: f.replace(/\.json$/, ''), event: payload.hook_event_name, payload });
    }
  }
  return out;
}

export function fixture(agent, name) {
  return JSON.parse(readFileSync(join(FIXTURES, agent, `${name}.json`), 'utf8'));
}

// The agent a fixture's hook command declares: Copilot runs the commands of .claude/settings.json.
export const declaredAgent = (agent) => (agent === 'copilot' ? 'claude' : agent);

export function answersText({ agents = AGENTS, modules = ['core', 'security'], profile = 'node-cli' } = {}) {
  return `mode: quick\nanswers:\n  user.agents: [${agents.join(', ')}]\n  idea.text: A tiny command-line tool.\nproposal:\n  status: confirmed\n  summary: test project\n  profiles: [${profile}]\n  modules: [${modules.join(', ')}]\n`;
}

// A project set up from `kitRoot` with the given modules and agents.
export async function makeProject({ kitRoot = KIT_ROOT, agents = AGENTS, modules = ['core', 'security'], profile = 'node-cli' } = {}) {
  const root = tmp('yaw-hookproj-');
  await initProject({ root, kitRoot, answersFile: writeAnswers(tmp('yaw-ans-'), answersText({ agents, modules, profile })), modules });
  return root;
}

// `yaw hook <event> --agent <a> --module <m>` in-process with the payload on stdin.
export async function hook({ root, kitRoot = KIT_ROOT, agent, event, module = 'security', payload, env }) {
  const stdout = capture();
  const stderr = capture();
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const home = env?.HOME ?? tmp('yaw-home-');
  const code = await main(['hook', event, '--agent', agent, '--module', module], {
    stdout, stderr, cwd: root, kitRoot, env: { HOME: home, ...env }, stdin: Readable.from([input]),
  });
  return { code, stdout: stdout.text(), stderr: stderr.text(), home };
}

// The same through the project's real shim in a child process (POSIX sh).
export function shim({ root, agent, event, module = 'security', payload, env }) {
  const r = spawnSync('/bin/sh', [join(root, '.yaw', 'bin', 'yaw-hook'), event, '--agent', agent, '--module', module], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload), encoding: 'utf8', env, cwd: tmp('yaw-elsewhere-'),
  });
  if (r.error) throw r.error;
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

// A payload for a Bash call (or another tool) built from an agent's recorded PreToolUse fixture.
export function toolCall(agent, toolInput, toolName) {
  const p = fixture(agent, 'PreToolUse');
  if (toolName) p.tool_name = toolName;
  p.tool_input = toolInput;
  return p;
}

// A kit with `core` and a module `probe` that has one hook of every kind on every event; each handler
// tries to return everything (context, messages, a deny), so tests see what the dispatcher lets through.
// `throws: true` makes every handler throw instead; `noisy: true` makes it print to stdout/stderr and return
// nothing; `kinds` limits the hooks to some kinds.
export const KINDS = ['guard', 'context', 'comfort', 'evaluation'];
export const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Stop', 'Notification'];

export function probeKit({ throws = false, noisy = false, kinds = KINDS } = {}) {
  const kitRoot = makeKit(tmp('yaw-probekit-'), { modules: { core: { templates: { 'AGENTS.md.tmpl': '# Agents\n' } } } });
  const hooks = [];
  for (const kind of kinds) {
    for (const event of EVENTS) hooks.push(`    - { name: ${kind}-${event.toLowerCase()}, event: ${event}, kind: ${kind}${kind === 'context' ? ', tokenCost: low' : ''} }`);
  }
  writeTree(kitRoot, {
    'modules/probe/module.yaml': [
      'name: probe',
      'description: Fixture module with one hook of every kind on every event.',
      'depends: [core]',
      'default: { quick: false, standard: false, full: false }',
      'outputs:',
      '  hooks:',
      ...hooks,
      'agents:',
      '  claude: { support: native }',
      '  codex: { support: native }',
      '  copilot: { support: native }',
      'tokenCost: none',
      'lastVerified: 2026-10-20',
      '',
    ].join('\n'),
  });
 // A bin/yaw that runs this checkout's CLI against the probe kit, so the real shim can be used.
  writeTree(kitRoot, { 'bin/yaw': `import { main } from ${JSON.stringify(join(KIT_ROOT, 'core', 'cli', 'main.js'))};\nprocess.exitCode = await main(process.argv.slice(2), { kitRoot: ${JSON.stringify(kitRoot)} });\n` });
  const body = throws
    ? 'export default function () { throw new Error("handler failed"); }\n'
    : noisy
      ? 'export default function () { console.log("stray stdout"); console.error("stray stderr"); process.stdout.write("raw stdout\\n"); process.stderr.write("raw stderr\\n"); return null; }\n'
      : 'export default function () { return { decision: "deny", reason: "probe says no", context: "probe context", additionalContext: "leak", systemMessage: "probe message", terminalSequence: "\\u001b]777;notify;YAW;probe\\u0007", hookSpecificOutput: { additionalContext: "leak" } }; }\n';
  for (const kind of KINDS) {
    for (const event of EVENTS) {
      const file = join(kitRoot, 'modules', 'probe', 'hooks', `${kind}-${event.toLowerCase()}.js`);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, body);
    }
  }
  return kitRoot;
}
