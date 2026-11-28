import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  decodeCachedImageRecovery,
  findActiveRecoveredImageReferences,
  localizeRecoveredImages,
} from './image-recovery-patch.mjs';
import { isImageResponse } from './network-image-recovery.mjs';
import { readImageDimensions } from './image-dimensions.mjs';
import { writeAtomicVerified } from './verified-write.mjs';

const MANIFEST_NAMES = Object.freeze([
  'network-image-recovery-manifest.json',
  'same-sku-page-image-recovery-manifest.json',
  'local-product-card-recovery-manifest.json',
  'historical-component-recovery-manifest.json',
]);

async function resolvePortableArtifactFile(artifactRoot, recordedPath) {
  const recorded = String(recordedPath || '');
  const normalized = recorded.replaceAll('\\', '/');
  const artifactParent = path.dirname(artifactRoot);
  const candidates = [recorded];
  const componentMarker = '/component-geometry-migration/';
  const fullSiteMarker = '/full-site-audit/';
  if (normalized.includes(componentMarker)) {
    candidates.push(path.join(artifactRoot, ...normalized.split(componentMarker)[1].split('/')));
  }
  if (normalized.includes(fullSiteMarker)) {
    candidates.push(path.join(artifactParent, 'full-site-audit', ...normalized.split(fullSiteMarker)[1].split('/')));
  }
  if (!path.isAbsolute(recorded)) candidates.push(path.join(artifactRoot, recorded));
  for (const candidate of [...new Set(candidates.filter(Boolean))]) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  throw Object.assign(new Error(`Recovered artifact file is missing after portable path resolution: ${recorded}`), { code: 'ENOENT' });
}

export async function loadVerifiedRecoveredImages(artifactRoot) {
  const recoveryBySource = new Map();
  const cacheAudit = JSON.parse(await fs.readFile(path.join(artifactRoot, 'missing-image-cache-audit.json'), 'utf8'));
  for (const recovery of cacheAudit.recovered || []) {
    const cacheFile = await resolvePortableArtifactFile(artifactRoot, recovery.cacheFile);
    const cacheEnvelope = await fs.readFile(cacheFile, 'utf8');
    const decoded = decodeCachedImageRecovery(cacheEnvelope, {
      sourceUrl: recovery.source,
      contentType: recovery.contentType,
      byteLength: recovery.byteLength,
    });
    if (!isImageResponse({ contentType: decoded.contentType, buffer: decoded.buffer })) {
      throw new Error(`Cached image recovery verification failed: ${recovery.targetSource}`);
    }
    const dimensions = readImageDimensions(decoded.buffer, decoded.contentType);
    recoveryBySource.set(recovery.targetSource, {
      dataUrl: decoded.dataUrl,
      intrinsicWidth: dimensions?.width || 0,
      intrinsicHeight: dimensions?.height || 0,
    });
  }
  for (const name of MANIFEST_NAMES) {
    let manifest;
    try { manifest = JSON.parse(await fs.readFile(path.join(artifactRoot, name), 'utf8')); } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    for (const [source, recovery] of Object.entries(manifest.entries || {})) {
      if (recovery.status !== 'recovered' || recoveryBySource.has(source)) continue;
      const recoveryFile = await resolvePortableArtifactFile(artifactRoot, recovery.file);
      const buffer = await fs.readFile(recoveryFile);
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      if (sha256 !== recovery.sha256 || buffer.length !== recovery.byteLength) {
        throw new Error(`Recovered image verification failed: ${source}`);
      }
      const dimensions = readImageDimensions(buffer, recovery.contentType);
      recoveryBySource.set(source, {
        dataUrl: `data:${recovery.contentType};base64,${buffer.toString('base64')}`,
        intrinsicWidth: dimensions?.width || 0,
        intrinsicHeight: dimensions?.height || 0,
      });
    }
  }
  return recoveryBySource;
}

export async function loadRecoveredImageTargetFiles(artifactRoot, recoveryBySource = new Map()) {
  const evidence = JSON.parse(await fs.readFile(path.join(artifactRoot, 'source-image-evidence-audit.json'), 'utf8'));
  return new Set((evidence.failures || [])
    .filter((failure) => recoveryBySource.has(failure.source))
    .map((failure) => failure.filename));
}

export async function publishRecoveredImages({
  artifactRoot,
  distReplayRoot,
  writeReport = true,
  reportPath = path.join(artifactRoot, 'publish-recovered-images-to-dist.json'),
} = {}) {
  if (!artifactRoot) throw new TypeError('artifactRoot is required');
  if (!distReplayRoot) throw new TypeError('distReplayRoot is required');
  const evidence = JSON.parse(await fs.readFile(path.join(artifactRoot, 'source-image-evidence-audit.json'), 'utf8'));
  const recoveryBySource = await loadVerifiedRecoveredImages(artifactRoot);
  const affectedFiles = [...new Set((evidence.failures || [])
    .filter((failure) => recoveryBySource.has(failure.source))
    .map((failure) => failure.filename))];
  const auditedFiles = [...new Set((evidence.failures || []).map((failure) => failure.filename))];
  const auditedSources = new Set((evidence.failures || []).map((failure) => failure.source));
  let replacements = 0;
  let alreadyLocalized = 0;
  const changedFiles = [];
  for (const filename of affectedFiles) {
    const file = path.join(distReplayRoot, filename);
    const html = await fs.readFile(file, 'utf8');
    const patched = localizeRecoveredImages(html, recoveryBySource);
    replacements += patched.replaced;
    alreadyLocalized += Object.values(patched.alreadyLocalizedBySource).reduce((sum, count) => sum + count, 0);
    if (patched.replaced === 0) continue;
    await writeAtomicVerified(file, patched.html);
    changedFiles.push(filename);
  }

  const remaining = [];
  for (const filename of auditedFiles) {
    const html = await fs.readFile(path.join(distReplayRoot, filename), 'utf8');
    for (const reference of findActiveRecoveredImageReferences(html, auditedSources)) {
      remaining.push({ filename, ...reference });
    }
  }
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    recoveredUniqueSources: recoveryBySource.size,
    auditedUniqueSources: auditedSources.size,
    affectedFileCount: affectedFiles.length,
    auditedFileCount: auditedFiles.length,
    changedFileCount: changedFiles.length,
    replacements,
    alreadyLocalized,
    remainingExternalRecoveredSourceReferences: remaining.length,
    pass: remaining.length === 0,
    changedFiles,
    remaining,
  };
  if (writeReport) await writeAtomicVerified(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
