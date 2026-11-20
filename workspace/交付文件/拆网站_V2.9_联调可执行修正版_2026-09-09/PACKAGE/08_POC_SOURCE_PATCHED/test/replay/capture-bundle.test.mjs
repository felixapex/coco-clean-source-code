import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeCaptureBundle, readCaptureBundle, createReplayCaptureFn } from '../../src/replay/capture-bundle.mjs';

test('capture replay bundle externalizes and rehydrates binary fields with integrity metadata', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'capture-replay-'));
  const pages = [{
    url: 'https://shop.example.com/',
    capture: {
      metadata: { title: 'Home' },
      screenshot: Buffer.from([1, 2, 3, 4]),
      stateCaptures: [{
        state: 'hover',
        changed: true,
        capture: { screenshot: Buffer.from([5, 6, 7]) },
      }],
      links: ['https://shop.example.com/search'],
      componentCandidates: [{ id: 'card-1', semanticRole: 'product-card' }],
    },
  }];

  const manifest = await writeCaptureBundle({
    startUrl: 'https://shop.example.com/',
    pages,
    outputRoot: root,
  });

  assert.equal(manifest.version, '0.1');
  assert.equal(manifest.pages.length, 1);
  assert.ok(manifest.blobs.length >= 2);
  assert.ok(manifest.blobs.every((blob) => /^[a-f0-9]{64}$/.test(blob.sha256)));

  const bundle = await readCaptureBundle(root);
  assert.equal(bundle.pages[0].url, pages[0].url);
  assert.deepEqual(bundle.pages[0].capture.screenshot, Buffer.from([1, 2, 3, 4]));
  assert.deepEqual(bundle.pages[0].capture.stateCaptures[0].capture.screenshot, Buffer.from([5, 6, 7]));

  const captureFn = createReplayCaptureFn(bundle);
  const replayed = await captureFn('https://shop.example.com/');
  assert.equal(replayed.metadata.title, 'Home');
  assert.deepEqual(replayed.screenshot, Buffer.from([1, 2, 3, 4]));
  await assert.rejects(() => captureFn('https://shop.example.com/missing'), /Replay page missing/);
});

test('capture replay bundle detects blob tampering', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'capture-replay-tamper-'));
  const manifest = await writeCaptureBundle({
    startUrl: 'https://shop.example.com/',
    pages: [{ url: 'https://shop.example.com/', capture: { screenshot: Buffer.from('original') } }],
    outputRoot: root,
  });
  const blob = manifest.blobs[0];
  await fs.writeFile(path.join(root, blob.path), Buffer.from('tampered'));
  await assert.rejects(() => readCaptureBundle(root), /SHA-256 mismatch/);
});

test('capture replay bundle rejects manifest paths that escape the bundle root', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'capture-replay-escape-'));
  await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify({
    version: '0.1',
    startUrl: 'https://shop.example.com/',
    pages: [{ url: 'https://shop.example.com/', capture: '../outside.json' }],
    blobs: [],
  }));
  await assert.rejects(() => readCaptureBundle(root), /escapes bundle root/);
});
