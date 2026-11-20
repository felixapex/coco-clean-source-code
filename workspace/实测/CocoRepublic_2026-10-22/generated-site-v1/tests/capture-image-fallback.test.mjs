import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  bigCommerceImageFallbackCandidates,
  captureHtml,
  loadNetworkResourceAsDataUrl,
  loadResourceAsDataUrlWithFallback,
  reconcileVisualReadinessWithCapturedAssets,
  shouldShareResourceAcrossPages,
} from '../../../../交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/src/capture/chromium-capture.mjs';
import pngjs from '../../../../交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/node_modules/pngjs/lib/png.js';

const { PNG } = pngjs;

test('a failed BigCommerce stencil image retries equivalent source sizes without changing the asset identity', () => {
  const source = 'https://cdn11.bigcommerce.com/s-store/images/stencil/2560w/products/27/208/image.jpg?c=1';
  assert.deepEqual(bigCommerceImageFallbackCandidates(source), [
    'https://cdn11.bigcommerce.com/s-store/images/stencil/1280w/products/27/208/image.jpg?c=1',
    'https://cdn11.bigcommerce.com/s-store/images/stencil/768w/products/27/208/image.jpg?c=1',
    'https://cdn11.bigcommerce.com/s-store/images/stencil/original/products/27/208/image.jpg?c=1',
  ]);
  assert.deepEqual(bigCommerceImageFallbackCandidates('https://example.com/image.jpg'), []);
});

test('only public navigation imagery, fonts, and stylesheets enter the cross-page cache', () => {
  assert.equal(shouldShareResourceAcrossPages('https://cdn.test/image-manager/mega-menu-sofa.jpg'), true);
  assert.equal(shouldShareResourceAcrossPages('https://cdn.test/site.woff2', { isFont: true }), true);
  assert.equal(shouldShareResourceAcrossPages('https://cdn.test/theme.css', { isStylesheet: true }), true);
  assert.equal(shouldShareResourceAcrossPages('https://cdn.test/products/chair-123.jpg'), false);
});

test('captured fallback assets clear stale pending and failed readiness records', () => {
  const capturedImage = 'https://cdn.test/image-manager/menu.jpg';
  const capturedBackground = 'https://cdn.test/image-manager/hero.jpg';
  const result = reconcileVisualReadinessWithCapturedAssets({
    pendingImages: 2,
    failedImages: 1,
    pendingImageDetails: [{ src: capturedImage }, { src: 'https://cdn.test/products/missing.jpg' }],
    failedImageDetails: [{ src: capturedImage }],
    pendingBackgroundImages: 1,
    failedBackgroundImages: 1,
    pendingBackgroundImageDetails: [{ source: capturedBackground }],
    failedBackgroundImageDetails: [{ source: capturedBackground }],
  }, [capturedImage, capturedBackground]);
  assert.equal(result.pendingImages, 1);
  assert.equal(result.failedImages, 0);
  assert.equal(result.pendingBackgroundImages, 0);
  assert.equal(result.failedBackgroundImages, 0);
  assert.equal(result.pendingImageDetails[0].src, 'https://cdn.test/products/missing.jpg');
});

test('a drawable image is not reported pending only because its lazy loader still marks it incomplete', async () => {
  const source = await fs.readFile(new URL('../../../../交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/src/capture/chromium-capture.mjs', import.meta.url), 'utf8');
  assert.match(source, /pendingImageNodes\s*=\s*relevantImages\.filter\(\(image\)\s*=>\s*!image\.complete\s*&&\s*image\.naturalWidth\s*<=\s*0\)/);
});

test('a shared image missing from response bodies is loaded directly once and reused from cache', async () => {
  const calls = [];
  const client = {
    async send(method, params) {
      calls.push({ method, params });
      if (method === 'Network.loadNetworkResource') {
        return {
          resource: {
            success: true,
            httpStatusCode: 200,
            headers: { 'content-type': 'image/png' },
            stream: 'stream-1',
          },
        };
      }
      if (method === 'IO.read') return { data: 'AQID', base64Encoded: true, eof: true };
      if (method === 'IO.close') return {};
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  };
  const cache = new Map();
  const url = 'https://cdn.test/shared-navigation.png';
  const first = await loadNetworkResourceAsDataUrl(client, url, cache);
  const second = await loadNetworkResourceAsDataUrl(client, url, cache);
  assert.equal(first, 'data:image/png;base64,AQID');
  assert.equal(second, first);
  assert.equal(calls.filter((entry) => entry.method === 'Network.loadNetworkResource').length, 1);
  assert.equal(calls.filter((entry) => entry.method === 'IO.read').length, 1);
});

test('a directly loaded resource is reused from disk after the memory cache is replaced', async (t) => {
  const os = await import('node:os');
  const path = await import('node:path');
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-resource-cache-integration-'));
  const previousDir = process.env.MATBOX_PERSISTENT_RESOURCE_CACHE_DIR;
  process.env.MATBOX_PERSISTENT_RESOURCE_CACHE_DIR = cacheDir;
  t.after(async () => {
    if (previousDir === undefined) delete process.env.MATBOX_PERSISTENT_RESOURCE_CACHE_DIR;
    else process.env.MATBOX_PERSISTENT_RESOURCE_CACHE_DIR = previousDir;
    await fs.rm(cacheDir, { recursive: true, force: true });
  });
  const url = 'https://cdn.test/persisted-navigation.png';
  const firstClient = {
    async send(method) {
      if (method === 'Network.loadNetworkResource') return { resource: { success: true, httpStatusCode: 200, headers: { 'content-type': 'image/png' }, stream: 'stream-1' } };
      if (method === 'IO.read') return { data: 'AQID', base64Encoded: true, eof: true };
      if (method === 'IO.close') return {};
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  };
  const expected = await loadNetworkResourceAsDataUrl(firstClient, url, new Map());
  const secondClient = { async send() { throw new Error('network must not be used'); } };
  assert.equal(await loadNetworkResourceAsDataUrl(secondClient, url, new Map()), expected);
});

test('a font missing from response bodies can be loaded directly as a font data URL', async () => {
  const client = {
    async send(method) {
      if (method === 'Network.loadNetworkResource') {
        return {
          resource: {
            success: true,
            httpStatusCode: 200,
            headers: { 'content-type': 'font/woff2' },
            stream: 'font-stream',
          },
        };
      }
      if (method === 'IO.read') return { data: 'Rk9OVA==', base64Encoded: true, eof: true };
      if (method === 'IO.close') return {};
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  };
  const result = await loadNetworkResourceAsDataUrl(client, 'https://cdn.test/site.woff2', new Map());
  assert.equal(result, 'data:font/woff2;base64,Rk9OVA==');
});

test('a cached font falls back to the page network context when CDP direct loading has no stream', async () => {
  const methods = [];
  const client = {
    async send(method) {
      methods.push(method);
      if (method === 'Network.loadNetworkResource') {
        return { resource: { success: true, httpStatusCode: 200 } };
      }
      if (method === 'Runtime.evaluate') {
        return { result: { value: { ok: true, mimeType: 'font/woff2', base64: 'Rk9OVA==' } } };
      }
      throw new Error(`Unexpected CDP method: ${method}`);
    },
  };
  const result = await loadResourceAsDataUrlWithFallback(client, 'https://fonts.test/cached.woff2', new Map());
  assert.equal(result, 'data:font/woff2;base64,Rk9OVA==');
  assert.deepEqual(methods, ['Network.loadNetworkResource', 'Runtime.evaluate']);
});

test('cached stylesheet requests use the same page-context resource fallback before capture validation', async () => {
  const source = await fs.readFile(new URL('../../../../交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/src/capture/chromium-capture.mjs', import.meta.url), 'utf8');
  assert.match(source, /\[\.\.\.requests\.values\(\)\][\s\S]*loadResourceAsDataUrlWithFallback/);
  assert.match(source, /capturedStylesheets\.add\(canonicalStylesheetUrl\(alias\)\)/);
  assert.match(source, /storeResourceDataUrl\(sharedImageResourceCache, response\.url, dataUrl\)/);
  assert.match(source, /shouldShareResourceAcrossPages\(response\.url/);
});

function screenshotSimilarity(leftBuffer, rightBuffer) {
  const left = PNG.sync.read(leftBuffer);
  const right = PNG.sync.read(rightBuffer);
  assert.deepEqual([right.width, right.height], [left.width, left.height]);
  let squaredError = 0;
  for (let index = 0; index < left.data.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = left.data[index + channel] - right.data[index + channel];
      squaredError += delta * delta;
    }
  }
  return 1 - Math.sqrt(squaredError / (left.width * left.height * 3)) / 255;
}

function countLightPixelsInFrozenImage(html) {
  const match = html.match(/<img[^>]*src="data:image\/png;base64,([^"]+)"[^>]*data-matbox-browser-frozen-image="true"/);
  assert.ok(match, 'expected a browser-frozen image data URL');
  const image = PNG.sync.read(Buffer.from(match[1], 'base64'));
  let count = 0;
  for (let y = 40; y < Math.min(100, image.height); y += 1) {
    for (let x = 10; x < Math.min(310, image.width); x += 1) {
      const offset = (y * image.width + x) * 4;
      if (image.data[offset] > 235 && image.data[offset + 1] > 235 && image.data[offset + 2] > 235) count += 1;
    }
  }
  return count;
}

test('a displayed image without a captured response body is frozen for offline replay', async () => {
  const html = `<!doctype html><html><head><style>html,body{margin:0}.hero{position:relative;width:320px;height:180px}.hero img{display:block;width:320px;height:180px;object-fit:cover}.copy{position:absolute;z-index:2;pointer-events:none;inset:45px 20px auto;color:white;font:700 32px/1 Arial}</style></head><body><div class="hero"><img alt="generated"><div class="copy">ONE VISIBLE TITLE</div></div><script>
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
    const context = canvas.getContext('2d'); const gradient = context.createLinearGradient(0,0,320,180);
    gradient.addColorStop(0,'#102850'); gradient.addColorStop(1,'#e6b428'); context.fillStyle=gradient; context.fillRect(0,0,320,180);
    canvas.toBlob((blob) => { document.querySelector('img').src = URL.createObjectURL(blob); });
  </script></body></html>`;
  const options = {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  };
  const original = await captureHtml(html, options);
  assert.equal(original.metadata.visualReadiness.browserFrozenUncapturedImages, 1);
  assert.match(original.renderedDocument.html, /data-matbox-browser-frozen-image="true"/);
  assert.match(original.renderedDocument.html, /data-matbox-browser-rasterized-image="true"/);
  assert.doesNotMatch(original.renderedDocument.html, /src="blob:/);
  assert.ok(countLightPixelsInFrozenImage(original.renderedDocument.html) < 10, 'overlay text must not be baked into the frozen image');
  const replay = await captureHtml(original.renderedDocument.html, options);
  assert.ok(screenshotSimilarity(original.screenshot, replay.screenshot) >= 0.99);
});

test('a frozen responsive picture cannot restore its remote source during serialization', async () => {
  const html = `<!doctype html><html><head><style>html,body{margin:0}img{display:block;width:320px;height:180px;object-fit:cover}</style></head><body><picture><source><img alt="responsive"></picture><script>
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
    const context = canvas.getContext('2d'); context.fillStyle='#315b44'; context.fillRect(0,0,320,180);
    canvas.toBlob((blob) => { const url=URL.createObjectURL(blob); document.querySelector('source').srcset=url; document.querySelector('img').src=url; });
  </script></body></html>`;
  const options = {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  };
  const original = await captureHtml(html, options);
  assert.match(original.renderedDocument.html, /data-matbox-browser-frozen-image="true"/);
  assert.match(original.renderedDocument.html, /data-matbox-browser-rasterized-image="true"/);
  assert.doesNotMatch(original.renderedDocument.html, /(?:src|srcset)="blob:/);
  const replay = await captureHtml(original.renderedDocument.html, options);
  assert.ok(screenshotSimilarity(original.screenshot, replay.screenshot) >= 0.99);
});

test('a frozen image drops active lazy-loading attributes that could restore the source website URL', async () => {
  const html = `<!doctype html><html data-matbox-source-client-width="64"><head><style>html,body{margin:0}img{display:block;width:32px;height:32px}</style></head><body>
    <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="
      data-src="https://source.example/lazy.jpg"
      data-lazy-src="https://source.example/second.jpg"
      data-original="https://source.example/original.jpg"
      data-srcset="https://source.example/double.jpg 2x"
      data-lazy-srcset="https://source.example/triple.jpg 3x">
  </body></html>`;
  const result = await captureHtml(html, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 64, height: 64, mobile: false },
  });
  assert.doesNotMatch(result.renderedDocument.html, /\bdata-(?:src|lazy-src|original|srcset|lazy-srcset)=/i);
  assert.match(result.renderedDocument.html, /src="data:image\/gif;base64,/i);
});

test('critical navigation imagery fails closed instead of baking surrounding page UI into the image', async () => {
  const html = `<!doctype html><html><head><style>html,body{margin:0}.mega-menu{width:320px;height:180px}.mega-menu img{display:block;width:320px;height:180px;object-fit:cover}</style></head><body><nav class="mega-menu"><img alt="navigation feature"></nav><script>
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
    const context = canvas.getContext('2d'); context.fillStyle='#315b44'; context.fillRect(0,0,320,180);
    canvas.toBlob((blob) => { document.querySelector('img').src = URL.createObjectURL(blob); });
    HTMLCanvasElement.prototype.toDataURL = () => { throw new DOMException('Synthetic tainted canvas', 'SecurityError'); };
  </script></body></html>`;
  const options = {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  };
  await assert.rejects(
    () => captureHtml(html, options),
    /critical image capture failed/i,
  );
});

test('a screenshot-frozen image preserves its source intrinsic sizing for wider responsive replays', async () => {
  const html = `<!doctype html><html><head><style>
    html,body{margin:0}.cards{display:flex;flex-wrap:wrap;gap:0}.card{max-width:50%;overflow:hidden}.card img{display:block;max-width:100%;height:auto}
  </style></head><body><div class="cards"><div class="card"><img alt="responsive"></div><div class="card"><img alt="responsive two"></div></div><script>
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 400;
    const context = canvas.getContext('2d'); context.fillStyle='#315b44'; context.fillRect(0,0,800,400);
    canvas.toBlob((blob) => {
      const source = URL.createObjectURL(blob); document.querySelectorAll('img').forEach((image) => { image.src = source; });
      HTMLCanvasElement.prototype.toDataURL = () => { throw new DOMException('Synthetic tainted canvas', 'SecurityError'); };
    });
  </script></body></html>`;
  const baseOptions = {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 240, mobile: false },
  };
  const source = await captureHtml(html, baseOptions);
  assert.match(source.renderedDocument.html, /data-matbox-browser-screenshot-image="true"/);
  assert.match(source.renderedDocument.html, /data-matbox-original-natural-width="800"/);
  assert.match(source.renderedDocument.html, /data-matbox-original-natural-height="400"/);
  assert.match(source.renderedDocument.html, /\bwidth="800"/);
  assert.match(source.renderedDocument.html, /\bheight="400"/);

  const replay = await captureHtml(source.renderedDocument.html, {
    ...baseOptions,
    viewport: { width: 640, height: 480, mobile: false },
  });
  assert.match(replay.renderedDocument.html, /class="card"[^>]*>[\s\S]*?<img[^>]+width="800"/);
});

test('captured images carry intrinsic, rendered, container, fit, position, and viewport evidence', async () => {
  const html = `<!doctype html><html><head><style>
    html,body{margin:0}.frame{width:200px;height:120px;overflow:hidden}.frame img{display:block;width:160px;height:90px;object-fit:cover;object-position:25% 75%}
  </style></head><body><div class="frame"><img width="80" height="40" alt="measured" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='40'%3E%3Crect width='80' height='40' fill='navy'/%3E%3C/svg%3E"></div></body></html>`;
  const capture = await captureHtml(html, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 240, mobile: false },
  });

  const imageTag = capture.renderedDocument.html.match(/<img\b[^>]*alt="measured"[^>]*>/i)?.[0] || '';
  assert.match(imageTag, /data-matbox-image-intrinsic-width="80"/);
  assert.match(imageTag, /data-matbox-image-intrinsic-height="40"/);
  assert.match(imageTag, /data-matbox-image-rendered-width="160"/);
  assert.match(imageTag, /data-matbox-image-rendered-height="90"/);
  assert.match(imageTag, /data-matbox-image-container-width="200"/);
  assert.match(imageTag, /data-matbox-image-container-height="120"/);
  assert.match(imageTag, /data-matbox-image-visible="true"/);
  assert.match(imageTag, /data-matbox-image-object-fit="cover"/);
  assert.match(imageTag, /data-matbox-image-object-position="25% 75%"/);
  assert.match(imageTag, /data-matbox-image-viewport="mobile"/);
  assert.match(imageTag, /data-matbox-image-viewport-width="320"/);
  assert.match(imageTag, /data-matbox-image-viewport-height="240"/);
});

test('captured component roots carry measured layout and viewport evidence', async () => {
  const html = `<!doctype html><html><head><style>
    html,body{margin:0}main{width:320px;height:240px}.hero{display:grid;grid-template-columns:120px 180px;gap:20px;width:320px;height:120px;align-items:center}.nested-component{width:240px;height:60px}.modal{display:none;width:180px;height:80px}
  </style></head><body><main><section class="hero"><span>A</span><span>B</span></section><div class="wrapper"><div id="cococlub-form-wrap" class="nested-component">Form</div></div></main><div id="modal" class="modal" data-reveal>Modal</div></body></html>`;
  const capture = await captureHtml(html, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 240, mobile: false },
  });
  const tag = capture.renderedDocument.html.match(/<section\b[^>]*class="hero"[^>]*>/i)?.[0] || '';
  assert.match(tag, /data-matbox-component-width="320"/);
  assert.match(tag, /data-matbox-component-height="120"/);
  assert.match(tag, /data-matbox-component-parent-width="320"/);
  assert.match(tag, /data-matbox-component-display="grid"/);
  assert.match(tag, /data-matbox-component-grid-columns="120px 180px"/);
  assert.match(tag, /data-matbox-component-gap="20px"/);
  assert.match(tag, /data-matbox-component-align-items="center"/);
  assert.match(tag, /data-matbox-component-viewport="mobile"/);
  const nested = capture.renderedDocument.html.match(/<div\b[^>]*id="cococlub-form-wrap"[^>]*>/i)?.[0] || '';
  assert.match(nested, /data-matbox-component-width="240"/);
  assert.match(nested, /data-matbox-component-height="60"/);
  const modal = capture.renderedDocument.html.match(/<div\b[^>]*id="modal"[^>]*>/i)?.[0] || '';
  assert.match(modal, /data-matbox-component-width="0"/);
  assert.match(modal, /data-matbox-component-height="0"/);
  assert.match(modal, /data-matbox-component-visible="false"/);
});
