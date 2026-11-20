import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildReplayPreflightCacheKey,
  loadReplayPreflightCache,
  writeReplayPreflightCache,
} from '../scripts/lib/resource-preflight-cache.mjs';

test('replay preflight cache key changes only when the captured source inventory changes', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-preflight-key-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'a.html'), '<main>A</main>');
  const first = await buildReplayPreflightCacheKey({ sourceReplayDir: root, replayFiles: ['a.html'] });
  const repeated = await buildReplayPreflightCacheKey({ sourceReplayDir: root, replayFiles: ['a.html'] });
  assert.equal(repeated, first);
  await fs.appendFile(path.join(root, 'a.html'), '!');
  const changed = await buildReplayPreflightCacheKey({ sourceReplayDir: root, replayFiles: ['a.html'] });
  assert.notEqual(changed, first);
});

test('a valid cache reuses font and document preflight without rescanning replay HTML', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-preflight-cache-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cachePath = path.join(root, 'preflight.json');
  const fontPath = path.join(root, 'font.woff2');
  const documentPath = path.join(root, 'document.pdf');
  await fs.writeFile(fontPath, 'font');
  await fs.writeFile(documentPath, '%PDF-document');
  await writeReplayPreflightCache({
    cachePath,
    cacheKey: 'source-v1',
    fontPreflight: { assets: [{ cachePath: fontPath, byteLength: 4 }] },
    documentPreflight: { documents: [{ cachePath: documentPath, byteLength: 13 }], failures: [] },
  });

  const cached = await loadReplayPreflightCache({ cachePath, cacheKey: 'source-v1' });
  assert.equal(cached.hit, true);
  assert.equal(cached.fontPreflight.assets.length, 1);
  assert.equal(cached.documentPreflight.documents.length, 1);
});

test('cache key mismatch or a missing frozen resource fails closed to a fresh scan', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-preflight-cache-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cachePath = path.join(root, 'preflight.json');
  const missingPath = path.join(root, 'missing.woff2');
  await writeReplayPreflightCache({
    cachePath,
    cacheKey: 'source-v1',
    fontPreflight: { assets: [{ cachePath: missingPath, byteLength: 4 }] },
    documentPreflight: { documents: [], failures: [] },
  });

  assert.equal((await loadReplayPreflightCache({ cachePath, cacheKey: 'source-v2' })).hit, false);
  const missing = await loadReplayPreflightCache({ cachePath, cacheKey: 'source-v1' });
  assert.equal(missing.hit, false);
  assert.equal(missing.reason, 'cached-resource-missing-or-changed');
});

test('the Coco build checks the cache before opening the expensive replay HTML stream and records its time', async () => {
  const source = await fs.readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
  const cacheRead = source.indexOf('loadReplayPreflightCache');
  const replayScan = source.indexOf('teeAsyncIterable(sourceReplayHtml()');
  assert.ok(cacheRead >= 0);
  assert.ok(replayScan > cacheRead);
  assert.match(source, /resource-preflight-cache-hit/);
  assert.match(source, /resource-preflight-scan/);
});
