import path from 'node:path';
import { capturePage } from '../../../../交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/src/capture/chromium-capture.mjs';
import { stableStateExpression, afterSettleStateExpression } from './lib/capture-state.mjs';

const root = path.resolve(import.meta.dirname, '..');
const url = process.argv[2] || 'http://127.0.0.1:4173/?full-site-audit=1&matbox-viewport=desktop';
const viewportName = process.argv[3] || 'desktop';
const viewport = viewportName === 'mobile'
  ? { width: 390, height: 844, mobile: true }
  : { width: 1440, height: 900, mobile: false };
const chromiumPath = process.env.MATBOX_CHROMIUM_PATH;
if (!chromiumPath) throw new Error('MATBOX_CHROMIUM_PATH must point to an isolated Google Chrome executable. Edge is forbidden.');

const result = await capturePage(url, {
  chromiumPath,
  artifactProfile: 'replay',
  timeoutMs: 60000,
  requestGuard: false,
  allowNetwork: true,
  viewport,
  profileRoot: path.join(root, 'artifacts', 'diagnostic-browser-profiles'),
  beforeCollectExpression: stableStateExpression,
  afterSettleExpression: afterSettleStateExpression,
});

const readiness = result.metadata.visualReadiness;
const replayHtml = result.renderedDocument?.html || '';
const failedImageContexts = (readiness.failedImageDetails || []).map((failure) => {
  const source = failure.declaredSrc || failure.src || '';
  const index = source ? replayHtml.indexOf(source) : -1;
  return {
    source,
    context: index >= 0 ? replayHtml.slice(Math.max(0, index - 1200), index + source.length + 1200) : '',
  };
});
process.stdout.write(`${JSON.stringify({ ...readiness, failedImageContexts }, null, 2)}\n`);
