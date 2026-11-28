import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

import { capturePagePool } from '../src/import-core/capture/chromium-capture.mjs';
import { buildComponentRegistry, extractPageComponents } from './lib/component-registry.mjs';
import {
  applyMeasuredImageGeometry,
  applyMeasuredComponentGeometry,
  compactComponentGeometryMeasurementExpression,
  markedComponentGeometryMeasurementExpression,
  markImageGeometryTargets,
  markComponentGeometryTargets,
  shouldSkipGeometryEnrichment,
  stripImageGeometryEvidence,
  stripComponentGeometryEvidence,
} from './lib/local-component-geometry.mjs';
import { writeAtomicVerified } from './lib/verified-write.mjs';

const root = path.resolve(import.meta.dirname, '..');
const replayRoot = path.join(root, 'src', 'replay');
const reportRoot = path.join(root, 'artifacts', 'component-geometry-migration');
const viewportName = process.argv.find((value) => value.startsWith('--viewport='))?.slice('--viewport='.length) || 'desktop';
if (!['desktop', 'mobile'].includes(viewportName)) throw new Error(`Unknown viewport: ${viewportName}`);
const mobile = viewportName === 'mobile';
const viewport = mobile ? { width: 390, height: 844, mobile: true } : { width: 1908, height: 1000, mobile: false };
const reportPath = path.join(reportRoot, mobile ? 'full-run-mobile.json' : 'full-run.json');
const profileRoot = path.join(reportRoot, 'browser-profiles');
const chromiumPath = process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const selectedRoutes = process.argv
  .filter((value) => value.startsWith('--route='))
  .map((value) => value.slice('--route='.length));
const queueFile = process.argv.find((value) => value.startsWith('--queue-file='))?.slice('--queue-file='.length) || null;
const limit = Number(process.argv.find((value) => value.startsWith('--limit='))?.slice('--limit='.length) || 0);
const workerCount = Math.max(1, Number(process.argv.find((value) => value.startsWith('--workers='))?.slice('--workers='.length) || 2));
const chunkSize = Math.max(workerCount, Number(process.argv.find((value) => value.startsWith('--chunk-size='))?.slice('--chunk-size='.length) || 24));
// Geometry migration needs only inert measurement attributes. Returning the
// full rendered document for large pages wastes memory and can terminate the
// browser process, so compact measurement is the safe default.
const measurementOnly = !process.argv.includes('--full-document-measurement');
const force = process.argv.includes('--force');

if (/msedge\.exe$/i.test(chromiumPath)) throw new Error('Microsoft Edge automation is forbidden in this workspace');
if (selectedRoutes.some((route) => !route.startsWith('/'))) throw new Error('--route must start with /');
if (queueFile && selectedRoutes.length > 0) throw new Error('--queue-file and --route cannot be combined');

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function occurrenceCount(value, pattern) {
  return (String(value).match(pattern) || []).length;
}

function pageInventory(html) {
  return {
    base: String(html).match(/<base\b[^>]*href=["']([^"']+)/i)?.[1] || null,
    anchors: occurrenceCount(html, /<a\b/gi),
    buttons: occurrenceCount(html, /<button\b/gi),
    images: occurrenceCount(html, /<img\b/gi),
    forms: occurrenceCount(html, /<form\b/gi),
  };
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

await fs.mkdir(reportRoot, { recursive: true });
await fs.mkdir(profileRoot, { recursive: true });
const routes = JSON.parse(await fs.readFile(path.join(replayRoot, mobile ? 'routes-mobile.json' : 'routes.json'), 'utf8'));
for (const route of selectedRoutes) {
  if (!routes[route]) throw new Error(`Unknown ${viewportName} replay route: ${route}`);
}

let routeEntries;
if (queueFile) {
  const queue = JSON.parse(await fs.readFile(path.resolve(queueFile), 'utf8'));
  if (!Array.isArray(queue)) throw new Error('--queue-file must contain a JSON array');
  routeEntries = queue.map((entry) => {
    if (!entry?.route || !entry?.filename || routes[entry.route] !== entry.filename) {
      throw new Error(`Invalid geometry queue entry: ${JSON.stringify(entry)}`);
    }
    return [entry.route, entry.filename];
  });
} else {
  routeEntries = selectedRoutes.length > 0
    ? selectedRoutes.map((route) => [route, routes[route]])
    : Object.entries(routes);
}
const routeByFile = new Map();
for (const [route, filename] of routeEntries) {
  if (!routeByFile.has(filename)) routeByFile.set(filename, route);
}

const skipped = [];
const jobs = [];
let scannedFiles = 0;
for (const [filename, route] of routeByFile) {
  const sourcePath = path.join(replayRoot, filename);
  const html = await fs.readFile(sourcePath, 'utf8');
  scannedFiles += 1;
  if (scannedFiles % 100 === 0 || scannedFiles === routeByFile.size) {
    process.stdout.write(`PREFLIGHT ${scannedFiles}/${routeByFile.size} pending=${jobs.length} skipped=${skipped.length}\n`);
  }
  // Legacy pages normally have no geometry attributes at all. Avoid running
  // the expensive full component parser twice across multi-gigabyte HTML: a
  // file without the marker is definitely pending and can go straight to the
  // browser measurement queue. Only partially/currently measured files need
  // semantic parsing during preflight.
  if (shouldSkipGeometryEnrichment(html, { force })) {
    skipped.push({
      route,
      filename,
      componentCount: occurrenceCount(html, /data-matbox-component-width=/g),
      reason: 'geometry-present',
    });
    continue;
  }
  jobs.push({ route, filename, sourcePath, key: filename, viewport });
  if (limit > 0 && jobs.length >= limit) break;
}

const allowedFiles = new Set(jobs.map((job) => job.filename));
const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
    const match = requestUrl.pathname.match(/^\/geometry\/([^/]+)$/);
    const filename = match ? decodeURIComponent(match[1]) : null;
    if (!filename || !allowedFiles.has(filename)) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not Found');
      return;
    }
    const source = await fs.readFile(path.join(replayRoot, filename), 'utf8');
    const markedComponents = markComponentGeometryTargets(source);
    const markedImages = markImageGeometryTargets(markedComponents.html);
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(markedImages.html);
  } catch (error) {
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(String(error?.stack || error));
  }
});

const startedAt = Date.now();
const completed = [];
const failures = [];
let reportWrite = Promise.resolve();
const snapshot = () => ({
  generatedAt: new Date().toISOString(),
  status: failures.length > 0 ? 'failed' : completed.length === jobs.length ? 'complete' : 'running',
  selectedRoutes,
  viewport: viewportName,
  workerCount,
  chunkSize,
  totalUniqueFiles: routeByFile.size,
  scheduled: jobs.length,
  skipped: skipped.length,
  completed: completed.length,
  failed: failures.length,
  elapsedMs: Date.now() - startedAt,
  results: completed,
  failures,
});
const persistReport = () => {
  reportWrite = reportWrite.then(() => writeAtomicVerified(reportPath, `${JSON.stringify(snapshot(), null, 2)}\n`));
  return reportWrite;
};

let port;
try {
  port = await listen(server);
  for (let offset = 0; offset < jobs.length; offset += chunkSize) {
    const batch = jobs.slice(offset, offset + chunkSize);
    const captures = await capturePagePool(batch.map((job) => ({
      ...job,
      url: `http://127.0.0.1:${port}/geometry/${encodeURIComponent(job.filename)}`,
    })), {
      chromiumPath,
      artifactProfile: 'replay',
      timeoutMs: 60000,
      requestGuard: false,
      allowNetwork: true,
      profileRoot,
      workerCount: Math.min(workerCount, batch.length),
      attempts: 1,
      retryDelayMs: 0,
      screenshotClip: { x: 0, y: 0, width: 1, height: 1, scale: 1 },
      ...(measurementOnly
        ? { settledReplayMeasurement: compactComponentGeometryMeasurementExpression }
        : { beforeSnapshotExpression: markedComponentGeometryMeasurementExpression }),
      async onResult(result, _url, entry) {
        const source = await fs.readFile(entry.sourcePath, 'utf8');
        const markedComponents = markComponentGeometryTargets(source);
        const markedImages = markImageGeometryTargets(markedComponents.html);
        const measuredHtml = measurementOnly ? result.settledReplayMeasurement : result.renderedDocument.html;
        const componentEnriched = applyMeasuredComponentGeometry(source, measuredHtml, markedComponents.targets);
        const imageTargets = markImageGeometryTargets(componentEnriched).targets;
        const enriched = applyMeasuredImageGeometry(componentEnriched, measuredHtml, imageTargets);
        const stripAllGeometry = (html) => stripImageGeometryEvidence(stripComponentGeometryEvidence(html));
        if (stripAllGeometry(enriched) !== stripAllGeometry(source)) {
          throw new Error(`GEOMETRY_ENRICHMENT_CHANGED_SOURCE ${entry.route}`);
        }
        const beforeInventory = pageInventory(source);
        const afterInventory = pageInventory(enriched);
        if (JSON.stringify(beforeInventory) !== JSON.stringify(afterInventory)) {
          throw new Error(`GEOMETRY_ENRICHMENT_CHANGED_INVENTORY ${entry.route}`);
        }
        const built = buildComponentRegistry([{ route: entry.route, html: enriched }], { requireGeometryEvidence: true });
        const componentCount = built.registry.components.length;
        await writeAtomicVerified(entry.sourcePath, enriched);
        completed.push({
          route: entry.route,
          filename: entry.filename,
          componentCount,
          geometryRecords: occurrenceCount(enriched, /data-matbox-component-width=/g),
          imageGeometryRecords: occurrenceCount(enriched, /data-matbox-image-intrinsic-width=/g),
          expectedImageRecords: markedImages.targets.length,
          sourceSha256: sha256(source),
          enrichedSha256: sha256(enriched),
          inventory: afterInventory,
          captureTimings: result.metadata.captureTimings,
        });
        await persistReport();
        process.stdout.write(`${completed.length}/${jobs.length} GEOMETRY_OK ${entry.route} components=${componentCount}\n`);
      },
    });
    for (const capture of captures) {
      if (capture.ok) continue;
      const entry = batch.find((job) => job.key === capture.key);
      failures.push({ route: entry?.route || null, filename: entry?.filename || capture.key, error: capture.error });
    }
    await persistReport();
    global.gc?.();
    process.stdout.write(`CHUNK_COMPLETE ${Math.min(offset + batch.length, jobs.length)}/${jobs.length} failures=${failures.length}\n`);
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
  await persistReport();
}

const finalReport = snapshot();
process.stdout.write(`${JSON.stringify({
  status: finalReport.status,
  scheduled: finalReport.scheduled,
  completed: finalReport.completed,
  skipped: finalReport.skipped,
  failed: finalReport.failed,
  elapsedMs: finalReport.elapsedMs,
  reportPath,
}, null, 2)}\n`);
if (failures.length > 0 || completed.length !== jobs.length) process.exitCode = 2;
