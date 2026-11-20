import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAuditCaptureReady } from '../scripts/lib/audit-capture-validation.mjs';
import fs from 'node:fs/promises';

const completeResult = (pendingImages) => ({
  screenshot: Buffer.from('png'),
  renderedDocument: {
    html: '<!doctype html><html><head><base href="https://majestic-template.myshopify.com/"><title>Product</title></head><body><section id="shopify-section-main"></section></body></html>',
  },
  interactiveElements: Array.from({ length: 20 }, () => ({})),
  metadata: { visualReadiness: { fontsReady: true, pendingImages, pendingStylesheets: 0 } },
});

test('local fidelity capture rejects pending images so the persistent browser retries', () => {
  assert.throws(
    () => assertAuditCaptureReady(completeResult(3), 'http://127.0.0.1:4173/products/example'),
    /pending-images/,
  );
  assert.doesNotThrow(() => assertAuditCaptureReady(completeResult(0), 'http://127.0.0.1:4173/products/example'));
});

test('pending-image errors report pending details even when failed-image details are empty', () => {
  const result = completeResult(1);
  result.metadata.visualReadiness.failedImageDetails = [];
  result.metadata.visualReadiness.pendingImageDetails = [{ src: 'https://cdn.example/slow.png' }];
  assert.throws(
    () => assertAuditCaptureReady(result, 'http://127.0.0.1:4173/'),
    /slow\.png/,
  );
});

test('local fidelity capture rejects completed but broken images', () => {
  const result = completeResult(0);
  result.metadata.visualReadiness.failedImages = 2;
  assert.throws(
    () => assertAuditCaptureReady(result, 'http://127.0.0.1:4173/products/example'),
    /failed-images/,
  );
});

test('local fidelity capture rejects failed or uncaptured stylesheets', () => {
  const result = completeResult(0);
  result.metadata.visualReadiness.failedStylesheets = 1;
  result.metadata.visualReadiness.uncapturedStylesheets = 1;
  assert.throws(
    () => assertAuditCaptureReady(result, 'http://127.0.0.1:4173/hc/en-us'),
    /failed-stylesheets, uncaptured-stylesheets/,
  );
});

test('local fidelity capture does not require the Shopify source base URL', () => {
  const result = completeResult(0);
  result.renderedDocument.html = result.renderedDocument.html.replace(
    'https://majestic-template.myshopify.com/',
    'http://127.0.0.1:4173/',
  );
  assert.doesNotThrow(() => assertAuditCaptureReady(result, 'http://127.0.0.1:4173/products/example'));
});

test('local fidelity capture rejects page-screenshot fallback inside navigation imagery', () => {
  const result = completeResult(0);
  result.renderedDocument.html = '<!doctype html><nav class="mega-menu"><img data-matbox-browser-screenshot-image="true" src="data:image/png;base64,abc"></nav>';
  assert.throws(
    () => assertAuditCaptureReady(result, 'http://127.0.0.1:4173/'),
    /critical-screenshot-image/,
  );
});

test('full-site audit retries failed local cells in fresh persistent browser batches', async () => {
  const source = await fs.readFile(new URL('../scripts/audit-full-site-fidelity.mjs', import.meta.url), 'utf8');
  assert.match(source, /runPersistentRetryBatches/);
  assert.match(source, /LOCAL_RETRY_WAVE/);
  assert.match(source, /failedCaptureJobs/);
});
