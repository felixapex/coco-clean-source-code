import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const stageArgument = process.argv.find((value) => value.startsWith('--stage='))?.slice('--stage='.length);
if (!stageArgument) throw new Error('Missing --stage=...');
const variantsDir = path.join(path.resolve(root, stageArgument), 'component-library', 'variants');
const files = await fs.readdir(variantsDir);
const counts = { imgVisible: 0, imgHidden: 0, imgUnknown: 0, video: 0, source: 0 };
const unique = Object.fromEntries(Object.keys(counts).map((key) => [key, new Set()]));
for (const file of files) {
  const html = await fs.readFile(path.join(variantsDir, file), 'utf8');
  for (const match of html.matchAll(/<(img|video|source)\b([^>]*)>/gi)) {
    const tag = match[1].toLowerCase();
    const attributes = match[2];
    const source = attributes.match(/(?:^|\s)src\s*=\s*(["'])(https?:\/\/[^"']+)\1/i)?.[2];
    if (!source) continue;
    let category = tag;
    if (tag === 'img') {
      const visible = attributes.match(/(?:^|\s)data-matbox-image-visible\s*=\s*(["'])(.*?)\1/i)?.[2];
      category = visible === 'true' ? 'imgVisible' : visible === 'false' ? 'imgHidden' : 'imgUnknown';
    }
    counts[category] += 1;
    unique[category].add(source);
  }
}
console.log(JSON.stringify({
  files: files.length,
  counts,
  unique: Object.fromEntries(Object.entries(unique).map(([key, values]) => [key, values.size])),
  samples: Object.fromEntries(Object.entries(unique).map(([key, values]) => [key, [...values].slice(0, 10)])),
}, null, 2));
