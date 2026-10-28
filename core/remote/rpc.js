// Bounded JSON-line transport. Never interpolate prompts into command arguments.
import { EventEmitter } from 'node:events';
export class JsonPeer extends EventEmitter {
  constructor(input, output, { limit = 256000, timeoutMs = 30000 } = {}) {
    super(); this.output = output; this.buffer = ''; this.pending = new Map(); this.next = 0; this.timeoutMs = timeoutMs;
    input.setEncoding('utf8');
    input.on('data', (chunk) => {
      this.buffer += chunk;
      if (Buffer.byteLength(this.buffer) > limit) { this.emit('failure'); this.rejectAll(); return; }
      let end;
      while ((end = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
        try { this.receive(JSON.parse(line)); } catch { this.emit('failure'); this.rejectAll(); }
      }
    });
    input.on('error', () => this.rejectAll()); input.on('end', () => this.rejectAll());
    output.on('error', () => this.rejectAll());
  }
  write(value) { this.output.write(`${JSON.stringify(value)}\n`); }
  request(method, params) {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('Protocol request timed out')); }, this.timeoutMs); timer.unref?.();
      this.pending.set(id, { resolve, reject, timer }); this.write({ id, method, params });
    });
  }
  receive(message) {
    if (message.method) this.emit(message.id === undefined ? 'notification' : 'request', message);
    else {
      const p = this.pending.get(message.id); if (!p) return;
      this.pending.delete(message.id); clearTimeout(p.timer);
      if (message.error) p.reject(new Error('Provider protocol request failed')); else p.resolve(message.result);
    }
  }
  rejectAll() { this.buffer = ''; for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Protocol disconnected')); } this.pending.clear(); }
}
