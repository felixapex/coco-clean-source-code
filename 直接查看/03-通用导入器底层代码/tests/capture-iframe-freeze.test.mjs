import test from 'node:test';
import assert from 'node:assert/strict';
import { captureHtml } from '../src/import-core/capture/chromium-capture.mjs';
import pngjs from 'pngjs';

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

test('a visible embedded frame is frozen from browser paint for offline replay', async () => {
  const embedded = '<!doctype html><style>html,body{margin:0;width:100%;height:100%;background:linear-gradient(135deg,#102850,#e6b428)}</style>';
  const html = `<!doctype html><html><head><style>html,body{margin:0}.hero{width:320px;height:180px}.hero iframe{display:block;width:100%;height:100%;border:0}</style></head><body><div class="hero"><iframe title="film" srcdoc="${embedded.replaceAll('"', '&quot;')}"></iframe></div></body></html>`;
  const options = {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  };
  const original = await captureHtml(html, options);
  assert.equal(original.metadata.visualReadiness.browserFrozenIframes, 1);
  assert.match(original.renderedDocument.html, /<img[^>]+data-matbox-frozen-iframe="true"/);
  assert.match(original.renderedDocument.html, /src="data:image\/png;base64,/);
  assert.doesNotMatch(original.renderedDocument.html, /<iframe\b/);
  const replay = await captureHtml(original.renderedDocument.html, options);
  assert.ok(screenshotSimilarity(original.screenshot, replay.screenshot) >= 0.99);
});

test('a fixed bottom-right frame remains anchored to the right at a wider replay viewport', async () => {
  const html = `<!doctype html><html><body style="margin:0"><iframe title="chat" srcdoc="<body style='margin:0;background:black'></body>" style="position:fixed;right:16px;bottom:16px;width:48px;height:48px;border:0"></iframe></body></html>`;
  const options = {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  };
  const original = await captureHtml(html, options);
  const replay = await captureHtml(original.renderedDocument.html, {
    ...options,
    viewport: { width: 640, height: 360, mobile: false },
    afterSettleExpression: `(() => {
      const image = document.querySelector('[data-matbox-frozen-iframe="true"]');
      const rect = image.getBoundingClientRect();
      document.documentElement.setAttribute('data-fixed-frame-right', String(Math.round(innerWidth - rect.right)));
      document.documentElement.setAttribute('data-fixed-frame-bottom', String(Math.round(innerHeight - rect.bottom)));
      return true;
    })()`,
  });
  assert.match(replay.renderedDocument.html, /data-fixed-frame-right="16"/);
  assert.match(replay.renderedDocument.html, /data-fixed-frame-bottom="16"/);
});
