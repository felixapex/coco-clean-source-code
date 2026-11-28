import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { prepareBuildResume, writeBuildPageCheckpoint } from '../scripts/lib/build-resume.mjs';

test('build resume reuses only verified pages and content-verified component assets', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-build-resume-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const resumeDir = path.join(root, 'resume');
  const assetSourceDir = path.join(root, 'asset-source');
  const outputDir = path.join(root, 'output');
  await fs.mkdir(path.join(resumeDir, 'replay'), { recursive: true });
  await fs.mkdir(path.join(assetSourceDir, 'component-library', 'assets'), { recursive: true });

  const asset = Buffer.from('verified-image');
  const assetName = 'chair.webp';
  const href = `/component-library/assets/${assetName}`;
  await fs.writeFile(path.join(assetSourceDir, 'component-library', 'assets', assetName), asset);
  await fs.writeFile(path.join(assetSourceDir, 'component-library', 'asset-manifest.json'), JSON.stringify([{
    href,
    byteLength: asset.length,
    mimeType: 'image/webp',
    sha256: crypto.createHash('sha256').update(asset).digest('hex'),
  }]));
  await fs.writeFile(path.join(resumeDir, 'replay', 'passed.html'), `<img src="${href}">`);
  await fs.writeFile(path.join(resumeDir, 'replay', 'unsafe.html'), '<img src="data:image/webp;base64,AA==" data-src="https://cdn.test/recovered.webp">');

  const result = await prepareBuildResume({
    resumeDir,
    assetSourceDir,
    outputDir,
    replayFiles: ['passed.html', 'unsafe.html', 'missing.html'],
    recoveredSources: new Set(['https://cdn.test/recovered.webp']),
  });

  assert.deepEqual([...result.reusedReplayFiles], ['passed.html']);
  assert.equal(result.reusedPageCount, 1);
  assert.equal(result.reusedAssetCount, 1);
  assert.deepEqual(result.skipped, [
    { replayFile: 'unsafe.html', reason: 'active-recovered-remote-reference' },
    { replayFile: 'missing.html', reason: 'resume-page-missing' },
  ]);
  assert.equal(await fs.readFile(path.join(outputDir, 'replay', 'passed.html'), 'utf8'), `<img src="${href}">`);
  assert.deepEqual(await fs.readFile(path.join(outputDir, 'component-library', 'assets', assetName)), asset);
});

test('page checkpoint atomically lands page, assets, hashes, and completed state', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-page-checkpoint-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const replayFile = 'product.html';
  const sourceHtml = '<img src="data:image/webp;base64,dmVyaWZpZWQ=">';
  const outputHtml = '<img src="/component-library/assets/product.webp">';
  const asset = Buffer.from('verified');
  const record = await writeBuildPageCheckpoint({
    outputDir: root,
    replayFile,
    sourceHtml,
    outputHtml,
    assets: [{
      href: '/component-library/assets/product.webp',
      buffer: asset,
      mimeType: 'image/webp',
    }],
  });

  assert.equal(record.status, 'completed');
  assert.equal(record.sourceSha256, crypto.createHash('sha256').update(sourceHtml).digest('hex'));
  assert.equal(record.outputSha256, crypto.createHash('sha256').update(outputHtml).digest('hex'));
  assert.equal(record.assets[0].sha256, crypto.createHash('sha256').update(asset).digest('hex'));
  assert.equal(await fs.readFile(path.join(root, 'replay', replayFile), 'utf8'), outputHtml);
  assert.deepEqual(await fs.readFile(path.join(root, 'component-library', 'assets', 'product.webp')), asset);
  const stored = JSON.parse(await fs.readFile(path.join(root, '.matbox-checkpoints', 'pages', `${encodeURIComponent(replayFile)}.json`), 'utf8'));
  assert.deepEqual(stored, record);

  const sourceReplayDir = path.join(root, 'current-source');
  const resumedOutputDir = path.join(root, 'resumed-output');
  await fs.mkdir(sourceReplayDir, { recursive: true });
  await fs.writeFile(path.join(sourceReplayDir, replayFile), sourceHtml);
  const resumed = await prepareBuildResume({
    resumeDir: root,
    outputDir: resumedOutputDir,
    sourceReplayDir,
    replayFiles: [replayFile],
  });
  assert.deepEqual([...resumed.reusedReplayFiles], [replayFile]);
  assert.equal(await fs.readFile(path.join(resumedOutputDir, 'replay', replayFile), 'utf8'), outputHtml);
  assert.deepEqual(await fs.readFile(path.join(resumedOutputDir, 'component-library', 'assets', 'product.webp')), asset);
});

test('resume retries a destination write that fails readback verification', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-resume-readback-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const resumeDir = path.join(root, 'resume');
  const sourceReplayDir = path.join(root, 'source');
  const outputDir = path.join(root, 'output');
  const replayFile = 'verified.html';
  const sourceHtml = '<!doctype html><p>source</p>';
  const outputHtml = '<!doctype html><p>verified output</p>';
  await fs.mkdir(sourceReplayDir, { recursive: true });
  await fs.writeFile(path.join(sourceReplayDir, replayFile), sourceHtml);
  await writeBuildPageCheckpoint({
    outputDir: resumeDir,
    replayFile,
    sourceHtml,
    outputHtml,
  });

  let corruptedOnce = false;
  const operations = {
    ...fs,
    async rename(from, to) {
      await fs.rename(from, to);
      if (!corruptedOnce && to === path.join(outputDir, 'replay', replayFile)) {
        corruptedOnce = true;
        await fs.writeFile(to, Buffer.alloc(Buffer.byteLength(outputHtml), 0x41));
      }
    },
  };

  const result = await prepareBuildResume({
    resumeDir,
    outputDir,
    sourceReplayDir,
    replayFiles: [replayFile],
    operations,
  });

  assert.equal(corruptedOnce, true, 'test must exercise a corrupted destination write');
  assert.equal(result.reusedPageCount, 1);
  assert.equal(await fs.readFile(path.join(outputDir, 'replay', replayFile), 'utf8'), outputHtml);
});
