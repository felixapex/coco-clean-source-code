import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCapturedHtml, validateCapturedPage } from '../scripts/lib/capture-validation.mjs';
import * as captureValidation from '../scripts/lib/capture-validation.mjs';

test('persisted HTML validation rejects NUL-corrupted route files', () => {
  const result = validateCapturedHtml('\0\0<!doctype html><section id="shopify-section-main"></section>');
  assert.equal(result.pass, false);
  assert.ok(result.failures.includes('invalid-html-bytes'));
  assert.ok(result.failures.includes('missing-document-base'));
});

test('persisted HTML validation rejects an external stylesheet that was not frozen into the local baseline', () => {
  const html = '<!doctype html><html><head><base href="https://cocorepublichelp.zendesk.com/hc/en-us"><link rel="stylesheet" href="https://static.zdassets.com/theme.css"></head><body></body></html>';
  const result = validateCapturedHtml(html);
  assert.equal(result.pass, false);
  assert.ok(result.failures.includes('external-stylesheet-not-frozen'));
});

test('persisted HTML validation rejects scheme-relative and source-relative stylesheets', () => {
  for (const href of ['//static.zdassets.com/theme.css', '/hc/theme.css']) {
    const html = `<!doctype html><html><head><base href="https://cocorepublichelp.zendesk.com/hc/en-us"><link rel="stylesheet" href="${href}"></head><body></body></html>`;
    const result = validateCapturedHtml(html);
    assert.equal(result.pass, false, href);
    assert.ok(result.failures.includes('external-stylesheet-not-frozen'), href);
  }
});

test('capture validation rejects Shopify error pages before they can replace a valid route', () => {
  const errorPage = '<!doctype html><html><head><base href="https://majestic-template.myshopify.com/"><title>Something went wrong</title></head><body><a href="/">Home</a></body></html>';
  const result = validateCapturedPage({ renderedDocument: { html: errorPage }, interactiveElements: [{}] });
  assert.equal(result.pass, false);
  assert.ok(result.failures.includes('error-page'));
  assert.ok(result.failures.includes('missing-shopify-section'));
  assert.ok(result.failures.includes('interaction-inventory-too-small'));
});

test('capture validation accepts a complete rendered Shopify theme page', () => {
  const html = '<!doctype html><html><head><base href="https://majestic-template.myshopify.com/"><title>Collection</title></head><body><section id="shopify-section-header"></section><section id="shopify-section-main"></section></body></html>';
  const result = validateCapturedPage({ renderedDocument: { html }, interactiveElements: Array.from({ length: 20 }, () => ({})) });
  assert.deepEqual(result, { pass: true, failures: [] });
});

test('capture validation accepts a complete rendered BigCommerce category page', () => {
  const html = '<!doctype html><html><head><base href="https://www.cocorepublic.com.au/sofas/standard/"><title>Standard Sofas - Coco Republic</title></head><body><header><nav><a href="/sofas/">Sofas</a></nav></header><main><h1>Standard Sofas</h1><article class="card">Laurent Sofa</article></main><footer>Customer Service</footer></body></html>';
  const result = validateCapturedPage({ renderedDocument: { html }, interactiveElements: Array.from({ length: 20 }, () => ({})) });
  assert.deepEqual(result, { pass: true, failures: [] });
});

test('capture validation rejects an empty asynchronous commerce result container', () => {
  const html = '<!doctype html><html><head><base href="https://www.cocorepublic.com.au/sofas/standard/"><title>Standard Sofas</title></head><body><main><h1>Standard Sofas</h1><div id="searchspring-category"></div></main></body></html>';
  const result = validateCapturedPage({ renderedDocument: { html }, interactiveElements: Array.from({ length: 20 }, () => ({})) });
  assert.equal(result.pass, false);
  assert.ok(result.failures.includes('commerce-content-not-ready'));
});

test('capture validation rejects a visible load-more control without an offline prefetched batch', () => {
  const html = '<!doctype html><html><head><base href="https://www.cocorepublic.com.au/bedroom"><title>Bedroom</title></head><body><main><div id="searchspring-category"><article class="product-card">Bed</article><button class="ss-load-more">Load More</button></div></main></body></html>';
  const result = validateCapturedPage({ renderedDocument: { html }, interactiveElements: Array.from({ length: 20 }, () => ({})) });
  assert.equal(result.pass, false);
  assert.ok(result.failures.includes('load-more-not-prefetched'));
});

test('capture validation identifies a source verification challenge instead of treating it as a simple page', () => {
  const html = '<!doctype html><html><head><base href="https://www.cocorepublic.com.au/contact-us"><title>请稍候…</title></head><body><p>正在验证您的连接</p></body></html>';
  const result = validateCapturedPage({ renderedDocument: { html }, interactiveElements: [{}, {}, {}] });
  assert.equal(result.pass, false);
  assert.ok(result.failures.includes('source-verification-challenge'));
});

test('capture validation accepts an intentionally sparse authentication form with complete controls', () => {
  const html = '<!doctype html><html><head><base href="https://cocorepublichelp.zendesk.com/hc/en-us/signin"><title>Sign in</title></head><body><main><form><label>Email<input type="email"></label><label>Password<input type="password"></label><button type="submit">Sign in</button></form></main></body></html>';
  const result = validateCapturedPage({ renderedDocument: { html }, interactiveElements: [{}, {}, {}] });
  assert.deepEqual(result, { pass: true, failures: [] });
});

test('capture validation accepts a complete Zendesk password-reset form whose email type is conveyed by autocomplete', () => {
  const html = '<!doctype html><html><head><base href="https://cocorepublichelp.zendesk.com/auth/v3/password/forgot"><title>Reset your password</title></head><body><main><h1>Reset your password</h1><form data-testid="forgot-password-form"><label>Email* (required)<input autocomplete="email" aria-required="true"></label></form><button data-testid="submit-button" type="button" disabled>Submit</button><button data-testid="cancel-button" type="button">Cancel</button></main></body></html>';
  const result = validateCapturedPage({ renderedDocument: { html }, interactiveElements: [{}, {}, {}] });
  assert.deepEqual(result, { pass: true, failures: [] });
});

test('capture validation rejects a visual baseline while images are still pending', () => {
  const html = '<!doctype html><html><head><base href="https://majestic-template.myshopify.com/"><title>Collection</title></head><body><section id="shopify-section-main"></section></body></html>';
  const result = validateCapturedPage({ renderedDocument: { html }, interactiveElements: Array.from({ length: 20 }, () => ({})), metadata: { visualReadiness: { pendingImages: 3 } } });
  assert.equal(result.pass, false);
  assert.ok(result.failures.includes('pending-images'));
});

test('capture validation rejects a source baseline that is wider than its viewport', () => {
  const html = '<!doctype html><html><head><base href="https://example.com/"><title>Wide page</title></head><body><main>Wide</main></body></html>';
  const result = validateCapturedPage({
    renderedDocument: { html },
    interactiveElements: Array.from({ length: 20 }, () => ({})),
    metadata: { visualReadiness: { viewportWidth: 1440, documentWidth: 7278, horizontalOverflowPx: 5838 } },
  });
  assert.equal(result.pass, false);
  assert.ok(result.failures.includes('horizontal-overflow'));
});

test('capture validation rejects completed but broken images', () => {
  const html = '<!doctype html><html><head><base href="https://majestic-template.myshopify.com/"><title>Collection</title></head><body><section id="shopify-section-main"></section></body></html>';
  const result = validateCapturedPage({ renderedDocument: { html }, interactiveElements: Array.from({ length: 20 }, () => ({})), metadata: { visualReadiness: { pendingImages: 0, failedImages: 1 } } });
  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, ['failed-images']);
});

test('capture validation rejects a baseline whose stylesheet request failed even when the browser exposed a sheet object', () => {
  const html = '<!doctype html><html><head><base href="https://cocorepublichelp.zendesk.com/hc/en-us"><title>Help centre</title><link rel="stylesheet" href="https://static.zdassets.com/theme.css"></head><body><main><a href="/hc/en-us">Home</a></main></body></html>';
  const result = validateCapturedPage({
    renderedDocument: { html },
    interactiveElements: Array.from({ length: 20 }, () => ({})),
    metadata: {
      visualReadiness: {
        pendingStylesheets: 0,
        failedStylesheets: 1,
        uncapturedStylesheets: 1,
      },
    },
  });
  assert.equal(result.pass, false);
  assert.ok(result.failures.includes('failed-stylesheets'));
  assert.ok(result.failures.includes('uncaptured-stylesheets'));
});

test('capture validation rejects failed or uncaptured custom fonts', () => {
  const html = '<!doctype html><html><head><base href="https://example.test/"><title>Icons</title></head><body><a href="/social">Social</a></body></html>';
  const result = validateCapturedPage({
    renderedDocument: { html },
    interactiveElements: Array.from({ length: 20 }, () => ({})),
    metadata: { visualReadiness: { failedFonts: 1, uncapturedFonts: 1 } },
  });
  assert.equal(result.pass, false);
  assert.ok(result.failures.includes('failed-fonts'));
  assert.ok(result.failures.includes('uncaptured-fonts'));
});

test('published validation accepts root base and only resolved frozen component assets', () => {
  const html = '<!doctype html><html><head><base href="/"><link rel="stylesheet" href="/component-library/assets/theme.css"></head><body><img src="/component-library/assets/hero.jpg"><a href="/products">Products</a></body></html>';
  const existing = new Set(['/component-library/assets/theme.css', '/component-library/assets/hero.jpg']);
  const result = validateCapturedHtml(html, { mode: 'published', assetResolver: (href) => existing.has(href) });
  assert.deepEqual(result, { pass: true, failures: [] });
});

test('published validation fails closed when a referenced frozen asset is missing', () => {
  const html = '<!doctype html><html><head><base href="/"><link rel="stylesheet" href="/component-library/assets/missing.css"></head><body><img src="/component-library/assets/missing.jpg"></body></html>';
  const result = validateCapturedHtml(html, { mode: 'published', assetResolver: () => false });
  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, [
    'unresolved-published-asset:/component-library/assets/missing.css',
    'unresolved-published-asset:/component-library/assets/missing.jpg',
  ]);
});

test('published validation rejects every active resource path that can return to the source website', () => {
  const html = `<!doctype html><html><head><base href="/">
    <style>.hero{background-image:url("https://source.example/background.jpg")}</style>
  </head><body>
    <img src="data:image/png;base64,AQID" data-src="https://source.example/lazy.jpg"
      srcset="https://source.example/double.jpg 2x">
    <video poster="//source.example/poster.jpg"></video>
    <script src="https://source.example/runtime.js"></script>
  </body></html>`;
  const result = validateCapturedHtml(html, { mode: 'published' });
  assert.equal(result.pass, false);
  assert.ok(result.failures.includes('external-published-resource:data-src'));
  assert.ok(result.failures.includes('external-published-resource:srcset'));
  assert.ok(result.failures.includes('external-published-resource:poster'));
  assert.ok(result.failures.includes('external-published-resource:src'));
  assert.ok(result.failures.includes('external-published-resource:css-url'));
});

test('clean publish audit rejects source-store anchors and form actions without rejecting normal outbound links', () => {
  const html = `<!doctype html><html><head><base href="/"></head><body>
    <a href="https://www.cocorepublic.com.au/bedroom">Bedroom</a>
    <form action="https://www.cocorepublic.com.au/search.php"></form>
    <a href="https://www.instagram.com/cocorepublic/">Instagram</a>
  </body></html>`;
  const result = captureValidation.auditPublishedSiteHtml(html, {
    sourceHosts: ['www.cocorepublic.com.au'],
  });
  assert.equal(result.pass, false);
  assert.deepEqual(result.failures.sort(), [
    'source-navigation:form:action',
    'source-navigation:a:href',
  ].sort());
});

test('published sanitizer removes trackers and stale lazy URLs while localizing required media and source navigation', () => {
  const videoUrl = 'https://store.example/content/hero.mp4';
  const html = `<!doctype html><html><head>
    <base href="https://www.cocorepublic.com.au/bedroom">
    <link rel="preconnect" href="https://cdn.example">
  </head><body>
    <iframe src="https://tracker.example/pixel"></iframe>
    <img src="/frozen/hero.jpg" data-src="https://cdn.example/hero.jpg" data-srcset="https://cdn.example/hero-2x.jpg 2x">
    <video><source src="${videoUrl}" type="video/mp4"></video>
    <a href="https://www.cocorepublic.com.au/bedroom">Bedroom</a>
    <form action="https://www.cocorepublic.com.au/search.php"></form>
    <a href="https://www.instagram.com/cocorepublic/">Instagram</a>
  </body></html>`;
  const result = captureValidation.sanitizePublishedHtml(html, {
    sourceHosts: ['www.cocorepublic.com.au'],
    resourceMap: new Map([[videoUrl, '/frozen-assets/external-v3/hero.mp4']]),
  });
  assert.match(result.html, /<base href="\/">/);
  assert.doesNotMatch(result.html, /tracker\.example|cdn\.example/);
  assert.match(result.html, /<source src="\/frozen-assets\/external-v3\/hero\.mp4"/);
  assert.match(result.html, /<a href="\/bedroom">Bedroom<\/a>/);
  assert.match(result.html, /<form action="\/search\.php">/);
  assert.match(result.html, /https:\/\/www\.instagram\.com/);
  assert.equal(result.report.removedIframes, 1);
});

test('published sanitizer maps related brand services locally while preserving explicit social links', () => {
  const html = `<a href="https://viewer.ipaper.io/coco/catalogue">Catalogue</a>
    <a href="https://republicpropertystyling.com.au/services">Property styling</a>
    <a href="https://www.instagram.com/cocorepublic/">Instagram</a>`;
  const result = captureValidation.sanitizePublishedHtml(html, {
    navigationFallbacks: {
      'viewer.ipaper.io': '/catalogues',
      'republicpropertystyling.com.au': '/interior-design',
    },
  });
  assert.match(result.html, /href="\/catalogues"/);
  assert.match(result.html, /href="\/interior-design"/);
  assert.match(result.html, /https:\/\/www\.instagram\.com/);
  assert.equal(result.report.localizedNavigation, 2);
});

test('external media collector selects visual media but ignores trackers and remote font stylesheets', () => {
  const html = `<!doctype html><html><head>
    <style>.hero{background-image:url("https://cdn.example/hero.jpg")}.font{src:url("https://fonts.googleapis.com/css2?family=Inter")}</style>
  </head><body>
    <video><source src="https://store.example/content/hero.mp4"></video>
    <iframe src="https://tracker.example/pixel"></iframe>
    <img src="/local.jpg" data-src="https://cdn.example/stale.jpg">
  </body></html>`;
  assert.deepEqual(captureValidation.collectExternalMediaUrls(html), [
    'https://cdn.example/hero.jpg',
    'https://store.example/content/hero.mp4',
  ]);
});

test('external media references distinguish required media from optional CSS fallbacks', () => {
  const html = `<style>.hero{background:url("https://cdn.example/hero.jpg")}</style>
    <video><source src="https://store.example/hero.mp4"></video>`;
  assert.deepEqual(captureValidation.collectExternalMediaReferences(html), [
    { url: 'https://cdn.example/hero.jpg', required: false },
    { url: 'https://store.example/hero.mp4', required: true },
  ]);
});

test('external video becomes optional when the capture contains a local frozen frame fallback', () => {
  const html = `<img data-matbox-frozen-video="true" src="/component-library/assets/frozen.png">
    <video><source src="https://store.example/hero.mp4"></video>`;
  assert.deepEqual(captureValidation.collectExternalMediaReferences(html), [
    { url: 'https://store.example/hero.mp4', required: false },
  ]);
  const result = captureValidation.sanitizePublishedHtml(html);
  assert.doesNotMatch(result.html, /store\.example/);
  assert.match(result.html, /data-matbox-static-video-fallback="true"/);
  assert.match(result.html, /src="\/component-library\/assets\/frozen\.png"/);
});

test('cached resource decoder restores the captured URL and binary payload before network fallback', () => {
  const decoded = captureValidation.decodeCachedResourceText(
    'https://cdn.example/icon.svg\ndata:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
  );
  assert.equal(decoded.sourceUrl, 'https://cdn.example/icon.svg');
  assert.equal(decoded.contentType, 'image/svg+xml');
  assert.equal(decoded.buffer.toString('utf8'), '<svg></svg>');
});
