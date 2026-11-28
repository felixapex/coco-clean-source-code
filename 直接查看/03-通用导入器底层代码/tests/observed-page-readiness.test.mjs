import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import {
  createObservedPageReadinessMonitor,
} from '../src/import-core/capture/observed-page-readiness.mjs';
import * as captureModule from '../src/import-core/capture/chromium-capture.mjs';

const { captureHtml } = captureModule;

class FakeClient {
  listeners = new Map();

  async send(method) {
    if (method === 'Network.enable') return {};
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main-frame' } } };
    assert.fail(`Unexpected CDP method: ${method}`);
  }

  onEvent(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
    return () => this.listeners.set(method, listeners.filter((item) => item !== listener));
  }

  emit(method, params) {
    for (const listener of this.listeners.get(method) || []) listener(params);
  }
}

test('observed readiness waits for real requests and the last content change, not a fixed delay', async () => {
  const client = new FakeClient();
  let now = 0;
  const monitor = await createObservedPageReadinessMonitor(client, { now: () => now });
  client.emit('Network.requestWillBeSent', {
    requestId: 'products',
    type: 'Fetch',
    request: { url: 'https://example.test/products.json' },
  });

  const result = await monitor.waitForStable({
    quietWindowMs: 500,
    maxWaitMs: 3000,
    pollIntervalMs: 100,
    sample: async () => ({
      signature: now < 400 ? 'height=1000|buttons=4' : 'height=1600|buttons=9',
      ready: true,
    }),
    sleep: async (ms) => {
      now += ms;
      if (now === 300) client.emit('Network.loadingFinished', { requestId: 'products' });
    },
  });

  assert.equal(result.reason, 'observed-stable');
  assert.equal(result.waitedMs, 900);
  assert.equal(result.pendingRelevantRequests, 0);
  monitor.close();
});

test('observed readiness ignores long-lived transport that cannot define page completion', async () => {
  const client = new FakeClient();
  let now = 0;
  const monitor = await createObservedPageReadinessMonitor(client, { now: () => now });
  client.emit('Network.requestWillBeSent', {
    requestId: 'socket',
    type: 'WebSocket',
    request: { url: 'wss://example.test/live' },
  });

  const result = await monitor.waitForStable({
    quietWindowMs: 500,
    maxWaitMs: 1500,
    pollIntervalMs: 100,
    sample: async () => ({ signature: 'stable-page', ready: true }),
    sleep: async (ms) => { now += ms; },
  });

  assert.equal(result.waitedMs, 500);
  assert.equal(result.pendingRelevantRequests, 0);
  monitor.close();
});

test('observed readiness does not wait for a streaming media response after visible content is ready', async () => {
  const client = new FakeClient();
  let now = 0;
  const monitor = await createObservedPageReadinessMonitor(client, { now: () => now });
  client.emit('Network.requestWillBeSent', {
    requestId: 'hero-video-stream',
    frameId: 'main-frame',
    type: 'Media',
    request: { url: 'https://media.example.test/hero.mp4' },
  });

  const result = await monitor.waitForStable({
    quietWindowMs: 500,
    maxWaitMs: 1500,
    pollIntervalMs: 100,
    sample: async () => ({ signature: 'visible-content-and-video-frame-ready', ready: true }),
    sleep: async (ms) => { now += ms; },
  });

  assert.equal(result.waitedMs, 500);
  assert.equal(result.pendingRelevantRequests, 0);
  monitor.close();
});

test('observed readiness ignores known analytics delivery requests but keeps content requests strict', async () => {
  const client = new FakeClient();
  let now = 0;
  const monitor = await createObservedPageReadinessMonitor(client, { now: () => now });
  client.emit('Network.requestWillBeSent', {
    requestId: 'google-conversion',
    frameId: 'main-frame',
    type: 'Fetch',
    request: { url: 'https://www.googleadservices.com/ccm/conversion/123/' },
  });
  client.emit('Network.requestWillBeSent', {
    requestId: 'clarity-script',
    frameId: 'main-frame',
    type: 'Script',
    request: { url: 'https://scripts.clarity.ms/0.8.80-beta/clarity.js' },
  });

  const result = await monitor.waitForStable({
    quietWindowMs: 500,
    maxWaitMs: 1500,
    pollIntervalMs: 100,
    sample: async () => ({ signature: 'stable-page', ready: true }),
    sleep: async (ms) => { now += ms; },
  });

  assert.equal(result.waitedMs, 500);
  assert.equal(result.pendingRelevantRequests, 0);
  monitor.close();
});

test('observed readiness does not let a Cloudflare challenge helper block stable visible content', async () => {
  const client = new FakeClient();
  let now = 0;
  const monitor = await createObservedPageReadinessMonitor(client, { now: () => now });
  client.emit('Network.requestWillBeSent', {
    requestId: 'cloudflare-helper',
    frameId: 'main-frame',
    type: 'Script',
    request: { url: 'https://shop.example.test/cdn-cgi/challenge-platform/scripts/precursor/main.js' },
  });

  const result = await monitor.waitForStable({
    quietWindowMs: 500,
    maxWaitMs: 1500,
    pollIntervalMs: 100,
    sample: async () => ({
      signature: 'stable-visible-storefront',
      ready: true,
      meaningfulContent: true,
      pendingImages: 0,
    }),
    sleep: async (ms) => { now += ms; },
  });

  assert.equal(result.waitedMs, 500);
  assert.equal(result.pendingRelevantRequests, 0);
  monitor.close();
});

test('observed readiness defers a detached network image to the later visual-resource gate', async () => {
  const client = new FakeClient();
  let now = 0;
  const monitor = await createObservedPageReadinessMonitor(client, { now: () => now });
  client.emit('Network.requestWillBeSent', {
    requestId: 'detached-or-background-image',
    frameId: 'main-frame',
    type: 'Image',
    request: { url: 'https://cdn.example.test/background.jpg' },
  });

  const result = await monitor.waitForStable({
    quietWindowMs: 500,
    maxWaitMs: 1500,
    pollIntervalMs: 100,
    sample: async () => ({
      signature: 'all-dom-images-complete',
      ready: true,
      meaningfulContent: true,
      pendingImages: 0,
    }),
    sleep: async (ms) => { now += ms; },
  });

  assert.equal(result.waitedMs, 500);
  assert.equal(result.pendingRelevantRequests, 0);
  assert.equal(result.pendingVisualGateRequests, 1);
  monitor.close();
});

test('coordinated readiness delegates still-loading DOM images to its parallel visual gate', async () => {
  const client = new FakeClient();
  let now = 0;
  const monitor = await createObservedPageReadinessMonitor(client, { now: () => now });
  client.emit('Network.requestWillBeSent', {
    requestId: 'visible-lazy-image',
    frameId: 'main-frame',
    type: 'Image',
    request: { url: 'https://cdn.example.test/lazy.jpg' },
  });

  const result = await monitor.waitForStable({
    quietWindowMs: 500,
    maxWaitMs: 1500,
    pollIntervalMs: 100,
    sample: async () => ({
      signature: 'dom-structure-is-stable',
      ready: true,
      meaningfulContent: true,
      pendingImages: 1,
      visualResourcesDelegated: true,
    }),
    sleep: async (ms) => { now += ms; },
  });

  assert.equal(result.waitedMs, 500);
  assert.equal(result.pendingRelevantRequests, 0);
  assert.equal(result.pendingVisualGateRequests, 1);
  monitor.close();
});

test('third-party Other requests are enhancements after the storefront is known', async () => {
  const client = new FakeClient();
  let now = 0;
  const monitor = await createObservedPageReadinessMonitor(client, { now: () => now });
  client.emit('Network.requestWillBeSent', {
    requestId: 'document',
    frameId: 'main-frame',
    type: 'Document',
    request: { url: 'https://shop.example.test/' },
  });
  client.emit('Network.loadingFinished', { requestId: 'document' });
  client.emit('Network.requestWillBeSent', {
    requestId: 'marketing-helper',
    frameId: 'main-frame',
    type: 'Other',
    request: { url: 'https://marketing.example/widget.js' },
  });

  const result = await monitor.waitForStable({
    quietWindowMs: 500,
    maxWaitMs: 1500,
    pollIntervalMs: 100,
    sample: async () => ({ signature: 'stable-page', ready: true, meaningfulContent: true }),
    sleep: async (ms) => { now += ms; },
  });

  assert.equal(result.waitedMs, 500);
  assert.equal(result.pendingRelevantRequests, 0);
  assert.equal(result.pendingEnhancementRequests, 1);
  monitor.close();
});

test('observed readiness releases third-party enhancement requests after real page content is stable', async () => {
  const client = new FakeClient();
  let now = 0;
  const monitor = await createObservedPageReadinessMonitor(client, { now: () => now });
  client.emit('Network.requestWillBeSent', {
    requestId: 'document',
    frameId: 'main-frame',
    type: 'Document',
    request: { url: 'https://shop.example.test/' },
  });
  client.emit('Network.loadingFinished', { requestId: 'document' });
  client.emit('Network.requestWillBeSent', {
    requestId: 'search-widget',
    frameId: 'main-frame',
    type: 'Script',
    request: { url: 'https://search-provider.example/widget.js' },
  });
  client.emit('Network.requestWillBeSent', {
    requestId: 'personalization',
    frameId: 'main-frame',
    type: 'XHR',
    request: { url: 'https://search-provider.example/personalization' },
  });

  const result = await monitor.waitForStable({
    quietWindowMs: 500,
    maxWaitMs: 1500,
    pollIntervalMs: 100,
    sample: async () => ({ signature: 'real-visible-page-content', ready: true, meaningfulContent: true }),
    sleep: async (ms) => { now += ms; },
  });

  assert.equal(result.waitedMs, 500);
  assert.equal(result.pendingRelevantRequests, 0);
  assert.equal(result.pendingEnhancementRequests, 2);
  monitor.close();
});

test('invisible injected script nodes do not prevent a visibly stable page from completing', async () => {
  const chromiumPath = process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const html = `<!doctype html><html><body>
    <main><h1>Visible page is ready</h1></main>
    <script>
      const timer = setInterval(() => {
        const node = document.createElement('script');
        node.type = 'application/json';
        node.textContent = JSON.stringify({ timestamp: Date.now() });
        document.body.append(node);
      }, 100);
      setTimeout(() => clearInterval(timer), 5000);
    </script>
  </body></html>`;

  const capture = await captureHtml(html, {
    chromiumPath,
    artifactProfile: 'replay',
    timeoutMs: 10000,
    observedReadiness: {
      quietWindowMs: 300,
      maxWaitMs: 1200,
      pollIntervalMs: 50,
    },
  });

  assert.equal(capture.metadata.observedReadiness.reason, 'observed-stable');
  assert.ok(capture.metadata.observedReadiness.waitedMs < 1200);
});

test('observed readiness leaves child-frame documents to the iframe capture gate', async () => {
  const client = new FakeClient();
  let now = 0;
  const monitor = await createObservedPageReadinessMonitor(client, { now: () => now });
  client.emit('Network.requestWillBeSent', {
    requestId: 'captcha-frame',
    frameId: 'child-frame',
    type: 'Document',
    request: { url: 'https://captcha.example.test/frame' },
  });

  const result = await monitor.waitForStable({
    quietWindowMs: 500,
    maxWaitMs: 1500,
    pollIntervalMs: 100,
    sample: async () => ({ signature: 'main-page-stable', ready: true }),
    sleep: async (ms) => { now += ms; },
  });

  assert.equal(result.waitedMs, 500);
  assert.equal(result.pendingRelevantRequests, 0);
  monitor.close();
});

test('observed readiness fails closed when a real content request never completes', async () => {
  const client = new FakeClient();
  let now = 0;
  const monitor = await createObservedPageReadinessMonitor(client, { now: () => now });
  client.emit('Network.requestWillBeSent', {
    requestId: 'hero-image',
    type: 'Image',
    request: { url: 'https://example.test/hero.jpg' },
  });

  await assert.rejects(
    monitor.waitForStable({
      quietWindowMs: 500,
      maxWaitMs: 1000,
      pollIntervalMs: 100,
      sample: async () => ({ signature: 'stable-but-incomplete', ready: true }),
      sleep: async (ms) => { now += ms; },
    }),
    (error) => {
      assert.equal(error.code, 'OBSERVED_READINESS_TIMEOUT');
      assert.equal(error.details.pendingRelevantRequests, 1);
      assert.equal(error.details.pending[0].url, 'https://example.test/hero.jpg');
      return true;
    },
  );
  monitor.close();
});

test('capture integration records observed readiness and includes a genuinely delayed control', async () => {
  const chromiumPath = process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const html = `<!doctype html><html><body>
    <main id="content">Initial</main>
    <script>
      setTimeout(() => {
        const button = document.createElement('button');
        button.id = 'late-control';
        button.textContent = 'Loaded later';
        document.querySelector('#content').append(button);
      }, 800);
    </script>
  </body></html>`;

  const capture = await captureHtml(html, {
    chromiumPath,
    artifactProfile: 'replay',
    timeoutMs: 10000,
    observedReadiness: {
      quietWindowMs: 300,
      maxWaitMs: 3000,
      pollIntervalMs: 50,
    },
  });

  assert.match(capture.renderedDocument.html, /id="late-control"/);
  assert.equal(capture.metadata.observedReadiness.reason, 'observed-stable');
  assert.ok(capture.metadata.observedReadiness.waitedMs >= 300);
  assert.equal(capture.metadata.observedReadiness.pendingRelevantRequests, 0);
});

test('visual settlement and observed readiness start together instead of waiting sequentially', async () => {
  assert.equal(typeof captureModule.coordinateVisualAndObservedReadiness, 'function');
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let visualStarted = false;
  let observedStarted = false;

  const operation = captureModule.coordinateVisualAndObservedReadiness({
    settleVisual: async () => {
      visualStarted = true;
      await gate;
      return { pendingImages: 0 };
    },
    waitObserved: async () => {
      observedStarted = true;
      await gate;
      return { reason: 'observed-stable' };
    },
    sampleState: async () => ({ signature: 'stable', ready: true }),
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(visualStarted, true);
  assert.equal(observedStarted, true);
  release();
  const result = await operation;
  assert.equal(result.retriedVisualSettlement, false);
});

test('observed timeout is retried once after the parallel visual gate finishes', async () => {
  let observedAttempts = 0;
  const result = await captureModule.coordinateVisualAndObservedReadiness({
    settleVisual: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { pendingImages: 0 };
    },
    waitObserved: async () => {
      observedAttempts += 1;
      if (observedAttempts === 1) {
        const error = new Error('Observed page readiness timed out while visual work was active');
        error.code = 'OBSERVED_READINESS_TIMEOUT';
        throw error;
      }
      return { reason: 'observed-stable' };
    },
    sampleState: async () => ({ signature: 'stable', ready: true }),
  });

  assert.equal(observedAttempts, 2);
  assert.equal(result.retriedObservedReadiness, true);
  assert.equal(result.observedReadiness.reason, 'observed-stable');
});

test('local HTML capture does not let blocked origin requests control readiness', async () => {
  const chromiumPath = process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const html = `<!doctype html><html><body>
    <main><h1>Local generated page</h1></main>
    <img src="https://invalid.example.test/never-loads.jpg" alt="intentionally unavailable">
  </body></html>`;

  const capture = await captureHtml(html, {
    chromiumPath,
    artifactProfile: 'replay',
    timeoutMs: 10000,
    allowNetwork: false,
    observedReadiness: {
      quietWindowMs: 200,
      maxWaitMs: 500,
      pollIntervalMs: 50,
    },
  });

  assert.equal(capture.metadata.observedReadiness.reason, 'observed-stable');
  assert.ok(capture.metadata.visualReadiness.failedImages >= 1);
});
