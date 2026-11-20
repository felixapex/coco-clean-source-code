import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assignPageIdentity,
  createEmptyPageIdentityRegistry,
  normalizeSourcePageIdentity,
} from '../page-identity.mjs';

test('keeps source page id separate and creates numeric import and platform ids', () => {
  const result = assignPageIdentity({
    platform: 'shopify',
    sourcePageId: 'gid://shopify/Page/42',
    sourceUrl: 'https://Example.com/pages/about/?utm_source=test',
    sourcePageName: 'About',
    importRunId: 'run-001',
  }, createEmptyPageIdentityRegistry());

  assert.equal(result.record.sourcePageId, 'gid://shopify/Page/42');
  assert.match(result.record.importPageId, /^\d{16}$/);
  assert.match(result.record.platformPageId, /^\d{16}$/);
  assert.notEqual(result.record.sourcePageId, result.record.platformPageId);
  assert.equal(result.record.sourceUrl, 'https://example.com/pages/about');
});

test('reuses the permanent platform id when the same source id is reimported from a changed url', () => {
  const first = assignPageIdentity({
    platform: 'shopify',
    sourcePageId: 'page-42',
    sourceUrl: 'https://shop.example/pages/about',
    importRunId: 'run-001',
  }, createEmptyPageIdentityRegistry());
  const second = assignPageIdentity({
    platform: 'shopify',
    sourcePageId: 'page-42',
    sourceUrl: 'https://shop.example/pages/about-us?utm_campaign=new',
    importRunId: 'run-002',
  }, first.registry);

  assert.equal(second.record.platformPageId, first.record.platformPageId);
  assert.notEqual(second.record.importPageId, first.record.importPageId);
  assert.equal(second.registry.pages[second.record.identityKey].sourceUrl, 'https://shop.example/pages/about-us');
});

test('normalizes tracking parameters and trailing slash before identifying a page without a source id', () => {
  const a = normalizeSourcePageIdentity({
    platform: 'web',
    sourceUrl: 'https://EXAMPLE.com/products/chair/?utm_source=x&color=oak#details',
  });
  const b = normalizeSourcePageIdentity({
    platform: 'web',
    sourceUrl: 'https://example.com/products/chair?color=oak',
  });

  assert.equal(a.sourcePageId, null);
  assert.equal(a.identityKey, b.identityKey);
  assert.equal(a.sourceUrl, 'https://example.com/products/chair?color=oak');
});

test('resolves generated id collisions without overwriting the existing page', () => {
  const idFactory = (_seed, attempt) => attempt === 0 ? '1111111111111111' : '2222222222222222';
  const first = assignPageIdentity({
    platform: 'web',
    sourceUrl: 'https://example.com/a',
    importRunId: 'run-a',
  }, createEmptyPageIdentityRegistry(), { idFactory });
  const second = assignPageIdentity({
    platform: 'web',
    sourceUrl: 'https://example.com/b',
    importRunId: 'run-b',
  }, first.registry, { idFactory });

  assert.equal(first.record.platformPageId, '1111111111111111');
  assert.equal(second.record.platformPageId, '2222222222222222');
  assert.equal(Object.keys(second.registry.pages).length, 2);
  assert.equal(second.registry.platformIds['1111111111111111'], first.record.identityKey);
  assert.equal(second.registry.platformIds['2222222222222222'], second.record.identityKey);
});

test('rejects a missing source url instead of using a page name as identity', () => {
  assert.throws(() => normalizeSourcePageIdentity({
    platform: 'web',
    sourcePageName: 'Home',
  }), /sourceUrl is required/);
});
