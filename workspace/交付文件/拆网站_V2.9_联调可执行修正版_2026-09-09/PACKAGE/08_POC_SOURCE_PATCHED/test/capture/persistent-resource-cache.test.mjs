import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  loadPersistentResourceDataUrl,
  storePersistentResourceDataUrl,
} from '../../src/capture/persistent-resource-cache.mjs';

test('a directly downloaded resource survives a fresh in-memory cache', async (t) => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-resource-cache-'));
  t.after(() => fs.rm(cacheDir, { recursive: true, force: true }));
  const url = 'https://cdn.test/image.jpg?version=1';
  const dataUrl = 'data:image/jpeg;base64,AQID';

  assert.equal(await loadPersistentResourceDataUrl(url, { cacheDir }), null);
  assert.equal(await storePersistentResourceDataUrl(url, dataUrl, { cacheDir, maxBytes: 1024 }), true);
  assert.equal(await loadPersistentResourceDataUrl(url, { cacheDir }), dataUrl);
});

test('persistent cache never returns data stored for another URL', async (t) => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-resource-cache-'));
  t.after(() => fs.rm(cacheDir, { recursive: true, force: true }));
  await storePersistentResourceDataUrl('https://cdn.test/a.jpg', 'data:image/jpeg;base64,AQID', { cacheDir });
  assert.equal(await loadPersistentResourceDataUrl('https://cdn.test/b.jpg', { cacheDir }), null);
});
