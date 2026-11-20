import test from 'node:test';
import assert from 'node:assert/strict';
import { inferFamilyDefinition } from '../../src/component/family-inference.mjs';

const members = [
  {
    id: 'oak', routeId: 'route-home', semanticRole: 'product-card', variant: 'default',
    structure: { slots: ['media','title','meta','actions'] },
    content: { title: 'Oak Chair', price: '$199', media: '/oak.jpg', actionLabels: ['Favorite'] },
  },
  {
    id: 'walnut', routeId: 'route-search', semanticRole: 'product-card', variant: 'compact',
    structure: { slots: ['media','title','meta','actions'] },
    content: { title: 'Walnut Chair', price: '$249', media: '/walnut.jpg', actionLabels: [] },
  },
];

test('inferFamilyDefinition derives canonical props, routes, slots and variants', () => {
  const family = inferFamilyDefinition(members, {
    id: 'family-1', semanticRole: 'product-card', confidence: 0.91, fingerprints: ['a','b'],
  });
  assert.equal(family.canonicalName, 'ProductCard');
  assert.deepEqual(new Set(family.routeIds), new Set(['route-home','route-search']));
  assert.deepEqual(new Set(family.variants), new Set(['default','compact']));
  assert.equal(family.propsSchema.title.type, 'string');
  assert.equal(family.propsSchema.title.required, true);
  assert.equal(family.propsSchema.price.type, 'money');
  assert.equal(family.propsSchema.media.type, 'asset');
  assert.equal(family.propsSchema.actionLabels.type, 'string[]');
  assert.equal(family.propsSchema.actionLabels.required, false);
});

test('inferFamilyDefinition keeps variants separate from observed runtime states', () => {
  const family = inferFamilyDefinition([
    { ...members[0], stateNames: ['hover', 'selected'] },
    { ...members[1], stateNames: ['hover'] },
  ], { id: 'family-2', semanticRole: 'product-card', confidence: 0.9, fingerprints: [] });
  assert.deepEqual(new Set(family.variants), new Set(['default','compact']));
  assert.deepEqual(new Set(family.states), new Set(['default','hover','selected']));
});

test('inferFamilyDefinition builds deterministic root/slot style profiles with variant overrides', () => {
  const styled = [
    {
      ...members[0],
      style: { display: 'block', paddingTop: '20px', backgroundColor: 'rgb(250, 240, 230)', borderRadius: '18px', color: 'rgb(30, 30, 30)' },
      slotStyles: { title: { fontSize: '24px', fontWeight: '700' }, price: { fontSize: '18px', color: 'rgb(120, 40, 20)' } },
    },
    {
      ...members[0], id: 'oak-2', routeId: 'route-search',
      style: { display: 'block', paddingTop: '20px', backgroundColor: 'rgb(250, 240, 230)', borderRadius: '18px', color: 'rgb(30, 30, 30)' },
      slotStyles: { title: { fontSize: '24px', fontWeight: '700' }, price: { fontSize: '18px', color: 'rgb(120, 40, 20)' } },
    },
    {
      ...members[1],
      style: { display: 'block', paddingTop: '10px', backgroundColor: 'rgb(250, 240, 230)', borderRadius: '12px', color: 'rgb(30, 30, 30)' },
      slotStyles: { title: { fontSize: '20px', fontWeight: '700' }, price: { fontSize: '16px', color: 'rgb(120, 40, 20)' } },
    },
  ];
  const family = inferFamilyDefinition(styled, { id: 'family-style', semanticRole: 'product-card', confidence: 0.95, fingerprints: [] });
  assert.equal(family.styleProfile.root.paddingTop, '20px');
  assert.equal(family.styleProfile.root.borderRadius, '18px');
  assert.equal(family.styleProfile.slots.title.fontSize, '24px');
  assert.equal(family.styleProfile.variants.compact.root.paddingTop, '10px');
  assert.equal(family.styleProfile.variants.compact.slots.title.fontSize, '20px');
});
