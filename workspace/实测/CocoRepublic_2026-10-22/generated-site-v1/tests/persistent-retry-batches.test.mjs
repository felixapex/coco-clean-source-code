import test from 'node:test';
import assert from 'node:assert/strict';
import { runPersistentRetryBatches } from '../scripts/lib/persistent-retry-batches.mjs';

test('failed routes retry in persistent browser batches without repeating successful routes', async () => {
  const browserBatches = [];
  const results = await runPersistentRetryBatches(['a', 'b', 'c', 'd', 'e'], async (batch, attempt) => {
    browserBatches.push({ attempt, batch: [...batch] });
    return batch.map((item) => ({
      item,
      ok: item !== 'e' && (item !== 'c' || attempt >= 2),
      error: `pending image for ${item}`,
      value: item.toUpperCase(),
    }));
  }, {
    initialWorkers: 2,
    maxRetryWaves: 3,
  });

  assert.deepEqual(browserBatches, [
    { attempt: 1, batch: ['a', 'b', 'c'] },
    { attempt: 1, batch: ['d', 'e'] },
    { attempt: 2, batch: ['c', 'e'] },
    { attempt: 3, batch: ['e'] },
  ]);
  assert.deepEqual(results.map(({ item, ok, attempts }) => ({ item, ok, attempts })), [
    { item: 'a', ok: true, attempts: 1 },
    { item: 'b', ok: true, attempts: 1 },
    { item: 'c', ok: true, attempts: 2 },
    { item: 'd', ok: true, attempts: 1 },
    { item: 'e', ok: false, attempts: 3 },
  ]);
});
