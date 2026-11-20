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
const capture = await import(pathToFileURL(capturePath));
const chromePath = process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const probeExpression = `(async () => {
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const sample = () => {
    const text = String(document.body?.innerText || '').replace(/\\s+/g, ' ').trim();
    let textHash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      textHash ^= text.charCodeAt(index);
      textHash = Math.imul(textHash, 16777619);
    }
    const images = Array.from(document.images).filter(visible);
    return {
      readyState: document.readyState,
      fontStatus: document.fonts?.status || 'loaded',
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      bodyChildren: document.body?.childElementCount || 0,
      textLength: text.length,
      textHash: textHash >>> 0,
      controls: Array.from(document.querySelectorAll('a[href],button,input,select,textarea,summary,[role="button"],[role="link"]')).filter(visible).length,
      images: images.length,
      pendingImages: images.filter((image) => !image.complete || image.naturalWidth <= 0).length,
    };
  };
  const changes = {};
  const examples = [];
  let previous = sample();
  for (let index = 0; index < 50; index += 1) {
    await pause(100);
    const current = sample();
    const changed = Object.keys(current).filter((key) => current[key] !== previous[key]);
    for (const key of changed) changes[key] = (changes[key] || 0) + 1;
    if (changed.length && examples.length < 12) examples.push({ elapsedMs: (index + 1) * 100, changed, previous, current });
    previous = current;
  }
  document.documentElement.setAttribute('data-matbox-readiness-probe', encodeURIComponent(JSON.stringify({ changes, examples, final: previous })));
  return true;
})()`;

const result = await capture.capturePage('https://www.cocorepublic.com.au/', {
  chromiumPath: chromePath,
  viewport: { width: 1440, height: 900, mobile: false },
  artifactProfile: 'replay',
  timeoutMs: 30000,
  allowNetwork: true,
  requestGuard: false,
  beforeCollectExpression: probeExpression,
});
const encoded = result.renderedDocument.html.match(/data-matbox-readiness-probe="([^"]+)"/)?.[1];
if (!encoded) throw new Error('Readiness probe result missing');
process.stdout.write(`${JSON.stringify(JSON.parse(decodeURIComponent(encoded.replace(/&amp;/g, '&'))), null, 2)}\n`);
