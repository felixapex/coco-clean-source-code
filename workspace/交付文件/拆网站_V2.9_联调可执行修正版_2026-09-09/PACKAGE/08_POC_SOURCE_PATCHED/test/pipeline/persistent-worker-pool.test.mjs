import test from 'node:test';
import assert from 'node:assert/strict';
import { runPersistentWorkerPool } from '../../src/pipeline/persistent-worker-pool.mjs';

test('persistent workers pull the next available item instead of waiting for static shards', async () => {
  const claimedByWorker = new Map();
  const items = ['slow', 'fast-1', 'fast-2', 'fast-3', 'fast-4'];

  const results = await runPersistentWorkerPool(items, 2, async ({ workerId, drain }) => {
    claimedByWorker.set(workerId, []);
    await drain(async (item) => {
      claimedByWorker.get(workerId).push(item);
      await new Promise((resolve) => setTimeout(resolve, item === 'slow' ? 40 : 2));
      return item.toUpperCase();
    });
  });

  assert.deepEqual(results, items.map((item) => item.toUpperCase()), 'results retain input order');
  assert.deepEqual(claimedByWorker.get(0), ['slow']);
  assert.deepEqual(claimedByWorker.get(1), ['fast-1', 'fast-2', 'fast-3', 'fast-4']);
});

test('persistent worker count never exceeds the number of items', async () => {
  const startedWorkers = [];

  const results = await runPersistentWorkerPool(['a', 'b'], 8, async ({ workerId, drain }) => {
    startedWorkers.push(workerId);
    await drain(async (item) => item);
  });

  assert.deepEqual(results, ['a', 'b']);
  assert.equal(startedWorkers.length, 2);
});

test('empty input does not launch a browser worker', async () => {
  let started = false;
  const results = await runPersistentWorkerPool([], 8, async () => { started = true; });
  assert.deepEqual(results, []);
  assert.equal(started, false);
});
