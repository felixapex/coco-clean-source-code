import fs from 'node:fs/promises';
import path from 'node:path';
import { runGoldenSuite } from '../benchmark/run-golden-suite.mjs';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const suitePath = arg('--suite');
if (!suitePath) {
  console.error('Usage: node src/cli/run-golden-benchmark.mjs --suite ./golden-suite.json --out ./artifacts/golden-benchmark');
  process.exit(2);
}
const absoluteSuite = path.resolve(suitePath);
const suite = JSON.parse(await fs.readFile(absoluteSuite, 'utf8'));
const suiteDir = path.dirname(absoluteSuite);
for (const site of suite.sites ?? []) {
  if (site.replayRoot && !path.isAbsolute(site.replayRoot)) site.replayRoot = path.resolve(suiteDir, site.replayRoot);
  if (typeof site.golden === 'string' && !path.isAbsolute(site.golden)) site.golden = path.resolve(suiteDir, site.golden);
}
const outputRoot = path.resolve(arg('--out', './artifacts/golden-benchmark'));
const report = await runGoldenSuite({ suite, outputRoot });
console.log(JSON.stringify({
  passed: report.passed,
  failedGates: report.failedGates,
  aggregate: report.aggregate,
  outputRoot,
}, null, 2));
process.exitCode = report.passed ? 0 : 3;
