export function connectCdp(url, { WebSocketImpl = WebSocket } = {}) {
  const socket = new WebSocketImpl(url);
  const pending = new Map();
  const listeners = new Map();
  let nextId = 1;
  let closed = false;

  const rejectPending = () => {
    if (closed) return;
    closed = true;
    const error = new Error('CDP target closed');
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  };

  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    const waiter = pending.get(message.id);
    if (waiter) {
      pending.delete(message.id);
      message.error ? waiter.reject(new Error(message.error.message)) : waiter.resolve(message.result);
      return;
    }
    for (const listener of listeners.get(message.method) || []) listener(message.params || {});
  });
  socket.addEventListener('close', rejectPending, { once: true });
  socket.addEventListener('error', rejectPending, { once: true });

  return {
    ready: new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    }),
    call(method, params = {}) {
      if (closed) return Promise.reject(new Error('CDP target closed'));
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    on(method, listener) {
      const methodListeners = listeners.get(method) || new Set();
      methodListeners.add(listener);
      listeners.set(method, methodListeners);
      return () => {
        methodListeners.delete(listener);
        if (!methodListeners.size) listeners.delete(method);
      };
    },
    close() {
      rejectPending();
      socket.close();
    },
  };
}
