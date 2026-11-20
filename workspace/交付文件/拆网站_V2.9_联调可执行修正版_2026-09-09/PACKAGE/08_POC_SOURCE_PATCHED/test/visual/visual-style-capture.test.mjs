import test from 'node:test';
import assert from 'node:assert/strict';
import { captureHtml } from '../../src/capture/chromium-capture.mjs';

const html = `<!doctype html><html><body style="margin:0;background:rgb(245, 246, 247);font-family:Arial,sans-serif;color:rgb(20,21,22)">
  <article id="product" style="width:240px;height:180px;padding:20px;display:flex;gap:12px;background:rgb(250,240,230);border:2px solid rgb(40,50,60);border-radius:18px;box-shadow:rgb(0 0 0 / 20%) 0px 4px 12px;color:rgb(30,31,32);font-family:Arial,sans-serif;font-size:16px;font-weight:400;line-height:24px">
    <img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" style="width:80px;height:60px;border-radius:8px" />
    <div><h3 style="margin:0 0 8px;font-size:24px;font-weight:700;line-height:28px;color:rgb(10,11,12)">Chair</h3><p style="margin:0;color:rgb(120,40,20);font-size:18px">$99</p><button style="margin-top:10px;padding:6px 12px;border-radius:9px;background:rgb(20,30,40);color:white">Buy</button></div>
  </article>
</body></html>`;

test('capture records route-level document style and detailed component/slot visual styles', async () => {
  const capture = await captureHtml(html, { chromiumPath: '/usr/bin/chromium', timeoutMs: 15000 });
  assert.equal(capture.metadata.documentStyle.backgroundColor, 'rgb(245, 246, 247)');
  assert.equal(capture.metadata.documentStyle.marginTop, '0px');
  assert.ok(capture.metadata.viewport.width > 0);

  const product = capture.componentCandidates.find((candidate) => candidate.semanticRole === 'product-card');
  assert.ok(product);
  assert.equal(product.style.backgroundColor, 'rgb(250, 240, 230)');
  assert.equal(product.style.borderRadius, '18px');
  assert.equal(product.style.fontSize, '16px');
  assert.equal(product.style.paddingTop, '20px');
  assert.equal(product.style.borderTopWidth, '2px');
  assert.equal(product.style.borderTopStyle, 'solid');
  assert.match(product.style.boxShadow, /4px/);
  assert.equal(product.slotStyles.title.fontSize, '24px');
  assert.equal(product.slotStyles.title.fontWeight, '700');
  assert.equal(product.slotStyles.price.fontSize, '18px');
  assert.equal(product.slotStyles.action.borderRadius, '9px');
  assert.equal(product.slotStyles.media.width, '80px');
});
