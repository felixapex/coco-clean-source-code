import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateGoldenSuite } from '../../src/benchmark/golden-set.mjs';

function report(id, { coverage = 1, f1 = 1 } = {}) {
  return {
    siteId: id,
    totalGoldenItems: 10,
    matchedItems: Math.round(10 * coverage),
    coverage,
    clustering: { f1 },
    semanticRoleAccuracy: 1,
    variantAccuracy: 1,
    state: { f1: 1 },
    counts: {
      clustering: { tp: 10, fp: 0, fn: 0, goldSamePairs: 10, goldDifferentPairs: 10 },
      semantic: { correct: 10, total: 10 },
      variant: { correct: 10, total: 10 },
      state: { tp: 10, fp: 0, fn: 0 },
    },
  };
}

test('release gates fail when suite has fewer real sites than required', () => {
  const result = evaluateGoldenSuite([report('a'), report('b')], { minSites: 10 });
  assert.equal(result.passed, false);
  assert.ok(result.failedGates.includes('siteCount'));
});

test('per-site gates prevent a bad site from being hidden by aggregate score', () => {
  const reports = Array.from({ length: 10 }, (_, i) => report(`site-${i}`, i === 9 ? { coverage: 0.5, f1: 0.4 } : {}));
  const result = evaluateGoldenSuite(reports, {
    minSites: 10,
    minPerSiteCoverage: 0.8,
    minPerSiteClusteringF1: 0.75,
    minCoverage: 0.8,
  });
  assert.equal(result.siteCount, 10);
  assert.equal(result.passed, false);
  assert.ok(result.failedGates.includes('siteCoverage:site-9'));
  assert.ok(result.failedGates.includes('siteClusteringF1:site-9'));
});
