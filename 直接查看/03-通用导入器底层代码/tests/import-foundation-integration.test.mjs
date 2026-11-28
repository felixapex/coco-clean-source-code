import assert from 'node:assert/strict';
import test from 'node:test';

import { buildImportFoundationRecords } from '../scripts/lib/component-registry.mjs';

test('Web registry emits the same shared dossier without using Shopify page identity', () => {
  const result = buildImportFoundationRecords([{
    route: '/',
    sourceUrl: 'https://www.cocorepublic.com.au/',
    html: '<section id="shopify-section-home__hero" class="hero"><h1>Home</h1><a href="/sofas">Shop</a></section>',
  }], {
    platform: 'web',
    sourceOrigin: 'https://www.cocorepublic.com.au',
    importRunId: 'coco-test-run',
    functionEvidenceBySourceSectionId: {
      'home__hero': {
        actualFunctionName: '首屏横幅',
        actualFunctionTypeId: 'hero-banner',
        acceptedAliases: ['hero'],
        evidenceConfidence: 0.96,
      },
    },
  });

  assert.equal(result.pages[0].pageIdentity.sourcePageId, null);
  assert.match(result.pages[0].pageIdentity.platformPageId, /^\d{16}$/);
  assert.equal(result.pages[0].components[0].nameMatchStatus, 'matched');
  assert.equal(result.pages[0].components[0].componentTypeId, 'hero-banner');
  assert.match(result.pages[0].components[0].responsiveFingerprint, /^rsp:/);
  assert.equal(result.pages[0].components[0].schema.status, 'candidate');
  assert.ok(result.pages[0].components[0].schema.settings.length > 0);
  assert.deepEqual(result.pages[0].components[0].schema.blocks, [{ type: '@theme' }]);
  assert.ok(result.pages[0].components[0].schema.presets.length > 0);
  assert.ok(Object.keys(result.pages[0].components[0].settings).length > 0);
  assert.ok(result.pages[0].components[0].editableContract.renderedManifest.visibleValues.length > 0);
  assert.deepEqual(result.pages[0].components[0].editableContract.themeBlockTypes.sort(), ['button', 'group', 'heading', 'image', 'text', 'video']);
  assert.equal(result.pages[0].components[0].editableContract.themeBlocks, undefined);
  assert.ok(result.themeBlockCatalog.heading.presets.length > 0);
  assert.equal(result.verification.status, 'failed');
  assert.ok(result.verification.failures.some((failure) => failure.type === 'component-not-verified'));
});
