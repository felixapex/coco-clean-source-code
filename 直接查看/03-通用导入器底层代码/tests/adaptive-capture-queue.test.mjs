import test from 'node:test';
import assert from 'node:assert/strict';
import { runAdaptiveQueue } from '../scripts/lib/adaptive-capture-queue.mjs';

test('connection-reset bursts are cooled down and retried concurrently without repeating successes', async () => {
  const items = ['a', 'b', 'c', 'd'];
  const attempts = new Map();
  const activeByAttempt = new Map();
  const peakByAttempt = new Map();

  const results = await runAdaptiveQueue(items, async (item, attempt) => {
    attempts.set(item, (attempts.get(item) ?? 0) + 1);
    activeByAttempt.set(attempt, (activeByAttempt.get(attempt) ?? 0) + 1);
    peakByAttempt.set(attempt, Math.max(peakByAttempt.get(attempt) ?? 0, activeByAttempt.get(attempt)));
    await new Promise((resolve) => setTimeout(resolve, 5));
    activeByAttempt.set(attempt, activeByAttempt.get(attempt) - 1);
    if (attempt === 1 && item !== 'a') throw new Error('Navigation failed: net::ERR_CONNECTION_RESET');
    return item.toUpperCase();
  }, {
    initialConcurrency: 4,
    minimumConcurrency: 2,
    maxAttempts: 2,
    baseBackoffMs: 0,
  });

  assert.deepEqual(results.map(({ item, ok, value, attempts: count }) => ({ item, ok, value, attempts: count })), [
    { item: 'a', ok: true, value: 'A', attempts: 1 },
    { item: 'b', ok: true, value: 'B', attempts: 2 },
    { item: 'c', ok: true, value: 'C', attempts: 2 },
    { item: 'd', ok: true, value: 'D', attempts: 2 },
  ]);
  assert.equal(attempts.get('a'), 1);
  assert.equal(peakByAttempt.get(1), 4);
  assert.equal(peakByAttempt.get(2), 2, 'retry work is parallel but backs off from the failed concurrency level');
});

test('non-transient failures are returned immediately instead of being retried', async () => {
  let attempts = 0;
  const [result] = await runAdaptiveQueue(['bad'], async () => {
    attempts += 1;
    throw new Error('Invalid Shopify capture: error-page');
  }, {
    initialConcurrency: 8,
    minimumConcurrency: 2,
    maxAttempts: 3,
    baseBackoffMs: 0,
  });

  assert.equal(result.ok, false);
  assert.equal(result.attempts, 1);
  assert.match(result.error, /error-page/);
  assert.equal(attempts, 1);
});
