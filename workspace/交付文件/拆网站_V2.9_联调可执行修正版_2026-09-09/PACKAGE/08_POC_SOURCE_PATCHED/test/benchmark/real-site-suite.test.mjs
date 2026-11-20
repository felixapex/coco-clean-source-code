import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRealSiteSuite, buildCapturePlan } from '../../src/benchmark/real-site-suite.mjs';

test('real-site suite requires explicit authorization attestation for every site', () => {
  assert.throws(() => validateRealSiteSuite({
    version: '1.0',
    sites: [{ id: 'shop', url: 'https://shop.example.com/' }],
  }), /authorization/i);
});

test('real-site suite normalizes capture policy and builds auditable capture plan', () => {
  const suite = validateRealSiteSuite({
    version: '1.0',
    releaseGates: { minSites: 10 },
    sites: [{
      id: 'shop',
      url: 'https://shop.example.com/',
      authorization: {
        status: 'owned',
        attestedBy: 'owner@example.com',
        attestedAt: '2026-08-17T18:00:00Z',
      },
      capturePolicy: { robots: 'respect', maxPages: 25 },
    }],
  });

  assert.equal(suite.sites[0].capturePolicy.robots, 'respect');
  assert.equal(suite.sites[0].capturePolicy.maxPages, 25);
  assert.equal(suite.sites[0].authorization.status, 'owned');
  const plan = buildCapturePlan(suite, '/tmp/real-captures');
  assert.equal(plan.length, 1);
  assert.equal(plan[0].siteId, 'shop');
  assert.match(plan[0].outputRoot.replaceAll('\\', '/'), /real-captures\/shop$/);
  assert.equal(plan[0].robotsPolicy, 'respect');
});

test('real-site suite defaults to production-sized release gates instead of permissive single-site scoring', () => {
  const suite = validateRealSiteSuite({
    version: '1.0',
    sites: [{
      id: 'shop', url: 'https://shop.example.com/',
      authorization: { status:'owned', attestedBy:'owner', attestedAt:'2026-08-17T18:00:00Z' }
    }],
  });
  assert.equal(suite.releaseGates.minSites, 10);
  assert.equal(suite.releaseGates.minPerSiteCoverage, 0.90);
  assert.equal(suite.releaseGates.minPerSiteClusteringF1, 0.75);
});
