import { EventEmitter } from 'node:events';
import { realpathSync, lstatSync } from 'node:fs';
import { basename, isAbsolute } from 'node:path';
import { readManifest } from '../render/manifest.js';
import { digest, identifier, requireValue, RemoteError } from './store.js';

const BUSY = new Set(['starting', 'running', 'waiting-input', 'waiting-approval', 'interrupting']);
const OWNED = new Set([...BUSY, 'idle', 'unknown']);
const PROMPT_LIMIT = 24000;
export class Supervisor extends EventEmitter {
  constructor({ store, adapters, maxWorkers = 2, timeoutMs = 30 * 60000, approvalMs = 5 * 60000, now = Date.now }) {
    super(); Object.assign(this, { store, adapters, maxWorkers, timeoutMs, approvalMs, now });
    this.workers = new Map(); this.buffers = new Map(); this.pending = new Map(); this.sequence = 0; this.epoch = identifier(); this.closed = false;
    this.launching = new Set();
    this.commands = new Set();
    this.startups = new Map(); this.cancelled = new Set();
    this.dropped = new Set();
  }
  list() { return this.store.state.sessions.map((s) => ({ ...s, controllable: this.workers.has(s.id) })); }
  capabilities() { return Object.entries(this.adapters).map(([id, a]) => ({ id, ...a.capabilities })); }
  project(id) {
    const p = this.store.state.projects.find((x) => x.id === id);
    requireValue(p && realpathSync(p.path) === p.path && lstatSync(p.path).isDirectory(), 'Registered project is unavailable');
    return p;
  }
  register(path) {
    requireValue(typeof path === 'string' && isAbsolute(path) && !/[\x00-\x1f]/.test(path), 'Give an absolute NAS checkout path');
    const canonical = realpathSync(path);
    requireValue(readManifest(canonical), 'Initialize YAW in the NAS checkout first');
    requireValue(this.store.state.projects.length < 200, 'Project limit reached');
    const old = this.store.state.projects.find((p) => p.path === canonical);
    if (old) return old;
    const p = { id: identifier(), name: basename(canonical), path: canonical };
    this.store.state.projects.push(p); this.store.save(); return p;
  }
  session(id) {
    const s = this.store.state.sessions.find((x) => x.id === id);
    requireValue(s, 'Unknown managed session', 404); return s;
  }
  ownsWorkspace(s) { return OWNED.has(s.state) || this.workers.has(s.id) || this.launching.has(s.id); }
  waitingState(s) {
    const requests = [...this.pending.values()].filter((p) => p.session === s.id);
    return requests.some((p) => p.kind === 'question') ? 'waiting-input' : requests.length ? 'waiting-approval' : 'running';
  }
  event(id, type, data = {}) {
    const event = { sequence: ++this.sequence, epoch: this.epoch, session: id, type, ...data };
    const buffer = this.buffers.get(id) ?? [];
    // Content is temporary, bounded and never written into the metadata store.
    if (Buffer.byteLength(JSON.stringify(event)) > 32000) event.text = '[Event exceeded the display limit]';
    if (Buffer.byteLength(JSON.stringify(event)) > 32000) { delete event.input; delete event.details; }
    buffer.push(event);
    while (buffer.length > 200 || Buffer.byteLength(JSON.stringify(buffer)) > 256000) { buffer.shift(); this.dropped.add(id); }
    this.buffers.set(id, buffer); this.emit('event', event);
  }
  events(id, after = 0, epoch) {
    const s = this.session(id), buffer = this.buffers.get(id) ?? [];
    return { epoch: this.epoch, gap: Boolean(epoch && epoch !== this.epoch) || (!epoch && after === 0 && (this.dropped.has(id) || (s.turn > 0 && !buffer.length))) || (after > 0 && (!buffer.length || after < buffer[0].sequence - 1)),
      events: buffer.filter((e) => e.sequence > (epoch && epoch !== this.epoch ? 0 : after)) };
  }
  transition(s, state) {
    s.state = state; s.updated = new Date(this.now()).toISOString();
    const transitions = this.store.state.transitions ??= [];
    transitions.push({ session: s.id, worker: s.worker, turn: s.turn, state, at: s.updated });
    if (transitions.length > 10000) transitions.shift();
    this.store.save(); this.event(s.id, 'state', { state });
  }
  async command(input, origin = 'browser') {
    requireValue(!this.closed, 'Controller is stopping', 503);
    const promise = this.dispatch(input, origin); this.commands.add(promise);
    try { return await promise; } finally { this.commands.delete(promise); }
  }
  async dispatch(input, origin) {
    requireValue(!this.closed, 'Controller is stopping', 503);
    requireValue(input && /^[A-Za-z0-9:_-]{8,150}$/.test(input.commandId), 'Supply a stable command ID');
    const { commandId, action, session: target } = input;
    const key = digest(commandId), fingerprint = digest(JSON.stringify(input));
    const old = this.store.state.receipts[key];
    if (old) { requireValue(old.fingerprint === fingerprint, 'Command ID was already used for another request', 409); return { ...old, duplicate: true }; }
    requireValue(Object.keys(this.store.state.receipts).length < 20000, 'Command receipt limit reached; archive the service metadata', 409);
    let s;
    if (action === 'new') {
      this.project(input.project);
      requireValue(this.adapters[input.agent]?.capabilities?.input, 'Agent adapter is unavailable');
      requireValue(this.adapters[input.agent].capabilities.available !== false, this.adapters[input.agent].capabilities.requirement ?? 'Agent adapter is unavailable');
      requireValue(this.store.state.sessions.length < 500, 'Session limit reached');
      requireValue(!this.store.state.sessions.some((x) => x.project === input.project && this.ownsWorkspace(x)), 'This workspace already has a managed writer; stop it or register another checkout', 409);
      requireValue(typeof input.prompt === 'string' && input.prompt.trim() && input.prompt.length <= PROMPT_LIMIT, 'Prompt must contain 1–24,000 characters');
      requireValue(input.model === undefined || (typeof input.model === 'string' && /^[A-Za-z0-9._:/-]{1,120}$/.test(input.model)), 'Invalid model');
      s = { id: identifier(), worker: identifier(), project: input.project, agent: input.agent, model: input.model ?? null, providerSession: null, turn: 0, state: 'starting', origin, created: new Date(this.now()).toISOString() };
    } else {
      s = this.session(target);
      requireValue(['send', 'resume', 'interrupt', 'stop', 'approve', 'deny', 'answer'].includes(action), 'Unknown controller action');
      if (action === 'send' || action === 'resume') {
        requireValue(!BUSY.has(s.state), 'The session is busy; wait or interrupt it', 409);
        requireValue(typeof input.prompt === 'string' && input.prompt.trim() && input.prompt.length <= PROMPT_LIMIT, 'Prompt must contain 1–24,000 characters');
        if (action === 'send') requireValue(this.workers.has(s.id), 'Resume this exact session first', 409);
        if (action === 'resume') {
          requireValue(!this.launching.has(s.id), 'Wait for the previous startup to stop', 409);
          requireValue(!this.workers.has(s.id) && s.providerSession, 'No resumable provider session is available', 409);
          requireValue(this.adapters[s.agent]?.capabilities?.resume, 'Adapter cannot resume this session');
          requireValue(!this.store.state.sessions.some((x) => x.id !== s.id && x.project === s.project && this.ownsWorkspace(x)), 'Workspace is already owned by another session', 409);
        }
      }
      if (action === 'interrupt') requireValue(this.workers.has(s.id) && BUSY.has(s.state), 'No running turn to interrupt', 409);
      if (['approve', 'deny', 'answer'].includes(action)) {
        const p = this.pending.get(input.requestId);
        requireValue(p && p.session === s.id && p.turn === s.turn && p.expires > this.now(), 'Approval is stale or no longer pending', 409);
        requireValue(action === 'deny' || (p.kind === 'question' ? action === 'answer' : action === 'approve'), 'Use the matching decision action');
        if (action === 'answer') requireValue(input.answers && typeof input.answers === 'object' && !Array.isArray(input.answers), 'Supply the question answers');
      }
    }
    if (action === 'new' || action === 'resume') requireValue(this.workers.size + this.launching.size < this.maxWorkers, 'Worker limit reached', 409);
    const receipt = { commandId, fingerprint, action, session: s.id, turn: s.turn, requestId: input.requestId ?? null, status: 'received', origin, accepted: new Date(this.now()).toISOString() };
    if (action === 'new') this.store.state.sessions.push(s);
    this.store.state.receipts[key] = receipt; this.store.save(); // acceptance precedes any provider delivery
    try {
      if (action === 'new' || action === 'resume') {
        this.cancelled.delete(s.id); this.transition(s, 'starting'); this.launching.add(s.id);
        const startup = this.launch(s); this.startups.set(s.id, startup);
        try { await startup; } finally { this.launching.delete(s.id); this.startups.delete(s.id); }
      }
      if (['new', 'resume', 'send'].includes(action)) {
        s.turn++; this.transition(s, 'running'); this.arm(s);
        this.event(s.id, 'message', { role: 'user', text: input.prompt });
        receipt.turn = s.turn; receipt.status = 'dispatched'; this.store.save();
        await this.workers.get(s.id).send(input.prompt);
      } else if (action === 'interrupt') {
        requireValue(this.workers.has(s.id) && BUSY.has(s.state), 'No running turn to interrupt', 409);
        this.invalidate(s.id); this.transition(s, 'interrupting'); await this.workers.get(s.id).interrupt();
      } else if (action === 'stop') { await this.stop(s); }
      else if (['approve', 'deny', 'answer'].includes(action)) {
        const p = this.pending.get(input.requestId); this.pending.delete(input.requestId); clearTimeout(p.timer);
        // One resolution shared by all channels; never broaden permissions beyond this call.
        p.resolve({ allow: action !== 'deny', answers: input.answers }); this.transition(s, this.waitingState(s));
      }
      if (receipt.status !== 'completed') receipt.status = ['new', 'resume', 'send'].includes(action) ? 'dispatched' : 'completed';
    } catch {
      if (this.cancelled.has(s.id) && receipt.status === 'received') {
        receipt.status = 'completed'; receipt.outcome = 'stopped'; this.transition(s, 'stopped');
      } else {
        receipt.status = 'unknown';
        if (this.workers.has(s.id)) await this.stop(s, 'unknown'); else if (s.state !== 'stopped') this.transition(s, 'unknown');
        this.event(s.id, 'notice', { text: 'Delivery could not be confirmed. Inspect the checkout and provider history before resending.' });
      }
    }
    this.store.save(); return { ...receipt };
  }
  arm(s) { const w = this.workers.get(s.id); clearTimeout(w.timer); w.timer = setTimeout(() => this.stop(s, 'failed').catch(() => {}), this.timeoutMs); w.timer.unref?.(); }
  async launch(s) {
    const project = this.project(s.project);
    s.worker = identifier(); this.store.save();
    const w = await this.adapters[s.agent].start({ session: { ...s }, project, onEvent: (e) => this.providerEvent(s, e), request: (r) => this.request(s, r) });
    if (this.cancelled.has(s.id) || this.closed) { await w.stop(); throw new RemoteError('Startup cancelled', 409); }
    this.workers.set(s.id, w); s.state = 'idle'; this.store.save();
  }
  providerEvent(s, e) {
    if (e.type === 'session' && typeof e.id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(e.id)) { s.providerSession = e.id; this.store.save(); }
    else if (e.type === 'done') {
      this.invalidate(s.id); clearTimeout(this.workers.get(s.id)?.timer);
      for (const receipt of Object.values(this.store.state.receipts)) {
        if (receipt.session === s.id && receipt.turn === s.turn && receipt.status === 'dispatched') { receipt.status = 'completed'; receipt.outcome = e.failed ? 'failed' : 'completed'; }
      }
      if (e.text) this.event(s.id, 'message', { role: 'assistant', text: e.text.slice(0, 24000) });
      this.transition(s, e.failed ? 'failed' : 'idle');
    } else if (e.type === 'exit') {
      this.invalidate(s.id); clearTimeout(this.workers.get(s.id)?.timer); this.workers.delete(s.id);
      if (s.state !== 'stopped') this.transition(s, 'unknown');
    } else if (['message', 'activity', 'notice', 'files'].includes(e.type)) this.event(s.id, e.type, { ...e, text: typeof e.text === 'string' ? e.text.slice(0, 24000) : undefined });
  }
  request(s, r) {
    const id = identifier(), expires = this.now() + this.approvalMs;
    requireValue(this.pending.size < 100, 'Too many pending approvals');
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id); resolve({ allow: false });
        if (this.workers.has(s.id)) this.transition(s, this.waitingState(s));
        this.event(s.id, 'notice', { text: 'Decision expired; permission was denied.' });
      }, this.approvalMs); timer.unref?.();
      this.pending.set(id, { session: s.id, turn: s.turn, kind: r.kind ?? 'tool', expires, resolve, timer, details: r });
      this.transition(s, r.kind === 'question' ? 'waiting-input' : 'waiting-approval');
      this.event(s.id, 'decision', { requestId: id, turn: s.turn, expires, details: r });
    });
  }
  decisions() { return [...this.pending].map(([requestId, p]) => ({ requestId, session: p.session, turn: p.turn, expires: p.expires, details: p.details })); }
  invalidate(id) { for (const [key, p] of this.pending) if (p.session === id) { clearTimeout(p.timer); p.resolve({ allow: false }); this.pending.delete(key); } }
  async stop(s, state = 'stopped') {
    this.cancelled.add(s.id);
    if (this.startups.has(s.id)) { this.transition(s, 'interrupting'); await Promise.allSettled([this.startups.get(s.id)]); }
    this.invalidate(s.id); const w = this.workers.get(s.id);
    if (w) { clearTimeout(w.timer); await w.stop(); this.workers.delete(s.id); }
    this.transition(s, state);
  }
  async close() { this.closed = true; await Promise.allSettled(this.commands); await Promise.allSettled([...this.workers.keys()].map((id) => this.stop(this.session(id), 'unknown'))); }
}
