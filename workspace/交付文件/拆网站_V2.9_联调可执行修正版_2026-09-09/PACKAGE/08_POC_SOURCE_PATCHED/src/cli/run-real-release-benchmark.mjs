import fs from 'node:fs/promises';
import path from 'node:path';
import { runRealReleaseBenchmark } from '../benchmark/real-release-workflow.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const suitePath = arg('--suite');
const reportPath = arg('--capture-report');
const goldenRoot = arg('--golden');
if (!suitePath || !reportPath || !goldenRoot) {
  console.error('Usage: node src/cli/run-real-release-benchmark.mjs --suite ./real-site-suite.json --capture-report ./real-site-capture-report.json --golden ./golden --out ./release-benchmark');
  process.exit(2);
}
const realSuite = JSON.parse(await fs.readFile(path.resolve(suitePath), 'utf8'));
const captureReport = JSON.parse(await fs.readFile(path.resolve(reportPath), 'utf8'));
const outputRoot = path.resolve(arg('--out', './artifacts/real-release-benchmark'));
const report = await runRealReleaseBenchmark({ realSuite, captureReport, goldenRoot:path.resolve(goldenRoot), outputRoot });
console.log(JSON.stringify({ passed: report.passed, failedGates: report.failedGates, aggregate: report.aggregate, outputRoot }, null, 2));
process.exitCode = report.passed ? 0 : 3;
