import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import * as capture from '../src/import-core/capture/chromium-capture.mjs';
import { stableStateExpression, afterSettleStateExpression, afterTrustedCommerceClickExpression } from '../scripts/lib/capture-state.mjs';

test('capture package exposes a reusable-browser batch API', () => {
  assert.equal(typeof capture.capturePageBatch, 'function');
});

test('persistent capture enables the CDP network domain only once per browser client', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../src/import-core/capture/chromium-capture.mjs', import.meta.url), 'utf8'));
  assert.match(source, /const networkEnabledClients = new WeakSet\(\)/);
  assert.match(source, /async function ensureNetworkEnabled\(client\)/);
  assert.match(source, /maxTotalBufferSize:\s*512 \* 1024 \* 1024/);
  assert.match(source, /maxResourceBufferSize:\s*64 \* 1024 \* 1024/);
  const collectorBody = source.slice(source.indexOf('async function createImageResponseCollector'), source.indexOf('async function settleVisualDocument'));
  assert.match(collectorBody, /await ensureNetworkEnabled\(client\)/);
  assert.doesNotMatch(collectorBody, /client\.send\('Network\.enable'\)/);
});

test('one browser batch can capture desktop and mobile while reusing cached assets', async (t) => {
  let assetRequests = 0;
  const server = http.createServer((request, response) => {
    if (request.url === '/asset.svg') {
      assetRequests += 1;
      response.writeHead(200, {
        'content-type': 'image/svg+xml',
        'cache-control': 'public, max-age=3600, immutable',
      });
      return response.end('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="green"/></svg>');
    }
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><img src="/asset.svg" width="20" height="20" alt="cached">');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/`;
  const widths = [];
  const documents = [];
  const results = await capture.capturePageBatch([
    { url, viewport: { width: 1440, height: 900, mobile: false }, key: 'desktop' },
    { url, viewport: { width: 390, height: 844, mobile: true }, key: 'mobile' },
  ], {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    requestGuard: false,
    allowNetwork: true,
    artifactProfile: 'replay',
    async onResult(result) {
      widths.push(result.screenshot.readUInt32BE(16));
      documents.push(result.renderedDocument.html);
    },
  });
  assert.deepEqual(results.map((result) => result.ok), [true, true]);
  assert.deepEqual(widths, [1440, 390]);
  assert.equal(assetRequests, 1);
  assert.equal(documents.length, 2);
  assert.equal(documents.every((html) => /src="data:image\/svg\+xml;base64,/.test(html)), true);
});

test('captured pages keep visible images after the source server is unavailable', async (t) => {
  const server = http.createServer((request, response) => {
    if (request.url === '/asset.svg') {
      response.writeHead(200, { 'content-type': 'image/svg+xml' });
      return response.end('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="rgb(12,140,64)"/></svg>');
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><html><body><img src="/asset.svg" width="40" height="20" alt="offline asset"></body></html>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });

  const sourceUrl = `http://127.0.0.1:${server.address().port}/`;
  const captured = await capture.capturePage(sourceUrl, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    requestGuard: false,
    allowNetwork: true,
    artifactProfile: 'replay',
  });
  assert.match(captured.renderedDocument.html, /src="data:image\/svg\+xml;base64,/);

  await new Promise((resolve) => server.close(resolve));
  const replay = await capture.captureHtml(captured.renderedDocument.html, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    artifactProfile: 'replay',
  });
  assert.equal(replay.metadata.visualReadiness.failedImages, 0);
  assert.equal(replay.metadata.visualReadiness.pendingImages, 0);
});

test('a broken linked category image can recover from the destination page declared image', async (t) => {
  const server = http.createServer((request, response) => {
    if (request.url === '/replacement.svg') {
      response.writeHead(200, { 'content-type': 'image/svg+xml' });
      return response.end('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="green"/></svg>');
    }
    if (request.url === '/missing.svg') {
      response.writeHead(404, { 'content-type': 'text/plain' });
      return response.end('Not found');
    }
    if (request.url === '/living') {
      response.writeHead(200, { 'content-type': 'text/html' });
      return response.end('<!doctype html><main><h1>New Collection Living</h1><img src="/replacement.svg" alt="New Collection Living"></main>');
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><a href="/living"><img src="/missing.svg" alt="Living" width="120" height="80"><span>Living</span></a>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });

  const result = await capture.capturePage(`http://127.0.0.1:${server.address().port}/`, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    requestGuard: false,
    allowNetwork: true,
    artifactProfile: 'replay',
  });
  assert.equal(result.metadata.visualReadiness.failedImages, 0);
  assert.equal(result.metadata.visualReadiness.linkedPageImageFallbacks, 1);
  assert.match(result.renderedDocument.html, /data-matbox-linked-page-image="http:\/\/127\.0\.0\.1:\d+\/living"/);
});

test('captured pages embed font responses into serialized styles for offline layout fidelity', async (t) => {
  const server = http.createServer((request, response) => {
    if (request.url === '/layout.woff2') {
      response.writeHead(200, { 'content-type': 'font/woff2', 'access-control-allow-origin': '*' });
      return response.end(Buffer.from('fake-font-response-for-freeze-test'));
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<!doctype html><style>
      @font-face { font-family: LayoutFreeze; src: url('/layout.woff2') format('woff2'); }
      body { font-family: LayoutFreeze, sans-serif; }
    </style><main>Layout fidelity</main>`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });

  const captured = await capture.capturePage(`http://127.0.0.1:${server.address().port}/`, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    requestGuard: false,
    allowNetwork: true,
    artifactProfile: 'replay',
  });
  assert.match(captured.renderedDocument.html, /url\(["']?data:font\/woff2;base64,/);
  assert.doesNotMatch(captured.renderedDocument.html, /url\(["']?\/layout\.woff2/);
});

test('capture reports a visible custom font that failed to load', async (t) => {
  const server = http.createServer((request, response) => {
    if (request.url === '/missing-icons.woff') {
      response.writeHead(404, { 'content-type': 'text/plain' });
      return response.end('missing');
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<!doctype html><style>
      @font-face { font-family: BrokenIcons; src: url('/missing-icons.woff') format('woff'); }
      .icon::before { content: '\\e914'; font-family: BrokenIcons; }
    </style><a class="icon" href="/social" aria-label="Social network"></a>`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });

  const captured = await capture.capturePage(`http://127.0.0.1:${server.address().port}/`, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    requestGuard: false,
    allowNetwork: true,
    artifactProfile: 'replay',
  });
  assert.equal(captured.metadata.visualReadiness.failedFonts, 1);
  assert.equal(captured.metadata.visualReadiness.uncapturedFonts, 1);
  assert.match(captured.metadata.visualReadiness.failedFontDetails[0].url, /missing-icons\.woff/);
});

test('capture package freezes the live page, captures the painted frame, then serializes that same frame', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../src/import-core/capture/chromium-capture.mjs', import.meta.url), 'utf8'));
  const liveFreeze = source.indexOf("data-matbox-live-freeze");
  const serialize = source.indexOf('const renderedDocumentEval');
  const screenshot = source.indexOf('const screenshotCapture = await capturePaintedScreenshot');
  assert.ok(liveFreeze > 0 && liveFreeze < screenshot && screenshot < serialize);
});

test('capture package loads eager images before measuring the lazy-scroll range', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../src/import-core/capture/chromium-capture.mjs', import.meta.url), 'utf8'));
  const eagerImages = source.indexOf('const initialImages = Array.from(document.images)');
  const scrollBottom = source.indexOf('const bottom = Math.max');
  assert.ok(eagerImages > 0 && eagerImages < scrollBottom);
});

test('replay capture skips unused analysis artifacts while preserving deliverable artifacts', async () => {
  const result = await capture.captureHtml('<!doctype html><a href="/next">Next</a><button>Buy</button>', {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    artifactProfile: 'replay',
  });
  assert.equal(result.domSnapshot, null);
  assert.equal(result.axTree, null);
  assert.deepEqual(result.componentCandidates, []);
  assert.ok(result.screenshot.length > 0);
  assert.match(result.renderedDocument.html, /Next/);
  assert.equal(result.interactiveElements.length, 2);
  assert.equal(result.links.length, 1);
  assert.ok(result.metadata.captureTimings.navigationMs >= 0);
  assert.ok(result.metadata.captureTimings.settleVisualDocumentMs >= 0);
  assert.ok(result.metadata.captureTimings.renderedDocumentMs >= 0);
  assert.ok(result.metadata.captureTimings.screenshotMs >= 0);
  assert.ok(result.metadata.captureTimings.collectTotalMs >= result.metadata.captureTimings.screenshotMs);
  assert.ok(result.metadata.visualReadiness.phaseTimings.initialImagesMs >= 0);
  assert.ok(result.metadata.visualReadiness.phaseTimings.lazyScrollMs >= 0);
  assert.ok(result.metadata.visualReadiness.phaseTimings.finalImagesMs >= 0);
  assert.ok(result.metadata.visualReadiness.phaseTimings.dynamicMediaMs >= 0);
});

test('one image shares a single load-and-decode deadline across both settle passes', async (t) => {
  const server = http.createServer((request, response) => {
    if (request.url === '/hang.png') return;
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><img id="slow" alt="" width="100" height="100">');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const { port } = server.address();
  const startedAt = Date.now();
  const result = await capture.capturePage(`http://127.0.0.1:${port}/`, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    requestGuard: false,
    allowNetwork: true,
    artifactProfile: 'replay',
    beforeCollectExpression: `document.querySelector('#slow').src = 'http://127.0.0.1:${port}/hang.png'; true`,
  });
  const elapsedMs = Date.now() - startedAt;
  assert.ok(result.metadata.captureTimings.pageNavigateCommandMs >= 0);
  assert.ok(result.metadata.captureTimings.readyStateWaitMs >= 0);
  assert.ok(result.metadata.captureTimings.settleVisualDocumentMs < 8000, JSON.stringify(result.metadata.visualReadiness.phaseTimings));
  assert.ok(elapsedMs < 12000, `elapsedMs=${elapsedMs}`);
});

test('image-heavy pages receive bounded extra settling time without relaxing readiness', async (t) => {
  const server = http.createServer((request, response) => {
    if (request.url === '/slow.svg') {
      return setTimeout(() => {
        response.writeHead(200, { 'content-type': 'image/svg+xml' });
        response.end('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="green"/></svg>');
      }, 10500);
    }
    const pixel = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<!doctype html><main>${Array.from({ length: 119 }, (_, index) => `<img src="${pixel}" width="20" height="20" alt="${index}">`).join('')}<img id="slow-heavy" width="20" height="20" alt="slow"></main>`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const { port } = server.address();
  const result = await capture.capturePage(`http://127.0.0.1:${port}/`, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    requestGuard: false,
    allowNetwork: true,
    artifactProfile: 'replay',
    beforeCollectExpression: `document.querySelector('#slow-heavy').src = 'http://127.0.0.1:${port}/slow.svg'; true`,
  });
  assert.equal(result.metadata.visualReadiness.pendingImages, 0);
  assert.equal(result.metadata.visualReadiness.failedImages, 0);
});

test('hidden zero-layout images do not delay or fail the visible-page baseline', async (t) => {
  const server = http.createServer((request, response) => {
    if (request.url === '/hang.png') return;
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><div style="display:none"><img id="hidden-slow" alt="" width="100" height="100"></div><main>Visible</main>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const { port } = server.address();
  const result = await capture.capturePage(`http://127.0.0.1:${port}/`, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    requestGuard: false,
    allowNetwork: true,
    artifactProfile: 'replay',
    beforeCollectExpression: `document.querySelector('#hidden-slow').src = 'http://127.0.0.1:${port}/hang.png'; true`,
  });
  assert.equal(result.metadata.visualReadiness.pendingImages, 0);
  assert.deepEqual(result.metadata.visualReadiness.pendingImageDetails, []);
  assert.ok(result.metadata.visualReadiness.phaseTimings.initialImagesMs < 1500, JSON.stringify(result.metadata.visualReadiness.phaseTimings));
});

test('visible images that finish with zero natural width are reported as failed', async (t) => {
  const server = http.createServer((request, response) => {
    if (request.url === '/missing.png') {
      response.writeHead(404, { 'content-type': 'image/png' });
      return response.end();
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><img src="/missing.png" alt="Broken product" width="320" height="240">');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const { port } = server.address();
  const result = await capture.capturePage(`http://127.0.0.1:${port}/`, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    requestGuard: false,
    allowNetwork: true,
    artifactProfile: 'replay',
  });
  assert.equal(result.metadata.visualReadiness.pendingImages, 0);
  assert.equal(result.metadata.visualReadiness.failedImages, 1);
  assert.match(result.metadata.visualReadiness.failedImageDetails[0].src, /missing\.png/);
});

test('content inserted shortly after lazy scrolling is serialized into the replay document', async (t) => {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<!doctype html><main style="height:2400px">Top</main><script>
      let scheduled = false;
      addEventListener('scroll', () => {
        if (scheduled || scrollY === 0) return;
        scheduled = true;
        setTimeout(() => {
          const section = document.createElement('section');
          section.id = 'late-section';
          section.textContent = 'Late product specifications';
          document.body.append(section);
        }, 900);
      });
    </script>`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const { port } = server.address();
  const result = await capture.capturePage(`http://127.0.0.1:${port}/`, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    requestGuard: false,
    allowNetwork: true,
    artifactProfile: 'replay',
    beforeCollectExpression: stableStateExpression,
  });
  assert.match(result.renderedDocument.html, /Late product specifications/);
});

test('commerce capture prefetches one load-more batch without changing the initial replay frame', async (t) => {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<!doctype html><html data-matbox-test-expand-commerce><body>
      <div id="searchspring-category"><div class="product-grid"><article class="product-card">Product 1</article></div><button class="ss-load-more">Load More</button></div>
      <script>
        document.querySelector('.ss-load-more').addEventListener('click', () => {
          const grid = document.querySelector('.product-grid');
          const card = document.createElement('article');
          card.className = 'product-card';
          card.textContent = 'Product ' + (grid.children.length + 1);
          grid.append(card);
          if (grid.children.length === 3) document.querySelector('.ss-load-more').remove();
        });
      </script>
    </body></html>`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const { port } = server.address();
  const result = await capture.capturePage(`http://127.0.0.1:${port}/`, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    requestGuard: false,
    allowNetwork: true,
    artifactProfile: 'replay',
    beforeCollectExpression: stableStateExpression,
  });
  assert.equal((result.renderedDocument.html.match(/class="product-card"/g) || []).length, 2);
  assert.match(result.renderedDocument.html, /data-matbox-load-more-item/);
  assert.match(result.renderedDocument.html, /data-matbox-load-more="true"/);
  assert.match(result.renderedDocument.html, /data-matbox-load-more-batch-size="1"/);
});

test('commerce capture records the initial product count after a delayed widget mount', async (t) => {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<!doctype html><html data-matbox-test-expand-commerce><body>
      <main id="commerce-mount"></main><script>
        setTimeout(() => {
          const root = document.createElement('div');
          root.id = 'searchspring-category';
          root.innerHTML = '<div class="product-grid"><article class="product-card" id="initial-product">Product 1</article></div><button class="ss-load-more">Load More</button>';
          document.querySelector('#commerce-mount').append(root);
          root.querySelector('.ss-load-more').addEventListener('click', () => {
            const card = document.createElement('article');
            card.className = 'product-card'; card.id = 'prefetched-product'; card.textContent = 'Product 2';
            root.querySelector('.product-grid').append(card);
          });
        }, 5000);
      </script>
    </body></html>`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const { port } = server.address();
  const result = await capture.capturePage(`http://127.0.0.1:${port}/`, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    requestGuard: false,
    allowNetwork: true,
    artifactProfile: 'replay',
    beforeCollectExpression: stableStateExpression,
  });
  const initialProductTag = result.renderedDocument.html.match(/<article\b[^>]*\bid="initial-product"[^>]*>/)?.[0] || '';
  const prefetchedProductTag = result.renderedDocument.html.match(/<article\b[^>]*\bid="prefetched-product"[^>]*>/)?.[0] || '';
  assert.ok(initialProductTag, 'the initially mounted product must be serialized');
  assert.doesNotMatch(initialProductTag, /\bhidden\b|\bdata-matbox-load-more-item\b/);
  assert.match(prefetchedProductTag, /\bhidden\b/);
  assert.match(prefetchedProductTag, /\bdata-matbox-load-more-item\b/);
});

test('commerce capture waits for the real product batch instead of accepting temporary cards', async (t) => {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<!doctype html><html data-matbox-test-expand-commerce><body>
      <div id="searchspring-category" aria-busy="true">
        <div class="product-grid">${Array.from({ length: 6 }, (_, index) => `<article class="product-card temporary">Temporary ${index}</article>`).join('')}</div>
        <button class="ss-load-more" style="display:none">Load More</button>
      </div><script>
        setTimeout(() => {
          const root = document.querySelector('#searchspring-category');
          root.removeAttribute('aria-busy');
          root.querySelector('.product-grid').innerHTML = Array.from({length:23}, (_, index) => '<article class="product-card">Product ' + index + '</article>').join('');
          const button = root.querySelector('.ss-load-more');
          button.style.display = 'block';
          button.addEventListener('click', () => {
            const card = document.createElement('article');
            card.className = 'product-card'; card.id = 'ready-prefetched'; card.textContent = 'Product 24';
            root.querySelector('.product-grid').append(card);
          });
        }, 2500);
      </script>
    </body></html>`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const { port } = server.address();
  const result = await capture.capturePage(`http://127.0.0.1:${port}/`, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    requestGuard: false,
    allowNetwork: true,
    artifactProfile: 'replay',
    beforeCollectExpression: stableStateExpression,
  });
  const rootTag = result.renderedDocument.html.match(/<div[^>]+id="searchspring-category"[^>]*>/)?.[0] || '';
  assert.match(rootTag, /data-matbox-initial-product-count="23"/);
  assert.match(result.renderedDocument.html, /id="ready-prefetched"[^>]*\bhidden\b/);
  assert.match(result.renderedDocument.html, /data-matbox-load-more="true"/);
});

test('commerce capture can use a trusted browser click when the widget rejects scripted clicks', async (t) => {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<!doctype html><html data-matbox-test-expand-commerce><body>
      <div id="searchspring-category">
        <div class="product-grid"><article class="product-card" id="trusted-initial">Product 1</article></div>
        <button class="ss-load-more">Load More</button>
      </div><script>
        document.querySelector('.ss-load-more').addEventListener('click', (event) => {
          if (!event.isTrusted) return;
          const card = document.createElement('article');
          card.className = 'product-card'; card.id = 'trusted-prefetched'; card.textContent = 'Product 2';
          document.querySelector('.product-grid').append(card);
        });
      </script>
    </body></html>`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const { port } = server.address();
  const result = await capture.capturePage(`http://127.0.0.1:${port}/`, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    requestGuard: false,
    allowNetwork: true,
    artifactProfile: 'replay',
    beforeCollectExpression: stableStateExpression,
    beforeCollectTrustedClickSelector: '#searchspring-category .ss-load-more',
    afterTrustedClickExpression: afterTrustedCommerceClickExpression,
  });
  const initialTag = result.renderedDocument.html.match(/<article\b[^>]*\bid="trusted-initial"[^>]*>/)?.[0] || '';
  const prefetchedTag = result.renderedDocument.html.match(/<article\b[^>]*\bid="trusted-prefetched"[^>]*>/)?.[0] || '';
  assert.doesNotMatch(initialTag, /\bhidden\b|\bdata-matbox-load-more-item\b/);
  assert.match(prefetchedTag, /\bhidden\b/);
  assert.match(prefetchedTag, /\bdata-matbox-load-more-item\b/);
  assert.match(result.renderedDocument.html, /data-matbox-load-more="true"/);
});

test('commerce capture falls back to a DOM click when a page overlay intercepts the trusted click', async (t) => {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<!doctype html><html data-matbox-test-expand-commerce><body>
      <div id="searchspring-category">
        <div class="product-grid"><article class="product-card" id="fallback-initial">Product 1</article></div>
        <button class="ss-load-more">Load More</button>
      </div>
      <div style="position:fixed;inset:0;z-index:9999"></div>
      <script>
        document.querySelector('.ss-load-more').addEventListener('click', (event) => {
          if (event.isTrusted) return;
          const card = document.createElement('article');
          card.className = 'product-card'; card.id = 'fallback-prefetched'; card.textContent = 'Product 2';
          document.querySelector('.product-grid').append(card);
        });
      </script>
    </body></html>`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const { port } = server.address();
  const result = await capture.capturePage(`http://127.0.0.1:${port}/`, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    requestGuard: false,
    allowNetwork: true,
    artifactProfile: 'replay',
    beforeCollectExpression: stableStateExpression,
    beforeCollectTrustedClickSelector: '#searchspring-category .ss-load-more',
    afterTrustedClickExpression: afterTrustedCommerceClickExpression,
  });
  assert.match(result.renderedDocument.html, /id="fallback-prefetched"[^>]*\bhidden\b/);
  assert.match(result.renderedDocument.html, /data-matbox-trusted-click="dom-fallback"/);
  assert.match(result.renderedDocument.html, /data-matbox-load-more="true"/);
});

test('content inserted after the first visual settle is normalized before the screenshot', async (t) => {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<!doctype html><main style="height:2400px">Top</main><script>
      let scheduled = false;
      addEventListener('scroll', () => {
        if (scheduled || scrollY === 0) return;
        scheduled = true;
        setTimeout(() => {
          const section = document.createElement('section');
          section.dataset.reveal = '';
          section.className = 'is-reveal-pending';
          section.textContent = 'Post-settle recommendations';
          document.body.append(section);
        }, 1800);
      });
    </script>`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const { port } = server.address();
  const result = await capture.capturePage(`http://127.0.0.1:${port}/`, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    requestGuard: false,
    allowNetwork: true,
    artifactProfile: 'replay',
    beforeCollectExpression: stableStateExpression,
    afterSettleExpression: afterSettleStateExpression,
  });
  assert.match(result.renderedDocument.html, /Post-settle recommendations/);
  assert.ok(result.metadata.visualReadiness.normalizedRevealItems >= 1);
});

test('resources inserted after the first settle are included in final readiness metadata', async (t) => {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><main>Product</main>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const { port } = server.address();
  const result = await capture.capturePage(`http://127.0.0.1:${port}/`, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    requestGuard: false,
    allowNetwork: true,
    artifactProfile: 'replay',
    afterSettleExpression: `(() => {
      const image = document.createElement('img');
      image.alt = 'inserted after settle';
      image.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>';
      document.body.append(image);
    })()`,
  });
  assert.equal(result.metadata.visualReadiness.imageCount, 1);
  assert.equal(result.metadata.visualReadiness.pendingImages, 0);
});

test('visible CSS background images are part of the visual readiness contract', async () => {
  const background = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlL5KAAAAAASUVORK5CYII=';
  const result = await capture.captureHtml(`<!doctype html><style>html,body{margin:0}.hero{width:400px;height:300px;background-image:url('${background}');background-size:cover}</style><div class="hero"></div>`, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    artifactProfile: 'replay',
  });
  assert.equal(result.metadata.visualReadiness.backgroundImageCount, 1);
  assert.equal(result.metadata.visualReadiness.pendingBackgroundImages, 0);
  assert.equal(result.metadata.visualReadiness.failedBackgroundImages, 0, JSON.stringify(result.metadata.visualReadiness));
});

test('stylesheet shorthand using an inline swatch variable is frozen to its computed color', async (t) => {
  const server = http.createServer((request, response) => {
    if (request.url === '/theme.css') {
      response.writeHead(200, { 'content-type': 'text/css' });
      response.end('.swatch{width:40px;height:40px;background:var(--swatch-background, #d1d5db)}');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><link rel="stylesheet" href="/theme.css"><span id="olive" class="swatch" style="--swatch-background: rgb(138 143 112)"></span>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const { port } = server.address();
  const result = await capture.capturePage(`http://127.0.0.1:${port}/`, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    requestGuard: false,
    allowNetwork: true,
    artifactProfile: 'replay',
  });
  assert.match(result.renderedDocument.html, /id="olive"[^>]*background-color:\s*rgb\(138, 143, 112\)/);
});

test('serialized replay keeps inert script positions so last-child layout selectors stay unchanged', async () => {
  const result = await capture.captureHtml(`<!doctype html><style>.option{margin-bottom:24px}.option:last-child{margin-bottom:0}</style><variant-picker><fieldset class="option">Color</fieldset><script type="application/json">{"variants":[]}</script></variant-picker>`, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    artifactProfile: 'replay',
  });
  assert.match(result.renderedDocument.html, /<fieldset class="option">Color<\/fieldset><script[^>]+type="application\/x-matbox-disabled"[^>]*><\/script>/);
  assert.doesNotMatch(result.renderedDocument.html, /\{"variants":\[\]\}/);
});

test('build sanitizer preserves inert script placeholders needed by structural CSS selectors', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8'));
  assert.match(source, /type === 'application\/x-matbox-disabled'/);
});

test('resources inserted when the page is frozen are included in final readiness metadata', async () => {
  const result = await capture.captureHtml(`<!doctype html><main>Product</main><script>
    new MutationObserver(() => {
      if (!document.querySelector('[data-matbox-live-freeze]') || document.querySelector('#late-freeze-image')) return;
      setTimeout(() => {
        const image = document.createElement('img');
        image.id = 'late-freeze-image';
        image.width = 20;
        image.height = 20;
        image.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>';
        document.body.append(image);
      }, 50);
    }).observe(document.documentElement, { childList: true, subtree: true });
  </script>`, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    artifactProfile: 'replay',
  });
  assert.equal(result.metadata.visualReadiness.imageCount, 1);
  assert.equal(result.metadata.visualReadiness.pendingImages, 0);
  assert.match(result.renderedDocument.html, /late-freeze-image/);
});

test('full-site fidelity audit uses a dynamic persistent browser pool instead of static shards', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../scripts/audit-full-site-fidelity.mjs', import.meta.url), 'utf8'));
  assert.match(source, /capturePagePool\(localEntries/);
  assert.match(source, /workerCount/);
  assert.doesNotMatch(source, /workersPerViewport/);
  assert.doesNotMatch(source, /viewportBatches/);
});

test('rendered golden capture uses supervised bounded scheduling and retries only transient failures', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../scripts/capture-rendered-golden.mjs', import.meta.url), 'utf8'));
  assert.match(source, /runSupervisedCaptureChunks\(/);
  assert.match(source, /selectRepresentativeCanaryJobs\(/);
  assert.doesNotMatch(source, /partitionForWorkers/);
  assert.match(source, /viewportName === 'both'/);
  assert.match(source, /key:\s*jobKey\(route, viewport\)/);
  const canarySource = source.slice(source.indexOf('const initialCanaryCaptures ='), source.indexOf('const canaryRetryCandidates'));
  assert.match(canarySource, /capturePagePool\(canaryJobs, \{ \.\.\.captureOptions\(\)/);
  assert.doesNotMatch(canarySource, /withPersistentBrowserRetry/);
  const supervisedSource = source.slice(source.indexOf('const supervised ='), source.indexOf('const remainingCaptures'));
  assert.match(supervisedSource, /capturePagePool\(chunkJobs, \{ \.\.\.captureOptions\(\)/);
  assert.doesNotMatch(supervisedSource, /withPersistentBrowserRetry/);
  const retrySource = source.slice(source.indexOf('const queueResults'), source.indexOf('for \(const item of queueResults'));
  assert.match(retrySource, /withPersistentBrowserRetry\(captureOptions\(\)\)/);
  assert.match(source, /retryableFailures\.length\s*\?\s*await runPersistentRetryBatches/);
  assert.match(source, /terminalFailures = firstPassFailures\.filter\(isSourceProtectedFailure\)/);
  assert.match(source, /RETRY_WAVE/);
});
