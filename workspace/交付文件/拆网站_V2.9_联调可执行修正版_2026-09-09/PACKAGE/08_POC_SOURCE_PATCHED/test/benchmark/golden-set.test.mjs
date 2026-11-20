import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoldenDraft, evaluateGoldenSite, evaluateGoldenSuite } from '../../src/benchmark/golden-set.mjs';

function makeIr({ families, instances }) {
  return {
    irVersion: '0.1',
    site: { id: 'shop', sourceUrl: 'https://shop.example.com/', capturedAt: '2026-08-17T00:00:00.000Z' },
    designSystem: { tokenFormat: 'dtcg-2025.10', tokens: {} },
    routes: [
      { id: 'route-home', path: '/', sections: [], evidenceIds: [] },
      { id: 'route-search-2', path: '/search', sections: [], evidenceIds: [] },
    ],
    componentFamilies: families,
    componentInstances: instances,
    interactions: [], assets: [], evidence: [], compileTargets: [],
  };
}

const families = [
  { id: 'fam-product', canonicalName: 'ProductCard', semanticRole: 'product-card', states: ['default','hover'], variants: ['default','compact'] },
  { id: 'fam-content', canonicalName: 'ContentCard', semanticRole: 'content-card', states: ['default'], variants: ['default'] },
];

const perfectIr = makeIr({
  families,
  instances: [
    { id:'i1', familyId:'fam-product', routeId:'route-home', sourceCandidateId:'route-home:oak', variant:'default', availableStates:['default','hover'] },
    { id:'i2', familyId:'fam-product', routeId:'route-search-2', sourceCandidateId:'route-search-2:walnut', variant:'compact', availableStates:['default','hover'] },
    { id:'i3', familyId:'fam-content', routeId:'route-home', sourceCandidateId:'route-home:story-a', variant:'default', availableStates:['default'] },
    { id:'i4', familyId:'fam-content', routeId:'route-search-2', sourceCandidateId:'route-search-2:story-b', variant:'default', availableStates:['default'] },
  ],
});

const golden = {
  version: '0.1',
  siteId: 'shop',
  items: [
    { routePath:'/', candidateId:'oak', familyLabel:'product', semanticRole:'product-card', variant:'default', states:['default','hover'] },
    { routePath:'/search', candidateId:'walnut', familyLabel:'product', semanticRole:'product-card', variant:'compact', states:['default','hover'] },
    { routePath:'/', candidateId:'story-a', familyLabel:'content', semanticRole:'content-card', variant:'default', states:['default'] },
    { routePath:'/search', candidateId:'story-b', familyLabel:'content', semanticRole:'content-card', variant:'default', states:['default'] },
  ],
};

test('createGoldenDraft emits reviewable stable route/candidate annotations', () => {
  const draft = createGoldenDraft(perfectIr);
  assert.equal(draft.version, '0.1');
  assert.equal(draft.siteId, 'shop');
  const oak = draft.items.find((item) => item.candidateId === 'oak');
  assert.equal(oak.routePath, '/');
  assert.equal(oak.familyName, 'ProductCard');
  assert.equal(oak.semanticRole, 'product-card');
  assert.equal(oak.reviewStatus, 'unreviewed');
  assert.deepEqual(oak.states, ['default','hover']);
});

test('perfect Golden match reports full coverage and perfect component metrics', () => {
  const report = evaluateGoldenSite({ ir: perfectIr, golden });
  assert.equal(report.coverage, 1);
  assert.equal(report.clustering.f1, 1);
  assert.equal(report.clustering.overMergeRate, 0);
  assert.equal(report.clustering.underMergeRate, 0);
  assert.equal(report.semanticRoleAccuracy, 1);
  assert.equal(report.variantAccuracy, 1);
  assert.equal(report.state.f1, 1);
  assert.deepEqual(report.missingItems, []);
});

test('missing candidates and over-merge are explicit and can fail release gates', () => {
  const broken = structuredClone(perfectIr);
  broken.componentInstances = broken.componentInstances.filter((instance) => instance.id !== 'i4');
  broken.componentInstances.find((instance) => instance.id === 'i3').familyId = 'fam-product';

  const report = evaluateGoldenSite({ ir: broken, golden });
  assert.equal(report.coverage, 0.75);
  assert.ok(report.clustering.overMergeRate > 0);
  assert.equal(report.missingItems.length, 1);
  assert.equal(report.missingItems[0].candidateId, 'story-b');

  const suite = evaluateGoldenSuite([report], {
    minCoverage: 1,
    minClusteringF1: 0.85,
    maxOverMergeRate: 0.05,
    maxUnderMergeRate: 0.12,
    minSemanticRoleAccuracy: 0.9,
    minVariantAccuracy: 0.8,
    minStateF1: 0.8,
  });
  assert.equal(suite.passed, false);
  assert.ok(suite.failedGates.includes('coverage'));
  assert.ok(suite.failedGates.includes('overMergeRate'));
});
