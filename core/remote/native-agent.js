// Native Claude Remote Control. YAW observes lifecycle; prompts and tool approvals stay in Claude.
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { platform } from 'node:os';
import { join, isAbsolute, delimiter } from 'node:path';
import { writeAtomic } from '../render/files.js';
import { existsSync, accessSync, constants, statSync } from 'node:fs';
import { digest, requireValue } from './store.js';

const quote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`;
const EVENTS = ['UserPromptSubmit', 'Stop', 'StopFailure', 'Notification', 'TaskCompleted', 'SessionEnd'];
export function nativePlan({ root, slug, env, session, token, address, kitRoot, os = platform() }) {
  requireValue(['linux', 'darwin'].includes(os), 'Native hosting currently requires Linux or macOS');
  const executable = env.YAW_CLAUDE_BIN || 'claude';
  requireValue(!/[\r\n\0]/.test(executable), 'Invalid host Claude executable');
  const command = [executable, 'remote-control', '--spawn=session', '--name', slug, '--permission-mode', 'default'].map(quote).join(' ');
  const childEnv = Object.fromEntries(['PATH', 'HOME', 'LANG', 'LC_ALL', 'TERM', 'COLORTERM', 'TMPDIR', 'USER', 'LOGNAME', 'SHELL', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'HTTPS_PROXY', 'HTTP_PROXY', 'NO_PROXY'].filter((k) => env[k]).map((k) => [k, env[k]]));
  Object.assign(childEnv, { TERM: childEnv.TERM || 'xterm-256color', YAW_NATIVE_SESSION: session, YAW_NATIVE_TOKEN: token, YAW_NATIVE_ADDRESS: address });
  // A separate local settings file preserves generated, managed project hooks.
  requireValue(!existsSync(join(root, '.claude/settings.local.json')), 'Existing local Claude settings require review before managed launch');
  const hook = [process.execPath, join(kitRoot, 'core/remote/native-event.js')].map(quote).join(' ');
  writeAtomic(root, '.claude/settings.local.json', JSON.stringify({ hooks: Object.fromEntries(EVENTS.map((event) => [event, [{ hooks: [{ type: 'command', command: `${hook} ${event}`, timeout: 5 }] }]])) }, null, 2) + '\n', { mode: 0o600 });
  return { command: '/usr/bin/script', args: os === 'darwin' ? ['-q', '/dev/null', '/bin/sh', '-c', `exec ${command}`] : ['-q', '-e', '-f', '-c', `exec ${command}`, '/dev/null'],
    options: { cwd: root, env: childEnv, detached: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] } };
}

export class NativeAgents extends EventEmitter {
  constructor({ store, env, kitRoot, address, spawnFn = spawn, maxWorkers = 2 }) {
    super(); Object.assign(this, { store, env, kitRoot, address, spawnFn, maxWorkers }); this.workers = new Map();
  }
  available() {
    if (this.spawnFn !== spawn) return true; // Trusted fixture runner, never a request option.
    const binary = this.env.YAW_CLAUDE_BIN || 'claude';
    const paths = isAbsolute(binary) ? [binary] : (this.env.PATH ?? '').split(delimiter).filter(isAbsolute).map((dir) => join(dir, binary));
    return paths.some((path) => { try { accessSync(path, constants.X_OK); accessSync('/usr/bin/script', constants.X_OK); return statSync(path).isFile(); } catch { return false; } });
  }
  list() { return this.store.state.sessions.filter((s) => s.native === true).map((s) => ({ ...s })); }
  save(session, state) { session.state = state; session.updated = new Date().toISOString(); this.store.save(); this.emit('status', { ...session }); }
  start(project) {
    requireValue(this.available(), 'Install Claude Code and the script PTY utility on the host before launch');
    requireValue(this.workers.size < this.maxWorkers, 'Native worker limit reached', 409);
    requireValue(![...this.workers.values()].some((w) => w.session.project === project.id), 'A native process already owns this workspace', 409);
    const session = { id: randomUUID(), native: true, project: project.id, slug: project.slug, agent: 'claude', state: 'starting', created: new Date().toISOString(), turn: 0 };
    const token = randomBytes(32).toString('hex');
    const plan = nativePlan({ root: project.path, slug: project.slug, env: this.env, session: session.id, token, address: this.address, kitRoot: this.kitRoot });
    this.store.state.sessions.push(session); this.store.save();
    const child = this.spawnFn(plan.command, plan.args, plan.options);
    const worker = { child, session, hash: digest(token), buffer: '', stopped: false, notified: new Set() };
    this.workers.set(session.id, worker);
    const data = (chunk) => {
      worker.buffer = (worker.buffer + String(chunk)).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').slice(-16384);
      const link = /https:\/\/claude\.ai\/code\/([A-Za-z0-9_-]{8,160})(?=[\s?])/.exec(worker.buffer);
      if (link && !session.url) { session.url = link[0]; delete session.startup; this.save(session, 'ready'); }
      if (!session.url && !session.startup) {
        const kind = /Trust [^\r\n]{1,4096}\?\s*\[y\/N\]/i.test(worker.buffer) ? 'workspace' : /Enable Remote Control\?\s*\(y\/n\)/i.test(worker.buffer) ? 'remote-control' : null;
        if (kind) { session.startup = kind; this.save(session, 'confirmation-required'); }
      }
      if (!session.url && /(?:not logged in|requires a claude.ai subscription|Workspace not trusted|authentication failed|unknown option)/i.test(worker.buffer)) this.save(session, 'setup-required');
    };
    child.stdout.on('data', data); child.stderr.on('data', data);
    child.once('error', () => { this.workers.delete(session.id); this.save(session, 'launch-failed'); });
    child.once('close', (code) => { this.workers.delete(session.id); delete session.startup; this.save(session, worker.stopped ? 'stopped' : code === 0 ? 'completed' : 'failed'); });
    return { ...session };
  }
  confirm(id) {
    const worker = this.workers.get(id);
    requireValue(worker?.session.startup && worker.session.state === 'confirmation-required', 'No native startup confirmation is pending', 409);
    delete worker.session.startup; worker.buffer = ''; worker.child.stdin.write('y\r'); this.save(worker.session, 'starting');
    return { ...worker.session };
  }
  event(token, input) {
    const worker = this.workers.get(input?.session);
    requireValue(worker && typeof token === 'string' && digest(token) === worker.hash, 'Unknown native session', 403);
    requireValue(EVENTS.includes(input.event) && typeof input.providerId === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(input.providerId), 'Invalid lifecycle event');
    const s = worker.session;
    requireValue(!s.providerId || s.providerId === input.providerId, 'Wrong provider session', 403); s.providerId = input.providerId;
    if (input.event === 'UserPromptSubmit') { s.turn++; worker.notified.clear(); this.save(s, 'busy'); }
    if (input.event === 'Stop' && input.background !== true) this.save(s, 'idle');
    if (input.event === 'StopFailure') this.save(s, 'failed');
    if (input.event === 'Notification' && input.notification === 'permission_prompt') this.save(s, 'input-required');
    const message = { Stop: 'Response finished', StopFailure: 'Agent error', Notification: input.notification === 'permission_prompt' ? 'Input required in Claude' : null, TaskCompleted: 'Task reported complete' }[input.event];
    if (message && !(input.event === 'Stop' && input.background === true) && !worker.notified.has(input.event)) {
      worker.notified.add(input.event); this.emit('notification', { session: s.id, text: `${s.slug}: ${message}${s.url ? `\n${s.url}` : ''}` });
    }
    return { accepted: true };
  }
  async stop(id) {
    const w = this.workers.get(id); requireValue(w, 'No running native process', 409); w.stopped = true;
    const closed = new Promise((resolve) => w.child.once('close', resolve));
    const signal = (name) => { try { if (w.child.pid) process.kill(-w.child.pid, name); else w.child.kill(name); } catch (e) { if (e.code !== 'ESRCH') throw e; } };
    signal('SIGTERM'); const timer = setTimeout(() => signal('SIGKILL'), 5000); timer.unref();
    await closed; clearTimeout(timer);
  }
  async close() { await Promise.all([...this.workers.keys()].map((id) => this.stop(id))); }
}
