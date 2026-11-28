import fs from 'node:fs/promises';
import path from 'node:path';
import { capturePage, capturePageBatch, capturePagePool } from '../src/import-core/capture/chromium-capture.mjs';
import pngjs from 'pngjs';
import { evaluateFidelityGate, visualReadinessParity } from './lib/fidelity-gate.mjs';
import { routeFilename } from './lib/site-inventory.mjs';
import { evaluatePipelineBudget, resolveWorkerCount, retryTransient } from './lib/pipeline-budget.mjs';
import { validateCapturedPage } from './lib/capture-validation.mjs';
import { stableStateExpression, afterSettleStateExpression } from './lib/capture-state.mjs';
import { assertAuditCaptureReady } from './lib/audit-capture-validation.mjs';
import { withPersistentBrowserRetry } from './lib/retry-capture-policy.mjs';
import { runPersistentRetryBatches } from './lib/persistent-retry-batches.mjs';
import { resolveSourceOrigin } from './lib/source-origin.mjs';
import { fidelityViewports } from './lib/audit-viewports.mjs';

const { PNG } = pngjs;
const root = path.resolve(import.meta.dirname, '..');
const inventory = JSON.parse(await fs.readFile(path.join(root, 'artifacts', 'full-site-audit', 'route-inventory.json'), 'utf8'));
const sourceOrigin = resolveSourceOrigin({ envValue: process.env.MATBOX_SOURCE_URL, inventorySource: inventory.source });
const evidenceRoot = path.join(root, 'artifacts', 'full-site-audit', 'fidelity');
const startedAt = Date.now();
const workerCount = resolveWorkerCount(process.env.MATBOX_WORKERS);
await fs.mkdir(evidenceRoot, { recursive: true });
const routeManifest = JSON.parse(await fs.readFile(path.join(root, 'src', 'replay', 'routes.json'), 'utf8'));
const localOrigin = (process.env.MATBOX_LOCAL_ORIGIN || 'http://127.0.0.1:4173').replace(/\/+$/, '');
const selectedRoutes = process.argv.filter((arg) => arg.startsWith('--route=')).map((arg) => arg.slice(8));
const selectedViewport = process.argv.find((arg) => arg.startsWith('--viewport='))?.slice(11);
const routes = selectedRoutes.length ? [...new Set(selectedRoutes)] : Object.keys(routeManifest).sort();
const viewports = fidelityViewports;
const viewportEntries = selectedViewport ? [[selectedViewport, viewports[selectedViewport]]] : Object.entries(viewports);
if (viewportEntries.some(([, value]) => !value)) throw new Error(`Unknown viewport: ${selectedViewport}`);
function slug(route) { return routeFilename(route).replace(/^route-|\.html$/g, ''); }

function similarityOf(referenceBuffer, candidateBuffer) {
  const reference = PNG.sync.read(referenceBuffer);
  const candidate = PNG.sync.read(candidateBuffer);
  const width = Math.max(reference.width, candidate.width);
  const height = Math.max(reference.height, candidate.height);
  const left = new PNG({ width, height }); left.data.fill(255);
  const right = new PNG({ width, height }); right.data.fill(255);
  PNG.bitblt(reference, left, 0, 0, reference.width, reference.height, 0, 0);
  PNG.bitblt(candidate, right, 0, 0, candidate.width, candidate.height, 0, 0);
  let squaredError = 0;
  for (let index = 0; index < left.data.length; index += 4) {
    for (let channel = 0; channel < 3; channel++) {
      const delta = left.data[index + channel] - right.data[index + channel];
      squaredError += delta * delta;
    }
  }
  return {
    similarity: 1 - Math.sqrt(squaredError / (width * height * 3)) / 255,
    exactSize: reference.width === candidate.width && reference.height === candidate.height,
    originalSize: [reference.width, reference.height],
    localSize: [candidate.width, candidate.height],
  };
}

async function capture(url, viewport) {
  return capturePage(url, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH,
    artifactProfile: 'replay',
    timeoutMs: 60000,
    requestGuard: false,
    allowNetwork: true,
    viewport,
    profileRoot: path.join(root, 'artifacts', 'browser-profiles'),
    beforeCollectExpression: stableStateExpression,
    afterSettleExpression: afterSettleStateExpression,
  });
}

function localUrlFor(route, viewportName) {
  return `${localOrigin}${route}?full-site-audit=1&matbox-viewport=${viewportName}`;
}

async function auditCell(route, viewportName, viewport, capturedLocal) {
  const originalUrl = `${sourceOrigin}${route}`;
  const localUrl = localUrlFor(route, viewportName);
  const goldenPrefix = path.join(root, 'artifacts', 'full-site-audit', 'golden', `${slug(route)}-${viewportName}`);
  let original;
  try {
    const [screenshot, metadataText] = await Promise.all([fs.readFile(`${goldenPrefix}.png`), fs.readFile(`${goldenPrefix}.json`, 'utf8')]);
    const stored = JSON.parse(metadataText);
    original = { screenshot, metadata: stored.metadata, interactiveElements: stored.interactiveElements ?? [] };
  } catch {
    original = await retryTransient(async () => {
      const result = await capture(originalUrl, viewport);
      const validation = validateCapturedPage(result);
      if (!validation.pass) throw new Error(`Invalid Shopify fidelity capture for ${route} ${viewportName}: ${validation.failures.join(', ')}`);
      return result;
    }, { attempts: 3, delayMs: 1500 });
    await fs.writeFile(`${goldenPrefix}.png`, original.screenshot);
    await fs.writeFile(`${goldenPrefix}.json`, `${JSON.stringify({ route, capturedAt: new Date().toISOString(), sourceUrl: original.renderedDocument?.sourceUrl, metadata: original.metadata, interactiveElements: original.interactiveElements ?? [], links: original.links ?? [] }, null, 2)}\n`, 'utf8');
  }
  const local = capturedLocal ?? await retryTransient(() => capture(localUrl, viewport), { attempts: 2, delayMs: 300 });
  assertAuditCaptureReady(local, localUrl);
  const replayName = viewportName === 'mobile' ? routeFilename(route).replace(/\.html$/, '-mobile.html') : routeFilename(route);
  let capturedMarkup = '';
  try { capturedMarkup = await fs.readFile(path.join(root, 'src', 'replay', replayName), 'utf8'); } catch {}
  const localMarkup = local.renderedDocument?.html || '';
  const image = similarityOf(original.screenshot, local.screenshot);
  const originalInteractions = original.interactiveElements.length;
  const localInteractions = local.interactiveElements.length;
  const interactionCoverage = Math.min(originalInteractions, localInteractions) / Math.max(1, originalInteractions);
  const originalReadiness = original.metadata.visualReadiness;
  const localReadiness = local.metadata.visualReadiness;
  const readinessOk = visualReadinessParity(originalReadiness, localReadiness);
  const gate = evaluateFidelityGate({
    similarity: image.similarity,
    exactSize: image.exactSize,
    readinessOk,
    interactionInventoryOk: interactionCoverage >= 0.95,
  });
  const prefix = `${slug(route)}-${viewportName}`;
  await fs.writeFile(path.join(evidenceRoot, `${prefix}-original.png`), original.screenshot);
  await fs.writeFile(path.join(evidenceRoot, `${prefix}-local.png`), local.screenshot);
  await fs.writeFile(path.join(evidenceRoot, `${prefix}-local.html`), localMarkup, 'utf8');
  return {
    route,
    viewport: viewportName,
    ...image,
    readinessOk,
    originalInteractions,
    localInteractions,
    interactionCoverage,
    originalReadiness,
    localReadiness,
    revealState: {
      capturedPending: (capturedMarkup.match(/is-reveal-pending/g) || []).length,
      capturedRevealed: (capturedMarkup.match(/is-revealed/g) || []).length,
      localPending: (localMarkup.match(/is-reveal-pending/g) || []).length,
      localRevealed: (localMarkup.match(/is-revealed/g) || []).length,
    },
    pass: gate.pass,
    failures: gate.failures,
  };
}

const jobs = routes.flatMap((route) => viewportEntries.map(([viewportName, viewport]) => ({ route, viewportName, viewport })));
const results = [];
const errors = [];
const failedCaptureJobs = [];
const localEntries = jobs.map((job) => ({
  url: localUrlFor(job.route, job.viewportName),
  key: `${job.viewportName}:${job.route}`,
  viewport: job.viewport,
}));
const jobsByKey = new Map(jobs.map((job) => [`${job.viewportName}:${job.route}`, job]));
const firstPass = await capturePagePool(localEntries, withPersistentBrowserRetry({
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH,
    artifactProfile: 'replay',
    timeoutMs: 60000,
    requestGuard: false,
    allowNetwork: true,
    workerCount,
    profileRoot: path.join(root, 'artifacts', 'browser-profiles'),
    beforeCollectExpression: stableStateExpression,
    afterSettleExpression: afterSettleStateExpression,
    validateResult(result, url) {
      assertAuditCaptureReady(result, url);
    },
    async onResult(local, url, entry) {
      const job = jobsByKey.get(entry.key);
      const result = await auditCell(job.route, job.viewportName, job.viewport, local);
      results.push(result);
      process.stdout.write(`${results.length}/${jobs.length} ${result.pass ? 'PASS' : 'FAIL'} ${job.viewportName} ${job.route} ${(result.similarity * 100).toFixed(2)}%\n`);
    },
  }));
for (const item of firstPass.filter((entry) => !entry.ok)) {
    const job = jobsByKey.get(item.key);
    failedCaptureJobs.push({ ...job, key: `${job.viewportName}:${job.route}`, error: item.error });
    process.stdout.write(`FIRST_LOCAL_CAPTURE_FAILED ${job.viewportName} ${job.route}\n`);
}
const retryJobByKey = new Map(failedCaptureJobs.map((job) => [job.key, job]));
const retryResults = failedCaptureJobs.length ? await runPersistentRetryBatches(failedCaptureJobs.map((job) => job.key), async (retryKeys) => {
  const retryEntries = retryKeys.map((key) => {
    const job = retryJobByKey.get(key);
    return { url: localUrlFor(job.route, job.viewportName), viewport: job.viewport, key };
  });
  const captures = await capturePageBatch(retryEntries, withPersistentBrowserRetry({
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH,
    artifactProfile: 'replay',
    timeoutMs: 60000,
    requestGuard: false,
    allowNetwork: true,
    profileRoot: path.join(root, 'artifacts', 'browser-profiles'),
    beforeCollectExpression: stableStateExpression,
    afterSettleExpression: afterSettleStateExpression,
    validateResult(result, url) { assertAuditCaptureReady(result, url); },
    async onResult(local, url, entry) {
      const job = retryJobByKey.get(entry.key);
      const result = await auditCell(job.route, job.viewportName, job.viewport, local);
      results.push(result);
      process.stdout.write(`${results.length}/${jobs.length} ${result.pass ? 'PASS' : 'FAIL'} ${job.viewportName} ${job.route} ${(result.similarity * 100).toFixed(2)}%\n`);
    },
  }));
  return captures.map((capture) => ({ item: capture.key, ok: capture.ok, error: capture.error }));
}, {
  initialWorkers: Math.min(2, failedCaptureJobs.length),
  maxRetryWaves: 2,
  onWave({ attempt, attempted, succeeded, retrying, workerCount: retryWorkers }) {
    process.stdout.write(`LOCAL_RETRY_WAVE wave=${attempt} browsers=${retryWorkers} attempted=${attempted} succeeded=${succeeded} retrying=${retrying}\n`);
  },
}) : [];
for (const item of retryResults.filter((entry) => !entry.ok)) {
  const job = retryJobByKey.get(item.item);
  errors.push({ route: job.route, viewport: job.viewportName, error: item.error || job.error });
  process.stdout.write(`${results.length + errors.length}/${jobs.length} ERROR ${job.viewportName} ${job.route}\n`);
}
results.sort((a, b) => a.route.localeCompare(b.route) || a.viewport.localeCompare(b.viewport));
const passing = results.filter((item) => item.pass);
const elapsedMs = Date.now() - startedAt;
const budget = evaluatePipelineBudget(elapsedMs);
const report = {
  generatedAt: new Date().toISOString(),
  threshold: 0.95,
  routeCount: routes.length,
  expectedCells: jobs.length,
  testedCells: results.length,
  passedCells: passing.length,
  failedCells: results.length - passing.length,
  errorCells: errors.length,
  workerCount,
  elapsedMs,
  budget,
  minimumSimilarity: results.length ? Math.min(...results.map((item) => item.similarity)) : null,
  pass: results.length === jobs.length && passing.length === jobs.length && errors.length === 0,
  results,
  errors,
};
await fs.writeFile(path.join(evidenceRoot, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ routeCount: report.routeCount, expectedCells: report.expectedCells, passedCells: report.passedCells, failedCells: report.failedCells, errorCells: report.errorCells, minimumSimilarity: report.minimumSimilarity, pass: report.pass }, null, 2)}\n`);
if (!report.pass) process.exitCode = 2;
