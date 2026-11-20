import fs from 'node:fs';
import pngjs from '../../../../交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/node_modules/pngjs/lib/png.js';

const { PNG } = pngjs;
const [leftPath, rightPath] = process.argv.slice(2);
if (!leftPath || !rightPath) throw new Error('Usage: node scripts/diagnose-pixel-diff.mjs left.png right.png');
const left = PNG.sync.read(fs.readFileSync(leftPath));
const right = PNG.sync.read(fs.readFileSync(rightPath));
if (left.width !== right.width || left.height !== right.height) throw new Error('Image sizes differ');
const bandHeight = 400;
const bands = [];
for (let top = 0; top < left.height; top += bandHeight) {
  let absoluteError = 0;
  let changed = 0;
  let pixels = 0;
  for (let y = top; y < Math.min(left.height, top + bandHeight); y += 1) {
    for (let x = 0; x < left.width; x += 1) {
      const index = (y * left.width + x) * 4;
      const delta = Math.abs(left.data[index] - right.data[index])
        + Math.abs(left.data[index + 1] - right.data[index + 1])
        + Math.abs(left.data[index + 2] - right.data[index + 2]);
      absoluteError += delta;
      if (delta > 30) changed += 1;
      pixels += 1;
    }
  }
  bands.push({ top, bottom: Math.min(left.height, top + bandHeight), meanAbsoluteChannelError: absoluteError / (pixels * 3), changedRatio: changed / pixels });
}
console.log(JSON.stringify({ width: left.width, height: left.height, bands }, null, 2));
