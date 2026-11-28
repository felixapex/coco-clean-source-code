import fs from 'node:fs/promises';
import path from 'node:path';
import { auditPublishedRouteClosure } from './lib/published-route-closure.mjs';

const args = process.argv.slice(2);
const siteIndex = args.indexOf('--site');
const outputIndex = args.indexOf('--output');
const siteRoot = path.resolve(siteIndex >= 0 ? args[siteIndex + 1] : process.env.MATBOX_DIST_DIR || 'dist');
const report = await auditPublishedRouteClosure(siteRoot);
if (outputIndex >= 0) {
  const outputPath = path.resolve(args[outputIndex + 1]);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
process.stdout.write(`${JSON.stringify({
  pass: report.pass,
  inspectedPages: report.inspectedPages,
  inspectedMobilePages: report.inspectedMobilePages,
  inspectedDocuments: report.inspectedDocuments,
  inspectedLinks: report.inspectedLinks,
  missingTargetCount: report.missingTargetCount,
  missingTargets: report.missingTargets.slice(0, 20),
}, null, 2)}\n`);
if (!report.pass) process.exitCode = 2;
