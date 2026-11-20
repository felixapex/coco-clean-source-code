import test from 'node:test';
import assert from 'node:assert/strict';
import { runAdaptiveCaptureQueue } from '../../src/pipeline/adaptive-capture-queue.mjs';

test('connection reset burst lowers concurrency and retries only failed captures', async () => {
  const calls = new Map();
  const waves = [];
  const results = await runAdaptiveCaptureQueue(['a', 'b', 'c', 'd'], async (item, attempt) => {
    calls.set(item, (calls.get(item) ?? 0) + 1);
    if (attempt === 1 && item !== 'a') throw new Error('net::ERR_CONNECTION_RESET');
    return item.toUpperCase();
  }, {
    initialConcurrency: 4,
    minimumConcurrency: 2,
    maxAttempts: 2,
    baseBackoffMs: 0,
    onWave: (wave) => waves.push(wave),
  });

  assert.deepEqual(results.map(({ item, ok, value, attempts }) => ({ item, ok, value, attempts })), [
    { item: 'a', ok: true, value: 'A', attempts: 1 },
    { item: 'b', ok: true, value: 'B', attempts: 2 },
    { item: 'c', ok: true, value: 'C', attempts: 2 },
    { item: 'd', ok: true, value: 'D', attempts: 2 },
  ]);
  assert.equal(calls.get('a'), 1);
  assert.equal(waves[0].nextConcurrency, 2);
  assert.equal(waves[0].concurrency, 2, 'legacy callers receive the same adaptive concurrency value');
});

test('permanent validation failures are not retried', async () => {
  let attempts = 0;
  const [result] = await runAdaptiveCaptureQueue(['bad'], async () => {
    attempts += 1;
    throw new Error('visual fidelity below 0.95');
  }, { initialConcurrency: 8, maxAttempts: 5, baseBackoffMs: 0 });
  assert.equal(result.ok, false);
  assert.equal(result.attempts, 1);
  assert.equal(attempts, 1);
});
