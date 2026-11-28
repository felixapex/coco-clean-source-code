import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { collectVerifiedPublicAssets } from '../scripts/lib/public-asset-manifest.mjs';

test('verified public asset manifest includes only files that exist under approved directories', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-public-assets-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'frozen-assets', 'fonts'), { recursive: true });
  await fs.writeFile(path.join(root, 'frozen-assets', 'fonts', 'font.woff2'), 'font-bytes');
  await fs.writeFile(path.join(root, 'outside.txt'), 'not public');

  const assets = await collectVerifiedPublicAssets(root, { publicDirectories: ['frozen-assets'] });

  assert.equal(assets.length, 1);
  assert.deepEqual(assets[0], {
    href: '/frozen-assets/fonts/font.woff2',
    byteLength: 10,
    mimeType: 'font/woff2',
    sha256: 'a446817d40e4dc37c526fb5e30859fe0dd7bb0a7d5b3c0c56f7a0626d0019307',
  });
});

test('missing approved public directory yields an empty manifest', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-public-assets-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  assert.deepEqual(await collectVerifiedPublicAssets(root, { publicDirectories: ['frozen-assets'] }), []);
});

test('large public asset inventories are read with bounded concurrency', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-public-assets-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'component-library', 'assets');
  await fs.mkdir(directory, { recursive: true });
  await Promise.all(Array.from({ length: 200 }, (_, index) => (
    fs.writeFile(path.join(directory, `${String(index).padStart(3, '0')}.webp`), `asset-${index}`)
  )));

  const assets = await collectVerifiedPublicAssets(root, {
    publicDirectories: ['component-library/assets'],
    readConcurrency: 3,
  });

  assert.equal(assets.length, 200);
  assert.equal(assets[0].href, '/component-library/assets/000.webp');
  assert.equal(assets.at(-1).href, '/component-library/assets/199.webp');
  await assert.rejects(
    collectVerifiedPublicAssets(root, { publicDirectories: ['component-library/assets'], readConcurrency: 0 }),
    /readConcurrency must be a positive integer/,
  );
});
