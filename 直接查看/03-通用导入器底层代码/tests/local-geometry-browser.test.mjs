import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { captureHtml } from '../src/import-core/capture/chromium-capture.mjs';
import { compactComponentGeometryMeasurementExpression } from '../scripts/lib/local-component-geometry.mjs';

test('geometry-only capture returns measured data without serializing the full document', async () => {
  const result = await captureHtml('<main style="width:400px"><section style="width:50%;height:80px">Private page content</section></main>', {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    profileRoot: path.resolve('artifacts/component-geometry-migration/browser-profiles'),
    viewport: { width: 1440, height: 900, mobile: false },
    timeoutMs: 30000,
    allowNetwork: false,
    settledReplayMeasurement: '(() => { const r = document.querySelector("section").getBoundingClientRect(); return { width: r.width, height: r.height }; })()',
  });

  assert.deepEqual(result.settledReplayMeasurement, { width: 200, height: 80 });
  assert.equal(result.renderedDocument, undefined);
  assert.equal(result.screenshot, undefined);
});

test('image geometry uses the nearest ancestor that actually contains visible overflow', async () => {
  const result = await captureHtml('<main><section style="position:relative;width:400px;height:400px"><div style="width:200px;height:40px;overflow:visible"><img data-matbox-image-geometry-key="image-1" src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'200\' height=\'200\'%3E%3C/svg%3E" style="display:block;width:200px;height:200px"></div></section></main>', {
    chromiumPath: process.env.MATBOX_CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    profileRoot: path.resolve('artifacts/component-geometry-migration/browser-profiles'),
    viewport: { width: 1440, height: 900, mobile: false },
    timeoutMs: 30000,
    allowNetwork: false,
    settledReplayMeasurement: compactComponentGeometryMeasurementExpression,
  });

  assert.match(result.settledReplayMeasurement, /data-matbox-image-container-height="400"/);
  assert.match(result.settledReplayMeasurement, /data-matbox-image-container-ancestor-depth="2"/);
  assert.match(result.settledReplayMeasurement, /data-matbox-image-overflow-y-px="0"/);
});
