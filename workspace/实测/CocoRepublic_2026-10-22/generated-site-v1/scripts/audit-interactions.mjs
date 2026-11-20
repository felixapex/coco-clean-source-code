import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const routes = JSON.parse(await fs.readFile(path.join(root, 'src', 'replay', 'routes.json'), 'utf8'));
const known = new Set(Object.keys(routes));
const inventory = new Map();

for (const [route, file] of Object.entries(routes)) {
  const html = await fs.readFile(path.join(root, 'src', 'replay', file), 'utf8');
  const attributes = [...html.matchAll(/(?:href|data-nav-url)=(?:"([^"]*)"|'([^']*)')/gi)];
  for (const match of attributes) {
    const raw = match[1] ?? match[2] ?? '';
    if (!raw || raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('tel:') || raw.startsWith('javascript:')) continue;
    let url;
    try { url = new URL(raw, 'https://majestic-template.myshopify.com'); } catch { continue; }
    if (!url.hostname.endsWith('myshopify.com')) continue;
    const key = url.pathname.replace(/\/$/, '') || '/';
    const item = inventory.get(key) || { path: key, references: 0, sourceRoutes: new Set(), local: known.has(key) };
    item.references += 1;
    item.sourceRoutes.add(route);
    inventory.set(key, item);
  }
}

const rows = [...inventory.values()]
  .map((item) => ({ ...item, sourceRoutes: [...item.sourceRoutes] }))
  .sort((a, b) => Number(a.local) - Number(b.local) || b.references - a.references || a.path.localeCompare(b.path));
const report = {
  routeCount: known.size,
  referencedInternalPathCount: rows.length,
  localPathCount: rows.filter((item) => item.local).length,
  missingPathCount: rows.filter((item) => !item.local).length,
  missing: rows.filter((item) => !item.local),
  local: rows.filter((item) => item.local),
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.missingPathCount) process.exitCode = 2;
