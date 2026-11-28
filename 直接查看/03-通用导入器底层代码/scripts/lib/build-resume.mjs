import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { findActiveRecoveredImageReferences } from './image-recovery-patch.mjs';
import { writeAtomicVerified } from './verified-write.mjs';

const COMPONENT_ASSET_PATTERN = /\/component-library\/assets\/([A-Za-z0-9._-]+)/g;

export function componentAssetHrefsInHtml(html) {
  return [...new Set([...String(html || '').matchAll(COMPONENT_ASSET_PATTERN)]
    .map((match) => `/component-library/assets/${match[1]}`))];
}

async function readJson(filename, fallback) {
  try {
    return JSON.parse(await fs.readFile(filename, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

function verifiedAsset(buffer, record) {
  if (!record || buffer.byteLength !== Number(record.byteLength)) return false;
  return !record.sha256 || crypto.createHash('sha256').update(buffer).digest('hex') === record.sha256;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function atomicWrite(filename, content, { operations = fs, attempts = 3 } = {}) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await writeAtomicVerified(filename, content, { operations, attempts });
}

export async function writeBuildPageCheckpoint({
  outputDir,
  replayFile,
  sourceHtml,
  outputHtml,
  assets = [],
  operations = fs,
  writeAttempts = 3,
} = {}) {
  if (!outputDir || !replayFile) throw new TypeError('outputDir and replayFile are required');
  const assetRecords = [];
  for (const asset of assets) {
    const filename = path.basename(asset.href || '');
    if (!filename || !Buffer.isBuffer(asset.buffer)) throw new TypeError(`Invalid checkpoint asset for ${replayFile}`);
    const record = {
      href: asset.href,
      byteLength: asset.buffer.byteLength,
      mimeType: asset.mimeType || 'application/octet-stream',
      sha256: sha256(asset.buffer),
    };
    await atomicWrite(path.join(outputDir, 'component-library', 'assets', filename), asset.buffer, {
      operations,
      attempts: writeAttempts,
    });
    assetRecords.push(record);
  }
  await atomicWrite(path.join(outputDir, 'replay', replayFile), String(outputHtml || ''), {
    operations,
    attempts: writeAttempts,
  });
  const record = {
    version: 1,
    status: 'completed',
    replayFile,
    sourceSha256: sha256(String(sourceHtml || '')),
    outputSha256: sha256(String(outputHtml || '')),
    assets: assetRecords,
  };
  await atomicWrite(
    path.join(outputDir, '.matbox-checkpoints', 'pages', `${encodeURIComponent(replayFile)}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
    { operations, attempts: writeAttempts },
  );
  return record;
}

export async function prepareBuildResume({
  resumeDir,
  assetSourceDir = resumeDir,
  outputDir,
  sourceReplayDir,
  replayFiles = [],
  recoveredSources = new Set(),
  operations = fs,
  writeAttempts = 3,
} = {}) {
  if (!resumeDir || !outputDir) throw new TypeError('resumeDir and outputDir are required');
  const manifest = await readJson(path.join(assetSourceDir, 'component-library', 'asset-manifest.json'), []);
  const manifestByHref = new Map(manifest.map((asset) => [asset.href, asset]));
  const reusedReplayFiles = new Set();
  const copiedAssets = new Set();
  const skipped = [];
  await fs.mkdir(path.join(outputDir, 'replay'), { recursive: true });
  await fs.mkdir(path.join(outputDir, 'component-library', 'assets'), { recursive: true });

  for (const replayFile of replayFiles) {
    const checkpointPath = path.join(resumeDir, '.matbox-checkpoints', 'pages', `${encodeURIComponent(replayFile)}.json`);
    const checkpoint = await readJson(checkpointPath, null);
    if (checkpoint) {
      let checkpointFailure = null;
      let outputHtml = '';
      const checkpointAssets = [];
      try {
        const sourceHtml = await fs.readFile(path.join(sourceReplayDir, replayFile), 'utf8');
        outputHtml = await fs.readFile(path.join(resumeDir, 'replay', replayFile), 'utf8');
        if (checkpoint.status !== 'completed'
          || checkpoint.sourceSha256 !== sha256(sourceHtml)
          || checkpoint.outputSha256 !== sha256(outputHtml)) {
          checkpointFailure = 'checkpoint-hash-mismatch';
        }
        for (const asset of checkpoint.assets || []) {
          if (copiedAssets.has(asset.href)) continue;
          const filename = path.basename(asset.href || '');
          const buffer = await fs.readFile(path.join(resumeDir, 'component-library', 'assets', filename));
          if (!verifiedAsset(buffer, asset)) {
            checkpointFailure = 'checkpoint-asset-verification-failed';
            break;
          }
          checkpointAssets.push({ ...asset, filename, buffer });
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        checkpointFailure = 'checkpoint-file-missing';
      }
      if (checkpointFailure) {
        skipped.push({ replayFile, reason: checkpointFailure });
        continue;
      }
      await atomicWrite(path.join(outputDir, 'replay', replayFile), outputHtml, {
        operations,
        attempts: writeAttempts,
      });
      for (const asset of checkpointAssets) {
        if (!copiedAssets.has(asset.href)) {
          await atomicWrite(path.join(outputDir, 'component-library', 'assets', asset.filename), asset.buffer, {
            operations,
            attempts: writeAttempts,
          });
          copiedAssets.add(asset.href);
        }
      }
      await atomicWrite(
        path.join(outputDir, '.matbox-checkpoints', 'pages', `${encodeURIComponent(replayFile)}.json`),
        `${JSON.stringify(checkpoint, null, 2)}\n`,
        { operations, attempts: writeAttempts },
      );
      reusedReplayFiles.add(replayFile);
      continue;
    }
    let html;
    try {
      html = await fs.readFile(path.join(resumeDir, 'replay', replayFile), 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') {
        skipped.push({ replayFile, reason: 'resume-page-missing' });
        continue;
      }
      throw error;
    }
    if (findActiveRecoveredImageReferences(html, recoveredSources).length > 0) {
      skipped.push({ replayFile, reason: 'active-recovered-remote-reference' });
      continue;
    }
    const assets = [];
    let failure = null;
    for (const href of componentAssetHrefsInHtml(html)) {
      if (copiedAssets.has(href)) continue;
      const record = manifestByHref.get(href);
      const filename = path.basename(href);
      try {
        const buffer = await fs.readFile(path.join(assetSourceDir, 'component-library', 'assets', filename));
        if (!verifiedAsset(buffer, record)) {
          failure = 'resume-asset-verification-failed';
          break;
        }
        assets.push({ href, filename, buffer });
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
        failure = 'resume-asset-missing';
        break;
      }
    }
    if (failure) {
      skipped.push({ replayFile, reason: failure });
      continue;
    }
    if (sourceReplayDir) {
      const sourceHtml = await fs.readFile(path.join(sourceReplayDir, replayFile), 'utf8');
      await writeBuildPageCheckpoint({
        outputDir,
        replayFile,
        sourceHtml,
        outputHtml: html,
        operations,
        writeAttempts,
        assets: assets.map((asset) => ({
          href: asset.href,
          buffer: asset.buffer,
          mimeType: manifestByHref.get(asset.href)?.mimeType,
        })),
      });
    } else {
      await atomicWrite(
        path.join(outputDir, 'replay', replayFile),
        await fs.readFile(path.join(resumeDir, 'replay', replayFile)),
        { operations, attempts: writeAttempts },
      );
      for (const asset of assets) {
        if (copiedAssets.has(asset.href)) continue;
        await atomicWrite(path.join(outputDir, 'component-library', 'assets', asset.filename), asset.buffer, {
          operations,
          attempts: writeAttempts,
        });
      }
    }
    for (const asset of assets) copiedAssets.add(asset.href);
    reusedReplayFiles.add(replayFile);
  }

  return {
    reusedReplayFiles,
    reusedPageCount: reusedReplayFiles.size,
    reusedAssetCount: copiedAssets.size,
    skipped,
  };
}
