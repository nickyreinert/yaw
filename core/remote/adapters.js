import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, realpathSync } from 'node:fs';
import { join, isAbsolute, relative, sep, resolve } from 'node:path';
import { userDataDir } from '../lib/user-store.js';
import { JsonPeer } from './rpc.js';
import { safeDirectory, requireValue } from './store.js';

export function sandboxPlan({ kitRoot, workspace, home, agent, env, platform = process.platform }) {
  requireValue(platform === 'linux', 'Managed execution requires Linux with bubblewrap; hub and browser can run here');
  const target = realpathSync(workspace), kit = realpathSync(kitRoot), control = resolve(userDataDir(env));
  const contains = (a, b) => { const rel = relative(a, b); return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)); };
  requireValue(![kit, control].some((path) => contains(path, target) || contains(target, path)), 'The execution checkout must be separate from the controller kit and state directories');
  const bwrap = env.YAW_REMOTE_BWRAP || '/usr/bin/bwrap';
  requireValue(isAbsolute(bwrap), 'Use an absolute bubblewrap executable'); accessSync(bwrap, constants.X_OK);
  const args = ['--die-with-parent', '--new-session', '--unshare-all', '--share-net', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp'];
  for (const path of ['/usr', '/bin', '/lib', '/lib64']) if (existsSync(path)) args.push('--ro-bind', path, path);
  args.push('--dir', '/etc');
  for (const path of ['/etc/resolv.conf', '/etc/hosts', '/etc/nsswitch.conf', '/etc/passwd', '/etc/group', '/etc/ssl', '/etc/pki']) if (existsSync(path)) args.push('--ro-bind', realpathSync(path), path);
  args.push('--dir', '/opt', '--dir', '/opt/bin', '--dir', '/home', '--dir', '/home/agent',
    '--ro-bind', realpathSync(process.execPath), '/opt/bin/node', '--ro-bind', kit, '/opt/yaw',
    '--bind', safeDirectory(workspace), '/work', '--bind', safeDirectory(home, true), '/home/agent', '--chdir', '/work');
  if (agent === 'codex') {
    requireValue(isAbsolute(env.YAW_REMOTE_CODEX_BIN ?? ''), 'Set YAW_REMOTE_CODEX_BIN to the installed Linux Codex binary');
    accessSync(env.YAW_REMOTE_CODEX_BIN, constants.X_OK); args.push('--ro-bind', realpathSync(env.YAW_REMOTE_CODEX_BIN), '/opt/bin/codex');
  }
  args.push('/opt/bin/node', '/opt/yaw/core/remote/worker.js');
  const childEnv = { PATH: '/opt/bin:/opt/yaw/bin:/usr/bin:/bin', HOME: '/home/agent', YAW_KIT: '/opt/yaw', LANG: 'C.UTF-8', TMPDIR: '/tmp' };
  // Controller, Telegram and paired-device credentials never enter the execution environment.
  const credential = agent === 'claude' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';
  requireValue(typeof env[credential] === 'string' && env[credential].length > 0, `Enter ${credential} privately in the service environment`);
  childEnv[credential] = env[credential];
  return { command: bwrap, args, env: childEnv };
}
export function executionAdapters({ env, kitRoot, spawnFn = spawn }) {
  return Object.fromEntries(['claude', 'codex'].map((agent) => [agent, {
    capabilities: { input: true, resume: true, interrupt: true, approvals: true, questions: true, files: true,
      available: process.platform === 'linux' && existsSync(env.YAW_REMOTE_BWRAP || '/usr/bin/bwrap') && Boolean(agent === 'claude'
        ? env.ANTHROPIC_API_KEY && existsSync(join(kitRoot, 'adapters/remote-claude/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs'))
        : env.OPENAI_API_KEY && env.YAW_REMOTE_CODEX_BIN && existsSync(env.YAW_REMOTE_CODEX_BIN)),
      requirement: agent === 'claude' ? 'Linux, bubblewrap, optional Claude SDK and ANTHROPIC_API_KEY' : 'Linux, bubblewrap, YAW_REMOTE_CODEX_BIN and OPENAI_API_KEY' },
    async start({ session, project, onEvent, request }) {
      const home = join(userDataDir(env), 'remote-workers', session.id);
      const plan = sandboxPlan({ kitRoot, workspace: project.path, home, agent, env });
      const child = spawnFn(plan.command, plan.args, { env: plan.env, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
      const peer = new JsonPeer(child.stdout, child.stdin);
      let exited = false;
      const exit = new Promise((resolve) => child.once('close', () => { exited = true; peer.rejectAll(); onEvent({ type: 'exit' }); resolve(); }));
      child.stderr.resume(); child.on('error', () => { peer.rejectAll(); onEvent({ type: 'exit' }); });
      peer.on('failure', () => child.kill('SIGTERM'));
      peer.on('notification', (m) => { if (m.method === 'event') onEvent(m.params); });
      peer.on('request', async (m) => {
        if (m.method !== 'decision') return peer.write({ id: m.id, error: { code: -32601, message: 'Unsupported request' } });
        try { peer.write({ id: m.id, result: await request(m.params) }); }
        catch { peer.write({ id: m.id, result: { allow: false } }); }
      });
      const stop = async () => {
        if (exited) return;
        child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 2000); timer.unref?.();
        await exit; clearTimeout(timer);
      };
      try { await peer.request('initialize', { agent, session: session.providerSession, model: session.model }); }
      catch (e) { await stop(); throw e; }
      return { send: (prompt) => peer.request('send', { prompt }), interrupt: () => peer.request('interrupt', {}), stop };
    },
  }]));
}
