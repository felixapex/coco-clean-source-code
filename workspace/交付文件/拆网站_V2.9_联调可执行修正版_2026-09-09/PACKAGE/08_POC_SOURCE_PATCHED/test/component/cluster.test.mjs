import test from 'node:test';
import assert from 'node:assert/strict';
import { clusterCandidates } from '../../src/component/cluster.mjs';

const card = (id, padding) => ({
  id, semanticRole: 'product-card',
  structure: { tag: 'article', childRoles: ['img','heading','price','button'], slots: ['media','title','meta','actions'] },
  style: { display: 'flex', borderRadius: 8, gap: 12, padding },
  visual: { aspectRatioBucket: 'landscape', density: padding === 16 ? 'medium' : 'compact' },
  behavior: { role: 'group', sideEffectClass: 'none', actions: ['favorite'] },
});

test('clusterCandidates groups compatible variants and keeps incompatible actions separate', () => {
  const candidates = [
    card('card-home', 16),
    card('card-search', 12),
    { id: 'nav', semanticRole: 'navigation-control', structure: { tag: 'button', slots: ['label'] }, style: { display: 'inline-flex', borderRadius: 8 }, visual: { shape: 'pill' }, behavior: { role: 'button', sideEffectClass: 'navigation', actions: ['navigate'] } },
    { id: 'buy', semanticRole: 'purchase-action', structure: { tag: 'button', slots: ['label'] }, style: { display: 'inline-flex', borderRadius: 8 }, visual: { shape: 'pill' }, behavior: { role: 'button', sideEffectClass: 'network-write', actions: ['purchase'] } },
  ];
  const families = clusterCandidates(candidates, { threshold: 0.75 });
  const cardFamily = families.find((f) => f.memberIds.includes('card-home'));
  assert.deepEqual(new Set(cardFamily.memberIds), new Set(['card-home','card-search']));
  assert.equal(families.find((f) => f.memberIds.includes('nav')).memberIds.length, 1);
  assert.equal(families.find((f) => f.memberIds.includes('buy')).memberIds.length, 1);
});
