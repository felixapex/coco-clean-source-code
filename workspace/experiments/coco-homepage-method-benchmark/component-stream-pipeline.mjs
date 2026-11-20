export async function runComponentStream({
  components = [],
  waitUntilReady,
  processComponent,
  concurrency = 1,
} = {}) {
  if (typeof waitUntilReady !== 'function') throw new TypeError('waitUntilReady must be a function');
  if (typeof processComponent !== 'function') throw new TypeError('processComponent must be a function');

  const limit = Math.max(1, Math.floor(Number(concurrency) || 1));
  const outputs = new Array(components.length);
  const events = [];
  const failures = [];
  const waiting = [];
  let active = 0;

  const acquire = async () => {
    if (active < limit) {
      active += 1;
      return;
    }
    await new Promise((resolve) => waiting.push(resolve));
    active += 1;
  };

  const release = () => {
    active -= 1;
    waiting.shift()?.();
  };

  const startedAt = performance.now();
  await Promise.all(components.map(async (component, index) => {
    try {
      const readiness = await waitUntilReady(component, index);
      events.push({ type: 'ready', index, elapsedMs: Math.round(performance.now() - startedAt), readiness });
      await acquire();
      try {
        events.push({ type: 'processing-started', index, elapsedMs: Math.round(performance.now() - startedAt) });
        outputs[index] = await processComponent(component, index, readiness);
        events.push({ type: 'processing-finished', index, elapsedMs: Math.round(performance.now() - startedAt) });
      } finally {
        release();
      }
    } catch (error) {
      failures.push({ index, error: String(error?.stack || error) });
    }
  }));

  return {
    outputs,
    completed: outputs.filter((value) => value !== undefined).length,
    failures,
    events,
    elapsedMs: Math.round(performance.now() - startedAt),
  };
}
