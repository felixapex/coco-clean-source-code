import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyIr, validateComponentIr } from '../../src/ir/component-ir.mjs';

test('createEmptyIr creates a valid minimal Component IR', () => {
  const ir = createEmptyIr({ id: 'site-1', sourceUrl: 'https://example.com/', capturedAt: '2026-08-17T00:00:00Z' });
  const result = validateComponentIr(ir);
  assert.equal(result.ok, true, result.errors.join('\n'));
});

test('validator rejects confidence outside 0..1 and missing evidence references', () => {
  const ir = createEmptyIr({ id: 'site-1', sourceUrl: 'https://example.com/', capturedAt: '2026-08-17T00:00:00Z' });
  ir.componentFamilies.push({
    id: 'fam-1', canonicalName: 'ProductCard', semanticRole: 'product-card', confidence: 1.2,
    propsSchema: {}, slots: [], variants: ['default'], states: ['default'], fingerprints: {}, evidenceIds: ['missing']
  });
  const result = validateComponentIr(ir);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /confidence/i.test(e)));
  assert.ok(result.errors.some((e) => /missing evidence/i.test(e)));
});

test('validator enforces variant/state conceptual separation', () => {
  const ir = createEmptyIr({ id: 'site-1', sourceUrl: 'https://example.com/', capturedAt: '2026-08-17T00:00:00Z' });
  ir.evidence.push({ id: 'ev-1', type: 'dom', source: 'capture' });
  ir.componentFamilies.push({
    id: 'fam-1', canonicalName: 'Button', semanticRole: 'button', confidence: 0.9,
    propsSchema: {}, slots: [], variants: ['hover'], states: ['hover'], fingerprints: {}, evidenceIds: ['ev-1']
  });
  const result = validateComponentIr(ir);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /both variant and state/i.test(e)));
});

test('validator rejects dangling parent/child component instance hierarchy references', () => {
  const ir = createEmptyIr({ id: 'site-1', sourceUrl: 'https://example.com/', capturedAt: '2026-08-17T00:00:00Z' });
  ir.routes.push({ id: 'route-home', path: '/', sections: [], evidenceIds: [] });
  ir.evidence.push({ id: 'ev-1', type: 'dom', source: 'capture' });
  ir.componentFamilies.push({
    id: 'fam-nav', canonicalName: 'Navigation', semanticRole: 'navigation', confidence: 0.9,
    propsSchema: {}, slots: [], variants: ['default'], states: ['default'], fingerprints: {}, evidenceIds: ['ev-1']
  });
  ir.componentInstances.push({
    id: 'inst-nav', familyId: 'fam-nav', routeId: 'route-home', evidenceIds: ['ev-1'],
    parentInstanceId: 'missing-parent', childInstanceIds: ['missing-child']
  });
  const result = validateComponentIr(ir);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /missing parent instance/i.test(e)));
  assert.ok(result.errors.some((e) => /missing child instance/i.test(e)));
});
