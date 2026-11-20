import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { captureHtmlWithAutoStates } from '../../src/capture/chromium-capture.mjs';
import { runSiteComponentPipeline } from '../../src/pipeline/run-site-component-pipeline.mjs';
import { validateComponentIr } from '../../src/ir/component-ir.mjs';
import { multiPageSite } from '../fixtures/multi-page-site.mjs';

const resolver = async () => [{ address: '93.184.216.34', family: 4 }];

test('one start URL becomes a multi-route component library without component annotations', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'component-site-pipeline-'));
  const captureFn = async (url) => {
    const html = multiPageSite[url];
    if (!html) throw new Error(`fixture page missing: ${url}`);
    return captureHtmlWithAutoStates(html, { chromiumPath: '/usr/bin/chromium', timeoutMs: 15000, maxStateSteps: 10 });
  };
  const result = await runSiteComponentPipeline({
    startUrl: 'https://shop.example.com/',
    captureFn,
    resolver,
    outputRoot: root,
    maxPages: 3,
    clusterThreshold: 0.78,
  });

  const validation = validateComponentIr(result.ir);
  assert.equal(validation.ok, true, validation.errors.join('\n'));
  assert.equal(result.ir.routes.length, 3);
  assert.ok(result.ir.routes.every((route) => route.renderedDocument?.html?.includes('data-matbox-render-freeze')));
  assert.ok(result.routeManifests.every((manifest) => manifest.artifacts.some((artifact) => artifact.type === 'rendered-document')));

  const product = result.ir.componentFamilies.find((f) => f.semanticRole === 'product-card');
  const content = result.ir.componentFamilies.find((f) => f.semanticRole === 'content-card');
  const search = result.ir.componentFamilies.find((f) => f.semanticRole === 'search-form');
  assert.ok(product, 'ProductCard family missing');
  assert.ok(content, 'ContentCard family missing');
  assert.ok(search, 'SearchForm family missing');
  assert.equal(product.occurrenceCount, 4);
  assert.deepEqual(new Set(product.variants), new Set(['default','compact']));
  assert.equal(product.propsSchema.title.required, true);
  assert.equal(product.propsSchema.price.type, 'money');
  assert.equal(product.states.includes('hover'), true);
  assert.equal(product.states.includes('selected'), true);
  assert.equal(search.states.includes('focus'), true);
  assert.equal(search.states.includes('expanded'), true);
  assert.equal(content.occurrenceCount, 3);
  assert.equal(product.id === content.id, false);
  assert.equal(result.componentLibrary.families.length, result.ir.componentFamilies.length);
  assert.ok(result.siteManifest.artifacts.some((a) => a.type === 'component-library'));
  assert.ok(result.siteManifest.artifacts.some((a) => a.type === 'component-ir'));
});
