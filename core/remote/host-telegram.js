import { randomBytes } from 'node:crypto';
import { TelegramController } from './telegram.js';
import { runInterview } from '../interview/engine.js';
import { remoteSettings } from '../lib/remote-settings.js';
import { digest, requireValue } from './store.js';
import { chooseInitModules } from '../cli/init-modules.js';
import { selectedByPolicy } from '../interview/depth.js';

// This questionnaire exists only inside a running Host service. Ordinary init has no Telegram route.
export class HostTelegram extends TelegramController {
  constructor({ projects, agents, ...options }) {
    super({ ...options, supervisor: agents }); this.projects = projects; this.agents = agents;
    this.notify = ({ text }) => this.send(text); this.agents.on('notification', this.notify);
  }
  event() { /* Native lifecycle notifications use the dedicated metadata event above. */ }
  async start() { const me = await this.api('getMe', {}); this.username = me.username; await super.start(); }
  pair() {
    const code = randomBytes(24).toString('hex'); this.pairing = { hash: digest(code), expires: Date.now() + 5 * 60000 };
    return { url: `https://t.me/${this.username}?start=${code}`, expires: this.pairing.expires };
  }
  async handle(update) {
    const settings = remoteSettings(this.env);
    if (!settings.enabled || settings.role !== 'host') return { refused: true };
    requireValue(Number.isSafeInteger(update?.update_id), 'Invalid Telegram update');
    if (update.update_id < this.store.state.offset) return { duplicate: true };
    this.store.state.offset = update.update_id + 1; this.store.save();
    const m = update.message;
    if (!m || m.chat?.type !== 'private' || m.from?.is_bot || m.forward_origin || m.forward_from || String(m.from?.id) !== String(m.chat?.id) || typeof m.text !== 'string') return { refused: true };
    const text = m.text.trim(), start = /^\/start ([a-f0-9]{48})$/.exec(text);
    if (start && this.pairing?.expires > Date.now() && digest(start[1]) === this.pairing.hash) {
      this.active?.reject?.(new Error('Telegram owner changed'));
      this.store.state.telegram = { userId: String(m.from.id), chatId: String(m.chat.id) }; this.store.save(); this.pairing = null;
      this.send('Paired. /init <slug> [quick|basic|all], /status, /projects, /cancel'); return { paired: true };
    }
    const owner = this.store.state.telegram;
    if (!owner || owner.userId !== String(m.from.id) || owner.chatId !== String(m.chat.id)) return { refused: true };
    if (text === '/cancel') { this.active?.reject?.(new Error('Cancelled')); this.send('Interview cancelled.'); return {}; }
    if (this.active?.resolve && !text.startsWith('/')) { const resolve = this.active.resolve; this.active.resolve = null; resolve(text); return {}; }
    if (text === '/status') { this.send(this.agents.list().map((s) => `${s.slug}: ${s.state}\n${s.id}${s.url ? `\n${s.url}` : ''}`).join('\n\n') || 'No agent sessions.'); return {}; }
    if (text === '/projects') { this.send(this.store.state.projects.map((p) => `${p.slug ?? p.id}: ${p.state ?? 'registered'}`).join('\n') || 'No projects.'); return {}; }
    const control = /^\/(stop|confirm) ([a-f0-9-]{36})$/.exec(text);
    if (control) { try { await (control[1] === 'stop' ? this.agents.stop(control[2]) : this.agents.confirm(control[2])); this.send('Updated.'); } catch { this.send('No matching process or startup confirmation.'); } return {}; }
    const init = /^\/init ([a-z0-9-]{1,64})(?: (quick|basic|all))?$/.exec(text);
    if (init) {
      if (this.active) { this.send('An interview is already open. /cancel'); return {}; }
      const task = this.interview(init[1], init[2] ?? 'quick', owner.userId);
      task.catch(() => this.send('Interview stopped. Inspect project status before retrying.')); return {};
    }
    this.send('Commands: /init <slug> [quick|basic|all], /status, /projects, /stop <session>, /confirm <session>, /cancel'); return {};
  }
  async interview(slug, mode, owner) {
    const session = this.projects.create({ slug, command: 'telegram' }, `telegram:${owner}`);
    const catalog = this.projects.bootstrap(session.id, `telegram:${owner}`);
    let output = '';
    this.active = {};
    const ask = (question) => new Promise((resolve, reject) => {
      const text = output + question; output = '';
      for (let offset = 0; offset < text.length; offset += 3400) this.send(text.slice(offset, offset + 3400));
      const active = this.active;
      const timer = setTimeout(() => reject(new Error('Interview expired')), 30 * 60000); timer.unref();
      active.resolve = (value) => { clearTimeout(timer); resolve(value); };
      active.reject = (error) => { clearTimeout(timer); reject(error); };
    });
    try {
      this.send(`Host interview: ${slug}\n${mode}`);
      const result = await runInterview({ questions: catalog.questions, mode, kitRoot: this.kitRoot, prompter: { interactive: true, show: (text) => { output += text; }, ask } });
      const input = { mode, answers: result.answers, gitInit: true };
      if (mode === 'all') {
        const selection = await chooseInitModules({ prompter: { show: (text) => { output += text; }, ask }, definitions: catalog.modules, defaults: catalog.modules.filter((m) => m.savedDefault).map((m) => m.name), answers: input.answers });
        requireValue(!selection.web, 'Use the host Web UI for a browser interview');
        input.modules = selectedByPolicy(catalog.modules, { answers: input.answers, modules: selection.modules });
      }
      const preview = await this.projects.action(session.id, `telegram:${owner}`, 'preview', input);
      if ((await ask(`\nCreate ${preview.destination}?\nClaude Code · ${preview.files.length} files\nReply yes to initialize and launch.`)).trim().toLowerCase() !== 'yes') { this.send('Cancelled.'); return; }
      const applied = await this.projects.action(session.id, `telegram:${owner}`, 'apply', input);
      this.send(`${slug}: ${applied.message}${applied.session ? `\n${applied.session.id}` : ''}`);
    } finally { this.active = null; }
  }
  async close() { this.active?.reject?.(new Error('Host stopped')); this.agents.off('notification', this.notify); await super.close(); }
}
