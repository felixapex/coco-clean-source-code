import fs from 'node:fs/promises';
import path from 'node:path';
import { capturePage } from '../../../../交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/src/capture/chromium-capture.mjs';
import { stableStateExpression, afterSettleStateExpression } from './lib/capture-state.mjs';

const root = path.resolve(import.meta.dirname, '..');
const chromiumPath = process.env.MATBOX_CHROMIUM_PATH;
if (!chromiumPath) throw new Error('MATBOX_CHROMIUM_PATH must point to an isolated non-Edge browser executable.');
const route = process.argv[2] || '/policies/shipping-policy';
const viewportName = process.argv[3] === 'mobile' ? 'mobile' : 'desktop';
const viewport = viewportName === 'mobile'
  ? { width: 390, height: 844, mobile: true }
  : { width: 1440, height: 900, mobile: false };
const localOrigin = (process.env.MATBOX_LOCAL_ORIGIN || 'http://127.0.0.1:4173').replace(/\/+$/, '');
const sourceOrigin = (process.env.MATBOX_SOURCE_URL || 'https://majestic-template.myshopify.com').replace(/\/+$/, '');
const outputPath = path.join(root, 'artifacts', 'typography-diagnostic.json');
const diagnosticExpression = `(() => {
  const selectors = {
    body: 'body',
    headerMenu: '.header__menu, .header-menu, header nav',
    breadcrumb: '.theme-breadcrumbs',
    policyContainer: '.shopify-policy__container',
    policyTitle: '.shopify-policy__title h1',
    policyBody: '.shopify-policy__body',
    policyParagraph: '.shopify-policy__body p',
    footerHeading: '.footer h2, .footer h3, footer h2, footer h3',
    footerLink: '.footer a, footer a'
    ,mainProduct: '.main-product'
    ,mainProductLayout: '.main-product__layout'
    ,mainProductMedia: '.main-product__media'
    ,productGallery: '.product-gallery'
    ,tickerViewport: '.ticker-rail__viewport'
    ,tickerTrack: '.ticker-rail__track'
    ,tickerItem: '.ticker-rail__item'
    ,mainProductContent: '.main-product__content'
  };
  const state = {};
  for (const [name, selector] of Object.entries(selectors)) {
    const node = document.querySelector(selector);
    if (!node) { state[name] = null; continue; }
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    state[name] = {
      selector,
      tag: node.tagName,
      text: (node.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
      rect: { x: rect.x, y: rect.y + scrollY, width: rect.width, height: rect.height },
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      fontStyle: style.fontStyle,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      padding: style.padding,
      margin: style.margin,
    };
  }
  const probes = {};
  for (const spec of ['300 16px Poppins', '500 16px Poppins', '300 italic 16px Newsreader', '400 16px Comfortaa']) {
    probes[spec] = document.fonts?.check(spec) ?? null;
  }
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const widths = {};
  for (const family of ['Poppins', 'Arial', 'sans-serif', 'Newsreader', 'Georgia', 'serif', 'Comfortaa']) {
    context.font = family === 'Newsreader' ? 'italic 300 32px Newsreader' : '300 32px ' + family;
    widths[family] = context.measureText('Shipping policy ABC xyz 0123456789').width;
  }
  state.document = {
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    bodyHeight: document.body.getBoundingClientRect().height,
    fontsStatus: document.fonts?.status ?? null,
    probes,
    widths,
  };
  document.documentElement.dataset.matboxTypographyDiagnostic = encodeURIComponent(JSON.stringify(state));
  return state;
})()`;

async function capture(url) {
  return capturePage(url, {
    chromiumPath,
    artifactProfile: 'replay',
    timeoutMs: 60000,
    requestGuard: false,
    allowNetwork: true,
    viewport,
    profileRoot: path.join(root, 'artifacts', 'browser-profiles'),
    beforeCollectExpression: stableStateExpression,
    afterSettleExpression: `(async () => { await (${afterSettleStateExpression}); return await (${diagnosticExpression}); })()`,
  });
}

function extract(result) {
  const html = result.renderedDocument?.html || '';
  const match = html.match(/data-matbox-typography-diagnostic="([^"]+)"/);
  if (!match) throw new Error('Typography diagnostic marker was not serialized');
  return JSON.parse(decodeURIComponent(match[1]));
}

const original = await capture(`${sourceOrigin}${route}`);
const local = await capture(`${localOrigin}${route}?typography-diagnostic=1&matbox-viewport=${viewportName}`);
const report = { route, viewport: viewportName, generatedAt: new Date().toISOString(), original: extract(original), local: extract(local) };
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
