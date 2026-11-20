import fs from 'node:fs/promises';
import path from 'node:path';

import { capturePage } from '../../../../交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/src/capture/chromium-capture.mjs';

const root = path.resolve(import.meta.dirname, '..');
const chromiumPath = process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
if (/msedge\.exe$/i.test(chromiumPath)) throw new Error('Microsoft Edge automation is forbidden in this workspace');
const url = process.env.MATBOX_INSPECT_URL || 'http://127.0.0.1:4197/';
const result = await capturePage(url, {
  chromiumPath,
  timeoutMs: 60000,
  requestGuard: false,
  allowNetwork: true,
  viewport: { width: 1908, height: 1000, mobile: false },
});
const output = path.join(root, 'artifacts', 'current-coco-home-inspection.png');
await fs.writeFile(output, result.screenshot);
process.stdout.write(`${JSON.stringify({
  url,
  output,
  title: result.renderedDocument?.title || '',
  controls: result.interactiveElements?.length || 0,
  htmlBytes: Buffer.byteLength(result.renderedDocument?.html || '', 'utf8'),
  readiness: result.metadata?.visualReadiness || null,
}, null, 2)}\n`);
