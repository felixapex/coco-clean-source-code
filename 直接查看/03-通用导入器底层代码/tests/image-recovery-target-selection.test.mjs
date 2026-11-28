import assert from 'node:assert/strict';
import test from 'node:test';

let selectPendingImageRecoveryTargets;
let summarizeTargetRecoveryEntries;
try {
  ({ selectPendingImageRecoveryTargets, summarizeTargetRecoveryEntries } = await import('../scripts/lib/image-recovery-target-selection.mjs'));
} catch {
  // The first TDD run intentionally reaches the assertion below before the module exists.
}

test('pending network targets exclude sources recovered by every recovery channel', () => {
  assert.equal(typeof selectPendingImageRecoveryTargets, 'function');
  const targets = selectPendingImageRecoveryTargets({
    missingSources: ['d.jpg', 'a.jpg', 'b.jpg', 'c.jpg', 'a.jpg'],
    cacheRecovered: [{ targetSource: 'a.jpg' }],
    manifests: [
      { entries: { 'b.jpg': { status: 'recovered' }, 'd.jpg': { status: 'network-deferred' } } },
      { entries: { 'c.jpg': { status: 'recovered' } } },
    ],
  });

  assert.deepEqual(targets, ['d.jpg']);
});

test('network recovery summary counts only the current target set', () => {
  assert.equal(typeof summarizeTargetRecoveryEntries, 'function');
  const summary = summarizeTargetRecoveryEntries({
    targets: ['pending.jpg', 'failed.jpg'],
    entries: {
      'pending.jpg': { status: 'network-deferred' },
      'failed.jpg': { status: 'failed' },
      'historical-recovered.jpg': { status: 'recovered' },
      'historical-deferred.jpg': { status: 'network-deferred' },
    },
  });

  assert.deepEqual(summary, { recovered: 0, networkDeferred: 1, failed: 1 });
});
