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

test('a long-page screenshot and serialized replay use one settled DOM state', async () => {
  const html = `<!doctype html><html><head><style>
    html,body{margin:0}.late{height:600px;background:#fff;color:#111;font:36px sans-serif}.tail{height:18000px;background:#eee}
  </style></head><body><section class="late"></section><div class="tail"></div><script>
    new MutationObserver(() => {
      if (!document.querySelector('[data-matbox-live-freeze]') || window.__lateScheduled) return;
      window.__lateScheduled = true;
      setTimeout(() => { document.querySelector('.late').textContent = 'Late stable content'; }, 800);
    }).observe(document.documentElement, { childList: true, subtree: true });
  </script></body></html>`;
  const options = {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  };
  const original = await captureHtml(html, options);
  assert.match(original.renderedDocument.html, /Late stable content/);
  const replay = await captureHtml(original.renderedDocument.html, options);
  assert.ok(screenshotSimilarity(original.screenshot, replay.screenshot) >= 0.995);
});

