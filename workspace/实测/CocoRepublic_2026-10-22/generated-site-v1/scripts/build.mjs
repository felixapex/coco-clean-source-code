import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildComponentRegistry, buildImportFoundationRecords, compactImportFoundationRecords, externalizePageAssetBundle, externalizePageCompositionMarkup, localizeCapturedRouteLinks, normalizeReplayBase, publishComponentVariantMarkup, restoreFrozenVideoBackgrounds } from './lib/component-registry.mjs';
import { validateCapturedHtml } from './lib/capture-validation.mjs';
import { promoteDirectoryAtomically, verifyAndPromoteUnit } from './lib/incremental-build-gate.mjs';
import { verifyAndPromotePage } from './lib/page-assembly-gate.mjs';
import { groupPageCompositions } from './lib/page-verification-evidence.mjs';
import { freezeRemoteFontAssets, preflightRemoteFontAssets } from './lib/remote-font-freezer.mjs';
import { preflightRemoteDocuments, publishFrozenDocuments } from './lib/remote-document-freezer.mjs';
import { auditCapturedRouteLinksBySource } from './lib/route-link-audit.mjs';
import { hideEmptyCommerceSkeletons, releaseResponsiveFrozenHeights, restoreInteractiveScrollbars, restoreResponsiveAutoSizedCardGridItems, restoreResponsiveFullWidthLayoutBoxes, restoreResponsivePageContainers, stripCaptureRevealStyles } from './lib/replay-state-sanitizer.mjs';
import { auditEditableImportFoundation } from './lib/editable-import-audit.mjs';
import { convertMarkupToEditableSection } from './lib/editable-component-contract.mjs';
import { writeJsonObjectStreaming } from './lib/stream-json-file.mjs';
import { teeAsyncIterable } from './lib/async-iterable.mjs';
import { buildStylesheetRecoveryGate } from './lib/final-verification-report.mjs';
import {
  buildReplayPreflightCacheKey,
  loadReplayPreflightCache,
  writeReplayPreflightCache,
} from './lib/resource-preflight-cache.mjs';
import {
  auditComponentDelivery,
  createPortableComponentPackage,
  materializePortableComponentPackage,
} from '../../../../packages/import-foundation/component-package.mjs';

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
const dist = stagingDirArgument ? path.resolve(root, stagingDirArgument) : `${stagingRoot}-${process.pid}`;
const frozenAssetCacheDir = path.join(root, 'artifacts', 'frozen-remote-assets');
const frozenFontCacheDir = path.join(frozenAssetCacheDir, 'fonts');
const frozenDocumentCacheDir = path.join(frozenAssetCacheDir, 'documents');
const sourceReplayDir = path.join(root, 'src', 'replay');
const recoveryRoot = path.join(root, 'artifacts', 'full-site-audit', 'recovery');
const generationTimingPath = path.join(root, 'artifacts', 'full-site-audit', 'generation-timing.json');
const generationTimingHistoryPath = path.join(root, 'artifacts', 'full-site-audit', 'generation-timing-history.jsonl');
const resourcePreflightCachePath = path.join(root, 'artifacts', 'full-site-audit', 'resource-preflight-cache.json');
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
async function* sourceReplayHtml() {
  for (const replayFile of sourceReplayFiles) yield fs.readFile(path.join(sourceReplayDir, replayFile), 'utf8');
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
await recordGenerationPhase(cachedResourcePreflight.hit ? 'resource-preflight-cache-hit' : 'resource-preflight-scan');
await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(path.join(dist, 'app'), { recursive: true });
await fs.mkdir(path.join(dist, 'vendor'), { recursive: true });
await fs.mkdir(path.join(dist, 'replay'), { recursive: true });
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
const localePack = await fs.readFile(path.join(root, 'src', 'localization', 'majestic-pack.js'), 'utf8');
const localeService = await fs.readFile(path.resolve(root, '..', '..', '..', 'packages', 'platform-localization', 'locale-service.js'), 'utf8');
const localeAdapter = await fs.readFile(path.join(root, 'src', 'localization', 'replay-adapter.js'), 'utf8');
const inlineScript = (tag, source) => `<script data-matbox-locale-${tag}>${source.replace(/<\/script/gi, '<\\/script')}</script>`;
const interactionRouteConfig = `<script data-matbox-interaction-routes>window.__matboxInteractionRoutes=${JSON.stringify(interactionRoutes).replace(/<\/script/gi, '<\\/script')};</script>`;
const interactionTags = `${inlineScript('pack', localePack)}${inlineScript('service', localeService)}${inlineScript('adapter', localeAdapter)}${interactionRouteConfig}<style data-matbox-interactive>${interactionCss}</style><script data-matbox-interactive>${interactionJs.replace(/<\/script/gi, '<\\/script')}</script>`;
const stripCapturedExecutableScripts = (html) => html.replace(/<script\b([^>]*)>[\s\S]*?<\/script>/gi, (full, attributes) => {
  const type = attributes.match(/\btype=["']([^"']+)["']/i)?.[1]?.toLowerCase() || '';
  return type === 'application/json' || type === 'application/ld+json' || type === 'application/x-matbox-disabled' ? full : '';
});
const capturedRoutes = [...new Set([...Object.keys(replayRoutes), ...Object.keys(mobileReplayRoutes)])];
const detectedSourceOrigins = new Set();
const routesByReplayFile = new Map();
for (const [route, replayFile] of Object.entries(replayRoutes)) {
  if (!routesByReplayFile.has(replayFile)) routesByReplayFile.set(replayFile, []);
  routesByReplayFile.get(replayFile).push(route);
}
for (const [route, replayFile] of Object.entries(mobileReplayRoutes)) {
  if (!routesByReplayFile.has(replayFile)) routesByReplayFile.set(replayFile, []);
  routesByReplayFile.get(replayFile).push(`${route}?matbox-viewport=mobile`);
}
let componentPages = [];
const replayAssetsByHref = new Map();
await recordGenerationPhase('source-preparation');
for (const replayFile of new Set([...Object.values(replayRoutes), ...Object.values(mobileReplayRoutes)])) {
  const replayPath = path.join(dist, 'replay', replayFile);
  const source = await fs.readFile(path.join(sourceReplayDir, replayFile), 'utf8');
  const persistedValidation = validateCapturedHtml(source);
  if (!persistedValidation.pass) throw new Error(`Persisted capture gate failed for ${replayFile}: ${persistedValidation.failures.join(', ')}`);
  const withoutPreviousInjection = source
    .replace(/<link rel="stylesheet" href="\/interactive\/runtime\.css">/g, '')
    .replace(/<script defer src="\/interactive\/runtime\.js"><\/script>/g, '')
    .replace(/<style data-matbox-interactive>[\s\S]*?<\/style>/g, '')
    .replace(/<script data-matbox-locale-(?:pack|service|adapter)>[\s\S]*?<\/script>/g, '')
    .replace(/<script data-matbox-interaction-routes>[\s\S]*?<\/script>/g, '')
    .replace(/<script data-matbox-interactive>[\s\S]*?<\/script>/g, '');
  const frozenDocument = stripCaptureRevealStyles(stripCapturedExecutableScripts(withoutPreviousInjection));
  const sourceBase = frozenDocument.match(/<base\b[^>]*href=["']([^"']+)/i)?.[1];
  const sourceOrigin = sourceBase ? new URL(sourceBase).origin : null;
  if (sourceOrigin) {
    detectedSourceOrigins.add(sourceOrigin);
  }
  const localizedDocument = sourceOrigin
    ? localizeCapturedRouteLinks(frozenDocument, { sourceOrigin, capturedRoutes, localizeAllSourceLinks: true })
    : frozenDocument;
  const restoredDocument = restoreInteractiveScrollbars(releaseResponsiveFrozenHeights(restoreResponsiveAutoSizedCardGridItems(restoreResponsivePageContainers(restoreResponsiveFullWidthLayoutBoxes(hideEmptyCommerceSkeletons(restoreFrozenVideoBackgrounds(localizedDocument)))))));
  const injectedWithRemoteFonts = restoredDocument.includes('</head>')
    ? restoredDocument.replace('</head>', () => `${interactionTags}</head>`)
    : `${interactionTags}${restoredDocument}`;
  const { html: injected } = await freezeRemoteFontAssets(injectedWithRemoteFonts, { cacheDir: frozenFontCacheDir });
  const html = normalizeReplayBase(injected);
  const routes = routesByReplayFile.get(replayFile) || [];
  const bundle = externalizePageAssetBundle(routes.map((route) => ({ route, replayFile, sourceOrigin, html })));
  for (const asset of bundle.assets) replayAssetsByHref.set(asset.href, asset);
  if (bundle.pages.length > 0) {
    await fs.writeFile(replayPath, bundle.pages[0].html, 'utf8');
    componentPages.push(...bundle.pages);
  }
}
try {
  await fs.cp(frozenAssetCacheDir, path.join(dist, 'frozen-assets'), { recursive: true });
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
const recoveryEntries = await loadRecoveryEntries();
const routeLinkAudit = auditCapturedRouteLinksBySource(componentPages, { capturedRoutes, localDocumentRoutes, recoveryEntries });
await fs.mkdir(path.join(root, 'artifacts', 'full-site-audit'), { recursive: true });
await fs.writeFile(path.join(root, 'artifacts', 'full-site-audit', 'document-preflight.json'), `${JSON.stringify(documentPreflight, null, 2)}\n`, 'utf8');
await fs.writeFile(path.join(root, 'artifacts', 'full-site-audit', 'route-link-audit.json'), `${JSON.stringify(routeLinkAudit, null, 2)}\n`, 'utf8');
const componentLibraryDir = path.join(dist, 'component-library');
const componentAssetsDir = path.join(componentLibraryDir, 'assets');
await fs.mkdir(componentAssetsDir, { recursive: true });
const assetManifestByHref = new Map();
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
let importFoundation = buildImportFoundationRecords(
  componentPages.filter((page) => !page.route.includes('?matbox-viewport=mobile')),
  {
    platform: 'web',
    sourceOrigin: foundationSourceOrigin,
    importRunId: process.env.MATBOX_IMPORT_RUN_ID || 'coco-build',
  },
);
let publishedImportFoundation = compactImportFoundationRecords(importFoundation);
let editableContractAudit = auditEditableImportFoundation(publishedImportFoundation);
await fs.writeFile(
  path.join(root, 'artifacts', 'full-site-audit', 'editable-contract-audit.json'),
  `${JSON.stringify(editableContractAudit, null, 2)}\n`,
  'utf8',
);
if (!editableContractAudit.pass) {
  throw new Error(`Editable component contract gate failed: ${JSON.stringify(editableContractAudit.failures.slice(0, 20))}`);
}
const pageIdentityByRoute = new Map(
  importFoundation.pages.map((page) => [page.route, page.pageIdentity]),
);
const importFoundationWrite = await writeJsonObjectStreaming(
  path.join(componentLibraryDir, 'import-foundation.json'),
  publishedImportFoundation,
  { streamedArrayKeys: ['pages', 'componentLibrary'] },
);
await fs.writeFile(path.join(componentLibraryDir, 'editable-contract-audit.json'), `${JSON.stringify(editableContractAudit, null, 2)}\n`, 'utf8');
await fs.writeFile(path.join(componentLibraryDir, 'page-identity-registry.json'), `${JSON.stringify(importFoundation.pageIdentityRegistry, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ phase: 'import-foundation-written', ...importFoundationWrite, heapUsed: process.memoryUsage().heapUsed }));
importFoundation = null;
publishedImportFoundation = null;
editableContractAudit = null;
global.gc?.();

let componentArtifacts = buildComponentRegistry(componentPages, { requireGeometryEvidence: true });
componentPages = [];
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
