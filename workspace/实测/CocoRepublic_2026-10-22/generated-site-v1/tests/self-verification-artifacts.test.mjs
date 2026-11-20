import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleSelfVerificationEvidence } from '../scripts/lib/self-verification-artifacts.mjs';

function passingArtifacts() {
  return {
    requiredViewports: ['desktop', 'wide', 'mobile'],
    inventory: { routeCount: 1, routes: ['/'] },
    routeManifest: { '/': 'route-home.html' },
    goldenCaptures: [
      { route: '/', viewport: 'desktop', status: 'passed' },
      { route: '/', viewport: 'wide', status: 'passed' },
      { route: '/', viewport: 'mobile', status: 'passed' },
    ],
    componentFidelity: { results: [{ route: '/', componentId: 'hero', viewport: 'desktop', pass: true, similarity: 0.97 }] },
    fidelity: { results: [{ route: '/', viewport: 'desktop', pass: true, similarity: 0.98 }], errors: [] },
    responsive: { pass: true, routeCount: 1, cells: [{ route: '/', width: 1440, pass: true }] },
    links: { pass: true, escapedSourceRouteCount: 0, uncapturedLocalRouteCount: 0 },
    clickAudit: { pass: true, visibleControlInstances: 10, clickedButtonInstances: 4, failures: [] },
    parity: { pass: true, sourceControlCount: 10, comparedControlCount: 10, failures: [] },
    componentReport: { routeCount: 1, coverage: 1, unmappedSectionCount: 0, reassemblyFailureCount: 0 },
  };
}

test('artifact assembly produces a passing self-verification report only from complete evidence', () => {
  const report = assembleSelfVerificationEvidence(passingArtifacts());
  assert.equal(report.pass, true);
  assert.equal(report.status, 'passed');
  assert.deepEqual(report.summary.baseline, { required: 3, passed: 3, missing: 0, errored: 0 });
  assert.equal(report.summary.components.checked, 1);
  assert.equal(report.summary.pages.checked, 1);
  assert.equal(report.summary.site.routeCoverage, 1);
  assert.equal(report.summary.site.interactionCoverage, 1);
});

test('artifact assembly preserves source capture errors and missing viewport evidence', () => {
  const artifacts = passingArtifacts();
  artifacts.goldenCaptures = [
    { route: '/', viewport: 'desktop', status: 'passed' },
    { route: '/', viewport: 'wide', status: 'error', error: 'net::ERR_CONNECTION_RESET' },
  ];
  const report = assembleSelfVerificationEvidence(artifacts);

  assert.equal(report.pass, false);
  assert.ok(report.failures.some((failure) => failure.type === 'baseline-capture-error' && failure.viewport === 'wide'));
  assert.ok(report.failures.some((failure) => failure.type === 'missing-baseline-cell' && failure.viewport === 'mobile'));
});

test('artifact assembly exposes route and interaction coverage instead of trusting unrelated pass flags', () => {
  const artifacts = passingArtifacts();
  artifacts.inventory = { routeCount: 4, routes: ['/', '/a', '/b', '/c'] };
  artifacts.routeManifest = { '/': 'route-home.html', '/a': 'route-a.html' };
  artifacts.goldenCaptures = artifacts.inventory.routes.flatMap((route) => artifacts.requiredViewports.map((viewport) => ({ route, viewport, status: 'passed' })));
  artifacts.parity = { pass: false, sourceControlCount: 20, comparedControlCount: 15, failures: [{ type: 'missing-control' }] };
  artifacts.links = { pass: false, escapedSourceRouteCount: 1, uncapturedLocalRouteCount: 2 };
  const report = assembleSelfVerificationEvidence(artifacts);

  assert.equal(report.pass, false);
  assert.ok(report.failures.some((failure) => failure.type === 'route-coverage-incomplete' && failure.missingRoutes === 2));
  assert.ok(report.failures.some((failure) => failure.type === 'interaction-coverage-incomplete' && failure.coverage === 0.75));
  assert.ok(report.failures.some((failure) => failure.type === 'source-link-escape' && failure.count === 1));
});

test('artifact assembly fails when component-level evidence has not been generated', () => {
  const artifacts = passingArtifacts();
  artifacts.componentFidelity = null;
  const report = assembleSelfVerificationEvidence(artifacts);
  assert.equal(report.pass, false);
  assert.ok(report.failures.some((failure) => failure.type === 'component-evidence-missing'));
});
