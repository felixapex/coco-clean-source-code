import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRouteManifestCache } from '../scripts/lib/route-manifest-cache.mjs';

test('reuses parsed manifest until file metadata changes', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'manifest-cache-'));
  const file = path.join(directory, 'routes.json');
  await fs.writeFile(file, JSON.stringify({ '/': 'one.html' }), 'utf8');
  let reads = 0;
  const cache = createRouteManifestCache({
    readFile: async (...args) => { reads += 1; return fs.readFile(...args); },
  });
  assert.equal((await cache.read(file))['/'], 'one.html');
  assert.equal((await cache.read(file))['/'], 'one.html');
  assert.equal(reads, 1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await fs.writeFile(file, JSON.stringify({ '/': 'two-longer.html' }), 'utf8');
  assert.equal((await cache.read(file))['/'], 'two-longer.html');
  assert.equal(reads, 2);
});

test('static audit mode never rereads an immutable manifest', async () => {
  let reads = 0;
  const cache = createRouteManifestCache({
    staticMode: true,
    stat: async () => ({ mtimeMs: 1, size: 10 }),
    readFile: async () => { reads += 1; return '{"/":"home.html"}'; },
  });
  await cache.read('routes.json');
  await cache.read('routes.json');
  assert.equal(reads, 1);
});
