export class CdpClient {
  constructor(webSocketUrl, { timeoutMs = 10000 } = {}) {
    this.webSocketUrl = webSocketUrl;
    this.timeoutMs = timeoutMs;
    this.nextId = 1;
    this.pending = new Map();
    this.eventWaiters = new Map();
    this.eventHandlers = new Map();
    this.ws = null;
  }

  async connect() {
    if (this.ws) return;
    const ws = new WebSocket(this.webSocketUrl);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('CDP WebSocket connect timeout')), this.timeoutMs);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      ws.addEventListener('error', (event) => { clearTimeout(timer); reject(new Error(`CDP WebSocket error: ${event?.message ?? 'unknown'}`)); }, { once: true });
    });
    ws.addEventListener('message', (event) => this.#onMessage(event.data));
    ws.addEventListener('close', () => this.#rejectAll(new Error('CDP WebSocket closed')));
    this.ws = ws;
  }

  #onMessage(raw) {
    const msg = JSON.parse(String(raw));
    if (msg.id) {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      clearTimeout(pending.timer);
      if (msg.error) pending.reject(new Error(`CDP ${pending.method}: ${msg.error.message}`));
      else pending.resolve(msg.result ?? {});
      return;
    }
    if (msg.method) {
      const params = msg.params ?? {};
      const handlers = this.eventHandlers.get(msg.method);
      if (handlers?.size) {
        for (const handler of handlers) {
          Promise.resolve().then(() => handler(params)).catch(() => {});
        }
      }
      const waiters = this.eventWaiters.get(msg.method);
      if (!waiters?.length) return;
      this.eventWaiters.delete(msg.method);
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.resolve(params);
      }
    }
  }

  #rejectAll(error) {
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    this.pending.clear();
    for (const waiters of this.eventWaiters.values()) {
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    }
    this.eventWaiters.clear();
  }

  async send(method, params = {}) {
    if (!this.ws) await this.connect();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timeout: ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  onEvent(method, handler) {
    if (typeof handler !== 'function') throw new Error('event handler must be a function');
    const set = this.eventHandlers.get(method) ?? new Set();
    set.add(handler);
    this.eventHandlers.set(method, set);
    return () => {
      const current = this.eventHandlers.get(method);
      current?.delete(handler);
      if (current?.size === 0) this.eventHandlers.delete(method);
    };
  }

  onceEvent(method, timeoutMs = this.timeoutMs) {
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        const list = this.eventWaiters.get(method) ?? [];
        this.eventWaiters.set(method, list.filter((x) => x !== waiter));
        reject(new Error(`CDP event timeout: ${method}`));
      }, timeoutMs);
      const list = this.eventWaiters.get(method) ?? [];
      list.push(waiter);
      this.eventWaiters.set(method, list);
    });
  }

  async close() {
    if (!this.ws) return;
    try { this.ws.close(); } catch {}
    this.ws = null;
  }
}
