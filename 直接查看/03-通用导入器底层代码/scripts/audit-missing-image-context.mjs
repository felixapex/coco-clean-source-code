import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const replayRoot = path.join(root, 'src', 'replay');
const artifactRoot = path.join(root, 'artifacts', 'component-geometry-migration');
const evidence = JSON.parse(await fs.readFile(path.join(artifactRoot, 'source-image-evidence-audit.json'), 'utf8'));
const manifest = JSON.parse(await fs.readFile(path.join(artifactRoot, 'network-image-recovery-manifest.json'), 'utf8'));
const pending = new Set(Object.entries(manifest.entries || {})
  .filter(([, entry]) => entry.status !== 'recovered')
  .map(([source]) => source));

function attribute(tag, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return tag.match(new RegExp(`\\b${escaped}\\s*=\\s*(["'])(.*?)\\1`, 'i'))?.[2] ?? '';
}

function lastMatch(text, regex) {
  const values = [...text.matchAll(regex)];
  return values.at(-1)?.[1] || '';
}

const htmlByFilename = new Map();
const records = [];
for (const failure of evidence.failures) {
  if (!pending.has(failure.source)) continue;
  let html = htmlByFilename.get(failure.filename);
  if (!html) {
    html = await fs.readFile(path.join(replayRoot, failure.filename), 'utf8');
    htmlByFilename.set(failure.filename, html);
  }
  const sourceVariants = [failure.source, failure.source.replaceAll('&', '&amp;')];
  let position = sourceVariants.reduce((found, source) => found >= 0 ? found : html.indexOf(source), -1);
  if (position < 0) {
    records.push({ ...failure, contextType: 'source-not-found' });
    continue;
  }
  const tagStart = html.lastIndexOf('<img', position);
  const tagEnd = html.indexOf('>', position);
  const tag = tagStart >= 0 && tagEnd >= 0 ? html.slice(tagStart, tagEnd + 1) : '';
  const before = html.slice(Math.max(0, tagStart - 3000), tagStart);
  const after = html.slice(tagEnd + 1, Math.min(html.length, tagEnd + 3001));
  const href = lastMatch(before, /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>[^<]*$/gi)
    || lastMatch(before.slice(-1500), /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi);
  const productId = after.match(/data-wishlist-product-id\s*=\s*["'](\d+)["']/i)?.[1]
    || before.match(/data-entity-id\s*=\s*["'](\d+)["']/i)?.[1]
    || failure.source.match(/\/products\/(\d+)\//i)?.[1]
    || '';
  const sku = after.match(/data-wishlist-product-sku\s*=\s*["']([^"']+)["']/i)?.[1]
    || href.match(/[?&]sku=([^&#]+)/i)?.[1]
    || '';
  const size = failure.source.match(/\/images\/stencil\/([^/]+)\//i)?.[1] || 'other';
  const isProductCard = /class\s*=\s*["'][^"']*product-card/i.test(before.slice(-3000));
  const isGallery = /productView-(?:image|thumbnails)|productView-thumbnail/i.test(before.slice(-3000));
  const contextType = isProductCard ? 'product-card' : isGallery ? 'product-gallery' : size === '2560w' || size === '1920w' ? 'large-content' : 'other';
  records.push({
    ...failure,
    sourceSize: size,
    contextType,
    alt: attribute(tag, 'alt'),
    href,
    productId,
    sku,
  });
}

const groups = Object.entries(records.reduce((counts, record) => {
  const key = `${record.contextType}:${record.sourceSize || 'unknown'}`;
  counts[key] = (counts[key] || 0) + 1;
  return counts;
}, {})).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
const report = {
  generatedAt: new Date().toISOString(),
  occurrenceCount: records.length,
  uniqueSourceCount: new Set(records.map((record) => record.source)).size,
  affectedFileCount: new Set(records.map((record) => record.filename)).size,
  groups,
  records,
};
const output = path.join(artifactRoot, 'missing-image-context-audit.json');
await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ ...report, records: undefined, output }, null, 2)}\n`);
