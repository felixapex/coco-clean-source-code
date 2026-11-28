import assert from 'node:assert/strict';
import test from 'node:test';

let evaluateImageRecoveryBlockers;
try {
  ({ evaluateImageRecoveryBlockers } = await import('../scripts/lib/image-recovery-blocker-gate.mjs'));
} catch {
  // The first TDD run intentionally reaches the assertion below before the module exists.
}

const report = {
  pass: false,
  blockedUniqueSourceCount: 2,
  blockedOccurrenceCount: 3,
  blockedFileCount: 2,
  files: [
    { filename: 'blocked-a.html', sha256: 'hash-a', sources: ['a.jpg'] },
    { filename: 'blocked-b.html', sha256: 'hash-b', sources: ['b.jpg'] },
  ],
};

test('selected blocked replay with matching evidence fails as unresolved source images', () => {
  assert.equal(typeof evaluateImageRecoveryBlockers, 'function');
  const result = evaluateImageRecoveryBlockers({
    report,
    selectedReplayFiles: ['blocked-a.html', 'safe.html'],
    currentHashes: new Map([['blocked-a.html', 'hash-a']]),
  });

  assert.deepEqual(result, {
    pass: false,
    code: 'unresolved-source-images',
    blockedFiles: ['blocked-a.html'],
    blockedUniqueSourceCount: 1,
    blockedOccurrenceCount: 1,
  });
});

test('changed blocked replay fails as stale blocker evidence', () => {
  assert.equal(typeof evaluateImageRecoveryBlockers, 'function');
  const result = evaluateImageRecoveryBlockers({
    report,
    selectedReplayFiles: ['blocked-a.html'],
    currentHashes: new Map([['blocked-a.html', 'new-hash']]),
  });

  assert.deepEqual(result, {
    pass: false,
    code: 'stale-image-recovery-blocker-report',
    staleFiles: ['blocked-a.html'],
  });
});

test('build subset with no blocked replay passes', () => {
  assert.equal(typeof evaluateImageRecoveryBlockers, 'function');
  const result = evaluateImageRecoveryBlockers({
    report,
    selectedReplayFiles: ['safe.html'],
    currentHashes: new Map(),
  });

  assert.deepEqual(result, { pass: true, code: null });
});
