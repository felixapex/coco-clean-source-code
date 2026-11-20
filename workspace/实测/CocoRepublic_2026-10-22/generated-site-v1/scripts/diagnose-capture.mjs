import fs from 'node:fs/promises';
import path from 'node:path';
import { capturePage } from '../../../../交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/src/capture/chromium-capture.mjs';
import { stableStateExpression, closeDelayedPopupExpression } from './lib/capture-state.mjs';

const url = process.argv[2];
if (!url) throw new Error('Usage: node scripts/diagnose-capture.mjs <url>');
const root = path.resolve(import.meta.dirname, '..');
const result = await capturePage(url, {
  chromiumPath: process.env.MATBOX_CHROMIUM_PATH,
  artifactProfile: 'replay',
  timeoutMs: 60000,
  requestGuard: false,
  allowNetwork: true,
  viewport: { width: 1440, height: 900, mobile: false },
  profileRoot: path.join(root, 'artifacts', 'browser-profiles'),
  beforeCollectExpression: stableStateExpression,
  afterSettleExpression: closeDelayedPopupExpression,
});
const slug = new URL(url).pathname.replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9]+/gi, '-') || 'home';
const diagnosticRoot = path.join(root, 'artifacts', 'diagnostics');
await fs.mkdir(diagnosticRoot, { recursive: true });
await fs.writeFile(path.join(diagnosticRoot, `${slug}.png`), result.screenshot);
await fs.writeFile(path.join(diagnosticRoot, `${slug}.html`), result.renderedDocument.html, 'utf8');
process.stdout.write(`${JSON.stringify({
  url,
  title: result.renderedDocument.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || '',
  interactions: result.interactiveElements.length,
  links: result.links.length,
  captureTimings: result.metadata.captureTimings,
  visualReadiness: result.metadata.visualReadiness,
}, null, 2)}\n`);
