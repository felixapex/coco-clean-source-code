import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBaselineEvidence, evaluateSelfVerification } from '../scripts/lib/self-verification-gate.mjs';

test('baseline evidence fails closed when a required viewport is missing', () => {
  const result = evaluateBaselineEvidence({
    requiredRoutes: ['/'],
    requiredViewports: ['desktop', 'wide', 'mobile'],
    captures: [
      { route: '/', viewport: 'desktop', status: 'passed' },
      { route: '/', viewport: 'mobile', status: 'passed' },
    ],
  });

  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, [{ type: 'missing-baseline-cell', route: '/', viewport: 'wide' }]);
  assert.deepEqual(result.coverage, { required: 3, passed: 2, missing: 1, errored: 0 });
});

test('baseline evidence exposes source capture errors and does not count them as coverage', () => {
  const result = evaluateBaselineEvidence({
    requiredRoutes: ['/'],
    requiredViewports: ['wide'],
    captures: [{ route: '/', viewport: 'wide', status: 'error', error: 'net::ERR_CONNECTION_RESET' }],
  });

  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, [{
    type: 'baseline-capture-error',
    route: '/',
    viewport: 'wide',
    error: 'net::ERR_CONNECTION_RESET',
  }]);
  assert.deepEqual(result.coverage, { required: 1, passed: 0, missing: 0, errored: 1 });
});

test('baseline evidence passes only with every required route and viewport', () => {
  const result = evaluateBaselineEvidence({
    requiredRoutes: ['/', '/sofas'],
    requiredViewports: ['desktop', 'mobile'],
    captures: [
      { route: '/', viewport: 'desktop', status: 'passed' },
      { route: '/', viewport: 'mobile', status: 'passed' },
      { route: '/sofas', viewport: 'desktop', status: 'passed' },
      { route: '/sofas', viewport: 'mobile', status: 'passed' },
    ],
  });

  assert.equal(result.pass, true);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.coverage, { required: 4, passed: 4, missing: 0, errored: 0 });
});

test('a failed component blocks release even when page and site checks pass', () => {
  const report = evaluateSelfVerification({
    baseline: { pass: true, failures: [], coverage: { required: 1, passed: 1, missing: 0, errored: 0 } },
    components: [{ route: '/', componentId: 'sale-grid', viewport: 'wide', pass: false, failures: ['row-signature-mismatch'] }],
    pages: [{ route: '/', viewport: 'wide', pass: true, similarity: 0.98 }],
    site: { routeCoverage: 1, escapedSourceLinks: 0, missingRoutes: 0, interactionCoverage: 1, pass: true },
  });

  assert.equal(report.pass, false);
  assert.deepEqual(report.failures, [{
    type: 'component-verification-failed', route: '/', componentId: 'sale-grid', viewport: 'wide', failures: ['row-signature-mismatch'],
  }]);
});

test('release requires complete routes and interactions in addition to visual similarity', () => {
  const report = evaluateSelfVerification({
    baseline: { pass: true, failures: [], coverage: { required: 1, passed: 1, missing: 0, errored: 0 } },
    components: [{ route: '/', componentId: 'hero', viewport: 'desktop', pass: true, similarity: 0.97 }],
    pages: [{ route: '/', viewport: 'desktop', pass: true, similarity: 0.98 }],
    site: { routeCoverage: 0.99, escapedSourceLinks: 0, missingRoutes: 1, interactionCoverage: 0.98, pass: false },
  });

  assert.equal(report.pass, false);
  assert.deepEqual(report.failures, [
    { type: 'route-coverage-incomplete', coverage: 0.99, missingRoutes: 1 },
    { type: 'interaction-coverage-incomplete', coverage: 0.98 },
  ]);
});

test('release cannot pass without component and page evidence', () => {
  const report = evaluateSelfVerification({
    baseline: { pass: true, failures: [], coverage: { required: 1, passed: 1, missing: 0, errored: 0 } },
    components: [],
    pages: [],
    site: { routeCoverage: 1, escapedSourceLinks: 0, missingRoutes: 0, interactionCoverage: 1, pass: true },
  });

  assert.equal(report.pass, false);
  assert.deepEqual(report.failures, [
    { type: 'component-evidence-missing' },
    { type: 'page-evidence-missing' },
  ]);
});

test('a component below 95 percent fails even if its caller marked it passed', () => {
  const report = evaluateSelfVerification({
    baseline: { pass: true, failures: [], coverage: { required: 1, passed: 1, missing: 0, errored: 0 } },
    components: [{ route: '/', componentId: 'hero', viewport: 'wide', pass: true, similarity: 0.949 }],
    pages: [{ route: '/', viewport: 'wide', pass: true, similarity: 0.98 }],
    site: { routeCoverage: 1, escapedSourceLinks: 0, missingRoutes: 0, interactionCoverage: 1, pass: true },
  });

  assert.equal(report.pass, false);
  assert.deepEqual(report.failures, [{
    type: 'component-visual-threshold-failed', route: '/', componentId: 'hero', viewport: 'wide', similarity: 0.949, threshold: 0.95,
  }]);
});

test('any source-domain escape blocks release', () => {
  const report = evaluateSelfVerification({
    baseline: { pass: true, failures: [], coverage: { required: 1, passed: 1, missing: 0, errored: 0 } },
    components: [{ route: '/', componentId: 'hero', viewport: 'wide', pass: true, similarity: 0.97 }],
    pages: [{ route: '/', viewport: 'wide', pass: true, similarity: 0.98 }],
    site: { routeCoverage: 1, escapedSourceLinks: 2, missingRoutes: 0, interactionCoverage: 1, pass: false },
  });

  assert.equal(report.pass, false);
  assert.deepEqual(report.failures, [{ type: 'source-link-escape', count: 2 }]);
});
