import test from 'node:test';
import assert from 'node:assert/strict';
import { robotsFetchDecision, createRobotsVisitPolicy, createPinnedLookup } from '../../src/site/fetch-robots.mjs';

const robotsText = `User-agent: *\nDisallow: /private\n`;

test('robots fetch decision follows fail-open 4xx and fail-closed unreachable behavior', () => {
  assert.equal(robotsFetchDecision({ status: 404 }).access, 'allow');
  assert.equal(robotsFetchDecision({ status: 410 }).access, 'allow');
  assert.equal(robotsFetchDecision({ status: 503 }).access, 'deny');
  assert.equal(robotsFetchDecision({ error: new Error('timeout') }).access, 'deny');
  assert.equal(robotsFetchDecision({ status: 200, text: robotsText }).access, 'rules');
});

test('robots visit policy can respect rules or record only without blocking', async () => {
  const respect = createRobotsVisitPolicy({ status: 200, text: robotsText }, { mode: 'respect', userAgent: 'MatboxComponentEngine' });
  assert.deepEqual(await respect('https://example.com/private'), { allowed: false, reason: 'robots-disallow' });
  assert.deepEqual(await respect('https://example.com/public'), { allowed: true, reason: 'robots-allow' });

  const recordOnly = createRobotsVisitPolicy({ status: 200, text: robotsText }, { mode: 'record-only', userAgent: 'MatboxComponentEngine' });
  assert.deepEqual(await recordOnly('https://example.com/private'), { allowed: true, reason: 'robots-record-only-disallow' });
});

test('robots fetch converts DNS resolver failure into structured unreachable result', async () => {
  const { fetchRobotsTxt } = await import('../../src/site/fetch-robots.mjs');
  const result = await fetchRobotsTxt('https://example.com/', {
    resolver: async () => { const error = new Error('getaddrinfo EAI_AGAIN example.com'); error.code = 'EAI_AGAIN'; throw error; },
  });
  assert.equal(result.fetched, false);
  assert.equal(result.status, 0);
  assert.match(String(result.error?.message), /EAI_AGAIN/);
});

test('pinned DNS lookup follows the Node all-address callback contract', async () => {
  const lookup = createPinnedLookup('23.227.38.74');
  const all = await new Promise((resolve, reject) => {
    lookup('example.com', { all: true }, (error, records) => error ? reject(error) : resolve(records));
  });
  assert.deepEqual(all, [{ address: '23.227.38.74', family: 4 }]);

  const single = await new Promise((resolve, reject) => {
    lookup('example.com', { all: false }, (error, address, family) => error ? reject(error) : resolve({ address, family }));
  });
  assert.deepEqual(single, { address: '23.227.38.74', family: 4 });
});
