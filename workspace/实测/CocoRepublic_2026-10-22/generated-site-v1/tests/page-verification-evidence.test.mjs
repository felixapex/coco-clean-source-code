import test from 'node:test';
import assert from 'node:assert/strict';
import { assemblePageVerificationEvidence, groupPageCompositions } from '../scripts/lib/page-verification-evidence.mjs';

const composition = {
  route: '/living',
  instances: [
    { matboxComponentId: 'header' },
    { matboxComponentId: 'hero' },
    { matboxComponentId: 'footer' },
  ],
};

function validInput() {
  return {
    composition,
    acceptedComponentIds: ['header', 'hero', 'footer'],
    fidelity: {
      results: [
        { route: '/living', viewport: 'desktop', pass: true, similarity: 0.97, failures: [] },
        { route: '/living', viewport: 'mobile', pass: true, similarity: 0.96, failures: [] },
      ],
    },
    responsive: {
      cells: [
        { route: '/living', viewport: 'desktop', width: 1440, pass: true, failures: [] },
        { route: '/living', viewport: 'mobile', width: 390, pass: true, failures: [] },
      ],
    },
    interactions: {
      desktop: { routeResults: [{ route: '/living', pass: true, sourceCount: 8, localCount: 8, comparedCount: 8 }], failures: [] },
      mobile: { routeResults: [{ route: '/living', pass: true, sourceCount: 5, localCount: 5, comparedCount: 5 }], failures: [] },
    },
  };
}

test('real visual, geometry, and per-viewport interaction reports assemble into page evidence', () => {
  const evidence = assemblePageVerificationEvidence(validInput());
  assert.equal(evidence.route, '/living');
  assert.deepEqual(evidence.componentIds, ['header', 'hero', 'footer']);
  assert.equal(evidence.viewports.desktop.visual.pass, true);
  assert.equal(evidence.viewports.mobile.geometry.pass, true);
  assert.equal(evidence.interactions.pass, true);
  assert.equal(evidence.interactions.total, 13);
  assert.equal(evidence.interactions.verified, 13);
  assert.deepEqual(evidence.interactions.viewports, ['desktop', 'mobile']);
});

test('missing desktop or mobile source evidence fails closed', () => {
  const input = validInput();
  input.fidelity.results = input.fidelity.results.filter((item) => item.viewport !== 'mobile');
  const evidence = assemblePageVerificationEvidence(input);
  assert.equal(evidence.viewports.mobile.visual.pass, false);
  assert.deepEqual(evidence.viewports.mobile.visual.failures, [{ type: 'missing-page-visual-evidence', viewport: 'mobile' }]);
});

test('responsive failures retain their exact reasons', () => {
  const input = validInput();
  input.responsive.cells[0] = {
    route: '/living', viewport: 'desktop', width: 1440, pass: false,
    failures: ['unexpected-right-blank-space', 'duplicate-text-overlap:2'],
  };
  const evidence = assemblePageVerificationEvidence(input);
  assert.equal(evidence.viewports.desktop.geometry.pass, false);
  assert.deepEqual(evidence.viewports.desktop.geometry.failures, [
    { type: 'unexpected-right-blank-space', width: 1440 },
    { type: 'duplicate-text-overlap:2', width: 1440 },
  ]);
});

test('every control occurrence on desktop and mobile must be compared', () => {
  const input = validInput();
  input.interactions.mobile.routeResults[0].comparedCount = 4;
  input.interactions.mobile.routeResults[0].pass = false;
  input.interactions.mobile.failures = [{ route: '/living', type: 'missing-local-control', fingerprint: 'menu#2' }];
  const evidence = assemblePageVerificationEvidence(input);
  assert.equal(evidence.interactions.pass, false);
  assert.equal(evidence.interactions.total, 13);
  assert.equal(evidence.interactions.verified, 12);
  assert.deepEqual(evidence.interactions.failures, [{ viewport: 'mobile', type: 'missing-local-control', fingerprint: 'menu#2' }]);
});

test('desktop and mobile compositions for one URL are grouped into one page contract', () => {
  const grouped = groupPageCompositions([
    { route: '/living', instances: [{ matboxComponentId: 'header' }, { matboxComponentId: 'desktop-hero' }] },
    { route: '/living?matbox-viewport=mobile', instances: [{ matboxComponentId: 'header' }, { matboxComponentId: 'mobile-hero' }] },
  ]);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].route, '/living');
  assert.equal(grouped[0].desktop.route, '/living');
  assert.equal(grouped[0].mobile.route, '/living?matbox-viewport=mobile');
  assert.deepEqual(grouped[0].componentIds, ['header', 'desktop-hero', 'mobile-hero']);
});

