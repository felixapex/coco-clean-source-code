import test from 'node:test';
import assert from 'node:assert/strict';
import { crawlSite } from '../../src/site/site-crawler.mjs';

const pages = new Map([
  ['https://shop.example.com/', { links: ['/search', '/stories', '/broken'] }],
  ['https://shop.example.com/search', { links: ['/products/oak', '/'] }],
  ['https://shop.example.com/stories', { links: ['/stories/oak'] }],
  ['https://shop.example.com/products/oak', { links: [] }],
  ['https://shop.example.com/stories/oak', { links: [] }],
]);

const resolver = async () => [{ address: '93.184.216.34', family: 4 }];

test('crawlSite performs deterministic same-origin BFS, caps pages, and isolates page failures', async () => {
  const seen = [];
  const captureFn = async (url) => {
    seen.push(url);
    if (url.endsWith('/broken')) throw new Error('fixture failure');
    const page = pages.get(url);
    if (!page) throw new Error(`missing fixture ${url}`);
    return { metadata: { title: url }, links: page.links, componentCandidates: [] };
  };
  const result = await crawlSite({
    startUrl: 'https://shop.example.com/',
    captureFn,
    resolver,
    maxPages: 4,
  });
  assert.deepEqual(result.pages.map((p) => p.url), [
    'https://shop.example.com/',
    'https://shop.example.com/search',
    'https://shop.example.com/stories',
    'https://shop.example.com/products/oak',
  ]);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].url, 'https://shop.example.com/broken');
  assert.equal(seen.includes('https://outside.example.com/'), false);
});

test('crawlSite retries a transient capture failure once before recording an error', async () => {
  let attempts = 0;
  const captureFn = async (url) => {
    attempts++;
    if (attempts === 1) throw new Error('transient chromium startup');
    return { metadata: { title: 'Recovered' }, links: [], componentCandidates: [] };
  };
  const result = await crawlSite({
    startUrl: 'https://shop.example.com/',
    captureFn,
    resolver,
    maxPages: 1,
    captureRetries: 1,
  });
  assert.equal(attempts, 2);
  assert.equal(result.pages.length, 1);
  assert.equal(result.errors.length, 0);
});
