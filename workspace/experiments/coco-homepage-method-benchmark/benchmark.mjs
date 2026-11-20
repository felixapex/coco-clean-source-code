import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const workspaceRoot = path.resolve(import.meta.dirname, '..', '..');
const projectRoot = path.join(workspaceRoot, '实测', 'CocoRepublic_2026-10-22', 'generated-site-v1');
const sharedCapturePath = path.join(
  workspaceRoot,
  '交付文件',
  '拆网站_V2.9_联调可执行修正版_2026-09-09',
  'PACKAGE',
  '08_POC_SOURCE_PATCHED',
  'src',
  'capture',
  'chromium-capture.mjs',
);
const pngPath = path.join(
  workspaceRoot,
  '交付文件',
  '拆网站_V2.9_联调可执行修正版_2026-09-09',
  'PACKAGE',
  '08_POC_SOURCE_PATCHED',
  'node_modules',
  'pngjs',
  'lib',
  'png.js',
);

const sourceUrl = process.env.MATBOX_SOURCE_URL || 'https://www.cocorepublic.com.au/';
const chromePath = process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const requestedMethod = (process.argv.find((item) => item.startsWith('--method='))?.split('=')[1] || '').toUpperCase();
const observedOnlyTimingSpike = process.argv.includes('--observed-only');
const observedReadinessRun = process.argv.includes('--observed-ready');
if (!['A', 'B', 'C'].includes(requestedMethod)) {
  throw new Error('Use --method=A, --method=B, or --method=C');
}

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const outputRoot = path.join(import.meta.dirname, 'results', `${requestedMethod}-${runId}`);
const profileRoot = path.join(outputRoot, 'browser-profile');
await fs.mkdir(outputRoot, { recursive: true });

const capture = await import(pathToFileURL(sharedCapturePath));
const pngjs = await import(pathToFileURL(pngPath));
const componentRegistry = await import(pathToFileURL(path.join(projectRoot, 'scripts', 'lib', 'component-registry.mjs')));
const { auditEditableImportFoundation } = await import(pathToFileURL(path.join(projectRoot, 'scripts', 'lib', 'editable-import-audit.mjs')));
const { validateCapturedPage } = await import(pathToFileURL(path.join(projectRoot, 'scripts', 'lib', 'capture-validation.mjs')));
const { prepareSourceHtmlForStaticCapture } = await import(pathToFileURL(path.join(projectRoot, 'scripts', 'lib', 'source-origin.mjs')));
const { stableStateExpression, afterSettleStateExpression, closeDelayedPopupExpression } = await import(pathToFileURL(path.join(projectRoot, 'scripts', 'lib', 'capture-state.mjs')));
const { browserImageReadinessPolicySource } = await import(pathToFileURL(path.join(projectRoot, 'scripts', 'lib', 'image-readiness-policy.mjs')));
const replayState = await import(pathToFileURL(path.join(projectRoot, 'scripts', 'lib', 'replay-state-sanitizer.mjs')));
const { PNG } = pngjs.default;
const imageReadinessPolicySource = browserImageReadinessPolicySource();

const stripCapturedExecutableScripts = (html) => String(html || '').replace(/<script\b([^>]*)>[\s\S]*?<\/script>/gi, (full, attributes) => {
  const type = attributes.match(/\btype=["']([^"']+)["']/i)?.[1]?.toLowerCase() || '';
  return type === 'application/json' || type === 'application/ld+json' || type === 'application/x-matbox-disabled' ? full : '';
});

function preparePublishedReplay(html) {
  const staticDocument = replayState.stripCaptureRevealStyles(stripCapturedExecutableScripts(html));
  return replayState.restoreInteractiveScrollbars(
    replayState.releaseResponsiveFrozenHeights(
      replayState.restoreResponsiveAutoSizedCardGridItems(
        replayState.restoreResponsivePageContainers(
          replayState.restoreResponsiveFullWidthLayoutBoxes(
            replayState.hideEmptyCommerceSkeletons(
              componentRegistry.restoreFrozenVideoBackgrounds(staticDocument),
            ),
          ),
        ),
      ),
    ),
  );
}

const observedOnlyStableStateExpression = `(async () => {
  const shouldPromoteDeferredImage = ${imageReadinessPolicySource};
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const paint = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  for (const image of document.images) {
    image.loading = 'eager';
    const deferred = image.dataset.src || image.dataset.lazySrc || image.dataset.original;
    const frozen = image.hasAttribute('data-matbox-image-intrinsic-width')
      || image.hasAttribute('data-matbox-browser-frozen-image')
      || image.hasAttribute('data-matbox-browser-screenshot-image');
    if (shouldPromoteDeferredImage({
      allowNetwork: !document.documentElement.hasAttribute('data-matbox-source-client-width'),
      currentSource: image.getAttribute('src'),
      deferredSource: deferred,
      frozen,
    })) image.src = deferred;
  }
  document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
  document.body?.style.setProperty('scroll-behavior', 'auto', 'important');
  const signature = () => [
    document.documentElement.scrollHeight,
    document.images.length,
    Array.from(document.images).filter((image) => image.complete && image.naturalWidth > 0).length,
    document.querySelectorAll('a[href],button,input,select,textarea,[role="button"],[role="link"]').length,
    document.body?.innerText?.length || 0,
  ].join('|');
  const startedAt = performance.now();
  let lastChangedAt = startedAt;
  let previous = signature();
  const observer = new MutationObserver(() => { lastChangedAt = performance.now(); });
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  while (performance.now() - startedAt < 6000) {
    await pause(100);
    const next = signature();
    if (next !== previous) {
      previous = next;
      lastChangedAt = performance.now();
    }
    if (performance.now() - lastChangedAt >= 750) break;
  }
  observer.disconnect();
  scrollTo(0, 0);
  await paint();
  return { waitedMs: Math.round(performance.now() - startedAt), signature: previous };
})()`;

const observedReadinessPrepExpression = `(async () => {
  const shouldPromoteDeferredImage = ${imageReadinessPolicySource};
  for (const image of document.images) {
    image.loading = 'eager';
    const deferred = image.dataset.src || image.dataset.lazySrc || image.dataset.original;
    const frozen = image.hasAttribute('data-matbox-image-intrinsic-width')
      || image.hasAttribute('data-matbox-browser-frozen-image')
      || image.hasAttribute('data-matbox-browser-screenshot-image');
    if (shouldPromoteDeferredImage({
      allowNetwork: !document.documentElement.hasAttribute('data-matbox-source-client-width'),
      currentSource: image.getAttribute('src'),
      deferredSource: deferred,
      frozen,
    })) image.src = deferred;
  }
  document.documentElement.style.setProperty('scroll-behavior', 'auto', 'important');
  document.body?.style.setProperty('scroll-behavior', 'auto', 'important');
  return true;
})()`;

const observedOnlyAfterSettleExpression = `(async () => {
  document.querySelectorAll('[data-subscription-popup-close], [data-subscription-popup-dismiss], .fancybox-close').forEach((node) => node.click());
  document.querySelectorAll('[data-subscription-popup], .subscription-popup, .fancybox-wrap, .fancybox-overlay').forEach((node) => {
    node.hidden = true;
    node.setAttribute('aria-hidden', 'true');
    node.style.setProperty('display', 'none', 'important');
  });
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const signature = () => [
    document.documentElement.scrollHeight,
    document.images.length,
    Array.from(document.images).filter((image) => image.complete && image.naturalWidth > 0).length,
    document.querySelectorAll('a[href],button,input,select,textarea,[role="button"],[role="link"]').length,
    document.body?.innerText?.length || 0,
  ].join('|');
  const startedAt = performance.now();
  let lastChangedAt = startedAt;
  let previous = signature();
  const observer = new MutationObserver(() => { lastChangedAt = performance.now(); });
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  while (performance.now() - startedAt < 6000) {
    await pause(100);
    const next = signature();
    if (next !== previous) {
      previous = next;
      lastChangedAt = performance.now();
    }
    if (performance.now() - lastChangedAt >= 750) break;
  }
  observer.disconnect();
  return { waitedMs: Math.round(performance.now() - startedAt), signature: previous };
})()`;

const viewport = { width: 1440, height: 900, mobile: false };
const timings = [];
async function timed(name, operation) {
  const startedAt = performance.now();
  try {
    const value = await operation();
    timings.push({ name, pass: true, elapsedMs: Math.round(performance.now() - startedAt) });
    return value;
  } catch (error) {
    timings.push({ name, pass: false, elapsedMs: Math.round(performance.now() - startedAt), error: String(error?.stack || error) });
    throw error;
  }
}

function captureOptions({ network }) {
  return {
    chromiumPath: chromePath,
    viewport,
    artifactProfile: 'replay',
    timeoutMs: 60000,
    requestGuard: false,
    allowNetwork: network,
    profileRoot,
    beforeCollectExpression: observedReadinessRun
      ? observedReadinessPrepExpression
      : observedOnlyTimingSpike ? observedOnlyStableStateExpression : stableStateExpression,
    afterSettleExpression: observedReadinessRun ? undefined : (
      observedOnlyTimingSpike ? observedOnlyAfterSettleExpression : afterSettleStateExpression
    ),
    observedReadiness: observedReadinessRun ? {
      quietWindowMs: 500,
      maxWaitMs: 10000,
      pollIntervalMs: 100,
    } : undefined,
    beforeSnapshotExpression: closeDelayedPopupExpression,
  };
}

function imageSimilarity(referenceBuffer, candidateBuffer) {
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
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = left.data[index + channel] - right.data[index + channel];
      squaredError += delta * delta;
    }
  }
  return {
    similarity: 1 - Math.sqrt(squaredError / (width * height * 3)) / 255,
    exactSize: reference.width === candidate.width && reference.height === candidate.height,
    sourceSize: [reference.width, reference.height],
    outputSize: [candidate.width, candidate.height],
  };
}

function summarizeHtml(html) {
  return {
    bytes: Buffer.byteLength(html),
    textCharacters: html.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length,
    images: (html.match(/<img\b/gi) || []).length,
    videos: (html.match(/<video\b/gi) || []).length,
    anchors: (html.match(/<a\b/gi) || []).length,
    buttons: (html.match(/<button\b/gi) || []).length,
  };
}

function componentGeometryParity(source = [], output = [], tolerance = 4) {
  const failures = [];
  if (source.length !== output.length) failures.push({ type: 'component-count-mismatch', source: source.length, output: output.length });
  const count = Math.min(source.length, output.length);
  for (let index = 0; index < count; index += 1) {
    const left = source[index]?.rect || source[index]?.geometry || null;
    const right = output[index]?.rect || output[index]?.geometry || null;
    if (!left || !right) continue;
    const leftValues = Array.isArray(left) ? left : [left.x, left.y, left.width, left.height];
    const rightValues = Array.isArray(right) ? right : [right.x, right.y, right.width, right.height];
    if (leftValues.some((value, axis) => Math.abs(Number(value || 0) - Number(rightValues[axis] || 0)) > tolerance)) {
      failures.push({ type: 'component-geometry-mismatch', index, source: leftValues, output: rightValues, tolerance });
    }
  }
  return { pass: failures.length === 0, failures, checked: count };
}

function buildEditableEvidence(html) {
  const foundation = componentRegistry.compactImportFoundationRecords(componentRegistry.buildImportFoundationRecords(
    [{ route: '/', html }],
    { platform: 'web', sourceOrigin: new URL(sourceUrl).origin, importRunId: `homepage-${requestedMethod}-${runId}` },
  ));
  return { foundation, audit: auditEditableImportFoundation(foundation) };
}

async function directSourceCapture() {
  return capture.capturePage(sourceUrl, captureOptions({ network: true }));
}

async function httpSeedSourceCapture() {
  const response = await fetch(sourceUrl, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 MatboxBenchmark/1.0' } });
  if (!response.ok) throw new Error(`HTTP seed returned ${response.status}`);
  const sourceHtml = await response.text();
  const prepared = prepareSourceHtmlForStaticCapture(sourceHtml, response.url || sourceUrl, {});
  return capture.captureHtml(prepared, captureOptions({ network: true }));
}

const startedAt = performance.now();
let sourceCapture;
let sourceValidation;
let outputHtml;
let outputCapture;
let componentEvidence;
let editableEvidence;
let outputAssets = [];

try {
  if (requestedMethod === 'C') {
    sourceCapture = await timed('http-seed-and-browser-dynamic-capture', httpSeedSourceCapture);
  } else {
    sourceCapture = await timed('browser-source-capture', directSourceCapture);
  }
  sourceValidation = await timed('source-capture-validation', async () => validateCapturedPage(sourceCapture));
  await timed('write-source-html', () => fs.writeFile(path.join(outputRoot, 'source.html'), sourceCapture.renderedDocument.html, 'utf8'));
  await timed('write-source-screenshot', () => fs.writeFile(path.join(outputRoot, 'source.png'), sourceCapture.screenshot));
  if (!sourceValidation.pass) throw new Error(`Source capture failed validation: ${sourceValidation.failures.join(', ')}`);
  const publishedSourceHtml = preparePublishedReplay(sourceCapture.renderedDocument.html);

  if (requestedMethod === 'A') {
    outputHtml = await timed('late-component-conversion', async () => {
      const registry = componentRegistry.buildComponentRegistry(
        [{ route: '/', html: publishedSourceHtml }],
        { requireGeometryEvidence: true },
      );
      outputAssets = registry.assets;
      editableEvidence = buildEditableEvidence(publishedSourceHtml);
      return componentRegistry.reassemblePage(registry.compositions[0], registry.registry);
    });
  } else {
    outputHtml = await timed('component-first-conversion', async () => {
      const extracted = componentRegistry.extractPageComponents(publishedSourceHtml, '/');
      const accepted = [];
      for (const component of extracted.components) {
        const candidateHtml = `<!doctype html><html><body>${component.sourceMarkup}</body></html>`;
        const candidateEvidence = buildEditableEvidence(candidateHtml);
        accepted.push({
          componentId: component.matboxComponentId,
          sourceSectionId: component.sourceSectionId,
          pass: candidateEvidence.audit.pass,
          failures: candidateEvidence.audit.failures,
          coverage: candidateEvidence.audit.coverage,
        });
        if (!candidateEvidence.audit.pass) throw new Error(`Component ${component.matboxComponentId} failed editable gate`);
      }
      componentEvidence = accepted;
      const registry = componentRegistry.buildComponentRegistry(
        [{ route: '/', html: publishedSourceHtml }],
        { requireGeometryEvidence: true },
      );
      outputAssets = registry.assets;
      editableEvidence = buildEditableEvidence(publishedSourceHtml);
      return componentRegistry.reassemblePage(registry.compositions[0], registry.registry);
    });
  }

  outputHtml = componentRegistry.normalizeReplayBase(
    componentRegistry.hydratePageAssetsForValidation(outputHtml, outputAssets),
  );

  await timed('write-output-html', () => fs.writeFile(path.join(outputRoot, 'output.html'), outputHtml, 'utf8'));
  outputCapture = await timed('offline-output-render', () => capture.captureHtml(outputHtml, captureOptions({ network: false })));
  const outputArtifactForValidation = {
    ...outputCapture,
    renderedDocument: { ...outputCapture.renderedDocument, html: outputHtml },
  };
  const outputValidation = await timed('output-capture-validation', async () => validateCapturedPage(outputArtifactForValidation, {
    mode: 'published',
    assetResolver: () => true,
  }));
  await timed('write-output-screenshot', () => fs.writeFile(path.join(outputRoot, 'output.png'), outputCapture.screenshot));

  const visual = await timed('visual-comparison', async () => imageSimilarity(sourceCapture.screenshot, outputCapture.screenshot));
  const interactions = {
    source: sourceCapture.interactiveElements?.length || 0,
    output: outputCapture.interactiveElements?.length || 0,
  };
  interactions.coverage = Math.min(interactions.source, interactions.output) / Math.max(1, interactions.source);
  const geometry = componentGeometryParity(sourceCapture.componentCandidates || [], outputCapture.componentCandidates || []);
  const sourceSummary = summarizeHtml(sourceCapture.renderedDocument.html);
  const outputSummary = summarizeHtml(outputHtml);
  const contentParity = {
    textCharactersRatio: Math.min(sourceSummary.textCharacters, outputSummary.textCharacters) / Math.max(1, sourceSummary.textCharacters),
    imageCountMatch: sourceSummary.images === outputSummary.images,
    videoCountMatch: sourceSummary.videos === outputSummary.videos,
    anchorCountMatch: sourceSummary.anchors === outputSummary.anchors,
    buttonCountMatch: sourceSummary.buttons === outputSummary.buttons,
  };
  const failures = [];
  if (!outputValidation.pass) failures.push({ gate: 'output-capture', failures: outputValidation.failures });
  if (visual.similarity < 0.98) failures.push({ gate: 'page-visual', similarity: visual.similarity, threshold: 0.98 });
  if (interactions.coverage < 1) failures.push({ gate: 'interaction-inventory', ...interactions });
  if (!editableEvidence.audit.pass) failures.push({ gate: 'editable-contract', failures: editableEvidence.audit.failures });
  if (!geometry.pass) failures.push({ gate: 'component-geometry', failures: geometry.failures });
  if (contentParity.textCharactersRatio < 1 || !contentParity.imageCountMatch || !contentParity.videoCountMatch || !contentParity.anchorCountMatch || !contentParity.buttonCountMatch) {
    failures.push({ gate: 'content-parity', ...contentParity });
  }
  const report = {
    method: requestedMethod,
    timingMode: observedReadinessRun
      ? 'observed-network-content-readiness'
      : observedOnlyTimingSpike ? 'observed-only-spike' : 'current-baseline',
    sourceUrl,
    runId,
    generatedAt: new Date().toISOString(),
    elapsedMs: Math.round(performance.now() - startedAt),
    pass: failures.length === 0,
    failures,
    timings,
    browserCaptureTimings: {
      source: sourceCapture?.metadata?.captureTimings || {},
      output: outputCapture?.metadata?.captureTimings || {},
    },
    visualReadinessPhases: {
      source: sourceCapture?.metadata?.visualReadiness?.phaseTimings || {},
      output: outputCapture?.metadata?.visualReadiness?.phaseTimings || {},
    },
    source: sourceSummary,
    output: outputSummary,
    visual,
    interactions,
    componentGeometry: geometry,
    contentParity,
    editable: editableEvidence.audit,
    componentEvidence: componentEvidence || [],
  };
  await fs.writeFile(path.join(outputRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ outputRoot, ...report }, null, 2)}\n`);
  if (!report.pass) process.exitCode = 2;
} catch (error) {
  const report = {
    method: requestedMethod,
    timingMode: observedReadinessRun
      ? 'observed-network-content-readiness'
      : observedOnlyTimingSpike ? 'observed-only-spike' : 'current-baseline',
    sourceUrl,
    runId,
    generatedAt: new Date().toISOString(),
    elapsedMs: Math.round(performance.now() - startedAt),
    pass: false,
    failures: [{ gate: 'experiment', error: String(error?.stack || error) }],
    timings,
    browserCaptureTimings: {
      source: sourceCapture?.metadata?.captureTimings || {},
      output: outputCapture?.metadata?.captureTimings || {},
    },
    sourceValidation: sourceValidation || null,
    sourceVisualReadiness: sourceCapture?.metadata?.visualReadiness || null,
  };
  await fs.writeFile(path.join(outputRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stderr.write(`${JSON.stringify({ outputRoot, ...report }, null, 2)}\n`);
  process.exitCode = 2;
}
