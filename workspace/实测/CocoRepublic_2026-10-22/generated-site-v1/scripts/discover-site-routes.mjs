import fs from 'node:fs/promises';
import path from 'node:path';
import { discoverDefaultLocaleRoutes } from './lib/site-inventory.mjs';
import { resolveRouteInventory } from './lib/route-inventory-cache.mjs';

const root = path.resolve(import.meta.dirname, '..');
const sourceOrigin = (process.env.MATBOX_SOURCE_URL || 'https://majestic-template.myshopify.com').replace(/\/$/, '');
const output = path.join(root, 'artifacts', 'full-site-audit');
await fs.mkdir(output, { recursive: true });
const inventoryPath = path.join(output, 'route-inventory.json');
const resolved = await resolveRouteInventory({
  sourceOrigin,
  preferCached: process.env.MATBOX_RESUME === '1',
  discover: () => discoverDefaultLocaleRoutes(fetch, `${sourceOrigin}/sitemap.xml`),
  readCached: async () => JSON.parse(await fs.readFile(inventoryPath, 'utf8')),
});
const inventory = resolved.inventory;
const report = {
  generatedAt: new Date().toISOString(),
  source: inventory.root,
  sitemapCount: inventory.sitemapUrls.length,
  homepageLinkCount: inventory.linkedRouteCount,
  routeCount: inventory.routes.length,
  routes: inventory.routes,
  reusedCachedInventory: resolved.reused,
  warning: resolved.warning,
};
await fs.writeFile(inventoryPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
