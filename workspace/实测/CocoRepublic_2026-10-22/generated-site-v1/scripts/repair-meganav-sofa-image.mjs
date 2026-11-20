import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const replayRoot = path.join(root, 'src', 'replay');
const restoredAssetPath = path.join(root, 'src', 'restored-assets', 'sofa-meganav.png');
const originalSource = 'https://cdn11.bigcommerce.com/s-hkpsknj5ns/images/stencil/original/image-manager/sofa-meganav-desktop-tile-1-.jpg?t=1738810749';
const restoredSource = `data:image/png;base64,${(await fs.readFile(restoredAssetPath)).toString('base64')}`;

function upsertAttribute(tag, name, value) {
  const pattern = new RegExp(`\\s${name}="[^"]*"`, 'i');
  if (pattern.test(tag)) return tag.replace(pattern, ` ${name}="${value}"`);
  return tag.replace(/\s*\/?\>$/, ` ${name}="${value}">`);
}

function removeAttribute(tag, name) {
  return tag.replace(new RegExp(`\\s${name}="[^"]*"`, 'gi'), '');
}

function restoreSofaMenuImage(tag) {
  let repaired = upsertAttribute(tag, 'src', restoredSource);
  repaired = upsertAttribute(repaired, 'data-src', restoredSource);
  repaired = upsertAttribute(repaired, 'data-matbox-original-source-url', originalSource);
  repaired = upsertAttribute(repaired, 'data-matbox-restored-menu-image', 'true');
  for (const name of [
    'srcset',
    'data-srcset',
    'data-matbox-image-freeze-id',
    'data-matbox-browser-frozen-image',
    'data-matbox-browser-screenshot-image',
    'data-matbox-browser-rasterized-image',
  ]) repaired = removeAttribute(repaired, name);
  return repaired;
}

const files = (await fs.readdir(replayRoot)).filter((file) => file.endsWith('.html'));
let repairedFiles = 0;
let repairedImages = 0;
for (const file of files) {
  const target = path.join(replayRoot, file);
  const before = await fs.readFile(target, 'utf8');
  let count = 0;
  const after = before.replace(/<img\b(?=[^>]*\balt="SOFAS")[^>]*>/gi, (tag) => {
    count += 1;
    return restoreSofaMenuImage(tag);
  });
  if (!count || after === before) continue;
  await fs.writeFile(target, after, 'utf8');
  repairedFiles += 1;
  repairedImages += count;
}

process.stdout.write(`${JSON.stringify({ repairedFiles, repairedImages, originalSource }, null, 2)}\n`);
if (!repairedImages) process.exitCode = 1;
