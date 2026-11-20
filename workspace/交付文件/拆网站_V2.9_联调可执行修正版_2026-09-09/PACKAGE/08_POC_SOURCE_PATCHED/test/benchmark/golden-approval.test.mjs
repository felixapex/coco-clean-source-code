import test from 'node:test';
import assert from 'node:assert/strict';
import { assertGoldenApproved } from '../../src/benchmark/golden-set.mjs';

test('release benchmark rejects machine-generated unreviewed Golden annotations', () => {
  const golden = {
    version: '0.1', siteId: 'shop', items: [
      { routePath: '/', candidateId: 'p1', familyLabel: 'product', reviewStatus: 'unreviewed' },
    ],
  };
  assert.throws(() => assertGoldenApproved(golden), /approved/i);
});

test('release benchmark accepts only when every Golden item is explicitly approved', () => {
  const golden = {
    version: '0.1', siteId: 'shop', items: [
      { routePath: '/', candidateId: 'p1', familyLabel: 'product', reviewStatus: 'approved' },
      { routePath: '/search', candidateId: 'p2', familyLabel: 'product', reviewStatus: 'approved' },
    ],
  };
  assert.doesNotThrow(() => assertGoldenApproved(golden));
});
