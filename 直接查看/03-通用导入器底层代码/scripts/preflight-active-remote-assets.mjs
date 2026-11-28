import fs from 'node:fs/promises';
import path from 'node:path';

import {
  collectActiveRemoteAssetUrls,
  freezeRemoteAssets,
  loadVerifiedRemoteAssetManifest,
} from './lib/remote-asset-freezer.mjs';
import { downloadRemoteAssetWithCurl } from './lib/remote-font-freezer.mjs';
import { buildReplayPreflightCacheKey } from './lib/resource-preflight-cache.mjs';
import { bigCommerceImageFallbackCandidates } from '../src/import-core/capture/chromium-capture.mjs';

const root = process.cwd();
const sourceReplayDir = path.join(root, 'src', 'replay');
const frozenAssetRoot = path.join(root, 'artifacts', 'frozen-remote-assets', 'external-v4');
const resourceCache = path.join(root, 'artifacts', 'full-site-audit', 'persistent-resource-cache');
const packageAuditPath = path.join(root, 'artifacts', 'full-site-audit', 'stage-component-package-audit.json');
const replayFiles = new Set();
const fromPackageAudit = process.argv.includes('--from-package-audit');
const stampOnly = process.argv.includes('--stamp-only');
const inventoryOnly = process.argv.includes('--inventory-only');
const reportPath = path.join(
  root,
  'artifacts',
  'full-site-audit',
  fromPackageAudit ? 'stage-remote-asset-preflight.json' : 'source-remote-asset-preflight.json',
);

for (const manifestName of ['routes.json', 'routes-mobile.json']) {
  const manifest = JSON.parse(await fs.readFile(path.join(sourceReplayDir, manifestName), 'utf8'));
  for (const filename of Object.values(manifest)) replayFiles.add(String(filename));
}
const cacheKey = await buildReplayPreflightCacheKey({
  sourceReplayDir,
  replayFiles: [...replayFiles],
});
if (stampOnly) {
  const legacyReportPath = path.join(root, 'artifacts', 'full-site-audit', 'remote-asset-preflight.json');
  const current = JSON.parse(await fs.readFile(reportPath, 'utf8').catch((error) => {
    if (error?.code !== 'ENOENT') throw error;
    return fs.readFile(legacyReportPath, 'utf8');
  }));
  const scope = fromPackageAudit ? 'stage-component-package-audit' : 'source-replay';
  await fs.writeFile(reportPath, `${JSON.stringify({ ...current, scope, cacheKey }, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ stamped: true, cacheKey }, null, 2)}\n`);
  process.exit(0);
}

if (inventoryOnly && !fromPackageAudit) {
  throw new Error('--inventory-only requires --from-package-audit');
}

async function* activeHtml() {
  if (fromPackageAudit) {
    const audit = JSON.parse(await fs.readFile(packageAuditPath, 'utf8'));
    const urls = new Set((audit.failures || []).flatMap((failure) => (
      (failure.failures || []).map((item) => String(item.href || '')).filter((href) => /^https?:\/\//i.test(href))
    )));
    for (const url of urls) yield `<style>.asset{background-image:url("${url.replaceAll('"', '&quot;')}")}</style>`;
    return;
  }
  for (const filename of replayFiles) {
    yield fs.readFile(path.join(sourceReplayDir, filename), 'utf8');
  }
}

const startedAt = Date.now();
if (inventoryOnly) {
  const urls = new Set();
  for await (const html of activeHtml()) {
    for (const url of collectActiveRemoteAssetUrls(html)) urls.add(url);
  }
  const verified = await loadVerifiedRemoteAssetManifest(frozenAssetRoot);
  const assets = [...urls]
    .map((url) => verified.assets.find((asset) => asset.sourceUrl === url))
    .filter(Boolean);
  const resolved = new Set(assets.map((asset) => asset.sourceUrl));
  const failures = [...urls]
    .filter((url) => !resolved.has(url))
    .sort()
    .map((url) => ({ url, error: 'not present in verified local asset cache; network not attempted' }));
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    scope: 'stage-component-package-audit',
    cacheKey,
    sourceMode: 'component-package-audit-inventory',
    replayFileCount: replayFiles.size,
    assetCount: assets.length,
    elapsedMs: Date.now() - startedAt,
    assets,
    failures,
    pass: failures.length === 0,
  };
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({
    replayFileCount: report.replayFileCount,
    assetCount: report.assetCount,
    elapsedMs: report.elapsedMs,
    pass: report.pass,
    failureCount: report.failures.length,
  }, null, 2)}\n`);
  if (!report.pass) process.exitCode = 1;
  process.exit();
}

const frozen = await freezeRemoteAssets(activeHtml(), {
  cacheDir: resourceCache,
  outputDir: frozenAssetRoot,
  publicBase: '/frozen-assets/external-v4',
  candidateFactory: bigCommerceImageFallbackCandidates,
  fallbackDownloadImpl: downloadRemoteAssetWithCurl,
  concurrency: 4,
  continueOnError: true,
});
const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  scope: fromPackageAudit ? 'stage-component-package-audit' : 'source-replay',
  cacheKey,
  sourceMode: fromPackageAudit ? 'component-package-audit' : 'source-replay',
  replayFileCount: replayFiles.size,
  assetCount: frozen.assets.length,
  elapsedMs: Date.now() - startedAt,
  assets: frozen.assets,
  failures: frozen.failures,
  pass: frozen.failures.length === 0,
};
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({
  replayFileCount: report.replayFileCount,
  assetCount: report.assetCount,
  elapsedMs: report.elapsedMs,
  pass: report.pass,
  failureCount: report.failures.length,
}, null, 2)}\n`);
if (!report.pass) process.exitCode = 1;
