import fs from 'node:fs/promises';
import path from 'node:path';
import pngjs from '../../../../交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/node_modules/pngjs/lib/png.js';

const { PNG } = pngjs;
const root = path.resolve(import.meta.dirname, '..');
const pairs = [
  ['desktop-original', path.join(root, 'artifacts', 'full-site-audit', 'fidelity', 'home-desktop-original.png'), [['a', 7600, 1400], ['b', 12000, 1800]]],
  ['desktop-local', path.join(root, 'artifacts', 'full-site-audit', 'fidelity', 'home-desktop-local.png'), [['a', 7600, 1400], ['b', 12000, 1800]]],
  ['mobile-original', path.join(root, 'artifacts', 'full-site-audit', 'fidelity', 'home-mobile-original.png'), [['a', 0, 600], ['b', 3400, 1000]]],
  ['mobile-local', path.join(root, 'artifacts', 'full-site-audit', 'fidelity', 'home-mobile-local.png'), [['a', 0, 600], ['b', 3400, 1000]]],
];
for (const [name, file, ranges] of pairs) {
  const source = PNG.sync.read(await fs.readFile(file));
  for (const [label, y, height] of ranges) {
    const crop = new PNG({ width: source.width, height });
    PNG.bitblt(source, crop, 0, y, source.width, height, 0, 0);
    await fs.writeFile(path.join(root, 'artifacts', 'full-site-audit', `latest-${name}-${label}.png`), PNG.sync.write(crop));
  }
}
