import test from 'node:test';
import assert from 'node:assert/strict';
import { crawlSite } from '../../src/site/site-crawler.mjs';

const resolver = async () => [{ address: '93.184.216.34', family: 4 }];

test('crawler skips routes denied by visit policy without recording capture error', async () => {
  const seen = [];
  const captures = new Map([
    ['https://example.com/', { links: ['/public', '/private'] }],
    ['https://example.com/public', { links: [] }],
    ['https://example.com/private', { links: [] }],
  ]);
  const crawl = await crawlSite({
    startUrl: 'https://example.com/',
    resolver,
    captureFn: async (url) => { seen.push(url); return captures.get(url); },
    visitPolicy: async (url) => ({ allowed: !url.endsWith('/private'), reason: 'robots-disallow' }),
  });
  assert.deepEqual(seen, ['https://example.com/', 'https://example.com/public']);
  assert.equal(crawl.errors.length, 0);
  assert.deepEqual(crawl.skipped, [{ url: 'https://example.com/private', reason: 'robots-disallow' }]);
});
