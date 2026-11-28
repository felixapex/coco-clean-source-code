import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseImportArguments,
  selectImporter,
} from '../scripts/importers/select-importer.mjs';

test('each explicit platform selects only its own importer', () => {
  assert.equal(selectImporter('shopify').platform, 'shopify');
  assert.equal(selectImporter('web').platform, 'web');
  assert.equal(selectImporter('wix').platform, 'wix');
});

test('unknown or missing platforms fail instead of falling back to the web importer', () => {
  assert.throws(() => selectImporter(), /explicit import platform/i);
  assert.throws(() => selectImporter('auto'), /unsupported import platform/i);
  assert.throws(() => selectImporter('wordpress'), /unsupported import platform/i);
});

test('pipeline arguments require a platform and preserve the selected import mode', () => {
  assert.deepEqual(
    parseImportArguments([
      '--platform=web',
      '--mode=layout-learning',
      'https://example.com/catalog',
    ], {}),
    {
      platform: 'web',
      mode: 'layout-learning',
      sourceUrl: 'https://example.com/catalog',
    },
  );
  assert.throws(
    () => parseImportArguments(['https://example.com'], {}),
    /--platform=shopify\|wix\|web/i,
  );
});

test('Wix importer fails closed before capture until its implementation exists', async () => {
  const importer = selectImporter('wix');
  await assert.rejects(
    () => importer.prepare({
      platform: 'wix',
      mode: 'authorized',
      sourceUrl: 'https://example.wixsite.com/store',
    }),
    /Wix importer is not implemented/i,
  );
});

test('Shopify and generic web importers produce isolated explicit contexts', async () => {
  const shopify = await selectImporter('shopify').prepare({
    platform: 'shopify',
    mode: 'authorized',
    sourceUrl: 'https://store.example/products/a',
  });
  const web = await selectImporter('web').prepare({
    platform: 'web',
    mode: 'layout-learning',
    sourceUrl: 'https://example.com/catalog',
  });
  assert.equal(shopify.platform, 'shopify');
  assert.equal(web.platform, 'web');
  assert.equal(shopify.sourceOrigin, 'https://store.example');
  assert.equal(web.sourceOrigin, 'https://example.com');
  assert.notEqual(shopify.importerId, web.importerId);
});
