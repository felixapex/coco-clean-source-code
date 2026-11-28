import fs from 'node:fs/promises';
import path from 'node:path';
import { mergeRouteClosure } from './lib/route-closure.mjs';

const root = path.resolve(import.meta.dirname, '..');
const inventoryPath = path.join(root, 'artifacts', 'full-site-audit', 'route-inventory.json');
const auditPath = path.join(root, 'artifacts', 'full-site-audit', 'route-link-audit.json');
const [inventory, audit] = await Promise.all([
  fs.readFile(inventoryPath, 'utf8').then(JSON.parse),
  fs.readFile(auditPath, 'utf8').then(JSON.parse),
]);
const previousRouteCount = inventory.routes.length;
inventory.routes = mergeRouteClosure(inventory.routes, audit.uncapturedLocalRoutes);
inventory.routeCount = inventory.routes.length;
inventory.linkClosureGeneratedAt = new Date().toISOString();
inventory.linkClosureAddedRouteCount = inventory.routeCount - previousRouteCount;
await fs.writeFile(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ previousRouteCount, routeCount: inventory.routeCount, addedRouteCount: inventory.linkClosureAddedRouteCount }, null, 2)}\n`);
