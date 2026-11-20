import fs from 'node:fs/promises';
import path from 'node:path';
import { discoverDefaultLocaleRoutes, routeFilename } from './lib/site-inventory.mjs';

const root = path.resolve(import.meta.dirname, '..');
const sourceOrigin = (process.env.MATBOX_SOURCE_URL || 'https://majestic-template.myshopify.com').replace(/\/$/, '');
const replayRoot = path.join(root, 'src', 'replay');
const routesPath = path.join(replayRoot, 'routes.json');
const evidenceRoot = path.join(root, 'artifacts', 'full-site-audit');
await fs.mkdir(evidenceRoot, { recursive: true });
const routes = JSON.parse(await fs.readFile(routesPath, 'utf8'));
const inventory = await discoverDefaultLocaleRoutes(fetch, `${sourceOrigin}/sitemap.xml`);
const force = process.argv.includes('--force');
const pending = inventory.routes.filter((route) => force || !routes[route]);
const failures = [];
const captured = [];

async function capture(route) {
  const url = `${sourceOrigin}${route}`;
  const response = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 MatboxFullSiteCapture/1.0' } });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  let html = await response.text();
  if (!/<html[\s>]/i.test(html) || !/<\/html>/i.test(html)) throw new Error(`${url} did not return a complete HTML document`);
  html = html.replace(/<base\b[^>]*>/gi, '');
  const base = `<base href="${url}">`;
  html = /<head\b[^>]*>/i.test(html) ? html.replace(/<head\b[^>]*>/i, (match) => `${match}${base}`) : `${base}${html}`;
  const filename = routeFilename(route);
  await fs.writeFile(path.join(replayRoot, filename), html, 'utf8');
  routes[route] = filename;
  captured.push({ route, filename, bytes: Buffer.byteLength(html) });
  process.stdout.write(`captured ${captured.length}/${pending.length} ${route}\n`);
}

const queue = [...pending];
const workers = Array.from({ length: Math.min(4, queue.length || 1) }, async () => {
  while (queue.length) {
    const route = queue.shift();
    try { await capture(route); } catch (error) { failures.push({ route, error: String(error?.stack || error) }); }
  }
});
await Promise.all(workers);
await fs.writeFile(routesPath, `${JSON.stringify(Object.fromEntries(Object.entries(routes).sort()), null, 2)}\n`, 'utf8');
const report = {
  generatedAt: new Date().toISOString(),
  expectedRouteCount: inventory.routes.length,
  routeManifestCount: Object.keys(routes).length,
  previouslyPresent: inventory.routes.length - pending.length,
  captured,
  failures,
};
await fs.writeFile(path.join(evidenceRoot, 'capture-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ expectedRouteCount: report.expectedRouteCount, routeManifestCount: report.routeManifestCount, captured: captured.length, failures: failures.length }, null, 2)}\n`);
if (failures.length || report.routeManifestCount < report.expectedRouteCount) process.exitCode = 1;
