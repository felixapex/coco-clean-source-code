import test from 'node:test';
import assert from 'node:assert/strict';
import { captureHtml } from '../../../../交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/src/capture/chromium-capture.mjs';
import pngjs from '../../../../交付文件/拆网站_V2.9_联调可执行修正版_2026-09-09/PACKAGE/08_POC_SOURCE_PATCHED/node_modules/pngjs/lib/png.js';

const { PNG } = pngjs;

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

function frozenVideoPng(html) {
  const tag = html.match(/<img[^>]*data-matbox-frozen-video="true"[^>]*>/)?.[0];
  assert.ok(tag, 'expected a browser-frozen video image');
  const source = tag.match(/src="data:image\/png;base64,([^"]+)"/)?.[1];
  assert.ok(source, 'expected an inline frozen video frame');
  return PNG.sync.read(Buffer.from(source, 'base64'));
}

function countBrightPixels(image, { x1 = 0, y1 = 0, x2 = image.width, y2 = image.height } = {}) {
  let count = 0;
  for (let y = y1; y < Math.min(y2, image.height); y += 1) {
    for (let x = x1; x < Math.min(x2, image.width); x += 1) {
      const offset = (y * image.width + x) * 4;
      if (image.data[offset] > 235 && image.data[offset + 1] > 235 && image.data[offset + 2] > 235) count += 1;
    }
  }
  return count;
}

test('an unloaded video poster is rasterized before it is labeled as a frozen frame', async () => {
  const poster = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="64" height="32" fill="rgb(12,34,56)"/></svg>');
  const result = await captureHtml(`<!doctype html><html><body style="margin:0"><video class="hero__video" width="64" height="32" poster="${poster}"></video></body></html>`, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
  });
  assert.equal(result.metadata.visualReadiness.frozenDynamicMedia, 1);
  assert.equal(result.metadata.visualReadiness.decodedDynamicMedia, 1);
  assert.match(result.renderedDocument.html, /<img[^>]+data-matbox-frozen-video="true"/);
  assert.match(result.renderedDocument.html, /src="data:image\/png;base64,/);
  assert.doesNotMatch(result.renderedDocument.html, /<video\b/);
  assert.doesNotMatch(result.renderedDocument.html, /data:image\/svg\+xml/);
});

test('a visible video without a readable frame is frozen from the browser paint', async () => {
  const html = `<!doctype html><html><head><style>
    html,body{margin:0}.frame{width:320px;height:180px;background:white}
    video{display:block;width:320px;height:180px;background:linear-gradient(135deg,rgb(20,40,80),rgb(230,180,40))}
  </style></head><body><div class="frame"><video autoplay muted></video></div></body></html>`;
  const options = {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  };
  const original = await captureHtml(html, options);
  assert.ok(original.metadata.visualReadiness.browserFrozenVideos >= 1, JSON.stringify({
    browserFrozenVideos: original.metadata.visualReadiness.browserFrozenVideos,
    frozenDynamicMedia: original.metadata.visualReadiness.frozenDynamicMedia,
    timings: original.metadata.captureTimings,
    hasVideo: /<video\b/.test(original.renderedDocument.html),
    hasFrozenImage: /data-matbox-frozen-video="true"/.test(original.renderedDocument.html),
  }));
  assert.match(original.renderedDocument.html, /<img[^>]+data-matbox-frozen-video="true"/);
  assert.match(original.renderedDocument.html, /src="data:image\/png;base64,/);
  assert.doesNotMatch(original.renderedDocument.html, /<video\b/);
  const replay = await captureHtml(original.renderedDocument.html, options);
  assert.ok(screenshotSimilarity(original.screenshot, replay.screenshot) >= 0.99);
});

test('a browser-painted video frame excludes overlapping live copy', async () => {
  const html = `<!doctype html><html><head><style>
    html,body{margin:0}.hero{position:relative;width:320px;height:180px;overflow:hidden}
    video{display:block;width:100%;height:100%;background:rgb(20,40,80)}
    .copy{position:absolute;z-index:2;inset:55px 10px auto;color:white;font:700 30px/1 Arial}
  </style></head><body><div class="hero"><video autoplay muted></video><div class="copy">ONE LIVE TITLE</div></div></body></html>`;
  const options = {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  };
  const original = await captureHtml(html, options);
  const frozen = frozenVideoPng(original.renderedDocument.html);
  assert.ok(countBrightPixels(frozen, { x1: 5, y1: 45, x2: 315, y2: 105 }) < 10, 'live overlay copy must not be baked into the frozen video frame');
  const replay = await captureHtml(original.renderedDocument.html, options);
  const similarity = screenshotSimilarity(original.screenshot, replay.screenshot);
  assert.ok(similarity >= 0.97, `expected source/replay similarity >= 0.97, got ${similarity}`);
});

test('a full-bleed frozen video remains full width when replayed in a wider viewport', async () => {
  const html = `<!doctype html><html><head><style>
    html,body{margin:0}.hero{position:relative;width:100%;height:180px;overflow:hidden}
    video{display:block;width:100%;height:100%;object-fit:cover;background:linear-gradient(90deg,#142850,#e6b428)}
  </style></head><body><div class="hero"><video autoplay muted></video></div></body></html>`;
  const baseOptions = {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  };
  const original = await captureHtml(html, baseOptions);
  const replay = await captureHtml(original.renderedDocument.html, {
    ...baseOptions,
    viewport: { width: 640, height: 180, mobile: false },
    afterSettleExpression: `(() => { const image = document.querySelector('[data-matbox-frozen-video="true"]'); document.documentElement.setAttribute('data-test-frozen-width', String(Math.round(image.getBoundingClientRect().width))); return true; })()`,
  });
  assert.match(replay.renderedDocument.html, /data-test-frozen-width="640"/);
});

test('a final UI cleanup runs after delayed widgets mount and before screenshot serialization', async () => {
  const html = `<!doctype html><html><head><style>
    html,body{margin:0;background:rgb(15,25,35)}
    #late-popup{display:none;position:fixed;inset:0;background:white;z-index:9999}
  </style></head><body><main>Storefront</main><div id="late-popup">LATE POPUP</div></body></html>`;
  const result = await captureHtml(html, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
    afterSettleExpression: `(() => {
      setTimeout(() => {
        const popup = document.querySelector('#late-popup');
        popup.style.display = 'block';
        popup.setAttribute('data-mounted-late', 'true');
      }, 25);
      return true;
    })()`,
    beforeSnapshotExpression: `(() => {
      const popup = document.querySelector('#late-popup');
      popup.style.setProperty('display', 'none', 'important');
      popup.setAttribute('data-final-cleanup', 'true');
      return true;
    })()`,
  });
  assert.match(result.renderedDocument.html, /data-mounted-late="true"/);
  assert.match(result.renderedDocument.html, /data-final-cleanup="true"/);
  assert.match(result.renderedDocument.html, /display:\s*none\s*!important/i);
  const screenshot = PNG.sync.read(result.screenshot);
  const center = (90 * screenshot.width + 160) * 4;
  assert.ok(screenshot.data[center] < 80 && screenshot.data[center + 1] < 80 && screenshot.data[center + 2] < 80, 'late popup must be gone from the final screenshot');
});

test('a video canvas that decodes as a flat white frame falls back to the browser paint', async () => {
  const html = `<!doctype html><html><head><style>
    html,body{margin:0}.frame{width:320px;height:180px;background:white}
    video{display:block;width:320px;height:180px;background:linear-gradient(135deg,rgb(20,40,80),rgb(230,180,40))}
  </style></head><body><div class="frame"><video autoplay muted></video></div><script>
    const video = document.querySelector('video');
    Object.defineProperty(video, 'videoWidth', { get: () => 320 });
    Object.defineProperty(video, 'videoHeight', { get: () => 180 });
    const nativeDrawImage = CanvasRenderingContext2D.prototype.drawImage;
    CanvasRenderingContext2D.prototype.drawImage = function(source, ...args) {
      if (source instanceof HTMLVideoElement) {
        this.fillStyle = 'rgb(255,255,255)';
        this.fillRect(0, 0, 320, 180);
        return;
      }
      return nativeDrawImage.call(this, source, ...args);
    };
  </script></body></html>`;
  const options = {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  };
  const original = await captureHtml(html, options);
  assert.ok(original.metadata.visualReadiness.browserFrozenVideos >= 1, JSON.stringify({
    browserFrozenVideos: original.metadata.visualReadiness.browserFrozenVideos,
    frozenDynamicMedia: original.metadata.visualReadiness.frozenDynamicMedia,
    timings: original.metadata.captureTimings,
    hasVideo: /<video\b/.test(original.renderedDocument.html),
    hasFrozenImage: /data-matbox-frozen-video="true"/.test(original.renderedDocument.html),
  }));
  assert.equal(original.metadata.captureTimings.postBrowserVideoFreezeSettleMs, undefined);
  assert.ok(original.metadata.captureTimings.postBrowserVideoFreezePaintMs < 1000);
  assert.ok(original.metadata.captureTimings.postFreezeQuiescenceWaitMs >= 900);
  assert.ok(original.metadata.captureTimings.postFreezeResourceSettleMs < 1500);
  const replay = await captureHtml(original.renderedDocument.html, options);
  assert.ok(screenshotSimilarity(original.screenshot, replay.screenshot) >= 0.99);
  const screenshot = PNG.sync.read(replay.screenshot);
  const left = (90 * screenshot.width + 40) * 4;
  const right = (90 * screenshot.width + 280) * 4;
  assert.ok(Math.abs(screenshot.data[left] - screenshot.data[right]) >= 40, 'expected the painted gradient instead of a flat white frame');
});

test('an inline browser-frozen video preserves the following content offset on replay', async () => {
  const html = `<!doctype html><html><head><style>
    html,body{margin:0;font-size:14px;line-height:19.6px}.hero{width:319px}.hero video{display:inline-block;width:100%;height:auto;aspect-ratio:16/9;background:linear-gradient(90deg,#123,#ed8)}
    .after{height:120px;background:#efe9df}
  </style></head><body><div class="hero"><video width="100%" autoplay muted></video></div><div class="after">After</div></body></html>`;
  const options = {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 360, mobile: false },
  };
  const original = await captureHtml(html, options);
  assert.match(original.renderedDocument.html, /vertical-align:\s*top/);
  const replay = await captureHtml(original.renderedDocument.html, options);
  const originalPng = PNG.sync.read(original.screenshot);
  const replayPng = PNG.sync.read(replay.screenshot);
  assert.deepEqual([replayPng.width, replayPng.height], [originalPng.width, originalPng.height]);
  assert.ok(screenshotSimilarity(original.screenshot, replay.screenshot) >= 0.999);
});

test('an already frozen video replays its saved poster instead of sampling a new frame', async () => {
  const poster = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="rgb(10,180,30)"/></svg>');
  const html = `<!doctype html><html><head><style>html,body{margin:0}video{display:block;width:160px;height:90px}</style></head><body>
    <video width="100%" data-matbox-frozen-video="true" poster="${poster}"></video>
    <script>
      const video = document.querySelector('video');
      Object.defineProperty(video, 'videoWidth', { get: () => 160 });
      Object.defineProperty(video, 'videoHeight', { get: () => 90 });
      const nativeDrawImage = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function(source, ...args) {
        if (source instanceof HTMLVideoElement) {
          this.fillStyle = 'rgb(220,20,20)';
          this.fillRect(0, 0, 160, 90);
          return;
        }
        return nativeDrawImage.call(this, source, ...args);
      };
    </script>
  </body></html>`;
  const result = await captureHtml(html, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 160, height: 90, mobile: false },
  });
  const screenshot = PNG.sync.read(result.screenshot);
  const offset = (45 * screenshot.width + 80) * 4;
  assert.ok(screenshot.data[offset + 1] > 140, `expected saved green poster, got rgb(${screenshot.data[offset]},${screenshot.data[offset + 1]},${screenshot.data[offset + 2]})`);
  assert.ok(screenshot.data[offset] < 80, `expected saved green poster, got rgb(${screenshot.data[offset]},${screenshot.data[offset + 1]},${screenshot.data[offset + 2]})`);
});

test('a frozen video survives an HTML replay without losing video-specific layout', async () => {
  const poster = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="rgb(12,34,56)"/><circle cx="120" cy="45" r="25" fill="rgb(230,180,40)"/></svg>');
  const html = `<!doctype html><html><head><style>
    html,body{margin:0;background:white} .frame{width:320px;height:180px;background:red;overflow:hidden}
    .frame>video{display:block;width:100%;height:100%;object-fit:cover;border:20px solid rgb(20,160,80);box-sizing:border-box}
  </style></head><body><div class="frame"><video poster="${poster}"></video></div></body></html>`;
  const options = {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  };
  const original = await captureHtml(html, options);
  const replay = await captureHtml(original.renderedDocument.html, options);
  assert.ok(screenshotSimilarity(original.screenshot, replay.screenshot) >= 0.99);
});

test('an offscreen frozen video is painted identically in tiled source and replay screenshots', async () => {
  const poster = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="rgb(240,220,180)"/><ellipse cx="80" cy="45" rx="55" ry="25" fill="rgb(80,40,20)"/></svg>');
  const html = `<!doctype html><html><head><style>html,body{margin:0}.spacer{height:3600px}.frame{width:320px;height:180px}.frame>video{display:block;width:100%;height:100%;object-fit:cover}</style></head><body><div class="spacer"></div><div class="frame"><video poster="${poster}"></video></div><div class="spacer"></div></body></html>`;
  const options = {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  };
  const original = await captureHtml(html, options);
  const replay = await captureHtml(original.renderedDocument.html, options);
  assert.ok(screenshotSimilarity(original.screenshot, replay.screenshot) >= 0.99);
});
