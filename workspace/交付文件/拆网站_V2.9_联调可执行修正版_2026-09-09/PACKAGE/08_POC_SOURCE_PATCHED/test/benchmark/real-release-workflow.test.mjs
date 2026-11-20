import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeCaptureBundle } from '../../src/replay/capture-bundle.mjs';
import { createGoldenDraftsFromCaptureReport, runRealReleaseBenchmark } from '../../src/benchmark/real-release-workflow.mjs';

function capture() {
  return {
    metadata: { title: 'Home', viewport: { width: 1280, height: 800, devicePixelRatio: 1 }, documentStyle: {} },
    domSnapshot: {}, axTree: {}, interactiveElements: [], stateCaptures: [], links: [],
    componentCandidates: [{
      id: 'p1', componentName: 'ProductCard', semanticRole: 'product-card', variant: 'default',
      structure: { tag: 'article', childRoles: ['heading','price','button'], slots: ['title','meta','actions'] },
      style: { display:'block', paddingTop:'16px', borderRadius:'8px' }, slotStyles: {},
      visual: { aspectRatioBucket:'landscape', density:'medium' },
      behavior: { role:'group', sideEffectClass:'none', actions:['submit'] }, detectedStates: [],
      content: { title:'Chair', price:'$100', actionLabels:['Favorite'] },
      bbox: { x:0,y:0,width:320,height:160 }, parentCandidateId:null, childCandidateIds:[],
    }],
  };
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'real-release-'));
  const replayRoot = path.join(root, 'captures', 'shop');
  await writeCaptureBundle({ startUrl:'https://shop.example.com/', outputRoot: replayRoot, pages:[{ url:'https://shop.example.com/', capture: capture() }] });
  const realSuite = {
    version:'1.0', releaseGates:{ minSites:1, minCoverage:1 },
    sites:[{ id:'shop', url:'https://shop.example.com/', authorization:{status:'owned',attestedBy:'owner',attestedAt:'2026-08-17T18:00:00Z'}, capturePolicy:{robots:'respect',maxPages:5} }],
  };
  const captureReport = { version:'1.0', sites:[{ siteId:'shop', status:'captured', capturedPages:1, replayRoot }] };
  return { root, replayRoot, realSuite, captureReport };
}

test('real workflow creates unreviewed Golden draft from frozen replay', async () => {
  const { root, captureReport } = await fixture();
  const goldenRoot = path.join(root, 'golden');
  const result = await createGoldenDraftsFromCaptureReport({ captureReport, outputRoot: goldenRoot });
  assert.equal(result.sites.length, 1);
  const golden = JSON.parse(await fs.readFile(path.join(goldenRoot, 'shop.golden.json'), 'utf8'));
  assert.equal(golden.items.length, 1);
  assert.equal(golden.items[0].reviewStatus, 'unreviewed');
});

test('release workflow refuses unapproved Gold then passes after explicit human approval', async () => {
  const { root, realSuite, captureReport } = await fixture();
  const goldenRoot = path.join(root, 'golden');
  await createGoldenDraftsFromCaptureReport({ captureReport, outputRoot: goldenRoot });
  await assert.rejects(() => runRealReleaseBenchmark({ realSuite, captureReport, goldenRoot, outputRoot:path.join(root,'bench-fail') }), /approved/i);

  const goldenPath = path.join(goldenRoot, 'shop.golden.json');
  const golden = JSON.parse(await fs.readFile(goldenPath, 'utf8'));
  golden.items = golden.items.map((item) => ({ ...item, reviewStatus:'approved' }));
  await fs.writeFile(goldenPath, JSON.stringify(golden, null, 2));

  const report = await runRealReleaseBenchmark({ realSuite, captureReport, goldenRoot, outputRoot:path.join(root,'bench-pass') });
  assert.equal(report.passed, true);
  assert.equal(report.siteCount, 1);
});
