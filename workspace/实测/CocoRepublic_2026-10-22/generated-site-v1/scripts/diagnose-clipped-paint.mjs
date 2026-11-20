import fs from 'node:fs/promises';
import path from 'node:path';
import { capturePage } from '../../../../交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/src/capture/chromium-capture.mjs';
import { stableStateExpression, closeDelayedPopupExpression } from './lib/capture-state.mjs';

const root = path.resolve(import.meta.dirname, '..');
const chromiumPath = process.env.MATBOX_CHROMIUM_PATH;
if (!chromiumPath) throw new Error('MATBOX_CHROMIUM_PATH must point to an isolated non-Edge browser executable.');
const options = {
  chromiumPath,
  timeoutMs: 60000,
  requestGuard: false,
  allowNetwork: true,
  viewport: { width: 1425, height: 900, mobile: false },
  beforeCollectExpression: stableStateExpression,
  afterSettleExpression: closeDelayedPopupExpression,
  screenshotClip: { x: 0, y: 7400, width: 1425, height: 1800, scale: 1 },
};

for (const [name, url] of [
  ['original', 'https://majestic-template.myshopify.com/'],
  ['local', 'http://127.0.0.1:4173/?matbox-viewport=desktop&clip-diagnostic=1'],
]) {
  const capture = await capturePage(url, options);
  const output = path.join(root, 'artifacts', 'full-site-audit', `clipped-${name}.png`);
  await fs.writeFile(output, capture.screenshot);
  console.log(output);
}
