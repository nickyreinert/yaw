// Test helpers: temp dirs, file trees, fixture kits and a scripted prompter.
// Not a test file (npm test only runs *.test.js).

import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { KIT_ROOT } from '../../core/render/kit.js';

export { KIT_ROOT };

export function tmp(prefix = 'yaw-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
}

// { "rel/path": "content" } for every file under root (dotfiles included).
export function readTree(root, prefix = '') {
  const out = {};
  for (const name of readdirSync(join(root, prefix)).sort()) {
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(join(root, rel)).isDirectory()) Object.assign(out, readTree(root, rel));
    else out[rel] = readFileSync(join(root, rel), 'utf8');
  }
  return out;
}

export function read(root, rel) {
  return readFileSync(join(root, rel), 'utf8');
}

export function readJson(root, rel) {
  return JSON.parse(read(root, rel));
}

// module.yaml text for a fixture module.
export function moduleYaml({ name, depends = [], templates = [], agentsMd, questions = [] }) {
  const lines = [
    `name: ${name}`,
    `description: Fixture module ${name}.`,
    `depends: [${depends.join(', ')}]`,
    'default: { quick: true, standard: true, full: true }',
    `questions: ${JSON.stringify(questions)}`,
    'outputs:',
    `  templates: [${templates.map((t) => JSON.stringify(t)).join(', ')}]`,
  ];
  if (agentsMd) lines.push('agentsMd: |', ...agentsMd.trimEnd().split('\n').map((l) => `  ${l}`));
  lines.push('agents:', '  claude: { support: native }', 'tokenCost: none', 'lastVerified: 2026-10-20');
  return `${lines.join('\n')}\n`;
}

// A kit folder: package.json + modules/<name>/{module.yaml, templates/...}.
// modules: { name: { depends, agentsMd, questions, templates: { "path" or "path.tmpl": content } } }
export function makeKit(root, { version = '1.0.0', modules }) {
  writeTree(root, { 'package.json': `${JSON.stringify({ name: 'yaw', version, type: 'module' })}\n` });
  for (const [name, m] of Object.entries(modules)) {
    const templates = Object.keys(m.templates ?? {}).map((t) => t.replace(/\.tmpl$/, ''));
    writeTree(root, { [`modules/${name}/module.yaml`]: moduleYaml({ name, depends: m.depends, templates, agentsMd: m.agentsMd, questions: m.questions }) });
    for (const [t, content] of Object.entries(m.templates ?? {})) writeTree(root, { [`modules/${name}/templates/${t}`]: content });
  }
  return root;
}

export const ANSWERS_YAML = `mode: quick
answers:
  user.agents: [claude]
  idea.text: A tiny command-line tool.
proposal:
  status: confirmed
  summary: Node CLI, local tasks.
  profiles: [node-cli]
  modules: [core]
`;

export function writeAnswers(dir, text = ANSWERS_YAML) {
  const p = join(dir, 'answers.yaml');
  writeFileSync(p, text);
  return p;
}

// Prompter that replays answers and records what was asked and shown.
export function scripted(answers = []) {
  const queue = [...answers];
  const asked = [];
  const shown = [];
  return {
    interactive: true,
    asked,
    shown,
    show(text) {
      shown.push(text);
    },
    async ask(question) {
      asked.push(question);
      if (queue.length === 0) throw new Error(`unexpected question: ${question}`);
      return queue.shift();
    },
    close() {},
  };
}

// Environment for child processes that must not see the developer's git or shell config.
export function cleanEnv(home, extra = {}) {
  return {
    HOME: home,
    PATH: [dirname(process.execPath), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
    LANG: 'C',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'YAW Test',
    GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'YAW Test',
    GIT_COMMITTER_EMAIL: 'test@example.invalid',
    ...extra,
  };
}

export function run(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...options });
  if (r.error) throw r.error;
  return r;
}

// Copy this working tree (tracked and untracked, minus ignored files) into a fresh git repo
// and tag it, so install.sh can clone it like the real kit repo.
export function makeKitRepo(dir, { env, tag = 'v0.0.0' } = {}) {
  const ls = run('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: KIT_ROOT });
  for (const rel of ls.stdout.split('\0').filter(Boolean)) {
    const src = join(KIT_ROOT, rel);
    let st;
    try {
      st = statSync(src);
    } catch {
      continue; // deleted in the working tree
    }
    if (!st.isFile()) continue;
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    copyFileSync(src, join(dir, rel));
    chmodSync(join(dir, rel), st.mode & 0o777);
  }
  for (const args of [['init', '--quiet', '-b', 'main'], ['add', '-A'], ['commit', '--quiet', '-m', 'kit snapshot']]) {
    const r = run('git', args, { cwd: dir, env });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  }
  if (tag) run('git', ['tag', tag], { cwd: dir, env });
  return dir;
}

// Output sink for in-process CLI runs: { write, text() }.
export function capture() {
  const chunks = [];
  return {
    write(chunk) {
      chunks.push(String(chunk));
      return true;
    },
    text: () => chunks.join(''),
  };
}

// Is a tool on the PATH? (tests that need just or uv skip with a reason when it is not)
export function hasTool(name, env = process.env) {
  const r = spawnSync(name, ['--version'], { encoding: 'utf8', env });
  return !r.error && r.status === 0;
}

// A folder with an executable `just` stand-in that logs "<cwd> <args>" and exits with `code`.
export function fakeJust(dir, { code = 0 } = {}) {
  const log = join(dir, 'just.log');
  writeFileSync(join(dir, 'just'), `#!/bin/sh\necho "$(pwd) $*" >> '${log}'\nexit ${code}\n`, { mode: 0o755 });
  return log;
}
