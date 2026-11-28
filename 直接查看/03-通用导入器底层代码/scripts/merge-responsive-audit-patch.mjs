import fs from 'node:fs/promises';
import path from 'node:path';
import { replaceResponsiveAuditCells } from './lib/responsive-audit-shards.mjs';

function argument(name) {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const basePath = path.resolve(argument('base') || 'artifacts/full-site-audit/responsive-layout.json');
const patchPath = path.resolve(argument('patch') || 'artifacts/full-site-audit/responsive-layout-targeted-promoted.json');
const routeManifestPath = path.resolve(argument('routes') || 'artifacts/coco-full-v3-stage-20261126/replay/routes.json');
const outputPath = path.resolve(argument('output') || basePath);
const [baseReport, patchReport, routeManifest] = await Promise.all([
  fs.readFile(basePath, 'utf8').then(JSON.parse),
  fs.readFile(patchPath, 'utf8').then(JSON.parse),
  fs.readFile(routeManifestPath, 'utf8').then(JSON.parse),
]);
const profiles = baseReport.profiles;
const report = replaceResponsiveAuditCells({
  baseReport,
  patchReport,
  routes: Object.keys(routeManifest).sort(),
  profiles,
});
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({
  routeCount: report.routeCount,
  cellCount: report.cellCount,
  passedCells: report.passedCells,
  failedCells: report.failedCells,
  coverageFailures: report.coverageFailures.length,
  pass: report.pass,
  output: outputPath,
}, null, 2)}\n`);
if (!report.pass) process.exitCode = 2;
