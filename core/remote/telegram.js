import { setTimeout as delay } from 'node:timers/promises';
import { requireValue } from './store.js';
import { loadRules, secretValueRule } from '../../modules/security/lib/guards.js';

// One polling consumer belongs to the service lock; no independent bot controls a worker.
export class TelegramController {
  constructor({ store, supervisor, token, fetchFn = fetch, dashboardUrl = '', pollSeconds = 25, kitRoot }) {
    Object.assign(this, { store, supervisor, token, fetchFn, dashboardUrl, pollSeconds });
    this.abort = new AbortController(); this.queue = []; this.draining = false; this.output = new Map(); this.health = 'stopped';
    this.listener = (e) => this.event(e);
    this.rules = loadRules({ kitRoot }); this.shown = new Map();
  }
  async api(method, input) {
    let response;
    try {
      response = await this.fetchFn(`https://api.telegram.org/bot${this.token}/${method}`, { method: 'POST', redirect: 'error',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(35000)]) });
      if (!response.ok) throw new Error();
      const data = await response.json(); if (data.ok !== true) throw new Error(); return data.result;
    } catch { throw new Error('Telegram request failed'); } // never propagate a credential-bearing URL
  }
  send(text) {
    if (!this.store.state.telegram || this.abort.signal.aborted) return;
    if (this.queue.length >= 20) { this.health = 'output-gap'; return; }
    this.queue.push({ text: String(text).slice(0, 3500), ...this.store.state.telegram }); this.drain();
  }
  async drain() {
    if (this.draining) return; this.draining = true;
    while (this.queue.length && !this.abort.signal.aborted) {
      const item = this.queue.shift(), owner = this.store.state.telegram;
      if (!owner || owner.userId !== item.userId || owner.chatId !== item.chatId) continue;
      try { await this.api('sendMessage', { chat_id: item.chatId, text: item.text }); }
      catch { this.health = 'delivery-unknown'; } // do not retry a possibly delivered message automatically
      try { await delay(1100, undefined, { signal: this.abort.signal }); } catch { break; }
    }
    this.draining = false;
  }
  event(e) {
    if (e.type === 'message' && e.role === 'assistant') this.output.set(e.session, `${this.output.get(e.session) ?? ''}\n${e.text}`.slice(-2800));
    if (e.type === 'message' && e.role === 'user') this.output.delete(e.session);
    if (e.type === 'state' && ['idle', 'failed', 'unknown'].includes(e.state)) {
      this.send(`${e.session}\n${e.state}\n${this.output.get(e.session) || 'Open the dashboard for activity.'}`); this.output.delete(e.session);
    }
    if (e.type === 'decision') {
      // Approval details stay in the authenticated browser; Telegram never approves an unseen action.
      this.send(`${e.session}\nWaiting for ${e.details.kind === 'question' ? 'input' : 'approval'}: ${e.details.tool}\nRequest ${e.requestId}\nReview and resolve in the private dashboard ${this.dashboardUrl}`);
    }
  }
  async handle(update) {
    requireValue(Number.isSafeInteger(update?.update_id), 'Invalid Telegram update');
    if (update.update_id < this.store.state.offset) return { duplicate: true };
    const message = update.message, owner = this.store.state.telegram;
    // Commit the receipt before dispatch. After a crash, unknown commands are never replayed.
    this.store.state.offset = update.update_id + 1; this.store.save();
    if (!owner || !message || message.chat?.type !== 'private' || message.from?.is_bot || message.forward_origin || message.forward_from ||
      String(message.from?.id) !== owner.userId || String(message.chat.id) !== owner.chatId || typeof message.text !== 'string') return { refused: true };
    const text = message.text.trim();
    const active = new Set(this.supervisor.decisions().map((p) => p.requestId));
    for (const id of this.shown.keys()) if (!active.has(id)) this.shown.delete(id);
    const decision = /^\/(decision|approve|deny|answer)\s+(\S+)\s+(\S+)(?:\s+([\s\S]+))?$/.exec(text);
    if (decision) {
      const [, action, session, requestId, answer] = decision;
      const p = this.supervisor.decisions().find((d) => d.session === session && d.requestId === requestId);
      if (!p) { this.send('That decision is stale or already resolved.'); return { refused: true }; }
      const details = JSON.stringify(p.details.input, null, 2);
      if (action === 'decision') {
        if (details.length > 1500 || secretValueRule(this.rules, details)) { this.send('Review this decision in the authenticated browser; its details cannot be sent through Telegram.'); return {}; }
        try {
          await this.api('sendMessage', { chat_id: owner.chatId, text: `${session}\nRequest ${requestId}, turn ${p.turn}, expires ${new Date(p.expires).toISOString()}\n${p.details.tool}\n${details}\nUse /approve, /deny or /answer with this exact session and request ID. Permission applies once.` });
          this.shown.set(requestId, `${owner.userId}:${owner.chatId}`);
        } catch { this.health = 'delivery-unknown'; }
        return {};
      }
      if (action !== 'deny' && this.shown.get(requestId) !== `${owner.userId}:${owner.chatId}`) { this.send('Use /decision <session-id> <request-id> to review the exact action first, or resolve it in the browser.'); return { refused: true }; }
      try {
        const receipt = await this.supervisor.command({ action, session, requestId, commandId: `telegram:${message.chat.id}:${update.update_id}`, ...(action === 'answer' ? { answers: JSON.parse(answer ?? '{}') } : {}) }, 'telegram');
        this.shown.delete(requestId); this.send(`${session}\nDecision ${receipt.status}`); return receipt;
      } catch { this.send('Decision refused; check its target, expiry and answer format.'); return { refused: true }; }
    }
    if (text === '/projects') { this.send(this.store.state.projects.map((p) => `${p.id} ${p.name}`).join('\n') || 'No projects registered.'); return {}; }
    if (text === '/sessions' || text === '/status') { this.send(this.supervisor.list().map((s) => `${s.id} ${s.agent} ${s.state}`).join('\n') || 'No managed sessions.'); return {}; }
    const match = /^\/(new|resume|send|interrupt|stop)\s+(\S+)(?:\s+([\s\S]+))?$/.exec(text);
    if (!match) { this.send('Commands: /projects, /sessions, /new <project-id> <agent> <prompt>, /resume <session-id> <prompt>, /send <session-id> <prompt>, /interrupt <session-id>, /stop <session-id>, /decision <session-id> <request-id>, /approve|deny|answer <session-id> <request-id> [JSON answers].'); return {}; }
    const [, action, target, rest] = match;
    let input = { action, session: target, prompt: rest, commandId: `telegram:${message.chat.id}:${update.update_id}` };
    if (action === 'new') { const parts = /^(\S+)\s+([\s\S]+)$/.exec(rest ?? ''); requireValue(parts, 'Use /new <project-id> <agent> <prompt>'); input = { ...input, session: undefined, project: target, agent: parts[1], prompt: parts[2] }; }
    try { const receipt = await this.supervisor.command(input, 'telegram'); this.send(`${receipt.session}\nCommand ${receipt.status}`); return receipt; }
    catch { this.send('Command refused. Check the session status, workspace ownership and request format.'); return { refused: true }; }
  }
  async start() {
    requireValue(typeof this.token === 'string' && /^\d+:[A-Za-z0-9_-]{20,}$/.test(this.token), 'Enter the Telegram bot credential in the service environment');
    const webhook = await this.api('getWebhookInfo', {});
    requireValue(!webhook.url, 'This bot has a webhook; choose a dedicated polling bot or remove its webhook privately');
    this.supervisor.on('event', this.listener); this.health = 'polling';
    this.loop = (async () => {
      while (!this.abort.signal.aborted) {
        try {
          const updates = await this.api('getUpdates', { offset: this.store.state.offset, timeout: this.pollSeconds, allowed_updates: ['message'] });
          for (const update of updates) await this.handle(update);
        } catch {
          if (this.abort.signal.aborted) break;
          this.health = 'poll-failed';
          try { await delay(5000, undefined, { signal: this.abort.signal }); } catch { break; }
        }
      }
    })();
  }
  async close() { this.abort.abort(); this.queue = []; this.supervisor.removeListener('event', this.listener); await this.loop; this.health = 'stopped'; }
}
