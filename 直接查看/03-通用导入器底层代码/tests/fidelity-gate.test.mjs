import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFidelityGate, visualReadinessParity } from '../scripts/lib/fidelity-gate.mjs';
import { fidelityViewports } from '../scripts/lib/audit-viewports.mjs';

test('fidelity audit includes a real wide desktop that exposes captured-width layout drift', () => {
  assert.deepEqual(Object.keys(fidelityViewports), ['desktop', 'wide', 'mobile']);
  assert.deepEqual(fidelityViewports.wide, { width: 1908, height: 1000, mobile: false });
});

test('fidelity gate passes only when similarity, size, readiness, and interaction inventory pass', () => {
  const passing = evaluateFidelityGate({ similarity: 0.951, exactSize: true, readinessOk: true, interactionInventoryOk: true });
  assert.equal(passing.pass, true);
  assert.deepEqual(passing.failures, []);
});

test('readiness parity requires complete resources but permits final DOM image-count growth', () => {
  const original = { fontsReady: true, pendingImages: 0, pendingStylesheets: 0, imageCount: 74, stylesheetCount: 8, documentHeight: 3480 };
  assert.equal(visualReadinessParity(original, { ...original, imageCount: 81 }), true);
  assert.equal(visualReadinessParity(original, { ...original, pendingStylesheets: 1 }), false);
  assert.equal(visualReadinessParity(original, { ...original, failedStylesheets: 1 }), false);
  assert.equal(visualReadinessParity(original, { ...original, uncapturedStylesheets: 1 }), false);
  assert.equal(visualReadinessParity(original, { ...original, pendingImages: 1 }), false);
  assert.equal(visualReadinessParity(original, { ...original, failedImages: 1 }), false);
  assert.equal(visualReadinessParity(original, { ...original, fontsReady: false }), false);
  const sourceWithOnePendingSheet = { ...original, pendingStylesheets: 1 };
  assert.equal(visualReadinessParity(sourceWithOnePendingSheet, original), true);
  assert.equal(visualReadinessParity(sourceWithOnePendingSheet, { ...original, pendingStylesheets: 2 }), false);
});

test('fidelity gate reports every failed dimension', () => {
  const result = evaluateFidelityGate({ similarity: 0.949, exactSize: false, readinessOk: false, interactionInventoryOk: false });
  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, ['similarity<0.95', 'size-mismatch', 'visual-readiness-failed', 'interaction-inventory-mismatch']);
});
