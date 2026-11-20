import fs from 'node:fs/promises';
import path from 'node:path';
import { captureHtml, capturePageBatch, capturePagePool } from '../../../../交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/src/capture/chromium-capture.mjs';
import { createInvalidCaptureError } from '../../../../交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/src/capture/capture-failure-policy.mjs';
import { routeFilename } from './lib/site-inventory.mjs';
import { evaluatePipelineBudget, resolveWorkerCount } from './lib/pipeline-budget.mjs';
import { validateCapturedPage } from './lib/capture-validation.mjs';
import { stableStateExpression, closeDelayedPopupExpression, afterSettleStateExpression, afterTrustedCommerceClickExpression } from './lib/capture-state.mjs';
import { validateRouteManifestEntries, writeAtomicVerified } from './lib/verified-write.mjs';
import { runPersistentRetryBatches } from './lib/persistent-retry-batches.mjs';
import { withPersistentBrowserRetry } from './lib/retry-capture-policy.mjs';
import { evaluateCaptureCoverage, isSourceProtectedFailure } from './lib/capture-coverage.mjs';
import { CAPTURE_CONTRACT_VERSION, captureContentSha256, isReusableCaptureMetadata } from './lib/capture-cache.mjs';
import { prepareSourceHtmlForStaticCapture, resolveCaptureSourceUrl, resolveSourceOrigin } from './lib/source-origin.mjs';
import {
  classifyCaptureFailure,
  evaluateCanaryCaptureHealth,
  mergeCaptureAttempts,
  runSupervisedCaptureChunks,
  selectRepresentativeCanaryJobs,
} from './lib/capture-batch-supervisor.mjs';
import { recoveryFailuresFromCaptures, runTargetedRecovery } from './lib/targeted-recovery-runner.mjs';

const root = path.resolve(import.meta.dirname, '..');
process.env.MATBOX_PERSISTENT_RESOURCE_CACHE_DIR ||= path.join(root, 'artifacts', 'full-site-audit', 'persistent-resource-cache');
const inventoryPath = path.join(root, 'artifacts', 'full-site-audit', 'route-inventory.json');
const inventory = JSON.parse(await fs.readFile(inventoryPath, 'utf8'));
const sourceOrigin = resolveSourceOrigin({ envValue: process.env.MATBOX_SOURCE_URL, inventorySource: inventory.source });
const recoverySiteId = new URL(sourceOrigin).hostname.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const recoveryLedgerPath = path.join(root, 'artifacts', 'full-site-audit', 'recovery', recoverySiteId, 'ledger.json');
const replayRoot = path.join(root, 'src', 'replay');
const viewportName = process.argv.find((arg) => arg.startsWith('--viewport='))?.slice(11) || 'desktop';
if (!['desktop', 'mobile', 'both'].includes(viewportName)) throw new Error(`Unknown viewport: ${viewportName}`);
const viewportNames = viewportName === 'both' ? ['desktop', 'mobile'] : [viewportName];
const viewportDefinitions = {
  desktop: { width: 1440, height: 900, mobile: false },
  mobile: { width: 390, height: 844, mobile: true },
};
const routeManifestPath = (viewport) => path.join(replayRoot, viewport === 'mobile' ? 'routes-mobile.json' : 'routes.json');
const goldenRoot = path.join(root, 'artifacts', 'full-site-audit', 'golden');
const profileRoot = path.join(root, 'artifacts', 'browser-profiles');
const startedAt = Date.now();
const workerCount = resolveWorkerCount(process.env.MATBOX_WORKERS);
const resumeMode = process.env.MATBOX_RESUME === '1';
await fs.mkdir(goldenRoot, { recursive: true });
const selectedRoutes = process.argv.filter((arg) => arg.startsWith('--route=')).map((arg) => arg.slice(8));
const sourceUrlOverride = process.argv.find((arg) => arg.startsWith('--source-url='))?.slice(13) || null;
const httpSeedMode = process.argv.includes('--http-seed');
const sourceHtmlFileArg = process.argv.find((arg) => arg.startsWith('--source-html-file='))?.slice(19) || null;
const sourceAssetMapArg = process.argv.find((arg) => arg.startsWith('--source-asset-map='))?.slice(19) || null;
const candidateOnly = process.argv.includes('--candidate-only');
const isPartialCapture = selectedRoutes.length > 0;
let targets;
if (isPartialCapture) {
  targets = [...new Set(selectedRoutes)];
} else {
  if (!Array.isArray(inventory.routes) || inventory.routes.length !== Number(inventory.routeCount)) throw new Error('Route inventory is incomplete');
  targets = inventory.routes;
}
const routesByViewport = {};
for (const viewport of viewportNames) {
  let existingRoutes = {};
  try { existingRoutes = JSON.parse(await fs.readFile(routeManifestPath(viewport), 'utf8')); } catch {}
  routesByViewport[viewport] = isPartialCapture || resumeMode ? existingRoutes : {};
}
function slug(route) { return routeFilename(route).replace(/^route-|\.html$/g, ''); }
function jobKey(route, viewport) { return `${viewport}:${route}`; }
function createJob(route, viewport) {
  return {
    url: resolveCaptureSourceUrl({
      sourceOrigin,
      route,
      explicitUrl: sourceUrlOverride,
      selectedRouteCount: selectedRoutes.length,
    }),
    route,
    viewportName: viewport,
    viewport: viewportDefinitions[viewport],
    key: jobKey(route, viewport),
  };
}

async function persistCapture(route, viewport, result) {
  const validation = validateCapturedPage(result);
  if (!validation.pass) throw createInvalidCaptureError({ channel: 'source', route, failures: validation.failures, result });
  const filename = viewport === 'mobile' ? routeFilename(route).replace(/\.html$/, '-mobile.html') : routeFilename(route);
  const replayHtml = result.renderedDocument.html;
  const screenshot = result.screenshot;
  await writeAtomicVerified(path.join(replayRoot, filename), replayHtml);
  await writeAtomicVerified(path.join(goldenRoot, `${slug(route)}-${viewport}.png`), screenshot);
  await writeAtomicVerified(path.join(goldenRoot, `${slug(route)}-${viewport}.json`), `${JSON.stringify({
    captureContractVersion: CAPTURE_CONTRACT_VERSION,
    route,
    capturedAt: new Date().toISOString(),
    sourceUrl: result.renderedDocument.sourceUrl,
    metadata: result.metadata,
    interactiveElements: result.interactiveElements,
    links: result.links,
    contentHashes: {
      replaySha256: captureContentSha256(replayHtml),
      screenshotSha256: captureContentSha256(screenshot),
    },
  }, null, 2)}\n`, 'utf8');
  routesByViewport[viewport][route] = filename;
  return { route, viewport, filename, interactions: result.interactiveElements.length, links: result.links.length };
}

async function persistCandidateCapture(route, viewport, result) {
  const validation = validateCapturedPage(result);
  const candidateRoot = path.join(root, 'artifacts', 'full-site-audit', 'recovery', 'candidates');
  await fs.mkdir(candidateRoot, { recursive: true });
  const prefix = path.join(candidateRoot, `${slug(route)}-${viewport}`);
  await writeAtomicVerified(`${prefix}.png`, result.screenshot);
  await writeAtomicVerified(`${prefix}.html`, result.renderedDocument.html);
  await writeAtomicVerified(`${prefix}.json`, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    candidateOnly: true,
    route,
    viewport,
    pass: validation.pass,
    failures: validation.failures,
    metadata: result.metadata,
    sourceUrl: result.renderedDocument.sourceUrl,
  }, null, 2)}\n`);
  return { route, viewport, candidateOnly: true, pass: validation.pass, failures: validation.failures };
}

const results = [];
const failures = [];
const captureOptions = () => ({
  chromiumPath: process.env.MATBOX_CHROMIUM_PATH,
  artifactProfile: 'replay',
  timeoutMs: 60000,
  requestGuard: false,
  allowNetwork: true,
  profileRoot,
  beforeCollectExpression: stableStateExpression,
  beforeCollectTrustedClickSelector: '#searchspring-category .ss-load-more',
  afterTrustedClickExpression: afterTrustedCommerceClickExpression,
  afterSettleExpression: afterSettleStateExpression,
  beforeSnapshotExpression: closeDelayedPopupExpression,
  attempts: 1,
  retryDelayMs: 0,
  validateResult(result, url, entry) {
    const route = entry?.route ?? new URL(url).pathname;
    const validation = validateCapturedPage(result);
    if (!validation.pass) throw createInvalidCaptureError({ channel: 'source', route, failures: validation.failures, result });
  },
  async onResult(result, url, entry) {
    const route = entry?.route ?? new URL(url).pathname;
    const viewport = entry?.viewportName ?? viewportName;
    const saved = await persistCapture(route, viewport, result);
    results.push(saved);
    process.stdout.write(`${results.length}/${allJobs.length} CAPTURED ${viewport} ${route} interactions=${saved.interactions}\n`);
  },
});
const allJobs = targets.flatMap((route) => viewportNames.map((viewport) => createJob(route, viewport)));
if (resumeMode) {
  for (const job of allJobs) {
    const filename = routesByViewport[job.viewportName]?.[job.route];
    if (!filename) continue;
    const prefix = path.join(goldenRoot, `${slug(job.route)}-${job.viewportName}`);
    try {
      const replayPath = path.join(replayRoot, filename);
      const [metadataText, screenshot, replayHtml] = await Promise.all([
        fs.readFile(`${prefix}.json`, 'utf8'),
        fs.readFile(`${prefix}.png`),
        fs.readFile(replayPath),
      ]);
      const metadata = JSON.parse(metadataText);
      if (!isReusableCaptureMetadata(metadata, {
        route: job.route,
        sourceUrl: job.url,
        replaySha256: captureContentSha256(replayHtml),
        screenshotSha256: captureContentSha256(screenshot),
      })) continue;
      results.push({ route: job.route, viewport: job.viewportName, filename, interactions: metadata.interactiveElements?.length ?? 0, links: metadata.links?.length ?? 0, reused: true });
    } catch {}
  }
}
const completedKeys = new Set(results.map((result) => jobKey(result.route, result.viewport)));
const jobs = allJobs.filter((job) => !completedKeys.has(job.key));
const jobByKey = new Map(allJobs.map((job) => [job.key, job]));
const canaryRouteCount = Math.max(1, Number.parseInt(process.env.MATBOX_CANARY_ROUTES || '8', 10) || 8);
const canaryJobs = selectRepresentativeCanaryJobs(jobs, canaryRouteCount);
const canaryKeys = new Set(canaryJobs.map((job) => job.key));
const remainingJobs = jobs.filter((job) => !canaryKeys.has(job.key));
const canaryWorkerCount = Math.min(2, workerCount, canaryJobs.length || 1);
const captureChunkSize = Math.max(1, Number.parseInt(process.env.MATBOX_CAPTURE_CHUNK_SIZE || '16', 10) || 16);
const captureStatusByKey = new Map(allJobs.map((job) => [job.key, {
  route: job.route,
  viewport: job.viewportName,
  status: completedKeys.has(job.key) ? 'completed' : 'pending',
}]));

async function persistRouteManifests() {
  for (const viewport of viewportNames) {
    const routes = routesByViewport[viewport];
    const manifestPath = routeManifestPath(viewport);
    await writeAtomicVerified(manifestPath, `${JSON.stringify(Object.fromEntries(Object.entries(routes).sort()), null, 2)}\n`);
    validateRouteManifestEntries(await fs.readFile(manifestPath), routes);
  }
}

function recordCaptureStatuses(captures) {
  for (const capture of captures) {
    const job = jobByKey.get(capture.key);
    if (!job) continue;
    if (capture.ok) {
      captureStatusByKey.set(job.key, { route: job.route, viewport: job.viewportName, status: 'completed' });
      continue;
    }
    if (isSourceProtectedFailure({ route: job.route, error: capture.error })) {
      captureStatusByKey.set(job.key, {
        route: job.route,
        viewport: job.viewportName,
        status: 'source-protected',
        error: String(capture.error || '').split(/\r?\n/)[0],
      });
      continue;
    }
    const classification = classifyCaptureFailure(capture.error);
    const status = classification.kind === 'shared-resource'
      ? 'waiting-shared-resource'
      : classification.kind === 'infrastructure'
        ? 'infrastructure-deferred'
        : 'page-failed';
    captureStatusByKey.set(job.key, {
      route: job.route,
      viewport: job.viewportName,
      status,
      error: String(capture.error || '').split(/\r?\n/)[0],
    });
  }
}

async function writeCaptureProgress(phase, circuit = null) {
  const entries = [...captureStatusByKey.values()];
  const counts = Object.fromEntries([...new Set(entries.map((entry) => entry.status))]
    .sort()
    .map((status) => [status, entries.filter((entry) => entry.status === status).length]));
  await writeAtomicVerified(path.join(goldenRoot, 'capture-progress.json'), `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    phase,
    counts,
    circuit,
    entries,
  }, null, 2)}\n`);
}

if (httpSeedMode) {
  if (!sourceUrlOverride || selectedRoutes.length !== 1) {
    throw new Error('--http-seed requires exactly one --route and one --source-url');
  }
  let sourceHtml;
  let finalSourceUrl = sourceUrlOverride;
  if (sourceHtmlFileArg) {
    const sourceHtmlPath = path.resolve(root, sourceHtmlFileArg);
    const relative = path.relative(root, sourceHtmlPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('--source-html-file must stay inside the project root');
    sourceHtml = await fs.readFile(sourceHtmlPath, 'utf8');
  } else {
    const response = await fetch(sourceUrlOverride, {
      redirect: 'follow',
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-AU,en;q=0.9',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      },
    });
    if (!response.ok) throw new Error(`HTTP source recovery failed: ${response.status} ${response.statusText}`);
    const contentType = response.headers.get('content-type') || '';
    if (!/text\/html/i.test(contentType)) throw new Error(`HTTP source recovery expected HTML, received: ${contentType}`);
    sourceHtml = await response.text();
    finalSourceUrl = response.url || sourceUrlOverride;
  }
  const assetDataByUrl = {};
  if (sourceAssetMapArg) {
    const mapPath = path.resolve(root, sourceAssetMapArg);
    const mapRelative = path.relative(root, mapPath);
    if (mapRelative.startsWith('..') || path.isAbsolute(mapRelative)) throw new Error('--source-asset-map must stay inside the project root');
    const map = JSON.parse(await fs.readFile(mapPath, 'utf8'));
    for (const [url, entry] of Object.entries(map)) {
      const assetPath = path.resolve(root, entry.file);
      const relative = path.relative(root, assetPath);
      if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Source asset must stay inside the project root: ${entry.file}`);
      const bytes = await fs.readFile(assetPath);
      assetDataByUrl[new URL(url).href] = `data:${entry.mime};base64,${bytes.toString('base64')}`;
    }
  }
  const seededHtml = prepareSourceHtmlForStaticCapture(sourceHtml, finalSourceUrl, assetDataByUrl);
  const route = selectedRoutes[0];
  for (const viewport of viewportNames) {
    const result = await captureHtml(seededHtml, {
      ...captureOptions(),
      viewport: viewportDefinitions[viewport],
    });
    result.renderedDocument.sourceUrl = finalSourceUrl;
    result.renderedDocument.html = prepareSourceHtmlForStaticCapture(result.renderedDocument.html, finalSourceUrl, assetDataByUrl);
    const saved = candidateOnly
      ? await persistCandidateCapture(route, viewport, result)
      : await persistCapture(route, viewport, result);
    results.push(saved);
    process.stdout.write(`${results.length}/${viewportNames.length} ${candidateOnly ? 'HTTP_SEED_CANDIDATE' : 'HTTP_SEED_CAPTURED'} ${viewport} ${route}${candidateOnly ? ` pass=${saved.pass}` : ` interactions=${saved.interactions}`}\n`);
  }
  if (!candidateOnly) await persistRouteManifests();
  process.stdout.write(`${JSON.stringify({ route, capturedCount: results.length, failureCount: results.filter((result) => result.pass === false).length, mode: candidateOnly ? 'http-seed-candidate' : 'http-seed' }, null, 2)}\n`);
  process.exit(0);
}

async function recordCaptureRecoveryFailures(captures) {
  const failuresToRecord = recoveryFailuresFromCaptures(captures);
  if (!failuresToRecord.length) return;
  await runTargetedRecovery({
    siteId: recoverySiteId,
    failures: failuresToRecord,
    handlers: {},
    ledgerPath: recoveryLedgerPath,
    maxRetryWaves: 0,
  });
}

let browserLaunchCount = canaryJobs.length ? canaryWorkerCount : 0;
process.stdout.write(`WORKERS canaryBrowsers=${canaryWorkerCount} fullBrowsers=${Math.min(2, workerCount)} chunkSize=${captureChunkSize} routes=${targets.length} captures=${allJobs.length} pending=${jobs.length} reused=${results.length} viewports=${viewportNames.join(',')} scheduling=canary-then-supervised-chunks\n`);
const initialCanaryCaptures = canaryJobs.length ? await capturePagePool(canaryJobs, { ...captureOptions(), workerCount: canaryWorkerCount }) : [];
const canaryRetryCandidates = initialCanaryCaptures.filter((capture) => {
  if (capture.ok) return false;
  const job = jobByKey.get(capture.key);
  return !isSourceProtectedFailure({ route: job?.route, error: capture.error });
});
const canaryInitialErrorByKey = new Map(canaryRetryCandidates.map((capture) => [capture.key, capture.error]));
const canaryRetryResults = canaryRetryCandidates.length ? await runPersistentRetryBatches(canaryRetryCandidates.map(({ key }) => key), async (retryKeys) => {
  browserLaunchCount += 1;
  const captures = await capturePageBatch(
    retryKeys.map((key) => jobByKey.get(key)),
    withPersistentBrowserRetry(captureOptions()),
  );
  return captures.map((capture) => ({
    item: capture.key,
    ok: capture.ok,
    value: capture,
    error: capture.error || canaryInitialErrorByKey.get(capture.key),
  }));
}, {
  initialWorkers: Math.min(2, workerCount, canaryRetryCandidates.length),
  maxRetryWaves: 2,
  onWave({ attempt, attempted, succeeded, retrying, workerCount: retryWorkers }) {
    process.stdout.write(`CANARY_RETRY wave=${attempt} browsers=${retryWorkers} attempted=${attempted} succeeded=${succeeded} retrying=${retrying}\n`);
  },
}) : [];
const canaryCaptures = mergeCaptureAttempts(initialCanaryCaptures, canaryRetryResults);
recordCaptureStatuses(canaryCaptures);
await recordCaptureRecoveryFailures(canaryCaptures);
await persistRouteManifests();
const canaryFailureCount = canaryCaptures.filter((capture) => !capture.ok).length;
const canaryHealth = evaluateCanaryCaptureHealth(canaryCaptures, {
  resolveRoute: (capture) => jobByKey.get(capture.key)?.route ?? new URL(capture.url).pathname,
  isProtected: isSourceProtectedFailure,
});
const preflightReport = {
  generatedAt: new Date().toISOString(),
  pass: canaryHealth.pass,
  code: canaryHealth.code || null,
  requestedRouteCount: canaryJobs.length,
  completedRouteCount: canaryCaptures.length,
  failureCount: canaryFailureCount,
  sourceProtectedCount: canaryHealth.sourceProtectedCount,
  unhandledFailureCount: canaryHealth.unhandledFailureCount,
  health: canaryHealth,
  routes: canaryJobs.map((job) => job.route),
  failures: canaryCaptures.filter((capture) => !capture.ok).map((capture) => ({
    route: jobByKey.get(capture.key)?.route ?? new URL(capture.url).pathname,
    error: capture.error,
  })),
};
await writeAtomicVerified(path.join(goldenRoot, 'capture-preflight.json'), `${JSON.stringify(preflightReport, null, 2)}\n`);
await writeCaptureProgress('canary', canaryHealth.pass ? null : canaryHealth);
if (!canaryHealth.pass) {
  throw new Error(`Capture preflight circuit opened: ${canaryHealth.code}; failures=${canaryFailureCount}`);
}
const supervised = remainingJobs.length ? await runSupervisedCaptureChunks(remainingJobs, async (chunkJobs) => {
  const chunkWorkers = Math.min(2, workerCount, chunkJobs.length);
  browserLaunchCount += chunkWorkers;
  return capturePagePool(chunkJobs, { ...captureOptions(), workerCount: chunkWorkers });
}, {
  chunkSize: captureChunkSize,
  async onChunk({ chunkCaptures, health, pendingJobs }) {
    recordCaptureStatuses(chunkCaptures);
    await persistRouteManifests();
    await writeCaptureProgress('full-capture', health.pass ? null : health);
    process.stdout.write(`CAPTURE_CHUNK completed=${chunkCaptures.length} pending=${pendingJobs.length} health=${health.pass ? 'pass' : health.code}\n`);
  },
}) : { pass: true, code: null, captures: [], pendingJobs: [] };
await recordCaptureRecoveryFailures(supervised.captures);
const remainingCaptures = supervised.captures;
if (!supervised.pass) {
  throw new Error(`Full capture circuit opened: ${supervised.code}; pending=${supervised.pendingJobs.length}`);
}
const firstPass = [...canaryCaptures, ...remainingCaptures];
const firstPassFailures = firstPass
  .filter((capture) => !capture.ok)
  .map((capture) => ({
    key: capture.key,
    route: jobByKey.get(capture.key)?.route ?? new URL(capture.url).pathname,
    viewport: jobByKey.get(capture.key)?.viewportName,
    error: capture.error,
  }));
for (const failure of firstPassFailures) {
  process.stdout.write(`FIRST_PASS_FAILED ${failure.viewport} ${failure.route} detail=${String(failure.error || 'unknown error').split(/\r?\n/)[0]}\n`);
}
const terminalFailures = firstPassFailures.filter(isSourceProtectedFailure);
const retryableFailures = firstPassFailures.filter((failure) => !isSourceProtectedFailure(failure));
for (const failure of terminalFailures) {
  failures.push({ route: failure.route, viewport: failure.viewport, error: failure.error, attempts: 1 });
  process.stdout.write(`${results.length + failures.length}/${allJobs.length} SOURCE_PROTECTED ${failure.viewport} ${failure.route} attempts=1\n`);
}
const initialErrorByKey = new Map(retryableFailures.map((failure) => [failure.key, failure.error]));
const queueResults = retryableFailures.length ? await runPersistentRetryBatches(retryableFailures.map(({ key }) => key), async (retryKeys) => {
  browserLaunchCount += 1;
  const captures = await capturePageBatch(
    retryKeys.map((key) => jobByKey.get(key)),
    withPersistentBrowserRetry(captureOptions()),
  );
  return captures.map((capture) => {
    return {
      item: capture.key,
      ok: capture.ok,
      value: capture,
      error: capture.error || initialErrorByKey.get(capture.key),
    };
  });
}, {
  initialWorkers: Math.min(2, retryableFailures.length),
  maxRetryWaves: 3,
  onWave({ attempt, attempted, succeeded, retrying, workerCount: retryWorkers }) {
    process.stdout.write(`RETRY_WAVE wave=${attempt} browsers=${retryWorkers} attempted=${attempted} succeeded=${succeeded} retrying=${retrying}\n`);
  },
}) : [];
for (const item of queueResults.filter((entry) => !entry.ok)) {
  const job = jobByKey.get(item.item);
  failures.push({ route: job.route, viewport: job.viewportName, error: item.error, attempts: item.attempts + 1 });
  process.stdout.write(`${results.length + failures.length}/${allJobs.length} ERROR ${job.viewportName} ${job.route} attempts=${item.attempts + 1} detail=${String(item.error || 'unknown error').split(/\r?\n/)[0]}\n`);
}
await persistRouteManifests();
const elapsedMs = Date.now() - startedAt;
const budget = evaluatePipelineBudget(elapsedMs);
const captureCoverage = evaluateCaptureCoverage({ total: allJobs.length, captured: results.length, failures });
const report = { generatedAt: new Date().toISOString(), viewport: viewportName, routeCount: targets.length, targetCount: allJobs.length, capturedCount: results.length, reusedCount: results.filter((result) => result.reused).length, failureCount: failures.length, sourceProtectedCount: captureCoverage.sourceProtectedCount, workerCount, browserLaunchCount, elapsedMs, budget, captureCoverage, results, failures };
await writeAtomicVerified(path.join(goldenRoot, 'capture-summary.json'), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ routeCount: targets.length, targetCount: allJobs.length, capturedCount: results.length, failureCount: failures.length, sourceProtectedCount: captureCoverage.sourceProtectedCount, coverage: captureCoverage.coverage }, null, 2)}\n`);
if (!captureCoverage.pass) process.exitCode = 1;
