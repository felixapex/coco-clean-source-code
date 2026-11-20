import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildRouteManifest,
  validateRouteManifest,
  validateRouteManifestEntries,
  writeAtomicVerified,
} from '../scripts/lib/verified-write.mjs';

test('buildRouteManifest creates deterministic desktop and mobile filenames', () => {
  const routes = ['/products/nest-coffee-table', '/', '/collections/all'];
  assert.deepEqual(buildRouteManifest(routes, 'desktop'), {
    '/': 'route-home.html',
    '/collections/all': 'route-collections-all.html',
    '/products/nest-coffee-table': 'route-products-nest-coffee-table.html',
  });
  assert.deepEqual(buildRouteManifest(routes, 'mobile'), {
    '/': 'route-home-mobile.html',
    '/collections/all': 'route-collections-all-mobile.html',
    '/products/nest-coffee-table': 'route-products-nest-coffee-table-mobile.html',
  });
});

test('validateRouteManifest rejects NUL-filled JSON that JSON.parse would not safely validate', () => {
  assert.throws(
    () => validateRouteManifest('\0\0\0', ['/'], 'desktop'),
    /NUL|JSON/i,
  );
});

test('validateRouteManifestEntries preserves intentional local route aliases', () => {
  const expected = {
    '/': 'route-home.html',
    '/login.php': 'route-local-login.html',
    '/black-friday': 'route-sale.html',
  };
  assert.deepEqual(validateRouteManifestEntries(JSON.stringify(expected), expected), expected);
  assert.throws(
    () => validateRouteManifestEntries(JSON.stringify({ ...expected, '/login.php': 'route-login-php.html' }), expected),
    /mapping/i,
  );
});

test('writeAtomicVerified retries when readback differs and leaves verified bytes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-verified-write-'));
  const target = path.join(root, 'routes.json');
  let corruptOnce = true;
  const operations = {
    ...fs,
    async rename(from, to) {
      await fs.rename(from, to);
      if (corruptOnce) {
        corruptOnce = false;
        await fs.writeFile(to, Buffer.alloc(Buffer.byteLength('{"/":"route-home.html"}')));
      }
    },
  };
  const expected = '{"/":"route-home.html"}';
  await writeAtomicVerified(target, expected, { operations, attempts: 2 });
  assert.equal(await fs.readFile(target, 'utf8'), expected);
  await fs.rm(root, { recursive: true, force: true });
});
