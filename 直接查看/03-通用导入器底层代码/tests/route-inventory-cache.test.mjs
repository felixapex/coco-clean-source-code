import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRouteInventory } from '../scripts/lib/route-inventory-cache.mjs';

test('route discovery falls back to a verified same-origin inventory after transient network failure', async () => {
  const cached = {
    generatedAt: '2026-10-21T22:33:17.156Z',
    source: 'https://www.cocorepublic.com.au/sitemap.php',
    routeCount: 2,
    routes: ['/', '/sofas/standard'],
  };
  const result = await resolveRouteInventory({
    sourceOrigin: 'https://www.cocorepublic.com.au',
    discover: async () => { throw new Error('ConnectTimeoutError'); },
    readCached: async () => cached,
  });
  assert.equal(result.reused, true);
  assert.deepEqual(result.inventory.routes, cached.routes);
  assert.match(result.warning, /ConnectTimeoutError/);
});

test('route discovery never reuses an inventory from another origin', async () => {
  await assert.rejects(() => resolveRouteInventory({
    sourceOrigin: 'https://www.cocorepublic.com.au',
    discover: async () => { throw new Error('ConnectTimeoutError'); },
    readCached: async () => ({ source: 'https://other.example/sitemap.xml', routeCount: 1, routes: ['/'] }),
  }), /ConnectTimeoutError/);
});

test('explicit resume mode uses the verified inventory without repeating discovery', async () => {
  let discoveryCalled = false;
  const result = await resolveRouteInventory({
    sourceOrigin: 'https://www.cocorepublic.com.au',
    preferCached: true,
    discover: async () => { discoveryCalled = true; throw new Error('must not run'); },
    readCached: async () => ({
      source: 'https://www.cocorepublic.com.au/sitemap.php',
      routeCount: 2,
      routes: ['/', '/sofas/standard'],
    }),
  });
  assert.equal(discoveryCalled, false);
  assert.equal(result.reused, true);
  assert.equal(result.warning, null);
});
