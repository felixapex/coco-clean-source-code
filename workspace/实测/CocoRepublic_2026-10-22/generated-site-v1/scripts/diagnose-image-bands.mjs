import fs from 'node:fs/promises';
import path from 'node:path';
import pngjs from '../../../../交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/node_modules/pngjs/lib/png.js';

const { PNG } = pngjs;
const [leftPath, rightPath, bandArg = '500'] = process.argv.slice(2);
if (!leftPath || !rightPath) throw new Error('Usage: node scripts/diagnose-image-bands.mjs <left.png> <right.png> [bandHeight]');
const [left, right] = await Promise.all([
  fs.readFile(leftPath).then((buffer) => PNG.sync.read(buffer)),
  fs.readFile(rightPath).then((buffer) => PNG.sync.read(buffer)),
]);
if (left.width !== right.width) throw new Error(`Image widths differ: ${left.width} vs ${right.width}`);
const bandHeight = Number.parseInt(bandArg, 10);
const compareHeight = Math.min(left.height, right.height);
const outputRoot = path.resolve('artifacts', 'image-band-diagnostics');
await fs.mkdir(outputRoot, { recursive: true });
for (let startY = 0; startY < compareHeight; startY += bandHeight) {
  const endY = Math.min(compareHeight, startY + bandHeight);
  let squaredError = 0;
  for (let y = startY; y < endY; y++) {
    for (let x = 0; x < left.width; x++) {
      const offset = (y * left.width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const delta = left.data[offset + channel] - right.data[offset + channel];
        squaredError += delta * delta;
      }
    }
  }
  const similarity = 1 - Math.sqrt(squaredError / (left.width * (endY - startY) * 3)) / 255;
  process.stdout.write(`${startY}-${endY}: ${(similarity * 100).toFixed(3)}%\n`);
  if (similarity < 0.99) {
    for (const [label, image] of [['original', left], ['local', right]]) {
      const crop = new PNG({ width: image.width, height: endY - startY });
      PNG.bitblt(image, crop, 0, startY, image.width, endY - startY, 0, 0);
      await fs.writeFile(path.join(outputRoot, `${startY}-${endY}-${label}.png`), PNG.sync.write(crop));
    }
  }
}
