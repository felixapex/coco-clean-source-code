import fs from 'node:fs/promises';
import path from 'node:path';
import { capturePage } from '../../../../交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/src/capture/chromium-capture.mjs';
import { stableStateExpression, afterSettleStateExpression } from './lib/capture-state.mjs';

const root = path.resolve(import.meta.dirname, '..');
const chromiumPath = process.env.MATBOX_CHROMIUM_PATH;
if (!chromiumPath) throw new Error('MATBOX_CHROMIUM_PATH must point to an isolated non-Edge browser executable.');
const result = await capturePage('http://127.0.0.1:4173/products/nordic-armchair?full-site-audit=1&matbox-viewport=mobile', {
  chromiumPath,
  artifactProfile: 'replay',
  timeoutMs: 60000,
  requestGuard: false,
  allowNetwork: true,
  viewport: { width: 390, height: 844, mobile: true },
  screenshotClip: { x: 0, y: 0, width: 390, height: 6621, scale: 1 },
  beforeCollectExpression: stableStateExpression,
  afterSettleExpression: afterSettleStateExpression,
});
await fs.writeFile(path.join(root, 'artifacts', 'single-shot-mobile.png'), result.screenshot);
process.stdout.write(`${JSON.stringify(result.metadata.visualReadiness, null, 2)}\n`);
