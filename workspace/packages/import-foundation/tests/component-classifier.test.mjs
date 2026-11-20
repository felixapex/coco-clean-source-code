import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyComponent } from '../component-classifier.mjs';

const existing = [{
  componentTypeId: 'hero-banner',
  version: '1.0.0',
  functionFingerprint: 'fn:a',
  structureInteractionFingerprint: 'si:b',
  responsiveFingerprint: 'rsp:c',
}];

test('classifies all three matching fingerprints as a duplicate', () => {
  const result = classifyComponent({
    functionFingerprint: 'fn:a',
    structureInteractionFingerprint: 'si:b',
    responsiveFingerprint: 'rsp:c',
  }, existing);

  assert.equal(result.classification, 'duplicate');
  assert.equal(result.matchedComponentTypeId, 'hero-banner');
});

test('classifies same function and interaction but different responsive fingerprint as a variant', () => {
  const result = classifyComponent({
    functionFingerprint: 'fn:a',
    structureInteractionFingerprint: 'si:b',
    responsiveFingerprint: 'rsp:d',
  }, existing);

  assert.equal(result.classification, 'variant');
  assert.equal(result.matchedComponentTypeId, 'hero-banner');
});

test('classifies a different interaction as a new component even when function matches', () => {
  const result = classifyComponent({
    functionFingerprint: 'fn:a',
    structureInteractionFingerprint: 'si:different',
    responsiveFingerprint: 'rsp:c',
  }, existing);

  assert.equal(result.classification, 'new');
  assert.equal(result.matchedComponentTypeId, null);
});

test('requires review when any fingerprint is absent', () => {
  const result = classifyComponent({
    functionFingerprint: 'fn:a',
    structureInteractionFingerprint: null,
    responsiveFingerprint: 'rsp:c',
  }, existing);

  assert.equal(result.classification, 'review-required');
});
