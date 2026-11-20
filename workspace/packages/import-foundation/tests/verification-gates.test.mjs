import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REQUIRED_UNIT_GATES,
  evaluatePageVerification,
  evaluateSiteVerification,
  evaluateUnitVerification,
} from '../verification-gates.mjs';

const passedUnitEvidence = Object.fromEntries(REQUIRED_UNIT_GATES.map((gate) => [gate, { pass: true }]));

test('unit verification fails closed when any required component gate is absent', () => {
  const evidence = { ...passedUnitEvidence };
  delete evidence.schema;
  const result = evaluateUnitVerification(evidence);
  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, [{ gate: 'schema', type: 'missing-gate-evidence' }]);
});

test('page verification requires accepted components, desktop and mobile, and every control result', () => {
  const result = evaluatePageVerification({
    componentIds: ['header', 'hero'],
    acceptedComponentIds: ['header'],
    viewports: {
      desktop: { visual: { pass: true }, geometry: { pass: true } },
      mobile: { visual: { pass: true }, geometry: { pass: true } },
    },
    interactions: { pass: true, total: 4, verified: 3 },
  });

  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.type === 'unverified-component'));
  assert.ok(result.failures.some((failure) => failure.type === 'incomplete-control-coverage'));
});

test('site verification cannot pass by skipping component or page verification', () => {
  const result = evaluateSiteVerification({
    publicResources: { pass: true },
    components: [{ id: 'hero', status: 'failed' }],
    pages: [{ platformPageId: '1234567890123456', status: 'passed' }],
    site: { status: 'passed', routeCoverage: 1, interactionCoverage: 1, escapedSourceLinks: 0 },
  });

  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.type === 'component-not-verified'));
});

test('site verification passes only when all four layers pass', () => {
  const result = evaluateSiteVerification({
    publicResources: { pass: true },
    components: [{ id: 'hero', status: 'passed' }],
    pages: [{ platformPageId: '1234567890123456', status: 'passed' }],
    site: { status: 'passed', routeCoverage: 1, interactionCoverage: 1, escapedSourceLinks: 0 },
  });

  assert.equal(result.pass, true);
  assert.equal(result.status, 'passed');
});

