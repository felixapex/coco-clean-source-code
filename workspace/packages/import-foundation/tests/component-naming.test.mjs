import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateComponentName } from '../component-naming.mjs';

test('keeps a source component name when it matches the observed function', () => {
  const result = evaluateComponentName({
    sourceComponentName: 'hero_banner',
    actualFunctionName: '首屏横幅',
    actualFunctionTypeId: 'hero-banner',
    evidenceConfidence: 0.97,
  });

  assert.equal(result.nameMatchStatus, 'matched');
  assert.equal(result.normalizedComponentType, 'hero-banner');
  assert.equal(result.sourceComponentName, 'hero_banner');
});

test('names a component from its actual function when the source name is missing', () => {
  const result = evaluateComponentName({
    sourceComponentName: null,
    actualFunctionName: '商品网格',
    actualFunctionTypeId: 'product-grid',
    evidenceConfidence: 0.95,
  });

  assert.equal(result.nameMatchStatus, 'missing');
  assert.equal(result.normalizedComponentType, 'product-grid');
});

test('replaces a generic source name instead of treating it as a reusable type', () => {
  const result = evaluateComponentName({
    sourceComponentName: 'section-23369189458141',
    actualFunctionName: '公告滚动条',
    actualFunctionTypeId: 'announcement-bar',
    evidenceConfidence: 0.93,
  });

  assert.equal(result.nameMatchStatus, 'generic');
  assert.equal(result.normalizedComponentType, 'announcement-bar');
});

test('records a mismatch and uses the observed function type', () => {
  const result = evaluateComponentName({
    sourceComponentName: 'image-banner',
    actualFunctionName: '商品网格',
    actualFunctionTypeId: 'product-grid',
    evidenceConfidence: 0.94,
  });

  assert.equal(result.nameMatchStatus, 'mismatched');
  assert.equal(result.normalizedComponentType, 'product-grid');
  assert.match(result.decisionReason, /does not match/);
});

test('requires review when the functional evidence is weak', () => {
  const result = evaluateComponentName({
    sourceComponentName: 'gallery',
    actualFunctionName: '图片区域',
    actualFunctionTypeId: 'image-gallery',
    evidenceConfidence: 0.52,
  });

  assert.equal(result.nameMatchStatus, 'review-required');
  assert.equal(result.normalizedComponentType, null);
});

test('keeps a meaningful section-prefixed source name when evidence confirms its function', () => {
  const result = evaluateComponentName({
    sourceComponentName: 'section-product-recommendations',
    actualFunctionName: '商品推荐',
    actualFunctionTypeId: 'product-recommendations',
    acceptedAliases: ['section-product-recommendations'],
    evidenceConfidence: 0.96,
  });

  assert.equal(result.nameMatchStatus, 'matched');
  assert.equal(result.normalizedComponentType, 'product-recommendations');
});

