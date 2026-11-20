import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const workspaceRoot = path.resolve(import.meta.dirname, '..', '..');
const projectRoot = path.join(workspaceRoot, '实测', 'CocoRepublic_2026-10-22', 'generated-site-v1');
const capturePath = path.join(
  workspaceRoot,
  '交付文件',
  '拆网站_V2.9_联调可执行修正版_2026-09-09',
  'PACKAGE',
  '08_POC_SOURCE_PATCHED',
  'src',
  'capture',
  'chromium-capture.mjs',
);
const capture = await import(pathToFileURL(capturePath));
const { afterSettleStateExpression, closeDelayedPopupExpression } = await import(pathToFileURL(path.join(projectRoot, 'scripts', 'lib', 'capture-state.mjs')));
const sourceUrl = process.env.MATBOX_SOURCE_URL || 'https://www.cocorepublic.com.au/';
const chromePath = process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const outputRoot = path.join(import.meta.dirname, 'results', `live-homepage-timing-${runId}`);
await fs.mkdir(outputRoot, { recursive: true });

const preparationExpression = `(async () => {
  for (const image of document.images) {
    image.loading = 'eager';
    const deferred = image.dataset.src || image.dataset.lazySrc || image.dataset.original;
    if (deferred && (!image.getAttribute('src') || image.getAttribute('src').startsWith('data:'))) image.src = deferred;
  }
  document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
  document.body?.style.setProperty('scroll-behavior', 'auto', 'important');
  return true;
})()`;

function summarizeHtml(html = '') {
  return {
    bytes: Buffer.byteLength(html),
    textCharacters: html.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length,
    images: (html.match(/<img\b/gi) || []).length,
    anchors: (html.match(/<a\b/gi) || []).length,
    buttons: (html.match(/<button\b/gi) || []).length,
  };
}

function timingBreakdown(elapsedMs, result) {
  const timings = result.metadata?.captureTimings || {};
  const navigationAndCollect = Number(timings.navigationMs || 0) + Number(timings.collectTotalMs || 0);
  return {
    totalMs: elapsedMs,
    browserLaunchAndCloseMs: Math.max(0, elapsedMs - navigationAndCollect),
    navigationAndReadyMs: timings.pageNavigationAndReadyMs ?? null,
    beforeCollectHooksMs: timings.beforeCollectHooksMs ?? null,
    initialVisualSettleMs: timings.settleVisualDocumentMs ?? 0,
    fixedDelayedMountWaitMs: timings.afterSettleExpressionMs ?? 0,
    observedReadinessMs: timings.observedReadinessMs ?? 0,
    postWaitVisualSettleMs: timings.postObservedReadinessSettleMs ?? timings.postExpressionSettleVisualDocumentMs ?? 0,
    videoFreezeMs: Number(timings.browserVideoFreezeMs || 0) + Number(timings.postBrowserVideoFreezeSettleMs || 0),
    iframeFreezeMs: timings.browserIframeFreezeMs ?? 0,
    freezeStateMs: timings.freezeStateMs ?? 0,
    postFreezeResourceSettleMs: timings.postFreezeResourceSettleMs ?? 0,
    inventoryMs: timings.inventoryMs ?? 0,
    assetCollectionMs: timings.assetCollectionMs ?? 0,
    imageFallbackMs: Number(timings.browserImageFallbackFreezeMs || 0) + Number(timings.postScreenshotImageFallbackFreezeMs || 0),
    screenshotMs: timings.screenshotMs ?? 0,
    htmlSerializationMs: timings.renderedDocumentMs ?? 0,
    analysisMs: timings.analysisMs ?? 0,
    captureCoreTotalMs: timings.collectTotalMs ?? 0,
  };
}

async function run(label, methodOptions) {
  const startedAt = performance.now();
  const result = await capture.capturePage(sourceUrl, {
    chromiumPath: chromePath,
    viewport: { width: 1440, height: 900, mobile: false },
    artifactProfile: 'replay',
    timeoutMs: 30000,
    allowNetwork: true,
    requestGuard: false,
    profileRoot: path.join(outputRoot, `${label}-profiles`),
    beforeCollectExpression: preparationExpression,
    beforeSnapshotExpression: closeDelayedPopupExpression,
    ...methodOptions,
  });
  const elapsedMs = Math.round(performance.now() - startedAt);
  await Promise.all([
    fs.writeFile(path.join(outputRoot, `${label}.html`), result.renderedDocument.html, 'utf8'),
    fs.writeFile(path.join(outputRoot, `${label}.png`), result.screenshot),
  ]);
  return {
    pass: true,
    timing: timingBreakdown(elapsedMs, result),
    content: summarizeHtml(result.renderedDocument.html),
    interactiveElements: result.interactiveElements?.length || 0,
    visualReadiness: {
      fontsReady: result.metadata?.visualReadiness?.fontsReady === true,
      pendingImages: result.metadata?.visualReadiness?.pendingImages ?? null,
      failedImages: result.metadata?.visualReadiness?.failedImages ?? null,
      pendingStylesheets: result.metadata?.visualReadiness?.pendingStylesheets ?? null,
      failedStylesheets: result.metadata?.visualReadiness?.failedStylesheets ?? null,
    },
    observedReadiness: result.metadata?.observedReadiness ? {
      reason: result.metadata.observedReadiness.reason,
      waitedMs: result.metadata.observedReadiness.waitedMs,
      pendingRelevantRequests: result.metadata.observedReadiness.pendingRelevantRequests,
      pendingEnhancementRequests: result.metadata.observedReadiness.pendingEnhancementRequests,
    } : null,
  };
}

async function runAndPersist(label, methodOptions) {
  try {
    const result = await run(label, methodOptions);
    await fs.writeFile(
      path.join(outputRoot, `${label}-result.json`),
      `${JSON.stringify(result, null, 2)}\n`,
      'utf8',
    );
    return result;
  } catch (error) {
    const failure = {
      pass: false,
      error: {
        name: error?.name || 'Error',
        code: error?.code || null,
        message: error?.message || String(error),
        stack: error?.stack || null,
        details: error?.details || null,
      },
    };
    await fs.writeFile(
      path.join(outputRoot, `${label}-error.json`),
      `${JSON.stringify(failure, null, 2)}\n`,
      'utf8',
    );
    return failure;
  }
}

const requestedMethod = String(process.env.MATBOX_TIMING_METHOD || 'both').toLowerCase();
const runFixed = requestedMethod === 'both' || requestedMethod === 'fixed-wait';
const runObserved = requestedMethod === 'both' || requestedMethod === 'event-driven';

const fixed = runFixed
  ? await runAndPersist('fixed-wait', { afterSettleExpression: afterSettleStateExpression })
  : null;
const observed = runObserved
  ? await runAndPersist('event-driven', {
    observedReadiness: { quietWindowMs: 500, maxWaitMs: 10000, pollIntervalMs: 100 },
  })
  : null;

const timingSavings = {};
for (const key of Object.keys(fixed?.timing || {})) {
  const before = Number(fixed.timing[key] || 0);
  const after = Number(observed?.timing?.[key] || 0);
  timingSavings[key] = {
    beforeMs: before,
    afterMs: after,
    savedMs: before - after,
    savedPercent: before > 0 ? Number((((before - after) / before) * 100).toFixed(2)) : null,
  };
}
const contentParity = fixed?.content && observed?.content
  ? Object.fromEntries(Object.keys(fixed.content).map((key) => [key, fixed.content[key] === observed.content[key]]))
  : null;
const report = {
  generatedAt: new Date().toISOString(),
  sourceUrl,
  viewport: { width: 1440, height: 900 },
  executionOrder: [runFixed ? 'fixed-wait' : null, runObserved ? 'event-driven' : null].filter(Boolean),
  fixed,
  observed,
  timingSavings,
  contentParity,
  pass: Boolean(fixed?.pass && observed?.pass
    && fixed.visualReadiness.fontsReady && observed.visualReadiness.fontsReady
    && fixed.visualReadiness.pendingImages === 0 && observed.visualReadiness.pendingImages === 0),
};
await fs.writeFile(path.join(outputRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({
  outputRoot,
  requestedMethod,
  fixedPass: fixed?.pass ?? null,
  observedPass: observed?.pass ?? null,
  fixedError: fixed?.error?.message ?? null,
  observedError: observed?.error?.message ?? null,
  reportPass: report.pass,
})}\n`);
if ((runFixed && !fixed?.pass) || (runObserved && !observed?.pass)) process.exitCode = 2;
