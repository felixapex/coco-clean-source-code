import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareSourceHtmlForStaticCapture, resolveCaptureSourceUrl, resolveSourceOrigin } from '../scripts/lib/source-origin.mjs';

test('source origin defaults to the verified route inventory instead of an unrelated legacy site', () => {
  assert.equal(resolveSourceOrigin({ inventorySource: 'https://www.cocorepublic.com.au/sitemap.php' }), 'https://www.cocorepublic.com.au');
});

test('explicit source must match the verified route inventory', () => {
  assert.throws(
    () => resolveSourceOrigin({ envValue: 'https://majestic-template.myshopify.com', inventorySource: 'https://www.cocorepublic.com.au/sitemap.php' }),
    /Source origin mismatch/,
  );
});

test('source origin fails closed when neither environment nor inventory identifies the site', () => {
  assert.throws(() => resolveSourceOrigin({}), /Source origin is required/);
});

test('capture URL normally comes from the verified source origin and local route', () => {
  assert.equal(resolveCaptureSourceUrl({
    sourceOrigin: 'https://www.cocorepublic.com.au',
    route: '/collections/shifting-spaces',
  }), 'https://www.cocorepublic.com.au/collections/shifting-spaces');
});

test('a single targeted route may use its verified redirect destination while keeping the local route identity', () => {
  assert.equal(resolveCaptureSourceUrl({
    sourceOrigin: 'https://www.cocorepublic.com.au',
    route: '/contact-us',
    explicitUrl: 'https://cocorepublichelp.zendesk.com/hc/en-us',
    selectedRouteCount: 1,
  }), 'https://cocorepublichelp.zendesk.com/hc/en-us');
});

test('source URL override fails closed for multi-route capture and non-http protocols', () => {
  assert.throws(() => resolveCaptureSourceUrl({
    sourceOrigin: 'https://www.cocorepublic.com.au',
    route: '/contact-us',
    explicitUrl: 'https://cocorepublichelp.zendesk.com/hc/en-us',
    selectedRouteCount: 2,
  }), /exactly one --route/);
  assert.throws(() => resolveCaptureSourceUrl({
    sourceOrigin: 'https://www.cocorepublic.com.au',
    route: '/contact-us',
    explicitUrl: 'file:///C:/secrets.txt',
    selectedRouteCount: 1,
  }), /http or https/);
});

test('HTTP-seeded source HTML receives one verified base URL for official relative assets', () => {
  const html = '<!doctype html><html><head><title>Help</title><script type="module">await import("/app.js")</script></head><body><img src="/logo.png"><img src="" onerror="this.src=\'/fallback.png\'"><script src="/tracking.js"></script></body></html>';
  const seeded = prepareSourceHtmlForStaticCapture(html, 'https://cocorepublichelp.zendesk.com/hc/en-us', {
    'https://cocorepublichelp.zendesk.com/logo.png': 'data:image/png;base64,AAAA',
  });
  assert.match(seeded, /<head><base href="https:\/\/cocorepublichelp\.zendesk\.com\/hc\/en-us">/);
  assert.equal((seeded.match(/<base\b/gi) || []).length, 1);
  assert.doesNotMatch(seeded, /<script\b/i);
  assert.match(seeded, /<img src="data:image\/png;base64,AAAA">/);
  assert.match(seeded, /<img src="\/fallback\.png"/);
});

test('HTTP-seeded recovery freezes declared stylesheet assets instead of leaving source URLs', () => {
  const html = '<!doctype html><html><head><link rel="stylesheet" href="//static.zdassets.com/theme.css"><link rel="stylesheet" href="/hc/custom.css"></head><body></body></html>';
  const seeded = prepareSourceHtmlForStaticCapture(html, 'https://cocorepublichelp.zendesk.com/hc/en-us', {
    'https://static.zdassets.com/theme.css': 'data:text/css;base64,QUJD',
    'https://cocorepublichelp.zendesk.com/hc/custom.css': 'data:text/css;base64,REVG',
  });
  assert.match(seeded, /href="data:text\/css;base64,QUJD"/);
  assert.match(seeded, /href="data:text\/css;base64,REVG"/);
  assert.doesNotMatch(seeded, /static\.zdassets\.com\/theme\.css|href="\/hc\/custom\.css"/);
});

test('HTTP-seeded recovery freezes image URLs nested inside an inlined stylesheet', () => {
  const css = '.hero{background-image:url(/hc/theming_assets/background)}';
  const html = '<!doctype html><html><head><link rel="stylesheet" href="/hc/theme.css"></head><body class="hero"></body></html>';
  const seeded = prepareSourceHtmlForStaticCapture(html, 'https://help.example.test/hc/en-us', {
    'https://help.example.test/hc/theme.css': `data:text/css;base64,${Buffer.from(css).toString('base64')}`,
    'https://help.example.test/hc/theming_assets/background': 'data:image/jpeg;base64,SU1BR0U=',
  });
  const encodedCss = seeded.match(/href="data:text\/css;base64,([^"]+)"/)?.[1];
  assert.ok(encodedCss, 'stylesheet should stay inlined');
  const frozenCss = Buffer.from(encodedCss, 'base64').toString('utf8');
  assert.match(frozenCss, /url\(["']?data:image\/jpeg;base64,SU1BR0U=["']?\)/);
  assert.doesNotMatch(frozenCss, /\/hc\/theming_assets\/background/);
});
