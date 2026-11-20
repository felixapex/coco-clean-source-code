import fs from 'node:fs/promises';
import path from 'node:path';
import { capturePage } from '../../../../交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/src/capture/chromium-capture.mjs';

const root = path.resolve(import.meta.dirname, '..');
const chromiumPath = process.env.MATBOX_CHROMIUM_PATH;
if (!chromiumPath) throw new Error('MATBOX_CHROMIUM_PATH must point to an isolated non-Edge browser executable.');
const profileRoot = path.join(root, 'artifacts', 'diagnostic-browser-profiles');
await fs.mkdir(profileRoot, { recursive: true });

const countExpression = `(() => ({
  pending: document.querySelectorAll('.is-reveal-pending').length,
  revealed: document.querySelectorAll('.is-revealed').length,
  total: document.querySelectorAll('.is-reveal-pending, .is-revealed').length,
}))()`;

const result = await capturePage('http://127.0.0.1:4173/?matbox-viewport=mobile&reveal-diagnostic=1', {
  chromiumPath,
  timeoutMs: 60000,
  requestGuard: false,
  allowNetwork: true,
  viewport: { width: 390, height: 844, mobile: true },
  profileRoot,
  beforeCollectExpression: `(async () => {
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const snapshot = () => ${countExpression};
    const timeline = { ready: snapshot(), frozenStyles: Array.from(document.querySelectorAll('style[data-matbox-frozen-stylesheet]')).map((node) => ({ sheet: Boolean(node.sheet), rules: (() => { try { return node.sheet?.cssRules?.length ?? -1; } catch { return -2; } })(), text: node.textContent.length })) };
    await pause(800);
    timeline.after800 = snapshot();
    timeline.afterDialogs = snapshot();
    for (const image of document.images) {
      image.loading = 'eager';
      const deferred = image.dataset.src || image.dataset.lazySrc || image.dataset.original;
      if (deferred && (!image.getAttribute('src') || image.getAttribute('src').startsWith('data:'))) image.src = deferred;
    }
    await pause(500);
    timeline.afterImages = snapshot();
    document.body.dataset.revealBefore = JSON.stringify(timeline);
    return timeline;
  })()`,
  afterSettleExpression: `(async () => {
    const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const snapshot = () => ${countExpression};
    const timeline = { beforeClose: snapshot() };
    const close = document.querySelector('[data-subscription-popup-close], [data-subscription-popup-dismiss]');
    if (close) { close.click(); await pause(250); }
    timeline.afterClose = snapshot();
    timeline.closeFound = Boolean(close);
    document.body.dataset.revealAfter = JSON.stringify(timeline);
    return timeline;
  })()`,
});

const html = result.renderedDocument?.html ?? '';
const extract = (name) => {
  const match = html.match(new RegExp(`data-${name}="([^"]+)"`));
  return match?.[1]?.replaceAll('&quot;', '"') ?? null;
};

console.log(JSON.stringify({
  readiness: result.metadata?.visualReadiness,
  before: extract('reveal-before'),
  after: extract('reveal-after'),
  final: {
    pending: (html.match(/\bis-reveal-pending\b/g) ?? []).length,
    revealed: (html.match(/\bis-revealed\b/g) ?? []).length,
  },
}, null, 2));
