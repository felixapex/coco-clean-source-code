import test from 'node:test';
import assert from 'node:assert/strict';
import { pairwiseClusteringMetrics } from '../../src/benchmark/clustering-metrics.mjs';

test('perfect clustering returns all perfect metrics', () => {
  const m = pairwiseClusteringMetrics(['A','A','B','B'], ['x','x','y','y']);
  assert.equal(m.precision, 1);
  assert.equal(m.recall, 1);
  assert.equal(m.f1, 1);
  assert.equal(m.overMergeRate, 0);
  assert.equal(m.underMergeRate, 0);
});

test('over-merge and under-merge are measured from pair errors', () => {
  // Gold same pairs: (0,1), (2,3). Predicted same pairs: (0,1), (1,2), (0,2).
  const m = pairwiseClusteringMetrics(['A','A','B','B'], ['x','x','x','y']);
  assert.equal(m.truePositivePairs, 1);
  assert.equal(m.falsePositivePairs, 2);
  assert.equal(m.falseNegativePairs, 1);
  assert.ok(Math.abs(m.precision - 1/3) < 1e-12);
  assert.ok(Math.abs(m.recall - 1/2) < 1e-12);
  assert.ok(Math.abs(m.overMergeRate - 2/4) < 1e-12);
  assert.ok(Math.abs(m.underMergeRate - 1/2) < 1e-12);
});
