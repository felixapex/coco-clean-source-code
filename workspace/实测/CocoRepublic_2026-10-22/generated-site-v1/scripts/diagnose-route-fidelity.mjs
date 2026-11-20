import fs from 'node:fs/promises';
import path from 'node:path';
import { capturePage } from '../../../../交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/src/capture/chromium-capture.mjs';
import pngjs from '../../../../交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/node_modules/pngjs/lib/png.js';

const { PNG } = pngjs;
const root = path.resolve(import.meta.dirname, '..');
const chromiumPath = process.env.MATBOX_CHROMIUM_PATH;
if (!chromiumPath) throw new Error('MATBOX_CHROMIUM_PATH must point to an isolated non-Edge browser executable.');
const output = path.join(root, 'artifacts', 'route-fidelity');
await fs.mkdir(output, { recursive: true });
const route = process.argv[2] || '/collections/all';
const slug = route.replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9]+/gi, '-') || 'home';
const targets = {
  original: `https://majestic-template.myshopify.com${route}`,
  local: `http://127.0.0.1:4173${route}?fidelity=1`,
};
const captures = {};
for (const [name, url] of Object.entries(targets)) {
  captures[name] = await capturePage(url, {
    chromiumPath,
    timeoutMs: 45000,
    requestGuard: false,
    allowNetwork: true,
  });
  await fs.writeFile(path.join(output, `${slug}-${name}.png`), captures[name].screenshot);
  await fs.writeFile(path.join(output, `${slug}-${name}.html`), captures[name].renderedDocument.html, 'utf8');
}

const reference = PNG.sync.read(captures.original.screenshot);
const candidate = PNG.sync.read(captures.local.screenshot);
const width = Math.max(reference.width, candidate.width);
const height = Math.max(reference.height, candidate.height);
const left = new PNG({ width, height }); left.data.fill(255);
const right = new PNG({ width, height }); right.data.fill(255);
PNG.bitblt(reference, left, 0, 0, reference.width, reference.height, 0, 0);
PNG.bitblt(candidate, right, 0, 0, candidate.width, candidate.height, 0, 0);
let squaredError = 0;
for (let index = 0; index < left.data.length; index += 4) {
  for (let channel = 0; channel < 3; channel++) {
    const delta = left.data[index + channel] - right.data[index + channel];
    squaredError += delta * delta;
  }
}
const similarity = 1 - Math.sqrt(squaredError / (width * height * 3)) / 255;
const report = {
  route,
  similarity,
  exactSize: reference.width === candidate.width && reference.height === candidate.height,
  original: { size: [reference.width, reference.height], readiness: captures.original.metadata.visualReadiness },
  local: { size: [candidate.width, candidate.height], readiness: captures.local.metadata.visualReadiness },
  interactiveCounts: { original: captures.original.interactiveElements.length, local: captures.local.interactiveElements.length },
};
await fs.writeFile(path.join(output, `${slug}-report.json`), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
