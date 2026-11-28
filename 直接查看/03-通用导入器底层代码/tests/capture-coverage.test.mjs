import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCaptureCoverage, isSourceProtectedFailure } from '../scripts/lib/capture-coverage.mjs';

test('source verification failures are terminal and must not enter retry waves', () => {
  assert.equal(isSourceProtectedFailure({ error: 'Error: source-verification-challenge' }), true);
  assert.equal(isSourceProtectedFailure({ route: '/contact-us', error: 'net::ERR_NETWORK_ACCESS_DENIED' }), true);
  assert.equal(isSourceProtectedFailure({ route: '/living', error: 'net::ERR_NETWORK_ACCESS_DENIED' }), false);
  assert.equal(isSourceProtectedFailure({ error: 'ERR_CONNECTION_RESET' }), false);
});

test('verified source challenges are reported separately and may pass the 95 percent route gate', () => {
  const result = evaluateCaptureCoverage({
    total: 164,
    captured: 162,
    failures: [
      { route: '/book-an-appointment', error: 'source-verification-challenge' },
      { route: '/contact-us', error: 'source-verification-challenge' },
    ],
  });
  assert.equal(result.pass, true);
  assert.equal(result.coverage, 162 / 164);
  assert.equal(result.sourceProtectedCount, 2);
  assert.deepEqual(result.unhandledFailures, []);
});

test('ordinary capture failures still fail the release gate', () => {
  const result = evaluateCaptureCoverage({
    total: 164,
    captured: 162,
    failures: [{ route: '/living', error: 'ERR_CONNECTION_RESET' }],
  });
  assert.equal(result.pass, false);
  assert.equal(result.unhandledFailures.length, 1);
});
