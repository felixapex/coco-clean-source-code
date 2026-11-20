import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverInternalLinks } from '../../src/site/link-discovery.mjs';

test('discoverInternalLinks keeps canonical same-origin pages and excludes assets/api/downloads', () => {
  const links = discoverInternalLinks('https://shop.example.com/', [
    '/search#filters',
    'https://shop.example.com/search?sort=price',
    '/products/oak/',
    '/products/oak#reviews',
    '/api/products',
    '/assets/app.js',
    '/catalog.pdf',
    'mailto:hello@example.com',
    'https://outside.example.com/page',
    '/',
  ]);
  assert.deepEqual(links, [
    'https://shop.example.com/search',
    'https://shop.example.com/products/oak',
    'https://shop.example.com/',
  ]);
});
