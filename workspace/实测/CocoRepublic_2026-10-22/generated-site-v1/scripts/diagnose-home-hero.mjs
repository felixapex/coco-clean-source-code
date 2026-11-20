import fs from 'node:fs/promises';
import path from 'node:path';
import { capturePage } from '../../../../交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/src/capture/chromium-capture.mjs';

const origin = process.argv[2] || 'http://127.0.0.1:4173';
const marker = 'data-matbox-home-hero-debug';
const expression = `(() => {
  const selectors = ['.home-hero', '.home-hero-wrap', '#video-viewport', '#video-viewport > *', '.home-hero-wrap > div:not(.text-wrap)', '.home-hero .text-wrap', '.home-hero .text-wrap h1', '.home-hero .text-wrap h2', '.home-hero .cr-msb__links'];
  const rows = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)).map((node, index) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return {
      selector,
      index,
      tag: node.tagName,
      text: (node.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 160),
      rect: [rect.left, rect.top, rect.width, rect.height].map((value) => Math.round(value * 100) / 100),
      display: style.display,
      position: style.position,
      transform: style.transform,
      textShadow: style.textShadow,
      filter: style.filter,
      letterSpacing: style.letterSpacing,
      font: style.font,
      whiteSpace: style.whiteSpace,
      opacity: style.opacity,
      visibility: style.visibility,
      attributes: Object.fromEntries(Array.from(node.attributes || []).map((attribute) => [attribute.name, attribute.value.slice(0, 180)])),
      childNodes: Array.from(node.childNodes).map((child) => ({ type: child.nodeType, name: child.nodeName, text: (child.textContent || '').trim().slice(0, 80) })),
      before: getComputedStyle(node, '::before').content,
      after: getComputedStyle(node, '::after').content,
    };
  }));
  document.documentElement.setAttribute('${marker}', encodeURIComponent(JSON.stringify({ innerWidth, scrollWidth: document.documentElement.scrollWidth, rows })));
  return true;
})()`;

const result = await capturePage(`${origin}/?home-hero-debug=1`, {
  chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  timeoutMs: 60000,
  requestGuard: false,
  allowNetwork: true,
  artifactProfile: 'replay',
  viewport: { width: 1920, height: 900, mobile: false },
  afterSettleExpression: expression,
});
await fs.mkdir(path.resolve(import.meta.dirname, '..', '.tmp'), { recursive: true });
await fs.writeFile(path.resolve(import.meta.dirname, '..', '.tmp', 'home-hero-diagnostic.png'), result.screenshot);
const match = result.renderedDocument.html.match(new RegExp(`${marker}="([^"]+)"`));
if (!match) throw new Error('Missing home hero diagnostic marker');
process.stdout.write(`${decodeURIComponent(match[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&'))}\n`);
