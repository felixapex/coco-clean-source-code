import fs from 'node:fs/promises';
import path from 'node:path';
import {
  buildRouteManifest,
  validateRouteManifest,
  writeAtomicVerified,
} from './lib/verified-write.mjs';

const root = path.resolve(import.meta.dirname, '..');
const replayRoot = path.join(root, 'src', 'replay');
const inventoryPath = path.join(root, 'artifacts', 'full-site-audit', 'route-inventory.json');
const inventoryText = await fs.readFile(inventoryPath, 'utf8');
if (inventoryText.includes('\0')) throw new Error('Route inventory contains NUL bytes');
const inventory = JSON.parse(inventoryText);
if (!Array.isArray(inventory.routes) || inventory.routes.length === 0) throw new Error('Route inventory has no routes');

const invalidFiles = [];
for (const viewport of ['desktop', 'mobile']) {
  const manifest = buildRouteManifest(inventory.routes, viewport);
  const manifestPath = path.join(replayRoot, viewport === 'mobile' ? 'routes-mobile.json' : 'routes.json');
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeAtomicVerified(manifestPath, manifestText);
  validateRouteManifest(await fs.readFile(manifestPath), inventory.routes, viewport);
  for (const [route, filename] of Object.entries(manifest)) {
    const filePath = path.join(replayRoot, filename);
    try {
      const content = await fs.readFile(filePath);
      const text = content.toString('utf8');
      if (!content.length || content.includes(0) || !/^\s*<!doctype html/i.test(text) || !/<\/html>\s*$/i.test(text)) {
        invalidFiles.push({ viewport, route, filename, bytes: content.length, reason: 'invalid HTML bytes or boundaries' });
      }
    } catch (error) {
      invalidFiles.push({ viewport, route, filename, bytes: 0, reason: error.code || error.message });
    }
  }
}

process.stdout.write(`${JSON.stringify({ routeCount: inventory.routes.length, manifestsRebuilt: 2, invalidFiles }, null, 2)}\n`);
if (invalidFiles.length) process.exitCode = 1;
