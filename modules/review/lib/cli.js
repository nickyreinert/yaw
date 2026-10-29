// `yaw review <run|gate|prompt|install>` (ADR-0055, prompts: ADR-0056). Reviewers read a change and report; they never edit.
// run: one reviewer on demand. gate: the pre-push hook (stdin: git's ref lines) runs every "Required before push"
// reviewer on the commits being pushed, headless through an agent CLI, and warns or blocks. prompt: prints the
// effective reviewer prompt (project -> global blueprint -> kit default) or lists where each comes from. install: writes
// .git/hooks/pre-push when the git-hooks module (lefthook) is not used.
// Exit codes: 0 ok / push allowed, 1 findings block the push, 2 usage or environment.

import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, writeFileSync, writeSync, chmodSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REVIEWERS, reviewTriggers } from '../../../core/render/kit.js';
import { enabledModules, readAnswers, requireManifest } from '../../../core/render/project.js';
import { PROMPT_KINDS, PromptError, allPrompts, effectivePrompt } from './prompts.js';
import { contextText, foundationContext } from '../../../core/lib/foundations.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const USAGE = 'usage: yaw review run <quality|logic|ux|feature|security> [<base>..<head>] | gate [remote] [url] | prompt [rules|quality|logic|ux|feature|security] | install';
const ZERO = /^0+$/;
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const MAX_DIFF = 120_000;
const MAX_TASKS = 6_000;
// Headless, read-only invocations. The prompt goes in on stdin (it carries a diff of up to 120 KB, more than
// Linux allows in one argument). Flags per the vendors' docs:
// - Claude Code (code.claude.com/docs/en/cli-reference): -p reads stdin; dontAsk denies anything not allowed;
//   --tools limits the tool set, --allowedTools the shell commands (rule syntax "Bash(git diff *)").
// - Codex (developers.openai.com/codex/noninteractive): `codex exec -` reads stdin, read-only sandbox, --ephemeral
//   keeps no session files; progress goes to stderr, the final message to stdout.
// - Copilot CLI (docs.github.com/copilot, programmatic reference): a piped prompt runs non-interactively, -s prints
//   only the answer, --no-ask-user never waits for input, --deny-tool=write blocks file edits.
const AGENT_CLIS = {
  claude: ['claude', ['-p', '--permission-mode', 'dontAsk', '--no-session-persistence', '--tools', 'Read,Grep,Glob,Bash', '--allowedTools', 'Read', 'Grep', 'Glob', 'Bash(git diff *)', 'Bash(git log *)', 'Bash(git show *)']],
  codex: ['codex', ['exec', '--sandbox', 'read-only', '--ephemeral', '-']],
  copilot: ['copilot', ['-s', '--no-ask-user', '--deny-tool=write', '--allow-tool=shell(git diff),shell(git log),shell(git show)']],
};
const LABEL = { quality: 'Quality', logic: 'Business logic', ux: 'UI/UX', feature: 'Feature fit', security: 'Security' };

export class ReviewUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReviewUsageError';
  }
}

function git(root, args, { input } = {}) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

export function triggers(root) {
  try {
    return reviewTriggers(readAnswers(root).answers ?? {});
  } catch {
    return reviewTriggers({});
  }
}

function gateMode(root) {
  try {
    return readAnswers(root).answers?.['quality.review-gate'] === 'block' ? 'block' : 'warn';
  } catch {
    return 'warn';
  }
}

export function reviewerPrompt(kind, { root, env = process.env } = {}) {
  return effectivePrompt(kind, { root, env }).text;
}

// The prompt carries the diff, so the agent needs no tools to review; it may still read files for context.
// The editable parts come from the prompt layers; the read-only rule and the VERDICT line stay fixed.
export function buildPrompt({ root, kind, range, diff, env = process.env }) {
  const parts = [
    reviewerPrompt(kind, { root, env }).trim(),
    reviewerPrompt('rules', { root, env }).trim(),
    contextText(foundationContext({ root })),
    'For this review, report needed foundation updates and rule conflicts as findings; never edit the sources.',
    'Read and report only; never edit, stage, commit or push.',
    'End with exactly one line: `VERDICT: PASS` (nothing that should stop a push) or `VERDICT: FINDINGS`.',
  ];
  if (kind === 'feature' && existsSync(join(root, 'TASKS.md'))) {
    parts.push(`TASKS.md:\n${readFileSync(join(root, 'TASKS.md'), 'utf8').slice(0, MAX_TASKS)}`);
  }
  const cut = diff.length > MAX_DIFF ? `${diff.slice(0, MAX_DIFF)}\n[diff cut at ${MAX_DIFF} characters; read the rest with git diff ${range}]` : diff;
  parts.push(`The change (${range}):\n\`\`\`diff\n${cut}\n\`\`\``);
  return `${parts.join('\n\n')}\n`;
}

// Which agent runs the review: YAW_REVIEW_AGENT, else the project's agents, else any installed CLI.
export function pickAgent({ env, agents = [] }) {
  if (env.YAW_REVIEW_CMD) return { name: 'custom', command: env.YAW_REVIEW_CMD };
  const wanted = env.YAW_REVIEW_AGENT ? [env.YAW_REVIEW_AGENT] : [...agents, 'claude', 'codex', 'copilot'];
  for (const name of [...new Set(wanted)]) {
    if (!AGENT_CLIS[name]) continue;
    const found = spawnSync('sh', ['-c', `command -v ${name}`], { env, encoding: 'utf8' });
    if (found.status === 0) return { name };
  }
  return null;
}

export function runAgent({ agent, prompt, root, env }) {
  const r = agent.command
    ? spawnSync('sh', ['-c', agent.command], { cwd: root, env, input: prompt, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    : spawnSync(...AGENT_CLIS[agent.name], { cwd: root, env, input: prompt, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.error) return { ok: false, output: `${agent.name}: ${r.error.message}` };
  const output = `${r.stdout ?? ''}${r.status === 0 ? '' : r.stderr ?? ''}`.trim();
  if (r.status !== 0) return { ok: false, output: output || `${agent.name} exited with ${r.status}` };
  return { ok: true, output };
}

export function verdict(output) {
  const lines = String(output).trim().split('\n').reverse();
  for (const line of lines) {
    const m = /VERDICT:\s*(PASS|FINDINGS)\b/i.exec(line);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

// ------------------------------------------------------------------ cache (per commit, per reviewer)

function cacheFile(root) {
  const dir = git(root, ['rev-parse', '--git-dir'])?.trim();
  return dir ? join(resolve(root, dir), 'yaw', 'reviews.json') : null;
}

export function readCache(root) {
  const file = cacheFile(root);
  try {
    return file ? JSON.parse(readFileSync(file, 'utf8')) : {};
  } catch {
    return {};
  }
}

function writeCache(root, cache) {
  const file = cacheFile(root);
  if (!file) return;
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, `${JSON.stringify(cache, null, 1)}\n`);
    renameSync(`${file}.tmp`, file);
  } catch { /* without the cache the next push reviews again */ }
}

// ------------------------------------------------------------------ push ranges

// git's pre-push stdin: "<local ref> <local sha> <remote ref> <remote sha>" per line.
export function pushedCommits(root, stdin) {
  const commits = [];
  const ranges = [];
  for (const line of String(stdin).split('\n')) {
    const [, localSha, , remoteSha] = line.trim().split(/\s+/);
    if (!localSha || ZERO.test(localSha)) continue; // deleting a branch
    const args = remoteSha && !ZERO.test(remoteSha) ? ['rev-list', '--reverse', `${remoteSha}..${localSha}`] : ['rev-list', '--reverse', localSha, '--not', '--remotes'];
    const list = (git(root, args) ?? '').split('\n').filter(Boolean);
    if (list.length === 0) continue;
    commits.push(...list);
    const base = git(root, ['rev-parse', '--verify', '--quiet', `${list[0]}^`])?.trim() || EMPTY_TREE;
    ranges.push({ base, head: localSha });
  }
  return { commits: [...new Set(commits)], ranges };
}

// ------------------------------------------------------------------ tty (Warn mode)

function askTty(question) {
  let fd;
  try {
    fd = openSync('/dev/tty', 'r+');
  } catch {
    return null;
  }
  try {
    writeSync(fd, question);
    const buf = Buffer.alloc(64);
    const n = readSync(fd, buf, 0, buf.length, null);
    return buf.toString('utf8', 0, n).trim().toLowerCase();
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

// ------------------------------------------------------------------ verbs

function needProject(io) {
  const manifest = requireManifest(io.root);
  if (!enabledModules(manifest).includes('review')) throw new ReviewUsageError('the review module is not installed; run: yaw add review');
  return manifest;
}

function run({ args, io }) {
  const manifest = needProject(io);
  const [kind, range] = args;
  if (!REVIEWERS.includes(kind)) throw new ReviewUsageError(`unknown reviewer "${kind ?? ''}"; pick one of ${REVIEWERS.join(', ')}`);
  if (git(io.root, ['rev-parse', '--is-inside-work-tree']) === null) {
    io.stderr.write('review: not a git repository; use the review skill in your agent instead (it reads the files directly)\n');
    return 2;
  }
  let label = range;
  let diff;
  if (range) {
    diff = git(io.root, ['diff', range]);
    if (diff === null) throw new ReviewUsageError(`git cannot diff "${range}"`);
  } else {
    diff = git(io.root, ['diff', 'HEAD']) ?? '';
    label = 'uncommitted changes';
    if (!diff.trim()) {
      diff = git(io.root, ['show', '--format=%s%n', 'HEAD']) ?? '';
      label = 'the last commit';
    }
  }
  if (!diff.trim()) {
    io.stdout.write('review: nothing to review\n');
    return 0;
  }
  const agent = pickAgent({ env: io.env, agents: manifest.agents });
  if (!agent) {
    io.stderr.write('review: no agent CLI found (claude, codex or copilot); install one, or use the review skill in your agent\n');
    return 2;
  }
  io.stdout.write(`${LABEL[kind]} review of ${label} (${agent.name})...\n`);
  const result = runAgent({ agent, prompt: buildPrompt({ root: io.root, kind, range: label, diff, env: io.env }), root: io.root, env: io.env });
  io.stdout.write(`${result.output}\n`);
  return result.ok ? 0 : 2;
}

function gate({ io, stdin }) {
  const env = io.env;
  const required = Object.entries(triggers(io.root)).filter(([, t]) => t === 'push').map(([k]) => k);
  if (required.length === 0) return 0;
  const { commits, ranges } = pushedCommits(io.root, stdin);
  if (commits.length === 0) return 0;
  const cache = readCache(io.root);
  const todo = required.filter((k) => commits.some((c) => !(cache[c] ?? []).includes(k)));
  if (todo.length === 0) {
    io.stderr.write(`review gate: ${commits.length} commit(s) already reviewed\n`);
    return 0;
  }
  if (env.YAW_REVIEW === 'skip') {
    io.stderr.write('review gate: skipped (YAW_REVIEW=skip); the commits stay unreviewed\n');
    return 0;
  }
  const mode = gateMode(io.root);
  let manifest = null;
  try {
    manifest = requireManifest(io.root);
  } catch { /* the gate still runs from the answers */ }
  const agent = pickAgent({ env, agents: manifest?.agents ?? [] });
  if (!agent) {
    io.stderr.write('review gate: no agent CLI found (claude, codex or copilot), so the push was not reviewed\n');
    return mode === 'block' ? stop(io) : 0;
  }
  const diff = ranges.map((r) => git(io.root, ['diff', r.base, r.head]) ?? '').join('\n');
  const label = ranges.map((r) => `${r.base.slice(0, 7)}..${r.head.slice(0, 7)}`).join(', ');
  const failed = [];
  for (const kind of todo) {
    io.stderr.write(`review gate: ${LABEL[kind]} review of ${commits.length} commit(s) (${agent.name})...\n`);
    const result = runAgent({ agent, prompt: buildPrompt({ root: io.root, kind, range: label, diff, env }), root: io.root, env });
    const v = result.ok ? verdict(result.output) : null;
    if (v === 'PASS') {
      for (const c of commits) cache[c] = [...new Set([...(cache[c] ?? []), kind])];
      continue;
    }
    failed.push(kind);
    io.stderr.write(`\n${LABEL[kind]}:\n${result.output || '(no output)'}\n${v ? '' : 'review gate: no VERDICT line, counted as findings\n'}\n`);
  }
  writeCache(io.root, cache);
  if (failed.length === 0) {
    io.stderr.write('review gate: all reviews passed\n');
    return 0;
  }
  if (mode === 'warn' && !env.YAW_REVIEW_NO_TTY) {
    const answer = askTty(`review gate: findings from ${failed.map((k) => LABEL[k]).join(', ')}. Push anyway? [y/N] `);
    if (answer === 'y' || answer === 'yes') return 0;
  }
  return stop(io);
}

function stop(io) {
  io.stderr.write('review gate: push stopped. Fix the findings and push again; to push anyway once: YAW_REVIEW=skip git push\n');
  return 1;
}

// `yaw review prompt <kind>` prints the effective text (the skill and sub-agents read it this way);
// without a kind it lists where each prompt comes from.
function prompt({ args, io }) {
  const [kind] = args;
  const ctx = { root: io.root, env: io.env };
  try {
    if (kind) {
      if (!PROMPT_KINDS.includes(kind)) throw new ReviewUsageError(`unknown prompt "${kind}"; pick one of ${PROMPT_KINDS.join(', ')}`);
      io.stdout.write(effectivePrompt(kind, ctx).text);
      return 0;
    }
    for (const p of allPrompts(ctx)) {
      const where = p.effective.source === 'project' ? p.project.path : p.effective.source === 'global' ? p.global.path : 'kit default';
      io.stdout.write(`${p.kind.padEnd(8)} ${where}\n`);
    }
    io.stdout.write('Edit them in yaw web (Settings > Review prompts), or the files themselves.\n');
    return 0;
  } catch (e) {
    if (e instanceof PromptError) throw new ReviewUsageError(e.message);
    throw e;
  }
}

function install({ io }) {
  needProject(io);
  const dir = git(io.root, ['rev-parse', '--git-path', 'hooks'])?.trim();
  if (!dir) {
    io.stderr.write('review install: not a git repository (run git init, or yaw edit to create it)\n');
    return 2;
  }
  const file = join(resolve(io.root, dir), 'pre-push');
  const script = readFileSync(join(HERE, 'pre-push.sh'), 'utf8');
  if (existsSync(file) && readFileSync(file, 'utf8') !== script) {
    io.stderr.write(`review install: ${file} exists and is not YAW's; add "yaw review gate \\"$@\\"" to it yourself\n`);
    return 2;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, script);
  chmodSync(file, 0o755);
  io.stdout.write(`review install: push gate installed (${file})\n`);
  return 0;
}

export function runReview({ verb, args = [], io, stdin = '' }) {
  if (verb === 'run') return run({ args, io });
  if (verb === 'gate') return gate({ io, stdin });
  if (verb === 'prompt') return prompt({ args, io });
  if (verb === 'install') return install({ io });
  throw new ReviewUsageError(verb ? `unknown verb "${verb}"` : 'missing verb');
}
