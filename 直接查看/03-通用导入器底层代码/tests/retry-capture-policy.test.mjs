import test from 'node:test';
import assert from 'node:assert/strict';
import { withPersistentBrowserRetry } from '../scripts/lib/retry-capture-policy.mjs';

test('transient CDN failures retry after cooling down in the same browser profile', () => {
  const options = withPersistentBrowserRetry({ timeoutMs: 60000, attempts: 1, retryDelayMs: 0 });

  assert.equal(options.timeoutMs, 60000);
  assert.equal(options.attempts, 2);
  assert.equal(options.retryDelayMs, 10000);
});
