import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFingerprint, compareFingerprints } from '../../src/component/fingerprint.mjs';

const baseCard = {
  semanticRole: 'product-card',
  structure: { tag: 'article', childRoles: ['img','heading','price','button'], slots: ['media','title','meta','actions'] },
  style: { display: 'flex', borderRadius: 8, gap: 12, padding: 16, background: '#fff' },
  visual: { aspectRatioBucket: 'landscape', density: 'medium' },
  behavior: { role: 'group', sideEffectClass: 'none', actions: ['favorite'] },
};

test('buildFingerprint is deterministic regardless of object key order', () => {
  const a = buildFingerprint(baseCard);
  const b = buildFingerprint({
    behavior: baseCard.behavior,
    visual: baseCard.visual,
    style: { background: '#fff', padding: 16, gap: 12, borderRadius: 8, display: 'flex' },
    structure: baseCard.structure,
    semanticRole: baseCard.semanticRole,
  });
  assert.equal(a.hash, b.hash);
});

test('similar ProductCard variants remain compatible and score highly', () => {
  const a = buildFingerprint(baseCard);
  const b = buildFingerprint({
    ...baseCard,
    style: { ...baseCard.style, padding: 12, background: '#f8f8f8' },
    visual: { aspectRatioBucket: 'landscape', density: 'compact' },
    behavior: { ...baseCard.behavior, actions: ['favorite','open-menu'] },
  });
  const result = compareFingerprints(a, b);
  assert.equal(result.compatible, true);
  assert.ok(result.score >= 0.75, result.score);
});

test('visual similarity cannot merge navigation and write actions', () => {
  const nav = buildFingerprint({
    semanticRole: 'navigation-control', structure: { tag: 'button', slots: ['label'] },
    style: { display: 'inline-flex', borderRadius: 8 }, visual: { shape: 'pill' },
    behavior: { role: 'button', sideEffectClass: 'navigation', actions: ['navigate'] },
  });
  const buy = buildFingerprint({
    semanticRole: 'purchase-action', structure: { tag: 'button', slots: ['label'] },
    style: { display: 'inline-flex', borderRadius: 8 }, visual: { shape: 'pill' },
    behavior: { role: 'button', sideEffectClass: 'network-write', actions: ['purchase'] },
  });
  const result = compareFingerprints(nav, buy);
  assert.equal(result.compatible, false);
  assert.ok(result.score < 0.75);
});
