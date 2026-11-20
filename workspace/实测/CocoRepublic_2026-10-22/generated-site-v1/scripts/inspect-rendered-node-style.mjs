import { capturePage } from '../../../../交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/src/capture/chromium-capture.mjs';
import { stableStateExpression } from './lib/capture-state.mjs';

const [url, selector] = process.argv.slice(2);
if (!url || !selector) throw new Error('Usage: node scripts/inspect-rendered-node-style.mjs <url> <selector>');

const escapedSelector = JSON.stringify(selector);
const result = await capturePage(url, {
  chromiumPath: process.env.MATBOX_CHROMIUM_PATH,
  artifactProfile: 'replay',
  timeoutMs: 60000,
  requestGuard: false,
  allowNetwork: true,
  viewport: { width: 1440, height: 900, mobile: false },
  beforeCollectExpression: stableStateExpression,
  afterSettleExpression: `(() => {
    const target = document.querySelector(${escapedSelector});
    const entries = [];
    for (let node = target; node && entries.length < 8; node = node.parentElement) {
      const style = getComputedStyle(node);
      const before = getComputedStyle(node, '::before');
      const after = getComputedStyle(node, '::after');
      const rect = node.getBoundingClientRect();
      entries.push({
        tag: node.tagName,
        id: node.id,
        className: String(node.className || ''),
        attributes: Object.fromEntries(Array.from(node.attributes || []).map((attribute) => [attribute.name, attribute.value])),
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        color: style.color,
        fontSize: style.fontSize,
        fontFamily: style.fontFamily,
        textShadow: style.textShadow,
        transform: style.transform,
        filter: style.filter,
        animation: style.animation,
        beforeContent: before.content,
        afterContent: after.content,
        overflow: style.overflow,
        width: rect.width,
        height: rect.height,
        top: rect.top + scrollY,
      });
    }
    document.documentElement.dataset.matboxInspectedNode = JSON.stringify(entries);
    return entries;
  })()`,
});

const match = result.renderedDocument.html.match(/data-matbox-inspected-node="([^"]*)"/);
const encoded = match?.[1] || '';
const decoded = encoded.replaceAll('&quot;', '"').replaceAll('&amp;', '&');
process.stdout.write(`${JSON.stringify(JSON.parse(decoded), null, 2)}\n`);
