import fs from 'node:fs/promises';
import path from 'node:path';
import { captureRealSiteSuite } from '../benchmark/capture-real-site-suite.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const suitePath = arg('--suite');
if (!suitePath) {
  console.error('Usage: node src/cli/capture-real-site-suite.mjs --suite ./real-site-suite.json --out ./artifacts/real-captures [--chromium /usr/bin/chromium]');
  process.exit(2);
}
const suite = JSON.parse(await fs.readFile(path.resolve(suitePath), 'utf8'));
const outputRoot = path.resolve(arg('--out', './artifacts/real-captures'));
const chromiumPath = arg('--chromium', '/usr/bin/chromium');
const report = await captureRealSiteSuite({ suite, outputRoot, chromiumPath });
console.log(JSON.stringify({
  siteCount: report.siteCount,
  capturedSiteCount: report.capturedSiteCount,
  failedSiteCount: report.failedSiteCount,
  report: path.join(outputRoot, 'real-site-capture-report.json'),
}, null, 2));
process.exitCode = report.failedSiteCount ? 4 : 0;
