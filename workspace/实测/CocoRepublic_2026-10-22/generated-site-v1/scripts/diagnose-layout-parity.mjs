import { capturePage } from '../../../../交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/src/capture/chromium-capture.mjs';
import { stableStateExpression, afterSettleStateExpression } from './lib/capture-state.mjs';

const route = process.argv[2] || '/collections/laurent-collection';
const sourceOrigin = (process.env.MATBOX_SOURCE_URL || 'https://www.cocorepublic.com.au').replace(/\/$/, '');
const localOrigin = (process.env.MATBOX_LOCAL_ORIGIN || 'http://127.0.0.1:4173').replace(/\/$/, '');
const marker = 'data-matbox-layout-debug';
const diagnosticExpression = `(async () => {
  await (${afterSettleStateExpression});
  const nodes = [document.documentElement, document.body, ...Array.from(document.querySelectorAll('main > *, main h1, main h2, main h3, main p, main img, main video, main canvas, [data-test-id^="carousel"], [id*="carousel"] > div'))].slice(0, 260);
  const rows = nodes.map((node, index) => {
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return {
      index,
      tag: node.tagName,
      id: node.id || '',
      className: typeof node.className === 'string' ? node.className.slice(0, 100) : '',
      text: (node.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80),
      rect: [rect.left + scrollX, rect.top + scrollY, rect.width, rect.height].map((value) => Math.round(value * 100) / 100),
      font: [style.fontFamily, style.fontSize, style.fontWeight, style.lineHeight],
      scroll: [node.clientWidth, node.scrollWidth, node.clientHeight, node.scrollHeight, style.overflowX, style.overflowY, style.scrollbarGutter, style.scrollbarWidth],
      rootState: index < 2 ? [innerWidth, innerHeight, scrollX, scrollY, style.position, style.width, style.maxWidth, document.querySelector('style[data-emotion]')?.sheet?.cssRules?.length ?? -1, document.adoptedStyleSheets?.length ?? -1] : null,
      fontReady: document.fonts?.check?.(style.font) ?? null,
    };
  });
  document.documentElement.setAttribute('${marker}', encodeURIComponent(JSON.stringify(rows)));
  return true;
})()`;

async function capture(url) {
  return capturePage(url, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 60000,
    requestGuard: false,
    allowNetwork: true,
    artifactProfile: 'replay',
    viewport: { width: 1440, height: 900, mobile: false },
    beforeCollectExpression: stableStateExpression,
    afterSettleExpression: diagnosticExpression,
  });
}

function extract(html) {
  const match = html.match(new RegExp(`${marker}="([^"]+)"`));
  if (!match) throw new Error('Missing layout diagnostic marker');
  return JSON.parse(decodeURIComponent(match[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&')));
}

const source = extract((await capture(`${sourceOrigin}${route}`)).renderedDocument.html);
const local = extract((await capture(`${localOrigin}${route}?layout-debug=1`)).renderedDocument.html);
const differences = [];
for (let index = 0; index < Math.min(source.length, local.length); index++) {
  const left = source[index];
  const right = local[index];
  const rectDelta = left.rect.map((value, position) => Math.round((right.rect[position] - value) * 100) / 100);
  if (rectDelta.some((value) => Math.abs(value) >= 0.5) || JSON.stringify(left.font) !== JSON.stringify(right.font) || JSON.stringify(left.scroll) !== JSON.stringify(right.scroll) || left.fontReady !== right.fontReady) {
    differences.push({ index, node: [left.tag, left.id, left.className, left.text], source: { rect: left.rect, font: left.font, scroll: left.scroll, fontReady: left.fontReady }, local: { rect: right.rect, font: right.font, scroll: right.scroll, fontReady: right.fontReady }, rectDelta });
  }
}
const signature = (row) => [row.index, row.tag, row.id, row.className, row.text, row.rect, row.scroll];
const rootsOnly = process.env.MATBOX_LAYOUT_ROOTS_ONLY === '1';
const compact = process.env.MATBOX_LAYOUT_COMPACT === '1';
const verticalOnly = process.env.MATBOX_LAYOUT_VERTICAL_ONLY === '1';
const compactDifferences = verticalOnly ? differences.filter(({ rectDelta }) => Math.abs(rectDelta[1]) >= 0.5 || Math.abs(rectDelta[3]) >= 0.5) : differences;
const result = rootsOnly
  ? { route, sourceRoots: source.slice(0, 2), localRoots: local.slice(0, 2), rootDifferences: differences.filter(({ index }) => index < 2) }
  : compact
    ? { route, sourceCount: source.length, localCount: local.length, differenceCount: differences.length, differences: compactDifferences.map(({ index, node, rectDelta, source, local }) => ({ index, node, rectDelta, sourceRect: source.rect, localRect: local.rect })).slice(0, 120) }
  : { route, sourceCount: source.length, localCount: local.length, source: source.map(signature), local: local.map(signature), differenceCount: differences.length, differences: differences.slice(0, 80) };
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
