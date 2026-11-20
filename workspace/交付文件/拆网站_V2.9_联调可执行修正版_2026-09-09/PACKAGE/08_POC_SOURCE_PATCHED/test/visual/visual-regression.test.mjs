import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { captureHtml } from '../../src/capture/chromium-capture.mjs';
import { runSiteComponentPipeline } from '../../src/pipeline/run-site-component-pipeline.mjs';
import { renderIrPreviewHtml } from '../../src/compiler/ir-preview.mjs';
import { comparePngBuffers, buildVisualRepairTask } from '../../src/visual/image-diff.mjs';

const sourceHtml = `<!doctype html><html><body style="margin:0;background:rgb(248,248,248);font-family:Arial,sans-serif">
  <article id="chair" style="position:absolute;left:24px;top:28px;width:260px;height:190px;box-sizing:border-box;padding:20px;background:rgb(255,245,235);border:1px solid rgb(210,190,170);border-radius:18px;color:rgb(35,35,35);font-family:Arial,sans-serif;font-size:16px;line-height:22px;box-shadow:rgba(0,0,0,.12) 0 6px 18px">
    <h3 style="margin:0 0 12px;font-size:26px;line-height:30px;font-weight:700;color:rgb(20,20,20)">Oak Chair</h3>
    <p style="margin:0 0 14px;font-size:20px;line-height:24px;color:rgb(150,60,20)">$129</p>
    <button style="padding:8px 14px;border:0;border-radius:10px;background:rgb(30,40,50);color:white;font-size:14px">Add</button>
  </article>
</body></html>`;

const resolver = async () => [{ address: '93.184.216.34', family: 4 }];

test('visual diff returns near-perfect similarity for identical PNGs and lower similarity for changed PNGs', async () => {
  const a = await captureHtml('<!doctype html><body style="margin:0;background:white"><div style="width:120px;height:120px;background:black"></div></body>', { chromiumPath: '/usr/bin/chromium', timeoutMs: 15000 });
  const b = await captureHtml('<!doctype html><body style="margin:0;background:white"><div style="width:120px;height:120px;background:black"></div></body>', { chromiumPath: '/usr/bin/chromium', timeoutMs: 15000 });
  const c = await captureHtml('<!doctype html><body style="margin:0;background:white"><div style="width:120px;height:120px;background:gray"></div></body>', { chromiumPath: '/usr/bin/chromium', timeoutMs: 15000 });
  const same = await comparePngBuffers(a.screenshot, b.screenshot);
  const changed = await comparePngBuffers(a.screenshot, c.screenshot, { includeDiffImage: true });
  assert.ok(same.similarity > 0.999);
  assert.ok(changed.similarity < same.similarity);
  assert.ok(changed.normalizedRmse > 0);
  assert.equal(Buffer.isBuffer(changed.diffImage), true);
  assert.ok(changed.diffImage.length > 0);
});

test('style-aware IR preview preserves captured geometry/style enough to produce a high visual similarity', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'visual-ir-preview-'));
  const captureFn = async () => captureHtml(sourceHtml, { chromiumPath: '/usr/bin/chromium', timeoutMs: 15000 });
  const result = await runSiteComponentPipeline({
    startUrl: 'https://visual.example.com/',
    captureFn,
    resolver,
    outputRoot: root,
    maxPages: 1,
    clusterThreshold: 0.65,
  });
  const family = result.ir.componentFamilies.find((item) => item.semanticRole === 'product-card');
  assert.ok(family?.styleProfile?.root);
  assert.equal(family.styleProfile.root.backgroundColor, 'rgb(255, 245, 235)');
  assert.equal(family.styleProfile.slots.title.fontSize, '26px');

  const previewHtml = renderIrPreviewHtml(result.ir, 'route-home');
  const baselineHtml = renderIrPreviewHtml(result.ir, 'route-home', { includeVisualStyles: false });
  const preview = await captureHtml(previewHtml, { chromiumPath: '/usr/bin/chromium', timeoutMs: 15000 });
  const baseline = await captureHtml(baselineHtml, { chromiumPath: '/usr/bin/chromium', timeoutMs: 15000 });
  const source = await captureHtml(sourceHtml, { chromiumPath: '/usr/bin/chromium', timeoutMs: 15000 });
  const diff = await comparePngBuffers(source.screenshot, preview.screenshot);
  const baselineDiff = await comparePngBuffers(source.screenshot, baseline.screenshot);
  assert.ok(diff.similarity > 0.88, `similarity=${diff.similarity} rmse=${diff.normalizedRmse}`);
  assert.ok(diff.similarity > baselineDiff.similarity, `styled=${diff.similarity} baseline=${baselineDiff.similarity}`);
});

test('repair task is emitted only when similarity is below the configured gate', () => {
  const low = buildVisualRepairTask({ routeId: 'route-home', similarity: 0.81, threshold: 0.92, referenceEvidenceId: 'ev-ref', generatedArtifact: 'preview.png' });
  assert.ok(low);
  assert.equal(low.kind, 'visual-fidelity-repair');
  assert.equal(low.routeId, 'route-home');
  assert.deepEqual(low.allowedScopes, ['generated-react', 'generated-css']);
  assert.match(low.instructions.join(' '), /Do not change Component IR architecture/i);

  const good = buildVisualRepairTask({ routeId: 'route-home', similarity: 0.97, threshold: 0.92, referenceEvidenceId: 'ev-ref', generatedArtifact: 'preview.png' });
  assert.equal(good, null);
});


test('IR preview can render from externally supplied generated-workspace CSS', () => {
  const ir = {
    routes: [{ id: 'route-home', path: '/', sections: [], evidenceIds: [] }],
    componentFamilies: [{ id: 'fam', canonicalName: 'ProductCard', semanticRole: 'product-card', propsSchema: {}, variants: ['default'], states: ['default'] }],
    componentInstances: [{ id: 'inst', familyId: 'fam', routeId: 'route-home', variant: 'default', state: 'default', bbox: { x: 0, y: 0, width: 100, height: 50 }, contentBindings: {}, evidenceIds: [] }],
  };
  const html = renderIrPreviewHtml(ir, 'route-home', {
    componentCss: '[data-component="ProductCard"] { background: rgb(1,2,3); }',
    layoutCss: '[data-instance="inst"] { position:absolute; left:11px; top:12px; width:100px; height:50px; }',
  });
  assert.match(html, /background: rgb\(1,2,3\)/);
  assert.match(html, /left:11px/);
});
