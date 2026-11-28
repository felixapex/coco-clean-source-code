import assert from 'node:assert/strict';
import test from 'node:test';

let buildImageRecoveryIssues;
try {
  ({ buildImageRecoveryIssues } = await import('../scripts/lib/validation-issue-list.mjs'));
} catch {
  // The first TDD run intentionally reaches the assertion below before the module exists.
}

test('image blocker files become stable actionable issue-list entries', () => {
  assert.equal(typeof buildImageRecoveryIssues, 'function');
  const issues = buildImageRecoveryIssues({
    files: [{
      filename: 'route-living.html',
      routes: ['/living'],
      sources: ['https://cdn.test/a.jpg', 'https://cdn.test/b.jpg'],
      occurrences: 3,
      sha256: 'page-hash',
    }],
  });

  assert.deepEqual(issues, [{
    id: 'image-source:route-living.html',
    category: 'assets',
    type: 'unresolved-source-images',
    severity: 'blocking',
    status: 'open',
    filename: 'route-living.html',
    routes: ['/living'],
    sourceCount: 2,
    occurrenceCount: 3,
    sources: ['https://cdn.test/a.jpg', 'https://cdn.test/b.jpg'],
    replaySha256: 'page-hash',
  }]);
});
