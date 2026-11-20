import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeCaptureBundle } from '../../src/replay/capture-bundle.mjs';
import { runGoldenSuite } from '../../src/benchmark/run-golden-suite.mjs';

function candidate(id, semanticRole, { variant = 'default', title = id } = {}) {
  const product = semanticRole === 'product-card';
  return {
    id,
    componentName: product ? 'ProductCard' : 'ContentCard',
    semanticRole,
    variant,
    structure: {
      tag: 'article',
      childRoles: product ? ['heading','price','button'] : ['heading','p'],
      slots: product ? ['title','meta','actions'] : ['title','body'],
    },
    style: { display: 'block', paddingTop: product ? '16px' : '12px', borderRadius: '8px' },
    slotStyles: {},
    visual: { aspectRatioBucket: 'landscape', density: variant === 'compact' ? 'compact' : 'medium' },
    behavior: { role: 'group', sideEffectClass: 'none', actions: product ? ['submit'] : [] },
    detectedStates: [],
    content: product ? { title, price: '$100', actionLabels: ['Favorite'] } : { title, items: ['Story'] },
    bbox: { x: 0, y: 0, width: 320, height: 160 },
    parentCandidateId: null,
    childCandidateIds: [],
  };
}

function capture(title, candidates, links = []) {
  return {
    metadata: { title, viewport: { width: 1280, height: 800, devicePixelRatio: 1 }, documentStyle: {} },
    domSnapshot: {}, axTree: {}, interactiveElements: [], componentCandidates: candidates,
    stateCaptures: [], links,
  };
}

test('Golden suite replays multiple sites offline, scores them, and persists gate failures', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'golden-suite-'));
  const siteOneRoot = path.join(root, 'replay-one');
  const siteTwoRoot = path.join(root, 'replay-two');

  await writeCaptureBundle({
    startUrl: 'https://shop.example.com/',
    outputRoot: siteOneRoot,
    pages: [
      { url: 'https://shop.example.com/', capture: capture('Home', [candidate('p1','product-card'), candidate('c1','content-card')], ['/search']) },
      { url: 'https://shop.example.com/search', capture: capture('Search', [candidate('p2','product-card',{variant:'compact'})]) },
    ],
  });
  await writeCaptureBundle({
    startUrl: 'https://docs.example.com/',
    outputRoot: siteTwoRoot,
    pages: [
      { url: 'https://docs.example.com/', capture: capture('Docs', [candidate('p1','product-card'), candidate('c1','content-card')]) },
    ],
  });

  const suite = {
    version: '0.1',
    gates: { minCoverage: 1 },
    sites: [
      {
        id: 'shop', replayRoot: siteOneRoot, startUrl: 'https://shop.example.com/', maxPages: 2, clusterThreshold: 0.78,
        golden: { version:'0.1', siteId:'shop', items: [
          { routePath:'/', candidateId:'p1', familyLabel:'product', semanticRole:'product-card', variant:'default', states:['default'] },
          { routePath:'/search', candidateId:'p2', familyLabel:'product', semanticRole:'product-card', variant:'compact', states:['default'] },
          { routePath:'/', candidateId:'c1', familyLabel:'content', semanticRole:'content-card', variant:'default', states:['default'] },
        ]},
      },
      {
        id: 'docs', replayRoot: siteTwoRoot, startUrl: 'https://docs.example.com/', maxPages: 1,
        golden: { version:'0.1', siteId:'docs', items: [
          { routePath:'/', candidateId:'p1', familyLabel:'product', semanticRole:'product-card', variant:'default', states:['default'] },
          { routePath:'/', candidateId:'c1', familyLabel:'content', semanticRole:'content-card', variant:'default', states:['default'] },
          { routePath:'/', candidateId:'missing', familyLabel:'content', semanticRole:'content-card', variant:'default', states:['default'] },
        ]},
      },
    ],
  };

  const outputRoot = path.join(root, 'out');
  const report = await runGoldenSuite({ suite, outputRoot });
  assert.equal(report.siteCount, 2);
  assert.equal(report.sites[0].coverage, 1);
  assert.equal(report.sites[0].clustering.f1, 1);
  assert.equal(report.sites[1].coverage, 2 / 3);
  assert.equal(report.passed, false);
  assert.ok(report.failedGates.includes('coverage'));
  assert.equal(report.aggregate.clustering.overMergeRate, 0);
  assert.equal(report.aggregate.clustering.underMergeRate, 0);

  const persisted = JSON.parse(await fs.readFile(path.join(outputRoot, 'golden-benchmark-report.json'), 'utf8'));
  assert.equal(persisted.siteCount, 2);
  assert.equal(persisted.passed, false);
  await fs.access(path.join(outputRoot, 'sites', 'shop', 'component-ir.json'));
  await fs.access(path.join(outputRoot, 'sites', 'docs', 'golden-draft.json'));
});

test('Golden suite can require human-approved annotations before scoring', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'golden-approved-'));
  const replayRoot = path.join(root, 'replay');
  await writeCaptureBundle({
    startUrl: 'https://shop.example.com/',
    outputRoot: replayRoot,
    pages: [{ url: 'https://shop.example.com/', capture: capture('Home', [candidate('p1','product-card')]) }],
  });
  const suite = {
    version: '0.1',
    requireApprovedGold: true,
    sites: [{
      id: 'shop', replayRoot, startUrl: 'https://shop.example.com/',
      golden: { version:'0.1', siteId:'shop', items: [
        { routePath:'/', candidateId:'p1', familyLabel:'product', semanticRole:'product-card', variant:'default', states:['default'], reviewStatus:'unreviewed' },
      ]},
    }],
  };
  await assert.rejects(() => runGoldenSuite({ suite, outputRoot: path.join(root, 'out') }), /approved/i);
});
