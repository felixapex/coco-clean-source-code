import fs from 'node:fs/promises';
import path from 'node:path';
import { buildGoldenBenchmarkSuite } from '../../examples/golden-benchmark-suite.mjs';
import { runRealReleaseBenchmark } from '../benchmark/real-release-workflow.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const siteReplayRoot = path.resolve(arg('--site-replay', './artifacts/site-fixture/replay'));
const complexReplayRoot = path.resolve(arg('--complex-replay', './artifacts/complex-site/replay'));
const outputRoot = path.resolve(arg('--out', './artifacts/real-release-workflow-demo'));
const goldenRoot = path.join(outputRoot, 'golden');
await fs.mkdir(goldenRoot, { recursive: true });

const benchmarkFixture = buildGoldenBenchmarkSuite({ siteReplayRoot, complexReplayRoot });
const realSuite = {
  version: '1.0',
  name: 'controlled-real-release-workflow-demo',
  releaseGates: {
    minSites: 2,
    minCoverage: 1,
    minClusteringF1: 0.85,
    maxOverMergeRate: 0.05,
    maxUnderMergeRate: 0.12,
    minSemanticRoleAccuracy: 0.90,
    minVariantAccuracy: 0.80,
    minStateF1: 0.80,
    minPerSiteCoverage: 1,
    minPerSiteClusteringF1: 0.75
  },
  sites: [
    {
      id: 'fixture-shop', url: 'https://shop.example.com/',
      authorization: { status:'public-benchmark', attestedBy:'controlled-fixture', attestedAt:'2026-08-17T18:00:00Z' },
      capturePolicy: { robots:'respect', maxPages:3 }
    },
    {
      id: 'fixture-operations', url: 'https://app.example.com/',
      authorization: { status:'public-benchmark', attestedBy:'controlled-fixture', attestedAt:'2026-08-17T18:00:00Z' },
      capturePolicy: { robots:'respect', maxPages:2 }
    }
  ]
};
const captureReport = {
  version: '1.0',
  sites: [
    { siteId:'fixture-shop', status:'captured', capturedPages:3, replayRoot:siteReplayRoot },
    { siteId:'fixture-operations', status:'captured', capturedPages:2, replayRoot:complexReplayRoot }
  ]
};

for (const site of benchmarkFixture.sites) {
  const approved = {
    ...site.golden,
    items: site.golden.items.map((item) => ({ ...item, reviewStatus:'approved' })),
  };
  await fs.writeFile(path.join(goldenRoot, `${site.id}.golden.json`), `${JSON.stringify(approved, null, 2)}\n`, 'utf8');
}
await fs.writeFile(path.join(outputRoot, 'real-site-suite.json'), `${JSON.stringify(realSuite, null, 2)}\n`, 'utf8');
await fs.writeFile(path.join(outputRoot, 'real-site-capture-report.json'), `${JSON.stringify(captureReport, null, 2)}\n`, 'utf8');

const report = await runRealReleaseBenchmark({ realSuite, captureReport, goldenRoot, outputRoot:path.join(outputRoot, 'benchmark') });
console.log(JSON.stringify({ passed:report.passed, siteCount:report.siteCount, aggregate:report.aggregate, outputRoot }, null, 2));
if (!report.passed) process.exitCode = 3;
