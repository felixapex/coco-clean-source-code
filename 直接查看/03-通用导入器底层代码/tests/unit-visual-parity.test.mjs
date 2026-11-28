import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateUnitVisualParity,
  validateCriticalImageEvidence,
} from '../scripts/lib/unit-visual-parity.mjs';

function validPair() {
  return {
    route: '/',
    componentId: 'sale-grid',
    viewport: 'desktop',
    threshold: 0.95,
    source: {
      screenshot: 'source/sale-grid.png',
      rect: { x: 0, y: 600, width: 1908, height: 720 },
      viewportWidth: 1908,
      contentRight: 1908,
      textKeys: ['shop-the-sale', 'sofas', 'bedroom'],
      imageKeys: ['sofas', 'bedroom'],
      overlapCount: 0,
    },
    local: {
      screenshot: 'local/sale-grid.png',
      diff: 'diff/sale-grid.png',
      rect: { x: 0, y: 600, width: 1908, height: 720 },
      viewportWidth: 1908,
      contentRight: 1908,
      textKeys: ['shop-the-sale', 'sofas', 'bedroom'],
      imageKeys: ['sofas', 'bedroom'],
      overlapCount: 0,
      similarity: 0.97,
    },
  };
}

test('component visual parity fails asymmetric right-side blank space', () => {
  const input = validPair();
  input.local.contentRight = 1430;

  const result = evaluateUnitVisualParity(input);

  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, [{
    type: 'right-blank-space-mismatch', sourceBlank: 0, localBlank: 478, tolerance: 4,
  }]);
});

test('component visual parity fails newly overlapping text', () => {
  const input = validPair();
  input.local.overlapCount = 2;

  const result = evaluateUnitVisualParity(input);

  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, [{ type: 'text-overlap-mismatch', sourceCount: 0, localCount: 2 }]);
});

test('component visual parity fails wrong component geometry', () => {
  const input = validPair();
  input.local.rect.width = 1600;

  const result = evaluateUnitVisualParity(input);

  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, [{
    type: 'component-geometry-mismatch',
    source: input.source.rect,
    local: input.local.rect,
    tolerance: 4,
  }]);
});

test('component visual parity fails missing text and images', () => {
  const input = validPair();
  input.local.textKeys = ['shop-the-sale'];
  input.local.imageKeys = ['sofas'];

  const result = evaluateUnitVisualParity(input);

  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, [
    { type: 'missing-component-text', keys: ['sofas', 'bedroom'] },
    { type: 'missing-component-images', keys: ['bedroom'] },
  ]);
});

test('component visual parity fails below 95 percent similarity', () => {
  const input = validPair();
  input.local.similarity = 0.949;

  const result = evaluateUnitVisualParity(input);

  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, [{ type: 'component-similarity-below-threshold', similarity: 0.949, threshold: 0.95 }]);
});

test('critical navigation imagery rejects page rectangles and unknown legacy provenance', () => {
  assert.deepEqual(validateCriticalImageEvidence({
    context: 'navigation', provenance: 'page-rectangle', containsPageChrome: true,
  }), {
    pass: false,
    failures: [{ type: 'page-screenshot-used-as-navigation-image' }],
  });
  assert.deepEqual(validateCriticalImageEvidence({
    context: 'navigation', provenance: '', containsPageChrome: false,
  }), {
    pass: false,
    failures: [{ type: 'unverified-critical-image-provenance' }],
  });
  assert.deepEqual(validateCriticalImageEvidence({
    context: 'navigation', provenance: 'direct-image-response', containsPageChrome: false,
  }), { pass: true, failures: [] });
});

test('complete component evidence passes and retains screenshot paths', () => {
  const result = evaluateUnitVisualParity(validPair());

  assert.equal(result.pass, true);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.evidence, {
    source: 'source/sale-grid.png',
    local: 'local/sale-grid.png',
    diff: 'diff/sale-grid.png',
  });
});
