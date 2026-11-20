import assert from 'node:assert/strict';
import test from 'node:test';

import { runComponentStream } from './component-stream-pipeline.mjs';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function waitFor(predicate, timeoutMs = 500) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('condition was not reached');
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

test('starts processing a ready component before the final component becomes ready', async () => {
  const readiness = [deferred(), deferred(), deferred()];
  const started = [];
  const run = runComponentStream({
    components: ['header', 'hero', 'footer'],
    waitUntilReady: (_component, index) => readiness[index].promise,
    processComponent: async (component) => {
      started.push(component);
      return component.toUpperCase();
    },
    concurrency: 1,
  });

  readiness[0].resolve({ readyAtMs: 10 });
  await waitFor(() => started.length === 1);
  assert.deepEqual(started, ['header']);

  readiness[1].resolve({ readyAtMs: 20 });
  readiness[2].resolve({ readyAtMs: 30 });
  const result = await run;

  assert.deepEqual(result.outputs, ['HEADER', 'HERO', 'FOOTER']);
  assert.equal(result.completed, 3);
  assert.equal(result.failures.length, 0);
});
