import { partitionForWorkers } from './capture-worker-plan.mjs';

export async function runPersistentRetryBatches(items, batchOperation, {
  initialWorkers = 2,
  maxRetryWaves = 3,
  onWave = () => {},
} = {}) {
  const originalItems = [...items];
  const completed = new Map();
  let pending = [...originalItems];

  for (let attempt = 1; attempt <= maxRetryWaves && pending.length; attempt += 1) {
    const workerCount = Math.max(1, Math.floor(initialWorkers / (2 ** (attempt - 1))));
    const shards = partitionForWorkers(pending, workerCount);
    const batches = await Promise.all(shards.map(async (shard) => {
      try {
        const batchResults = await batchOperation(shard, attempt);
        if (!Array.isArray(batchResults)) throw new Error('Retry batch operation must return an array');
        return batchResults;
      } catch (error) {
        return shard.map((item) => ({ item, ok: false, error: error?.message || String(error) }));
      }
    }));

    const returned = new Map(batches.flat().map((result) => [result.item, result]));
    const retrying = [];
    let succeeded = 0;
    for (const item of pending) {
      const result = returned.get(item) ?? { item, ok: false, error: 'Retry batch omitted route result' };
      const normalized = { ...result, item, attempts: attempt };
      if (normalized.ok) {
        completed.set(item, normalized);
        succeeded += 1;
      } else if (attempt === maxRetryWaves) {
        completed.set(item, normalized);
      } else {
        retrying.push(item);
      }
    }
    onWave({
      attempt,
      attempted: pending.length,
      succeeded,
      retrying: retrying.length,
      workerCount: shards.length,
    });
    pending = retrying;
  }

  return originalItems.map((item) => completed.get(item));
}
