import path from 'node:path';
import { capturePage } from '../../../../交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/src/capture/chromium-capture.mjs';

const root = path.resolve(import.meta.dirname, '..');
const inspect = `(() => {
  const snapshot = (node) => {
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return {
      tag: node.tagName,
      classes: node.className,
      rect: { x: rect.x, y: rect.y + scrollY, width: rect.width, height: rect.height },
      display: style.display,
      gridTemplateColumns: style.gridTemplateColumns,
      gap: style.gap,
      width: style.width,
      maxWidth: style.maxWidth,
      padding: style.padding,
      margin: style.margin,
    };
  };
  const textOf = (node) => (node?.textContent || '').replace(/\\s+/g, ' ').trim();
  const saleHeading = Array.from(document.querySelectorAll('h1,h2,h3,h4,p,div,span'))
    .find((node) => textOf(node).toUpperCase() === 'SHOP THE SALE');
  const saleSection = saleHeading?.closest('section') || saleHeading?.parentElement?.parentElement || null;
  const saleCandidates = saleSection ? Array.from(saleSection.querySelectorAll('div,ul,ol')).filter((node) => {
    const children = Array.from(node.children);
    return children.length >= 4 && children.some((child) => child.querySelector('img'));
  }) : [];
  const saleGrid = saleCandidates.sort((left, right) => right.children.length - left.children.length)[0] || null;
  const grids = Array.from(document.querySelectorAll('.card-grid-widget')).map((grid) => ({
    grid: snapshot(grid),
    parent: snapshot(grid.parentElement),
    children: Array.from(grid.children).slice(0, 5).map(snapshot),
  }));
  const result = {
    innerWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    sale: {
      heading: snapshot(saleHeading),
      section: snapshot(saleSection),
      grid: snapshot(saleGrid),
      gridAttributes: saleGrid ? Object.fromEntries(Array.from(saleGrid.attributes).map((attribute) => [attribute.name, attribute.value])) : null,
      childCount: saleGrid?.children.length || 0,
      children: saleGrid ? Array.from(saleGrid.children).map(snapshot) : [],
    },
    grids,
  };
  document.body.dataset.matboxCardLayout = JSON.stringify(result);
  return result;
})()`;

async function capture(url, suffix) {
  return capturePage(url, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 90000,
    requestGuard: false,
    allowNetwork: true,
    viewport: { width: 1908, height: 1000, mobile: false },
    profileRoot: path.join(root, 'artifacts', `diagnostic-card-layout-${suffix}`),
    afterSettleExpression: inspect,
  });
}

const [original, local] = await Promise.all([
  capture('https://www.cocorepublic.com.au/', 'original'),
  capture('http://127.0.0.1:4173/?card-layout=1', 'local'),
]);

const extract = (captureResult) => {
  const html = captureResult.renderedDocument?.html ?? '';
  const match = html.match(/data-matbox-card-layout="([^"]+)"/);
  return match ? JSON.parse(match[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&')) : null;
};

console.log(JSON.stringify({ original: extract(original), local: extract(local) }, null, 2));
