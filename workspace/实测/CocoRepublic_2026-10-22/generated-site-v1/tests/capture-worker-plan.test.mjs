import test from 'node:test';
import assert from 'node:assert/strict';
import { partitionForWorkers } from '../scripts/lib/capture-worker-plan.mjs';

test('seventy-five routes are assigned to eight persistent browser workers without duplication', () => {
  const routes = Array.from({ length: 75 }, (_, index) => `/route-${index + 1}`);
  const shards = partitionForWorkers(routes, 8);

  assert.equal(shards.length, 8);
  assert.equal(Math.max(...shards.map((shard) => shard.length)), 10);
  assert.equal(Math.min(...shards.map((shard) => shard.length)), 9);
  assert.deepEqual(shards.flat(), routes);
  assert.equal(new Set(shards.flat()).size, routes.length);
});

test('worker plan never creates more browser workers than routes', () => {
  assert.deepEqual(partitionForWorkers(['/a', '/b'], 8), [['/a'], ['/b']]);
  assert.deepEqual(partitionForWorkers([], 8), []);
});

