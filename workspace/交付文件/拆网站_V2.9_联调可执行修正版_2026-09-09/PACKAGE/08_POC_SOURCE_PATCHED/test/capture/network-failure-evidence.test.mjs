import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeCriticalNetworkFailures } from '../../src/capture/chromium-capture.mjs';

test('critical network evidence keeps failed document, script, xhr and fetch requests only', () => {
  const requests = new Map([
    ['xhr', { url: 'https://api.searchspring.test/search', type: 'XHR' }],
    ['image', { url: 'https://cdn.test/image.jpg', type: 'Image' }],
    ['analytics', { url: 'https://analytics.test/ping', type: 'Ping' }],
  ]);
  const failures = new Map([
    ['xhr', { errorText: 'net::ERR_CONNECTION_RESET', canceled: false }],
    ['image', { errorText: 'net::ERR_CONNECTION_RESET', canceled: false }],
    ['analytics', { errorText: 'net::ERR_ABORTED', canceled: true }],
  ]);
  assert.deepEqual(summarizeCriticalNetworkFailures(requests, failures), {
    failedNetworkRequests: 1,
    failedNetworkRequestDetails: [{
      url: 'https://api.searchspring.test/search',
      type: 'XHR',
      errorText: 'net::ERR_CONNECTION_RESET',
      blockedReason: '',
    }],
  });
});
