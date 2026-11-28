import test from 'node:test';
import assert from 'node:assert/strict';
import pngjs from 'pngjs';
import { captureHtml } from '../src/import-core/capture/chromium-capture.mjs';

const { PNG } = pngjs;

test('pages within the safe browser limit use one full-page paint to avoid missing offscreen content', async () => {
  const result = await captureHtml(`<!doctype html><style>html,body{margin:0}.band{height:1200px}.a{background:#c00}.b{background:#0c0}.c{background:#00c}.d{background:#cc0}.e{background:#0cc}</style><div class="band a"></div><div class="band b"></div><div class="band c"></div><div class="band d"></div><div class="band e"></div>`, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  });
  const screenshot = PNG.sync.read(result.screenshot);
  assert.equal(result.metadata.visualReadiness.screenshotTileCount, 1);
  assert.equal(screenshot.width, 320);
  assert.equal(screenshot.height, 6000);
});

test('pages beyond the safe browser limit still use coordinate tiles', async () => {
  const result = await captureHtml(`<!doctype html><style>html,body{margin:0}.band{height:4000px}.a{background:#c00}.b{background:#0c0}.c{background:#00c}.d{background:#cc0}.e{background:#0cc}</style><div class="band a"></div><div class="band b"></div><div class="band c"></div><div class="band d"></div><div class="band e"></div>`, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  });
  const screenshot = PNG.sync.read(result.screenshot);
  assert.ok(result.metadata.visualReadiness.screenshotTileCount > 1);
  assert.equal(screenshot.width, 320);
  assert.equal(screenshot.height, 20000);
});

test('capture stops smooth-scroll controllers and returns to the real document origin', async () => {
  const result = await captureHtml(`<!doctype html><style>html,body{margin:0}.band{height:1200px}</style><div class="band"></div><div class="band"></div><script>const nativeScrollTo=window.scrollTo.bind(window);let blocksOrigin=true;window.lenis={stop(){blocksOrigin=false},scrollTo(top){nativeScrollTo(0,top)}};window.scrollTo=(x,y)=>{const top=typeof x==='object'?Number(x.top||0):Number(y||0);if(top===0&&blocksOrigin)return;nativeScrollTo(0,top)};</script>`, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  });
  assert.equal(result.metadata.visualReadiness.finalScrollY, 0);
});

test('shopify section heights are serialized as stable minimum layout constraints', async () => {
  const result = await captureHtml(`<!doctype html><style>html,body{margin:0}.shopify-section{height:321px}</style><section class="shopify-section">Stable section</section>`, {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    timeoutMs: 30000,
    viewport: { width: 320, height: 180, mobile: false },
  });
  assert.equal(result.metadata.visualReadiness.frozenLayoutSections, 1);
  assert.match(result.renderedDocument.html, /min-height:\s*321px\s*!important/);
});
