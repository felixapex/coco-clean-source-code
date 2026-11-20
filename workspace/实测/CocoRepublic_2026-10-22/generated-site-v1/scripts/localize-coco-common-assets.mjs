import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const cacheDirectory = path.join(root, 'artifacts', 'full-site-audit', 'persistent-resource-cache');
const outputDirectory = path.join(dist, 'frozen-assets', 'external');

const assets = [
  {
    name: 'coco-republic-favicon.webp',
    cacheFile: '48628a4c3e60118093252b4862609f74fd359246d0d72145ebf1b074d7700776.resource',
    localUrl: '/frozen-assets/external/coco-republic-favicon.webp',
    match: /https:\/\/cdn11\.bigcommerce\.com\/s-hkpsknj5ns\/product_images\/coco-republic-favicon-32x32\.png(?:\?[^"'\s<>]*)?/g,
  },
  {
    name: 'login-slide.jpg',
    cacheFile: 'ba0d0ebca2447e18c4bbf53a0510b7a8b9f2ab4394cbad18c4b635db133b735c.resource',
    localUrl: '/frozen-assets/external/login-slide.jpg',
    match: /https:\/\/www\.cocorepublic\.com\.au\/content\/img\/login-slide\.jpg(?:\?[^"'\s<>]*)?/g,
  },
  {
    name: 'login-slide-mobile.jpg',
    cacheFile: '0ddeb7b8a10d822a402c95187322a77b26dad701ad61358575fd948dc67061e8.resource',
    localUrl: '/frozen-assets/external/login-slide-mobile.jpg',
    match: /https:\/\/www\.cocorepublic\.com\.au\/content\/img\/login-slide-mobile\.jpg(?:\?[^"'\s<>]*)?/g,
  },
  {
    name: 'icon-sprite.svg',
    cacheFile: '103fead8c56fbae3b9f4ec28b8b7398242ec3222150a73c7f0995c50be2ff66c.resource',
    localUrl: '/frozen-assets/external/icon-sprite.svg',
    match: /https:\/\/cdn11\.bigcommerce\.com\/s-hkpsknj5ns\/stencil\/[^"'\s<>]+\/img\/icon-sprite\.svg/g,
  },
];

function decodeDataUrl(dataUrl) {
  const value = String(dataUrl || '');
  const marker = ';base64,';
  const markerIndex = value.indexOf(marker);
  if (!value.startsWith('data:') || markerIndex < 0) throw new Error('resource cache does not contain a base64 data URL');
  return {
    mimeType: value.slice(5, markerIndex).split(';')[0],
    buffer: Buffer.from(value.slice(markerIndex + marker.length), 'base64'),
  };
}

async function restoreAsset(asset) {
  const cachePath = path.join(cacheDirectory, asset.cacheFile);
  const cacheText = await fs.readFile(cachePath, 'utf8');
  const newlineIndex = cacheText.indexOf('\n');
  if (newlineIndex < 0) throw new Error(`invalid persistent resource cache: ${cachePath}`);
  const sourceUrl = cacheText.slice(0, newlineIndex).replace(/\r$/, '');
  const decoded = decodeDataUrl(cacheText.slice(newlineIndex + 1).trim());
  if (decoded.buffer.length === 0) throw new Error(`empty cached resource: ${sourceUrl}`);
  await fs.writeFile(path.join(outputDirectory, asset.name), decoded.buffer);
  return {
    name: asset.name,
    sourceUrl,
    localUrl: asset.localUrl,
    mimeType: decoded.mimeType,
    bytes: decoded.buffer.length,
  };
}

async function listTextFiles(directory) {
  const output = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await listTextFiles(fullPath));
    else if (/\.(?:html|json|css|js|mjs)$/i.test(entry.name)) output.push(fullPath);
  }
  return output;
}

await fs.mkdir(outputDirectory, { recursive: true });
const restored = [];
for (const asset of assets) restored.push(await restoreAsset(asset));

let changedFiles = 0;
let replacements = 0;
for (const file of await listTextFiles(dist)) {
  let text = await fs.readFile(file, 'utf8');
  const original = text;
  for (const asset of assets) {
    text = text.replace(asset.match, () => {
      replacements += 1;
      return asset.localUrl;
    });
  }
  text = text.replace(/\s*<!--\s*<a href="\/">\s*<img class="footer-logo-svg" src="https:\/\/cdn11\.bigcommerce\.com\/s-hkpsknj5ns\/content\/svg\/coco-logo\.svg"[^>]*>\s*<\/a>\s*-->/g, '');
  if (text !== original) {
    await fs.writeFile(file, text);
    changedFiles += 1;
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  restored,
  changedFiles,
  replacements,
};
await fs.writeFile(path.join(outputDirectory, 'localization-report.json'), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
