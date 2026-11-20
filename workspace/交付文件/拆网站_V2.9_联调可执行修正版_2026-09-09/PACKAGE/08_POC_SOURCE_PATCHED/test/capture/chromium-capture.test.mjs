import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureHtml } from '../fixtures/site.mjs';
import { captureHtml, capturePage } from '../../src/capture/chromium-capture.mjs';

test('captureHtml captures DOM snapshot, computed styles, screenshot, AX tree and interactive elements', async () => {
  const result = await captureHtml(fixtureHtml, { chromiumPath: '/usr/bin/chromium', timeoutMs: 15000 });

  assert.equal(result.metadata.title, 'Component Engine Fixture');
  assert.equal(result.metadata.visualReadiness?.fontsReady, true);
  assert.ok(result.metadata.visualReadiness?.lazyScrollSteps >= 1);
  assert.equal(result.metadata.visualReadiness?.pendingImages, 0);
  assert.equal(result.metadata.visualReadiness?.pendingStylesheets, 0);
  assert.equal(result.metadata.visualReadiness?.frozenDynamicMedia, 0);
  assert.ok(result.domSnapshot?.documents?.length >= 1);
  assert.ok(Array.isArray(result.domSnapshot?.documents?.[0]?.layout?.styles));
  assert.ok(result.axTree?.nodes?.length >= 1);
  assert.ok(Buffer.isBuffer(result.screenshot));
  assert.ok(result.screenshot.length > 100);
  assert.ok(result.interactiveElements.some((el) => el.id === 'favorite' && el.tag === 'button'));
  assert.ok(result.interactiveElements.some((el) => el.id === 'details' && el.tag === 'a'));
  assert.equal(result.renderedDocument?.sourceUrl, 'about:blank');
  assert.match(result.renderedDocument?.html ?? '', /<article class="card"/);
  assert.match(result.renderedDocument?.html ?? '', /data-matbox-render-freeze/);
  assert.doesNotMatch(result.renderedDocument?.html ?? '', /<script\b/i);
  assert.equal(result.componentHints.length, 2);
  assert.ok(result.componentHints.every((c) => c.semanticRole === 'product-card'));
  assert.deepEqual(new Set(result.componentHints.map((c) => c.variant)), new Set(['default','compact']));
});

test('capturePage rejects a blocked navigation cleanly without an unhandled rejection', async () => {
  await assert.rejects(
    capturePage('http://127.0.0.1:1/', { chromiumPath: '/usr/bin/chromium', timeoutMs: 8000 }),
    /Navigation failed|ERR_/i
  );
});
