import fs from 'node:fs/promises';
import path from 'node:path';
import { capturePage } from '../../../../交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/src/capture/chromium-capture.mjs';

const root = path.resolve(import.meta.dirname, '..');
const chromiumPath = process.env.MATBOX_CHROMIUM_PATH;
if (!chromiumPath) throw new Error('MATBOX_CHROMIUM_PATH must point to an isolated non-Edge browser executable.');
const profileRoot = path.join(root, 'artifacts', 'diagnostic-browser-profiles');
await fs.mkdir(profileRoot, { recursive: true });
const viewportName = process.argv[2] === 'mobile' ? 'mobile' : 'desktop';
const viewport = viewportName === 'mobile'
  ? { width: 390, height: 844, mobile: true }
  : { width: 1440, height: 900, mobile: false };
const stable = `(async () => {
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  await pause(800);
  for (const image of document.images) image.loading = 'eager';
  await pause(500);
})()`;
const inspect = `(async () => {
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const close = document.querySelector('[data-subscription-popup-close], [data-subscription-popup-dismiss]');
  if (close) { close.click(); await pause(250); }
  const selectors = {
    header: '#shopify-section-sections--23369189458141__header',
    primary: '.twi__primary-img img',
    secondary: '.twi__secondary-img img',
    videoHero: '.hero__video',
  };
  const state = {};
  for (const [name, selector] of Object.entries(selectors)) {
    const node = document.querySelector(selector);
    if (!node) { state[name] = null; continue; }
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    state[name] = { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, position: style.position, transform: style.transform, inlineTransform: node.style.transform, classes: node.className };
  }
  state.revealSamples = Array.from(document.querySelectorAll('.is-reveal-pending,.is-revealed')).map((node, index) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return {
      index,
      tag: node.tagName.toLowerCase(),
      classes: node.className,
      text: (node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80),
      documentY: rect.y + scrollY,
      width: rect.width,
      height: rect.height,
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
      transform: style.transform,
    };
  }).filter((item) => item.documentY >= 2500 && item.documentY <= 14000);
  state.imageSamples = Array.from(document.images).map((node, index) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return {
      index,
      alt: node.alt,
      src: (node.currentSrc || node.src || '').slice(-180),
      documentY: rect.y + scrollY,
      width: rect.width,
      height: rect.height,
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
      transform: style.transform,
      classes: node.className,
    };
  }).filter((item) => item.documentY >= 3000 && item.documentY <= 4400 && item.width > 0 && item.height > 0);
  state.headerActions = Array.from(document.querySelectorAll('header a, header button, .header a, .header button')).map((node) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return {
      text: (node.getAttribute('aria-label') || node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      href: node.getAttribute('href'),
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
      width: rect.width,
      height: rect.height,
      classes: node.className,
    };
  }).filter((item) => item.width > 0 && item.height > 0);
  document.body.dataset.matboxLayoutDiagnostic = JSON.stringify(state);
  return state;
})()`;

async function capture(url) {
  return capturePage(url, {
    chromiumPath,
    timeoutMs: 60000,
    requestGuard: false,
    allowNetwork: true,
    viewport,
    profileRoot,
    beforeCollectExpression: stable,
    afterSettleExpression: inspect,
  });
}

const [original, local] = await Promise.all([
  capture('https://majestic-template.myshopify.com/'),
  capture(`http://127.0.0.1:4173/?matbox-viewport=${viewportName}&layout-diagnostic=1`),
]);
const extract = (result) => {
  const html = result.renderedDocument?.html ?? '';
  const match = html.match(/data-matbox-layout-diagnostic="([^"]+)"/);
  return match?.[1]?.replaceAll('&quot;', '"') ?? null;
};
const compact = (result) => {
  const encoded = extract(result);
  if (!encoded) return null;
  const state = JSON.parse(encoded);
  return {
    header: state.header,
    primary: state.primary,
    secondary: state.secondary,
    imageSamples: state.imageSamples,
    headerActions: state.headerActions,
  };
};
console.log(JSON.stringify({ viewport: viewportName, original: compact(original), local: compact(local) }, null, 2));
