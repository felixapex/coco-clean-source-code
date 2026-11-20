import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const workspaceRoot = path.resolve(import.meta.dirname, '..', '..');
const capturePath = path.join(
  workspaceRoot,
  '交付文件',
  '拆网站_V2.9_联调可执行修正版_2026-09-09',
  'PACKAGE',
  '08_POC_SOURCE_PATCHED',
  'src',
  'capture',
  'chromium-capture.mjs',
);
const inputPath = path.resolve(process.argv[2] || '');
if (!inputPath) throw new Error('usage: node diagnose-render-state.mjs <html-path>');

const html = await fs.readFile(inputPath, 'utf8');
const capture = await import(pathToFileURL(capturePath));
const expression = `(() => {
  const selector = '#cards-622b573b-f700-447d-aed6-c40badca8425';
  const root = document.querySelector(selector);
  const nodes = root ? [root, root.querySelector('.cat-cards'), ...root.querySelectorAll('.category-block'), ...root.querySelectorAll('img')] : [];
  const values = nodes.filter(Boolean).map((node, index) => {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return {
      index,
      tag: node.tagName.toLowerCase(),
      className: String(node.className || ''),
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
      position: style.position,
      overflow: style.overflow,
      width: rect.width,
      height: rect.height,
      top: rect.top + scrollY,
      left: rect.left + scrollX,
      complete: node instanceof HTMLImageElement ? node.complete : undefined,
      naturalWidth: node instanceof HTMLImageElement ? node.naturalWidth : undefined,
      naturalHeight: node instanceof HTMLImageElement ? node.naturalHeight : undefined,
      srcPrefix: node instanceof HTMLImageElement ? String(node.currentSrc || node.src || '').slice(0, 80) : undefined,
    };
  });
  document.documentElement.setAttribute('data-matbox-render-diagnostic', encodeURIComponent(JSON.stringify(values)));
  return values.length;
})()`;

const result = await capture.captureHtml(html, {
  chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  viewport: { width: 1440, height: 900, mobile: false },
  artifactProfile: 'replay',
  timeoutMs: 60000,
  requestGuard: false,
  allowNetwork: false,
  beforeSnapshotExpression: expression,
});
const encoded = result.renderedDocument.html.match(/data-matbox-render-diagnostic="([^"]*)"/)?.[1] || '';
console.log(JSON.stringify(encoded ? JSON.parse(decodeURIComponent(encoded.replace(/&quot;/g, '"').replace(/&amp;/g, '&'))) : [], null, 2));
await fs.writeFile(path.join(path.dirname(inputPath), 'render-diagnostic.png'), result.screenshot);
