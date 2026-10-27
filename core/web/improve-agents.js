// Explicit headless review, never a shell command supplied by the browser. Prompt and verdict stay in memory.
import { spawn } from 'node:child_process';
import { accessSync, constants, mkdtempSync, rmdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, delimiter } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readUserData, writeUserData } from '../lib/user-store.js';
import { CHATS } from './assets/chat-services.js';

// Vendor references: https://code.claude.com/docs/en/cli-reference and https://developers.openai.com/codex/noninteractive
const CLIS = {
  claude: { name: 'Claude Code', args: ['-p', '--bare', '--tools', '', '--disallowedTools', '*', '--permission-mode', 'dontAsk', '--no-session-persistence'] },
  codex: { name: 'Codex', args: ['exec', '--sandbox', 'read-only', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check',
    '--disable', 'shell_tool', '--disable', 'apps', '--disable', 'multi_agent', '--disable', 'hooks', '-c', 'web_search="disabled"', '-'] },
};
export const REVIEW_RUN_LIMITS = Object.freeze({ prompt: 24000, output: 32000, timeoutMs: 180000, retentionMs: 15 * 60000 });
function executable(name, env) {
  for (const directory of (env.PATH ?? '').split(delimiter).filter(isAbsolute)) {
    const file = join(directory, name);
    try { accessSync(file, constants.X_OK); if (statSync(file).isFile()) return file; } catch { /* not installed here */ }
  }
  return null;
}
export function improveSettings(env = process.env, input = readUserData(env, 'improve-settings.json') ?? {}) {
  const enabledAgents = input.enabledAgents ?? [];
  const defaultTarget = input.defaultTarget ?? 'browser:ChatGPT';
  if (!Array.isArray(enabledAgents) || enabledAgents.some((id) => !Object.hasOwn(CLIS, id)) || new Set(enabledAgents).size !== enabledAgents.length) throw new Error('Choose supported CLI reviewers');
  const targets = [...CHATS.map(([name]) => `browser:${name}`), ...enabledAgents.map((id) => `cli:${id}`)];
  if (!targets.includes(defaultTarget)) throw new Error('Choose an enabled default review destination');
  return { enabledAgents, defaultTarget, agents: Object.entries(CLIS).map(([id, spec]) => ({ id, name: spec.name, installed: Boolean(executable(id, env)) })) };
}
export function saveImproveSettings(env, input) {
  const settings = improveSettings(env, input);
  writeUserData(env, 'improve-settings.json', { enabledAgents: settings.enabledAgents, defaultTarget: settings.defaultTarget });
  return settings;
}
export function createImproveRunner({ env = process.env, spawnFn = spawn, timeoutMs = REVIEW_RUN_LIMITS.timeoutMs }) {
  let job = null, child = null, timer = null, forceTimer = null, expiry = null;
  const publicJob = () => job && ({ id: job.id, agent: job.agent, status: job.status, output: job.output, message: job.message });
  const kill = () => {
    child?.kill('SIGTERM');
    const process = child;
    forceTimer = setTimeout(() => process?.kill('SIGKILL'), 1500); forceTimer.unref?.();
  };
  return {
    read: publicJob,
    clear() {
      clearTimeout(expiry);
      if (job?.status === 'running') { job.status = 'stopped'; job.output = ''; job.message = 'Review stopped.'; kill(); }
      else job = null;
      return publicJob();
    },
    start(input) {
      if (input.confirm !== true) throw new Error('Confirm sending this review prompt to the selected CLI provider');
      if (job?.status === 'running' || child) throw new Error('A CLI review is already running');
      const settings = improveSettings(env), agent = input.agent;
      if (!Object.hasOwn(CLIS, agent) || !settings.enabledAgents.includes(agent)) throw new Error('Enable this CLI reviewer in Global Settings → Improve first');
      const file = executable(agent, env);
      if (!file) throw new Error('This CLI is not installed on the dashboard server PATH');
      if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > REVIEW_RUN_LIMITS.prompt) throw new Error('Review prompt must contain 1–24,000 characters');
      const cwd = mkdtempSync(join(tmpdir(), 'yaw-improve-'));
      clearTimeout(expiry);
      job = { id: randomUUID(), agent, status: 'running', output: '', message: 'Waiting for the reviewer…' };
      const current = job;
      let settled = false;
      const finish = (ok) => {
        if (settled) return; settled = true;
        clearTimeout(timer); clearTimeout(forceTimer); child = null;
        try { rmdirSync(cwd); } catch { /* never recursively delete files an external CLI might create */ }
        expiry = setTimeout(() => { if (job === current) job = null; }, REVIEW_RUN_LIMITS.retentionMs); expiry.unref?.();
        if (current.status !== 'running') return;
        current.status = ok && current.output.trim() ? 'completed' : 'failed';
        current.message = current.status === 'completed' ? 'Review complete. Nothing was applied.' : 'CLI review failed. Check CLI version and sign-in in your terminal; no changes were applied.';
        if (current.status === 'failed') current.output = '';
      };
      try {
        child = spawnFn(file, CLIS[agent].args, { cwd, env, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (text) => {
          if (current.status !== 'running') return;
          if (current.output.length + text.length > REVIEW_RUN_LIMITS.output) {
            current.status = 'failed'; current.output = ''; current.message = 'Reviewer output exceeded the limit. Try the browser prompt instead.'; kill();
          } else current.output += text;
        });
        // Vendor errors can echo prompt text or credentials. Drain stderr without storing or returning it.
        child.stderr.resume();
        child.stdin.on('error', () => {});
        child.once('error', () => finish(false));
        child.once('close', (code) => finish(code === 0));
        child.stdin.end(input.prompt);
        timer = setTimeout(() => {
          if (current.status !== 'running') return;
          current.status = 'failed'; current.output = ''; current.message = 'Review timed out. Try again or use a browser chat.'; kill();
        }, timeoutMs); timer.unref?.();
      } catch { finish(false); }
      return publicJob();
    },
  };
}
