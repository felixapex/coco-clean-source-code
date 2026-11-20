import fs from 'node:fs/promises';
import path from 'node:path';
import { createGoldenDraftsFromCaptureReport } from '../benchmark/real-release-workflow.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const reportPath = arg('--capture-report');
if (!reportPath) {
  console.error('Usage: node src/cli/create-golden-drafts.mjs --capture-report ./real-site-capture-report.json --out ./golden');
  process.exit(2);
}
const captureReport = JSON.parse(await fs.readFile(path.resolve(reportPath), 'utf8'));
const outputRoot = path.resolve(arg('--out', './artifacts/real-golden'));
const result = await createGoldenDraftsFromCaptureReport({ captureReport, outputRoot });
console.log(JSON.stringify({ siteCount: result.sites.length, outputRoot }, null, 2));
