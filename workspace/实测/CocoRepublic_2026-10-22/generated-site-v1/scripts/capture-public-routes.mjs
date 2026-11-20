import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const replayRoot = path.join(root, 'src', 'replay');
const routesPath = path.join(replayRoot, 'routes.json');
const routes = JSON.parse(await fs.readFile(routesPath, 'utf8'));
const targets = [
  ['/collections/all', 'route-collections-all.html'],
  ['/collections', 'route-collections-index.html'],
];

for (const [pathname, filename] of targets) {
  const url = `https://majestic-template.myshopify.com${pathname}`;
  const response = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 MatboxCapture/1.0' } });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  let html = await response.text();
  if (!/<html[\s>]/i.test(html) || !/<\/html>/i.test(html)) throw new Error(`${url} did not return a complete HTML document`);
  html = html.replace(/<base\b[^>]*>/gi, '');
  const base = `<base href="${url}">`;
  html = /<head\b[^>]*>/i.test(html) ? html.replace(/<head\b[^>]*>/i, (match) => `${match}${base}`) : `${base}${html}`;
  await fs.writeFile(path.join(replayRoot, filename), html, 'utf8');
  routes[pathname] = filename;
  process.stdout.write(`captured ${pathname} -> ${filename} (${Buffer.byteLength(html)} bytes)\n`);
}

await fs.writeFile(routesPath, `${JSON.stringify(routes, null, 2)}\n`, 'utf8');
