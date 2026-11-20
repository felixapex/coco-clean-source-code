import fs from 'node:fs/promises';
import path from 'node:path';
import { buildGoldenBenchmarkSuite } from '../../examples/golden-benchmark-suite.mjs';
import { runGoldenSuite } from '../benchmark/run-golden-suite.mjs';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const siteReplayRoot = path.resolve(arg('--site-replay', './artifacts/site-fixture/replay'));
const complexReplayRoot = path.resolve(arg('--complex-replay', './artifacts/complex-site/replay'));
const outputRoot = path.resolve(arg('--out', './artifacts/golden-benchmark-demo'));
await fs.mkdir(outputRoot, { recursive: true });
const suite = buildGoldenBenchmarkSuite({ siteReplayRoot, complexReplayRoot });
await fs.writeFile(path.join(outputRoot, 'golden-suite.json'), `${JSON.stringify(suite, null, 2)}\n`, 'utf8');
const report = await runGoldenSuite({ suite, outputRoot });
console.log(JSON.stringify({
  passed: report.passed,
  failedGates: report.failedGates,
  aggregate: report.aggregate,
  sites: report.sites.map((site) => ({ siteId: site.siteId, coverage: site.coverage, f1: site.clustering.f1 })),
  outputRoot,
}, null, 2));
if (!report.passed) process.exitCode = 3;
