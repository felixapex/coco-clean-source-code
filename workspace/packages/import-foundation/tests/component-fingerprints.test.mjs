import assert from 'node:assert/strict';
import test from 'node:test';

import { createComponentFingerprints } from '../component-fingerprints.mjs';

const base = {
  function: { purpose: 'hero-banner', capabilities: ['link', 'autoplay', 'carousel'] },
  structureInteraction: {
    tree: { role: 'region', children: [{ role: 'heading' }, { role: 'link' }] },
    interactions: [{ control: 'next', resultType: 'carousel-slide' }],
  },
  responsive: {
    aspectRatios: ['16:9'],
    breakpoints: [{ min: 0, columns: 1 }, { min: 990, columns: 1 }],
    crop: 'cover',
  },
};

test('creates stable fingerprints when unordered capability input changes order', () => {
  const first = createComponentFingerprints(base);
  const second = createComponentFingerprints({
    ...base,
    function: { purpose: 'hero-banner', capabilities: ['carousel', 'link', 'autoplay'] },
  });

  assert.equal(first.functionFingerprint, second.functionFingerprint);
  assert.equal(first.structureInteractionFingerprint, second.structureInteractionFingerprint);
  assert.equal(first.responsiveFingerprint, second.responsiveFingerprint);
  assert.match(first.functionFingerprint, /^fn:[a-f0-9]{64}$/);
});

test('changes the structure interaction fingerprint when click outcome changes', () => {
  const first = createComponentFingerprints(base);
  const second = createComponentFingerprints({
    ...base,
    structureInteraction: {
      ...base.structureInteraction,
      interactions: [{ control: 'next', resultType: 'external-navigation' }],
    },
  });

  assert.equal(first.functionFingerprint, second.functionFingerprint);
  assert.notEqual(first.structureInteractionFingerprint, second.structureInteractionFingerprint);
});

test('changes only the responsive fingerprint for a layout ratio variant', () => {
  const first = createComponentFingerprints(base);
  const second = createComponentFingerprints({
    ...base,
    responsive: { ...base.responsive, aspectRatios: ['4:3'] },
  });

  assert.equal(first.functionFingerprint, second.functionFingerprint);
  assert.equal(first.structureInteractionFingerprint, second.structureInteractionFingerprint);
  assert.notEqual(first.responsiveFingerprint, second.responsiveFingerprint);
});

