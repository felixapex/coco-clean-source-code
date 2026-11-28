import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createComponentRegistryAccumulator, externalizePageAssetBundle, externalizePageCompositionMarkup, localizeCapturedRouteLinks, normalizeReplayBase, publishComponentVariantMarkup, replaySourceOrigin, restoreFrozenVideoBackgrounds } from './lib/component-registry.mjs';
import { validateCapturedHtml } from './lib/capture-validation.mjs';
import { promoteDirectoryAtomically, verifyAndPromoteUnit } from './lib/incremental-build-gate.mjs';
import { verifyAndPromotePage } from './lib/page-assembly-gate.mjs';
import { groupPageCompositions } from './lib/page-verification-evidence.mjs';
import { downloadRemoteAssetWithCurl, freezeRemoteFontAssets, preflightRemoteFontAssets } from './lib/remote-font-freezer.mjs';
import { preflightRemoteDocuments, publishFrozenDocuments } from './lib/remote-document-freezer.mjs';
import { auditCapturedRouteLinksBySource, mergeCapturedRouteLinkAudits } from './lib/route-link-audit.mjs';
import { deactivateInactiveRemoteMedia, hideEmptyCommerceSkeletons, releaseResponsiveFrozenHeights, restoreInteractiveScrollbars, restoreResponsiveAutoSizedCardGridItems, restoreResponsiveContainedComponentBoxes, restoreResponsiveFullWidthLayoutBoxes, restoreResponsivePageContainers, stripCaptureRevealStyles } from './lib/replay-state-sanitizer.mjs';
import { convertMarkupToEditableSection } from './lib/editable-component-contract.mjs';
import { createDiskBackedImportFoundation } from './lib/disk-backed-import-foundation.mjs';
import { teeAsyncIterable } from './lib/async-iterable.mjs';
import { buildStylesheetRecoveryGate } from './lib/final-verification-report.mjs';
import {
  buildReplayPreflightCacheKey,
  loadReplayPreflightCache,
  writeReplayPreflightCache,
} from './lib/resource-preflight-cache.mjs';
import { evaluateImageRecoveryBlockers } from './lib/image-recovery-blocker-gate.mjs';
import {
  loadVerifiedRecoveredImages,
} from './lib/recovered-image-publisher.mjs';
import { localizeRecoveredImages } from './lib/image-recovery-patch.mjs';
import { prepareBuildResume, writeBuildPageCheckpoint } from './lib/build-resume.mjs';
import { assertBuildCheckpointIntegrity, auditBuildCheckpointIntegrity } from './lib/build-checkpoint-integrity.mjs';
import { collectVerifiedPublicAssets } from './lib/public-asset-manifest.mjs';
import { freezeRemoteAssets, loadVerifiedRemoteAssetManifest, localizeRemoteAssets } from './lib/remote-asset-freezer.mjs';
import { bigCommerceImageFallbackCandidates } from '../src/import-core/capture/chromium-capture.mjs';
import {
  auditComponentDelivery,
  createPortableComponentPackage,
  materializePortableComponentPackage,
} from '../src/import-foundation/component-package.mjs';

const root = process.cwd();
const stageOnly = process.argv.includes('--stage-only');
const selectedBuildRoutes = new Set(
  process.argv.filter((item) => item.startsWith('--route=')).map((item) => item.slice('--route='.length)),
);
const routeIsSelected = (route) => selectedBuildRoutes.size === 0 || selectedBuildRoutes.has(route);
const filterRouteManifest = (manifest) => Object.fromEntries(
  Object.entries(manifest || {}).filter(([route]) => routeIsSelected(route)),
);
const acceptedDist = path.join(root, 'dist');
const stagingRoot = path.join(root, '.dist-staging');
const stagingDirArgument = process.argv.find((item) => item.startsWith('--staging-dir='))?.slice('--staging-dir='.length);
const continueExistingStageArgument = process.argv.find((item) => item.startsWith('--continue-existing-stage='))?.slice('--continue-existing-stage='.length);
const continueExistingStage = continueExistingStageArgument ? path.resolve(root, continueExistingStageArgument) : null;
if (continueExistingStage && stagingDirArgument) {
  throw new Error('--continue-existing-stage and --staging-dir cannot be combined');
}
const dist = continueExistingStage || (stagingDirArgument ? path.resolve(root, stagingDirArgument) : `${stagingRoot}-${process.pid}`);
const resumeFromArgument = process.argv.find((item) => item.startsWith('--resume-from='))?.slice('--resume-from='.length);
const resumeAssetsFromArgument = process.argv.find((item) => item.startsWith('--resume-assets-from='))?.slice('--resume-assets-from='.length);
const resumeFrom = resumeFromArgument ? path.resolve(root, resumeFromArgument) : null;
const resumeAssetsFrom = resumeAssetsFromArgument ? path.resolve(root, resumeAssetsFromArgument) : resumeFrom;
if (continueExistingStage && (resumeFrom || resumeAssetsFromArgument)) {
  throw new Error('--continue-existing-stage cannot be combined with resume options');
}
const frozenAssetCacheDir = path.join(root, 'artifacts', 'frozen-remote-assets');
const frozenFontCacheDir = path.join(frozenAssetCacheDir, 'fonts');
const frozenDocumentCacheDir = path.join(frozenAssetCacheDir, 'documents');
const frozenExternalAssetCacheDir = path.join(frozenAssetCacheDir, 'external-v4');
const sourceReplayDir = path.join(root, 'src', 'replay');
const recoveryRoot = path.join(root, 'artifacts', 'full-site-audit', 'recovery');
const generationTimingPath = path.join(root, 'artifacts', 'full-site-audit', 'generation-timing.json');
const generationTimingHistoryPath = path.join(root, 'artifacts', 'full-site-audit', 'generation-timing-history.jsonl');
const resourcePreflightCachePath = path.join(root, 'artifacts', 'full-site-audit', 'resource-preflight-cache.json');
const imageRecoveryBlockerReportPath = path.join(root, 'artifacts', 'component-geometry-migration', 'image-recovery-blockers.json');
const recoveredImageArtifactRoot = path.join(root, 'artifacts', 'component-geometry-migration');
const generationStartedAt = Date.now();
let generationPhaseStartedAt = generationStartedAt;
const generationTimings = [];
const stylesheetRecoveryLedger = await fs.readFile(path.join(recoveryRoot, 'stylesheets', 'recovery-ledger.json'), 'utf8')
  .then(JSON.parse)
  .catch(() => null);
const stylesheetRecoveryGate = buildStylesheetRecoveryGate(stylesheetRecoveryLedger);
if (!stageOnly && !stylesheetRecoveryGate.pass) {
  throw new Error(`Stylesheet recovery gate failed: ${JSON.stringify({
    code: stylesheetRecoveryGate.code,
    total: stylesheetRecoveryGate.total,
    recovered: stylesheetRecoveryGate.recovered,
    sourceProtected: stylesheetRecoveryGate.sourceProtected,
    unresolved: stylesheetRecoveryGate.unresolved,
    failures: stylesheetRecoveryGate.failures,
  })}`);
}
async function recordGenerationPhase(name) {
  const now = Date.now();
  generationTimings.push({ name, status: 'passed', elapsedMs: now - generationPhaseStartedAt });
  generationPhaseStartedAt = now;
  await fs.mkdir(path.dirname(generationTimingPath), { recursive: true });
  await fs.writeFile(generationTimingPath, `${JSON.stringify({
    status: 'running',
    stageOnly,
    elapsedMs: now - generationStartedAt,
    timings: generationTimings,
  }, null, 2)}\n`, 'utf8');
}
async function finishGenerationTiming() {
  const now = Date.now();
  const report = {
    generatedAt: new Date(now).toISOString(),
    status: 'passed',
    stageOnly,
    elapsedMs: now - generationStartedAt,
    timings: generationTimings,
  };
  await fs.writeFile(generationTimingPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.appendFile(generationTimingHistoryPath, `${JSON.stringify(report)}\n`, 'utf8');
}
const sourceReplayFiles = new Set();
for (const manifestName of ['routes.json', 'routes-mobile.json']) {
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(sourceReplayDir, manifestName), 'utf8'));
    for (const replayFile of Object.values(filterRouteManifest(manifest))) sourceReplayFiles.add(replayFile);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}
const imageRecoveryBlockerReport = await fs.readFile(imageRecoveryBlockerReportPath, 'utf8')
  .then(JSON.parse)
  .catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
if (imageRecoveryBlockerReport) {
  const blockedNames = new Set((imageRecoveryBlockerReport.files || []).map((file) => file.filename));
  const currentHashes = new Map();
  for (const replayFile of sourceReplayFiles) {
    if (!blockedNames.has(replayFile)) continue;
    const content = await fs.readFile(path.join(sourceReplayDir, replayFile));
    currentHashes.set(replayFile, crypto.createHash('sha256').update(content).digest('hex'));
  }
  const imageRecoveryGate = evaluateImageRecoveryBlockers({
    report: imageRecoveryBlockerReport,
    selectedReplayFiles: [...sourceReplayFiles],
    currentHashes,
  });
  if (!imageRecoveryGate.pass) {
    throw new Error(`Image recovery blocker gate failed: ${JSON.stringify({
      ...imageRecoveryGate,
      reportPath: imageRecoveryBlockerReportPath,
    })}`);
  }
}
const recoveredImagesBySource = imageRecoveryBlockerReport
  ? await loadVerifiedRecoveredImages(recoveredImageArtifactRoot)
  : new Map();
if (continueExistingStage) {
  const existingStageIntegrity = await auditBuildCheckpointIntegrity({
    stageDir: dist,
    sourceReplayDir,
    replayFiles: [...sourceReplayFiles],
  });
  await fs.mkdir(path.join(root, 'artifacts', 'full-site-audit'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'artifacts', 'full-site-audit', 'build-checkpoint-integrity-existing-stage.json'),
    `${JSON.stringify(existingStageIntegrity, null, 2)}\n`,
    'utf8',
  );
  assertBuildCheckpointIntegrity(existingStageIntegrity, 'existing stage checkpoint integrity');
}
async function* sourceReplayHtml() {
  for (const replayFile of sourceReplayFiles) yield fs.readFile(path.join(sourceReplayDir, replayFile), 'utf8');
}
async function* activeRemoteAssetHtml() {
  for (const replayFile of sourceReplayFiles) {
    yield fs.readFile(path.join(sourceReplayDir, replayFile), 'utf8');
  }
}
async function loadRecoveryEntries() {
  let directories;
  try { directories = await fs.readdir(recoveryRoot, { withFileTypes: true }); } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const entries = [];
  for (const directory of directories.filter((item) => item.isDirectory())) {
    try {
      const ledger = JSON.parse(await fs.readFile(path.join(recoveryRoot, directory.name, 'ledger.json'), 'utf8'));
      entries.push(...Object.values(ledger.entries || {}));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return entries;
}
const resourcePreflightCacheKey = await buildReplayPreflightCacheKey({
  sourceReplayDir,
  replayFiles: [...sourceReplayFiles],
});
const cachedResourcePreflight = await loadReplayPreflightCache({
  cachePath: resourcePreflightCachePath,
  cacheKey: resourcePreflightCacheKey,
});
let fontPreflight;
let documentPreflight;
if (cachedResourcePreflight.hit) {
  fontPreflight = cachedResourcePreflight.fontPreflight;
  documentPreflight = cachedResourcePreflight.documentPreflight;
} else {
  const [fontSources, documentSources] = teeAsyncIterable(sourceReplayHtml(), 2);
  [fontPreflight, documentPreflight] = await Promise.all([
    preflightRemoteFontAssets(fontSources, { cacheDir: frozenFontCacheDir }),
    preflightRemoteDocuments(documentSources, { cacheDir: frozenDocumentCacheDir }),
  ]);
  await writeReplayPreflightCache({
    cachePath: resourcePreflightCachePath,
    cacheKey: resourcePreflightCacheKey,
    fontPreflight,
    documentPreflight,
  });
}
// Source replay preflight and an already-built stage audit are different
// evidence scopes. Never let a test/stage audit overwrite the source gate.
const remoteAssetPreflightReportPath = path.join(root, 'artifacts', 'full-site-audit', 'source-remote-asset-preflight.json');
const cachedRemoteAssetPreflight = await fs.readFile(remoteAssetPreflightReportPath, 'utf8')
  .then(JSON.parse)
  .catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
let remoteAssetPreflight;
if (continueExistingStage) {
  remoteAssetPreflight = await loadVerifiedRemoteAssetManifest(frozenExternalAssetCacheDir);
} else if (cachedRemoteAssetPreflight?.cacheKey === resourcePreflightCacheKey) {
  if (!cachedRemoteAssetPreflight.pass) {
    const failures = cachedRemoteAssetPreflight.failures || [];
    const failuresByHost = {};
    for (const failure of failures) {
      let host = '(invalid-url)';
      try { host = new URL(failure.url).hostname; } catch {}
      failuresByHost[host] = (failuresByHost[host] || 0) + 1;
    }
    throw new Error(`Remote asset preflight gate failed: ${JSON.stringify({
      failureCount: failures.length,
      failuresByHost,
      sampleUrls: failures.slice(0, 10).map((failure) => failure.url),
      reportPath: remoteAssetPreflightReportPath,
    })}`);
  }
  remoteAssetPreflight = await loadVerifiedRemoteAssetManifest(frozenExternalAssetCacheDir);
} else {
  remoteAssetPreflight = await freezeRemoteAssets(activeRemoteAssetHtml(), {
    cacheDir: path.join(root, 'artifacts', 'full-site-audit', 'persistent-resource-cache'),
    outputDir: frozenExternalAssetCacheDir,
    publicBase: '/frozen-assets/external-v4',
    candidateFactory: bigCommerceImageFallbackCandidates,
    fallbackDownloadImpl: downloadRemoteAssetWithCurl,
    concurrency: 4,
  });
}
await fs.writeFile(
  remoteAssetPreflightReportPath,
  `${JSON.stringify({
    version: 1,
    generatedAt: new Date().toISOString(),
    scope: 'source-replay',
    cacheKey: resourcePreflightCacheKey,
    replayFileCount: sourceReplayFiles.size,
    assetCount: remoteAssetPreflight.assets.length,
    assets: remoteAssetPreflight.assets,
    pass: true,
  }, null, 2)}\n`,
  'utf8',
);
await recordGenerationPhase(cachedResourcePreflight.hit ? 'resource-preflight-cache-hit' : 'resource-preflight-scan');
if (!continueExistingStage) {
  await fs.rm(dist, { recursive: true, force: true });
}
await fs.mkdir(path.join(dist, 'app'), { recursive: true });
await fs.mkdir(path.join(dist, 'vendor'), { recursive: true });
await fs.mkdir(path.join(dist, 'replay'), { recursive: true });
await fs.mkdir(path.join(dist, 'interactive'), { recursive: true });
const localDocumentRoutes = await publishFrozenDocuments(documentPreflight.documents, { outputDir: dist });
const tscEntry = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const tsc = spawnSync(process.execPath, [tscEntry, '-p', 'tsconfig.build.json', '--outDir', path.join(dist, 'app')], { cwd: root, stdio: 'inherit' });
if (tsc.status !== 0) process.exit(tsc.status ?? 1);
for (const file of ['index.css', 'design-tokens.css', 'component-styles.css', 'layout.css']) {
  await fs.copyFile(path.join(root, 'src', file), path.join(dist, 'app', file));
}
await fs.copyFile(path.join(root, 'vendor', 'react-poc-runtime.js'), path.join(dist, 'vendor', 'react-poc-runtime.js'));
for (const manifestName of ['routes.json', 'routes-mobile.json', 'interaction-routes.json']) {
  try {
    const sourceManifestPath = path.join(sourceReplayDir, manifestName);
    const outputManifestPath = path.join(dist, 'replay', manifestName);
    if (selectedBuildRoutes.size > 0 && manifestName !== 'interaction-routes.json') {
      const manifest = JSON.parse(await fs.readFile(sourceManifestPath, 'utf8'));
      await fs.writeFile(outputManifestPath, `${JSON.stringify(filterRouteManifest(manifest), null, 2)}\n`, 'utf8');
    } else {
      await fs.copyFile(sourceManifestPath, outputManifestPath);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}
const buildResume = continueExistingStage
  ? {
      reusedReplayFiles: new Set(sourceReplayFiles),
      reusedPageCount: sourceReplayFiles.size,
      reusedAssetCount: 0,
      skipped: [],
    }
  : resumeFrom
    ? await prepareBuildResume({
    resumeDir: resumeFrom,
    assetSourceDir: resumeAssetsFrom,
    outputDir: dist,
    sourceReplayDir,
    replayFiles: [...sourceReplayFiles],
    recoveredSources: new Set(recoveredImagesBySource.keys()),
    })
    : { reusedReplayFiles: new Set(), reusedPageCount: 0, reusedAssetCount: 0, skipped: [] };
await fs.mkdir(path.join(root, 'artifacts', 'full-site-audit'), { recursive: true });
await fs.writeFile(
  path.join(root, 'artifacts', 'full-site-audit', 'build-resume-report.json'),
  `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    continueExistingStage,
    resumeFrom,
    reusedPageCount: buildResume.reusedPageCount,
    reusedAssetCount: buildResume.reusedAssetCount,
    skipped: buildResume.skipped,
  }, null, 2)}\n`,
  'utf8',
);
const replayRoutesPath = path.join(dist, 'replay', 'routes.json');
const replayRoutes = JSON.parse(await fs.readFile(replayRoutesPath, 'utf8'));
let interactionRoutes = { redirects: {}, aliases: {} };
try {
  interactionRoutes = JSON.parse(await fs.readFile(path.join(dist, 'replay', 'interaction-routes.json'), 'utf8'));
} catch {}
for (const [alias, capturedRoute] of Object.entries(interactionRoutes.aliases || {})) {
  if (selectedBuildRoutes.size > 0 && !selectedBuildRoutes.has(alias)) continue;
  if (!replayRoutes[capturedRoute]) {
    if (selectedBuildRoutes.size > 0) continue;
    throw new Error(`Interaction route alias ${alias} references uncaptured route ${capturedRoute}`);
  }
  replayRoutes[alias] = replayRoutes[capturedRoute];
}
await fs.writeFile(replayRoutesPath, `${JSON.stringify(replayRoutes, null, 2)}\n`, 'utf8');
let mobileReplayRoutes = {};
try { mobileReplayRoutes = JSON.parse(await fs.readFile(path.join(dist, 'replay', 'routes-mobile.json'), 'utf8')); } catch {}
const interactionCss = await fs.readFile(path.join(root, 'src', 'interactive', 'runtime.css'), 'utf8');
const interactionJs = await fs.readFile(path.join(root, 'src', 'interactive', 'runtime.js'), 'utf8');
await fs.writeFile(path.join(dist, 'interactive', 'runtime.css'), interactionCss, 'utf8');
await fs.writeFile(path.join(dist, 'interactive', 'runtime.js'), interactionJs, 'utf8');
const localePack = await fs.readFile(path.join(root, 'src', 'localization', 'majestic-pack.js'), 'utf8');
const localeService = await fs.readFile(path.join(root, 'src', 'localization', 'locale-service.js'), 'utf8');
const localeAdapter = await fs.readFile(path.join(root, 'src', 'localization', 'replay-adapter.js'), 'utf8');
const inlineScript = (tag, source) => `<script data-matbox-locale-${tag}>${source.replace(/<\/script/gi, '<\\/script')}</script>`;
const interactionRouteConfig = `<script data-matbox-interaction-routes>window.__matboxInteractionRoutes=${JSON.stringify(interactionRoutes).replace(/<\/script/gi, '<\\/script')};</script>`;
const interactionTags = `${inlineScript('pack', localePack)}${inlineScript('service', localeService)}${inlineScript('adapter', localeAdapter)}${interactionRouteConfig}<link rel="stylesheet" href="/interactive/runtime.css"><script defer src="/interactive/runtime.js"></script>`;
const stripCapturedExecutableScripts = (html) => html.replace(/<script\b([^>]*)>[\s\S]*?<\/script>/gi, (full, attributes) => {
  const type = attributes.match(/\btype=["']([^"']+)["']/i)?.[1]?.toLowerCase() || '';
  return type === 'application/json' || type === 'application/ld+json' || type === 'application/x-matbox-disabled' ? full : '';
});
const capturedRoutes = [...new Set([...Object.keys(replayRoutes), ...Object.keys(mobileReplayRoutes)])];
const detectedSourceOrigins = new Set();
for (const replayFile of new Set([...Object.values(replayRoutes), ...Object.values(mobileReplayRoutes)])) {
  const handle = await fs.open(path.join(sourceReplayDir, replayFile), 'r');
  try {
    const buffer = Buffer.alloc(131072);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const detectedOrigin = replaySourceOrigin(buffer.subarray(0, bytesRead).toString('utf8'));
    if (detectedOrigin) detectedSourceOrigins.add(detectedOrigin);
  } finally {
    await handle.close();
  }
}
const routesByReplayFile = new Map();
for (const [route, replayFile] of Object.entries(replayRoutes)) {
  if (!routesByReplayFile.has(replayFile)) routesByReplayFile.set(replayFile, []);
  routesByReplayFile.get(replayFile).push(route);
}
for (const [route, replayFile] of Object.entries(mobileReplayRoutes)) {
  if (!routesByReplayFile.has(replayFile)) routesByReplayFile.set(replayFile, []);
  routesByReplayFile.get(replayFile).push(`${route}?matbox-viewport=mobile`);
}
const componentPageDescriptors = [];
const analysisBatchSize = Math.max(1, Number.parseInt(process.env.MATBOX_BUILD_ANALYSIS_BATCH_SIZE || '16', 10) || 16);
const replayAssetsByHref = new Map();
let recoveredImageReplacementCount = 0;
await recordGenerationPhase('source-preparation');
for (const replayFile of new Set([...Object.values(replayRoutes), ...Object.values(mobileReplayRoutes)])) {
  const source = await fs.readFile(path.join(sourceReplayDir, replayFile), 'utf8');
  const sourceBase = source.match(/<base\b[^>]*href=["']([^"']+)/i)?.[1];
  const locallyAuthored = sourceBase === '/';
  const referenceTag = /<meta\s+name="matbox-reference-url"\s+content="(https:\/\/[^"]+)"\s*\/?\s*>/i;
  const referenceUrl = locallyAuthored ? source.match(referenceTag)?.[1] : undefined;
  if (locallyAuthored && !referenceUrl) throw new Error(`Authored page reference is required for ${replayFile}`);
  const persistedValidation = validateCapturedHtml(source, { mode: locallyAuthored ? 'published' : 'source' });
  if (!persistedValidation.pass) throw new Error(`Persisted capture gate failed for ${replayFile}: ${persistedValidation.failures.join(', ')}`);
  const withoutPreviousInjection = (locallyAuthored ? source.replace(referenceTag, '') : source)
    .replace(/<link rel="stylesheet" href="\/interactive\/runtime\.css">/g, '')
    .replace(/<script defer src="\/interactive\/runtime\.js"><\/script>/g, '')
    .replace(/<style data-matbox-interactive>[\s\S]*?<\/style>/g, '')
    .replace(/<script data-matbox-locale-(?:pack|service|adapter)>[\s\S]*?<\/script>/g, '')
    .replace(/<script data-matbox-interaction-routes>[\s\S]*?<\/script>/g, '')
    .replace(/<script data-matbox-interactive>[\s\S]*?<\/script>/g, '');
  const frozenDocument = stripCaptureRevealStyles(stripCapturedExecutableScripts(withoutPreviousInjection));
  const sourceOrigin = new URL(referenceUrl ?? sourceBase).origin;
  if (sourceOrigin) {
    detectedSourceOrigins.add(sourceOrigin);
  }
  if (buildResume.reusedReplayFiles.has(replayFile)) {
    const routes = routesByReplayFile.get(replayFile) || [];
    componentPageDescriptors.push(...routes.map((route) => ({
      route,
      replayFile,
      sourceOrigin,
      sourceUrl: referenceUrl,
    })));
    continue;
  }
  const localizedDocument = sourceOrigin
    ? localizeCapturedRouteLinks(frozenDocument, {
      sourceOrigin,
      capturedOrigins: [...detectedSourceOrigins],
      capturedRoutes,
      localizeAllSourceLinks: true,
    })
    : frozenDocument;
  const sanitizedDocument = deactivateInactiveRemoteMedia(localizedDocument);
  const restoredDocument = restoreInteractiveScrollbars(releaseResponsiveFrozenHeights(restoreResponsiveAutoSizedCardGridItems(restoreResponsiveContainedComponentBoxes(restoreResponsivePageContainers(restoreResponsiveFullWidthLayoutBoxes(hideEmptyCommerceSkeletons(restoreFrozenVideoBackgrounds(sanitizedDocument))))))));
  const injectedWithRemoteFonts = restoredDocument.includes('</head>')
    ? restoredDocument.replace('</head>', () => `${interactionTags}</head>`)
    : `${interactionTags}${restoredDocument}`;
  const { html: injected } = await freezeRemoteFontAssets(injectedWithRemoteFonts, { cacheDir: frozenFontCacheDir });
  const normalizedHtml = normalizeReplayBase(injected);
  const remoteLocalizedHtml = localizeRemoteAssets(normalizedHtml, remoteAssetPreflight.resourceMap);
  const recoveredImages = recoveredImagesBySource.size > 0
    ? localizeRecoveredImages(remoteLocalizedHtml, recoveredImagesBySource)
    : {
      html: remoteLocalizedHtml,
      replaced: 0,
      remainingActiveReferences: [],
    };
  const remainingRecoveredReferences = recoveredImages.remainingActiveReferences;
  if (remainingRecoveredReferences.length > 0) {
    throw new Error(`Recovered image localization gate failed for ${replayFile}: ${JSON.stringify(remainingRecoveredReferences.slice(0, 20))}`);
  }
  recoveredImageReplacementCount += recoveredImages.replaced;
  const html = recoveredImages.html;
  const routes = routesByReplayFile.get(replayFile) || [];
  const bundle = externalizePageAssetBundle(routes.map((route) => ({ route, replayFile, sourceOrigin, sourceUrl: referenceUrl, html })));
  for (const asset of bundle.assets) replayAssetsByHref.set(asset.href, asset);
  if (bundle.pages.length > 0) {
    await writeBuildPageCheckpoint({
      outputDir: dist,
      replayFile,
      sourceHtml: source,
      outputHtml: bundle.pages[0].html,
      assets: bundle.assets,
    });
    componentPageDescriptors.push(...bundle.pages.map(({ route, sourceOrigin: pageSourceOrigin, sourceUrl }) => ({
      route,
      replayFile,
      sourceOrigin: pageSourceOrigin,
      sourceUrl,
    })));
  }
}
const afterPageCheckpointIntegrity = await auditBuildCheckpointIntegrity({
  stageDir: dist,
  replayFiles: [...sourceReplayFiles],
});
await fs.writeFile(
  path.join(root, 'artifacts', 'full-site-audit', 'build-checkpoint-integrity-after-pages.json'),
  `${JSON.stringify(afterPageCheckpointIntegrity, null, 2)}\n`,
  'utf8',
);
assertBuildCheckpointIntegrity(afterPageCheckpointIntegrity, 'post-page build checkpoint integrity');
await fs.mkdir(path.join(root, 'artifacts', 'full-site-audit'), { recursive: true });
await fs.writeFile(
  path.join(root, 'artifacts', 'full-site-audit', 'build-recovered-image-localization.json'),
  `${JSON.stringify({
    version: 1,
    generatedAt: new Date().toISOString(),
    recoveredUniqueSources: recoveredImagesBySource.size,
    replacements: recoveredImageReplacementCount,
    remainingExternalRecoveredSourceReferences: 0,
    pass: true,
  }, null, 2)}\n`,
  'utf8',
);
try {
  await fs.cp(frozenAssetCacheDir, path.join(dist, 'frozen-assets'), { recursive: true });
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
const verifiedPublicAssets = await collectVerifiedPublicAssets(dist, { publicDirectories: ['frozen-assets', 'component-library/assets'] });
const recoveryEntries = await loadRecoveryEntries();
async function loadComponentPageBatch(descriptors) {
  const htmlByReplayFile = new Map();
  await Promise.all([...new Set(descriptors.map((descriptor) => descriptor.replayFile))].map(async (replayFile) => {
    htmlByReplayFile.set(replayFile, await fs.readFile(path.join(dist, 'replay', replayFile), 'utf8'));
  }));
  return descriptors.map((descriptor) => ({
    ...descriptor,
    html: htmlByReplayFile.get(descriptor.replayFile),
  }));
}
const componentLibraryDir = path.join(dist, 'component-library');
const componentAssetsDir = path.join(componentLibraryDir, 'assets');
await fs.mkdir(componentAssetsDir, { recursive: true });
const assetManifestByHref = new Map();
for (const asset of verifiedPublicAssets) assetManifestByHref.set(asset.href, asset);
const writeAssetBatch = async (assets) => {
  for (let index = 0; index < assets.length; index += 32) {
    await Promise.all(assets.slice(index, index + 32).map(async (asset) => {
      if (assetManifestByHref.has(asset.href)) return;
      await fs.writeFile(path.join(componentAssetsDir, path.basename(asset.href)), asset.buffer);
      const { buffer: _buffer, ...metadata } = asset;
      assetManifestByHref.set(asset.href, metadata);
    }));
  }
};
await writeAssetBatch([...replayAssetsByHref.values()]);
replayAssetsByHref.clear();
await recordGenerationPhase('page-analysis');

const foundationSourceOrigin = [...detectedSourceOrigins][0] || process.env.MATBOX_SOURCE_URL;
const importFoundationWorkDir = path.join(componentLibraryDir, '.analysis-work', 'import-foundation');
const importFoundationAccumulator = await createDiskBackedImportFoundation({
  platform: 'web',
  sourceOrigin: foundationSourceOrigin,
  importRunId: process.env.MATBOX_IMPORT_RUN_ID || 'coco-build',
  workDir: importFoundationWorkDir,
  outputPath: path.join(componentLibraryDir, 'import-foundation.json'),
});
const routeLinkAuditReports = [];
for (let index = 0; index < componentPageDescriptors.length; index += analysisBatchSize) {
  const pages = await loadComponentPageBatch(componentPageDescriptors.slice(index, index + analysisBatchSize));
  routeLinkAuditReports.push(auditCapturedRouteLinksBySource(pages, {
    capturedRoutes,
    localDocumentRoutes,
    recoveryEntries,
  }));
  await importFoundationAccumulator.addPages(pages.filter((page) => !page.route.includes('?matbox-viewport=mobile')));
}
const routeLinkAudit = mergeCapturedRouteLinkAudits(routeLinkAuditReports, { recoveryEntries });
await fs.mkdir(path.join(root, 'artifacts', 'full-site-audit'), { recursive: true });
await fs.writeFile(path.join(root, 'artifacts', 'full-site-audit', 'document-preflight.json'), `${JSON.stringify(documentPreflight, null, 2)}\n`, 'utf8');
await fs.writeFile(path.join(root, 'artifacts', 'full-site-audit', 'route-link-audit.json'), `${JSON.stringify(routeLinkAudit, null, 2)}\n`, 'utf8');
const importFoundationResult = await importFoundationAccumulator.finish();
const editableContractAudit = importFoundationResult.editableContractAudit;
await fs.writeFile(
  path.join(root, 'artifacts', 'full-site-audit', 'editable-contract-audit.json'),
  `${JSON.stringify(editableContractAudit, null, 2)}\n`,
  'utf8',
);
if (!editableContractAudit.pass) {
  throw new Error(`Editable component contract gate failed: ${JSON.stringify(editableContractAudit.failures.slice(0, 20))}`);
}
const pageIdentityByRoute = importFoundationResult.pageIdentityByRoute;
await fs.writeFile(path.join(componentLibraryDir, 'editable-contract-audit.json'), `${JSON.stringify(editableContractAudit, null, 2)}\n`, 'utf8');
await fs.writeFile(path.join(componentLibraryDir, 'page-identity-registry.json'), `${JSON.stringify(importFoundationResult.pageIdentityRegistry, null, 2)}\n`, 'utf8');
await fs.rm(path.join(componentLibraryDir, '.analysis-work'), { recursive: true, force: true });
console.log(JSON.stringify({ phase: 'import-foundation-written', ...importFoundationResult.write, retainedFullComponentCount: importFoundationResult.retainedFullComponentCount, heapUsed: process.memoryUsage().heapUsed }));
global.gc?.();

const componentRegistryAccumulator = createComponentRegistryAccumulator({ requireGeometryEvidence: true });
for (let index = 0; index < componentPageDescriptors.length; index += analysisBatchSize) {
  const pages = await loadComponentPageBatch(componentPageDescriptors.slice(index, index + analysisBatchSize));
  componentRegistryAccumulator.addPages(pages);
}
let componentArtifacts = componentRegistryAccumulator.finish();
global.gc?.();
const publishedCompositions = externalizePageCompositionMarkup(componentArtifacts.compositions);
if (componentArtifacts.report.unmappedSectionCount > 0 || componentArtifacts.report.componentIdCollisionCount > 0 || componentArtifacts.report.reassemblyFailureCount > 0) {
  throw new Error(`Component library gate failed: ${JSON.stringify(componentArtifacts.report)}`);
}
await recordGenerationPhase('component-conversion');
const unitVerificationRoot = path.join(root, 'artifacts', 'unit-verification');
const unitStagingRoot = path.join(root, 'artifacts', 'incremental-build', 'staging');
const acceptedUnitRoot = path.join(root, 'artifacts', 'incremental-build', 'accepted');
const acceptedComponentIds = new Set();
const registeredComponentIds = new Set();
const componentPackageRecords = [];
const componentPackagesDir = path.join(componentLibraryDir, 'packages');
await writeAssetBatch(componentArtifacts.assets);
const packageAssetManifest = [...assetManifestByHref.values()];
const availableComponentAssetHrefs = packageAssetManifest.map((asset) => asset.href);
if (!stageOnly) {
  await fs.rm(unitStagingRoot, { recursive: true, force: true });
  for (const component of componentArtifacts.registry.components) {
    const unitId = component.matboxComponentId;
    const unitFolder = encodeURIComponent(unitId);
    const stagingDir = path.join(unitStagingRoot, unitFolder);
    const acceptedDir = path.join(acceptedUnitRoot, unitFolder);
    let evidence = {};
    try {
      evidence = JSON.parse(await fs.readFile(path.join(unitVerificationRoot, `${unitFolder}.json`), 'utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const editableVariants = component.variants.map((variant) => {
      const editable = convertMarkupToEditableSection({
        sectionId: component.sourceSectionId,
        sectionType: component.sourceSectionType,
        markup: variant.markup,
      });
      return { ...variant, markup: editable.annotatedMarkup };
    });
    const packageRecord = createPortableComponentPackage({
      ...component,
      variants: editableVariants,
    }, {
      assetManifest: packageAssetManifest,
      verification: evidence,
    });
    const materialization = await materializePortableComponentPackage(packageRecord, stagingDir);
    if (!materialization.pass) {
      throw new Error(`Component package materialization failed: ${JSON.stringify({ unitId, failures: materialization.failures })}`);
    }
    const promotion = await verifyAndPromoteUnit({
      unitId,
      stagingDir,
      acceptedDir,
      evidence,
      component,
      availableAssetHrefs: availableComponentAssetHrefs,
    });
    if (!promotion.pass) {
      throw new Error(`Incremental component gate failed before accepted output: ${JSON.stringify({ unitId, failures: promotion.failures })}`);
    }
    acceptedComponentIds.add(unitId);
    componentPackageRecords.push(packageRecord);
  }

  for (const componentId of acceptedComponentIds) registeredComponentIds.add(componentId);
  const formalComponents = componentArtifacts.registry.components.map((component) => ({
    componentId: component.matboxComponentId,
    sourceCandidateId: component.matboxComponentId,
  }));
  const pageReferences = groupPageCompositions(componentArtifacts.compositions).map((composition) => ({
    pageId: pageIdentityByRoute.get(composition.route)?.platformPageId || null,
    componentIds: composition.componentIds,
  }));
  const componentDeliveryAudit = auditComponentDelivery({
    candidates: formalComponents.map((component) => component.sourceCandidateId),
    excluded: [],
    formalComponents,
    packages: componentPackageRecords,
    acceptedIds: [...acceptedComponentIds],
    registeredIds: [...registeredComponentIds],
    pageReferences,
  });
  if (!componentDeliveryAudit.pass) {
    throw new Error(`Component delivery gate failed: ${JSON.stringify(componentDeliveryAudit.failures.slice(0, 50))}`);
  }
  await fs.rm(componentPackagesDir, { recursive: true, force: true });
  await fs.mkdir(componentPackagesDir, { recursive: true });
  for (const componentId of registeredComponentIds) {
    const unitFolder = encodeURIComponent(componentId);
    await fs.cp(
      path.join(acceptedUnitRoot, unitFolder),
      path.join(componentPackagesDir, unitFolder),
      { recursive: true },
    );
  }
  await fs.writeFile(path.join(componentLibraryDir, 'component-package-report.json'), `${JSON.stringify(componentDeliveryAudit, null, 2)}\n`, 'utf8');
  await fs.writeFile(path.join(componentLibraryDir, 'component-package-registry.json'), `${JSON.stringify({
    schemaVersion: 1,
    components: [...registeredComponentIds].map((componentId) => ({
      componentId,
      status: 'registered',
      packageHref: `/component-library/packages/${encodeURIComponent(componentId)}/manifest.json`,
    })),
  }, null, 2)}\n`, 'utf8');

  const pageVerificationRoot = path.join(root, 'artifacts', 'page-verification');
  const pageStagingRoot = path.join(root, 'artifacts', 'page-assembly', 'staging');
  const acceptedPageRoot = path.join(root, 'artifacts', 'page-assembly', 'accepted');
  await fs.rm(pageStagingRoot, { recursive: true, force: true });
  for (const composition of groupPageCompositions(componentArtifacts.compositions)) {
    const pageIdentity = pageIdentityByRoute.get(composition.route);
    if (!pageIdentity?.platformPageId) {
      throw new Error(`Permanent platform page ID missing for route ${composition.route}`);
    }
    const pageId = pageIdentity.platformPageId;
    const pageFolder = encodeURIComponent(pageId);
    const evidenceFolder = encodeURIComponent(composition.route);
    const stagingDir = path.join(pageStagingRoot, pageFolder);
    const acceptedDir = path.join(acceptedPageRoot, pageFolder);
    const componentIds = composition.componentIds;
    await fs.mkdir(stagingDir, { recursive: true });
    await fs.writeFile(path.join(stagingDir, 'page.json'), `${JSON.stringify(composition, null, 2)}\n`, 'utf8');
    let evidence = {};
    try {
      evidence = JSON.parse(await fs.readFile(path.join(pageVerificationRoot, `${evidenceFolder}.json`), 'utf8'));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    evidence = {
      ...evidence,
      route: composition.route,
      componentIds,
      acceptedComponentIds: [...acceptedComponentIds],
      registeredComponentIds: [...registeredComponentIds],
    };
    const promotion = await verifyAndPromotePage({ pageId, stagingDir, acceptedDir, evidence });
    if (!promotion.pass) {
      throw new Error(`Page assembly gate failed before accepted output: ${JSON.stringify({ pageId, failures: promotion.failures })}`);
    }
  }
}
await fs.mkdir(componentLibraryDir, { recursive: true });
const componentVariantsDir = path.join(componentLibraryDir, 'variants');
const componentVariants = await publishComponentVariantMarkup(componentArtifacts.registry, componentVariantsDir);
const componentCompositionsDir = path.join(componentLibraryDir, 'compositions');
await fs.mkdir(componentCompositionsDir, { recursive: true });
for (let index = 0; index < publishedCompositions.fragments.length; index += 64) {
  await Promise.all(publishedCompositions.fragments.slice(index, index + 64).map((fragment) => (
    fs.writeFile(path.join(componentCompositionsDir, fragment.filename), fragment.content, 'utf8')
  )));
}
await writeAssetBatch(componentArtifacts.assets);
const assetManifest = [...assetManifestByHref.values()].sort((a, b) => a.href.localeCompare(b.href));
await fs.writeFile(path.join(componentLibraryDir, 'asset-manifest.json'), `${JSON.stringify(assetManifest, null, 2)}\n`, 'utf8');
await fs.writeFile(path.join(componentLibraryDir, 'component-registry.json'), `${JSON.stringify(componentVariants.registry, null, 2)}\n`, 'utf8');
await fs.writeFile(path.join(componentLibraryDir, 'page-compositions.json'), `${JSON.stringify(publishedCompositions.compositions, null, 2)}\n`, 'utf8');
await fs.writeFile(path.join(componentLibraryDir, 'component-report.json'), `${JSON.stringify(componentArtifacts.report, null, 2)}\n`, 'utf8');
const componentDir = path.join(dist, 'app', 'components');
const pageDir = path.join(dist, 'app', 'pages');
const stripModuleSyntax = (source) => source.replace(/^import .*?;\n/gm, '').replace(/\bexport\s+(?=(function|const|let|var|class)\b)/g, '');
const componentFiles = (await fs.readdir(componentDir)).filter((name) => name.endsWith('.js')).sort();
const pageFiles = (await fs.readdir(pageDir)).filter((name) => name.endsWith('.js')).sort();
const chunks = [];
for (const name of componentFiles) chunks.push(stripModuleSyntax(await fs.readFile(path.join(componentDir, name), 'utf8')));
for (const name of pageFiles) chunks.push(stripModuleSyntax(await fs.readFile(path.join(pageDir, name), 'utf8')));
chunks.push(stripModuleSyntax(await fs.readFile(path.join(dist, 'app', 'main.js'), 'utf8')));
await fs.writeFile(path.join(dist, 'app.js'), chunks.join('\n'), 'utf8');
await fs.writeFile(path.join(dist, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app/index.css"></head><body><div id="root"></div><script src="/vendor/react-poc-runtime.js"></script><script src="/app.js"></script></body></html>\n');
if (!routeLinkAudit.pass && !stageOnly) {
  throw new Error(`Captured route link gate failed: ${JSON.stringify(routeLinkAudit.failures.slice(0, 20))}`);
}
const finalCheckpointIntegrity = await auditBuildCheckpointIntegrity({
  stageDir: dist,
  replayFiles: [...sourceReplayFiles],
});
await fs.writeFile(
  path.join(root, 'artifacts', 'full-site-audit', 'build-checkpoint-integrity-final.json'),
  `${JSON.stringify(finalCheckpointIntegrity, null, 2)}\n`,
  'utf8',
);
assertBuildCheckpointIntegrity(finalCheckpointIntegrity, 'final build checkpoint integrity');
if (stageOnly) {
  const stageFailedGates = [
    ...(!routeLinkAudit.pass ? ['route-links'] : []),
    ...(!stylesheetRecoveryGate.pass ? ['stylesheet-recovery'] : []),
  ];
  const stagingStatus = {
    verified: false,
    publishable: false,
    reason: stageFailedGates.length ? 'stage-only build has failed gates' : 'stage-only build',
    failedGates: stageFailedGates,
    routeLinkAudit: {
      pass: routeLinkAudit.pass,
      uncapturedLocalRouteCount: routeLinkAudit.uncapturedLocalRouteCount,
      failures: routeLinkAudit.failures.slice(0, 20),
    },
    stylesheetRecovery: stylesheetRecoveryGate,
  };
  await fs.writeFile(path.join(dist, 'UNVERIFIED-STAGING.json'), `${JSON.stringify(stagingStatus, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ok: true, stageOnly: true, verified: false, publishable: false, failedGates: stagingStatus.failedGates, dist }, null, 2));
} else {
  await promoteDirectoryAtomically({ stagingDir: dist, acceptedDir: acceptedDist });
  console.log(JSON.stringify({ ok: true, stageOnly: false, publishable: true, dist: acceptedDist }, null, 2));
}
await recordGenerationPhase('site-generation');
await finishGenerationTiming();
