import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const replayRoot = path.join(root, 'src', 'replay');
const reportPath = path.resolve(
  process.argv.find((value) => value.startsWith('--output='))?.slice('--output='.length)
    || path.join(root, 'artifacts', 'component-geometry-migration', 'source-image-evidence-audit.json'),
);
const routeFilter = new Set(process.argv
  .filter((value) => value.startsWith('--route='))
  .map((value) => value.slice('--route='.length)));
const routes = JSON.parse(await fs.readFile(path.join(replayRoot, 'routes.json'), 'utf8'));
const routesByFilename = new Map();
for (const [route, filename] of Object.entries(routes)) {
  if (routeFilter.size > 0 && !routeFilter.has(route)) continue;
  if (!routesByFilename.has(filename)) routesByFilename.set(filename, []);
  routesByFilename.get(filename).push(route);
}

function attribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return tag.match(new RegExp(`\\b${escaped}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2] ?? null;
}

const failures = [];
const sourceCounts = new Map();
let scanned = 0;
let imageCount = 0;
for (const [filename, pageRoutes] of routesByFilename) {
  const html = await fs.readFile(path.join(replayRoot, filename), 'utf8');
  for (const match of html.matchAll(/<img\b[^>]*data-matbox-image-intrinsic-width\s*=\s*(["'])[^"']*\1[^>]*>/gi)) {
    const tag = match[0];
    imageCount += 1;
    const visible = attribute(tag, 'data-matbox-image-visible') !== 'false';
    const intrinsicWidth = Number(attribute(tag, 'data-matbox-image-intrinsic-width'));
    const intrinsicHeight = Number(attribute(tag, 'data-matbox-image-intrinsic-height'));
    if (!visible || (intrinsicWidth > 0 && intrinsicHeight > 0)) continue;
    const source = attribute(tag, 'src') || attribute(tag, 'data-src') || null;
    const record = {
      routes: pageRoutes,
      filename,
      source,
      intrinsicWidth,
      intrinsicHeight,
      renderedWidth: Number(attribute(tag, 'data-matbox-image-rendered-width')),
      renderedHeight: Number(attribute(tag, 'data-matbox-image-rendered-height')),
      containerWidth: Number(attribute(tag, 'data-matbox-image-container-width')),
      containerHeight: Number(attribute(tag, 'data-matbox-image-container-height')),
    };
    failures.push(record);
    sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
  }
  scanned += 1;
  if (scanned % 100 === 0 || scanned === routesByFilename.size) {
    process.stdout.write(`IMAGE_EVIDENCE_SCAN ${scanned}/${routesByFilename.size} failures=${failures.length}\n`);
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  pass: failures.length === 0,
  scannedFiles: scanned,
  imageCount,
  missingSourceEvidenceCount: failures.length,
  affectedFileCount: new Set(failures.map((failure) => failure.filename)).size,
  affectedRouteCount: new Set(failures.flatMap((failure) => failure.routes)).size,
  uniqueSourceCount: sourceCounts.size,
  sources: [...sourceCounts.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((left, right) => right.count - left.count || String(left.source).localeCompare(String(right.source))),
  failures,
};
await fs.mkdir(path.dirname(reportPath), { recursive: true });
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({
  pass: report.pass,
  scannedFiles: report.scannedFiles,
  missingSourceEvidenceCount: report.missingSourceEvidenceCount,
  affectedFileCount: report.affectedFileCount,
  affectedRouteCount: report.affectedRouteCount,
  uniqueSourceCount: report.uniqueSourceCount,
  reportPath,
}, null, 2)}\n`);
if (!report.pass) process.exitCode = 2;
