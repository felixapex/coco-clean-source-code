import assert from 'node:assert/strict';
import test from 'node:test';

import { buildImportFoundationRecords } from '../registry-adapter.mjs';

function component({ sourceSectionId, sourceSectionType, sourceMarkup }) {
  return {
    sourceSectionId,
    sourceSectionType,
    sourceMarkup,
    sourceFingerprint: `source:${sourceSectionId}`,
    matboxComponentId: `component:${sourceSectionId}`,
    matboxInstanceId: `instance:${sourceSectionId}`,
    schema: { name: sourceSectionType, settings: [], blocks: [{ type: '@theme' }], presets: [{ name: sourceSectionType }] },
    settings: {},
    blocks: {},
    blockOrder: [],
    contract: { responsiveRules: [], responsiveLayout: [] },
  };
}

function buildFrom(candidate) {
  return buildImportFoundationRecords([{
    route: '/',
    sourceUrl: 'https://example.test/',
    html: candidate.sourceMarkup,
  }], {
    platform: 'web',
    importRunId: 'evidence-test',
  }, () => ({
    composition: { route: '/', instances: [] },
    components: [candidate],
  }));
}

test('derives naming evidence from component markup when explicit evidence is absent', () => {
  const result = buildFrom(component({
    sourceSectionId: 'hero_banner',
    sourceSectionType: 'hero-banner',
    sourceMarkup: '<section class="hero-banner"><img src="hero.jpg"><h1>New collection</h1><a href="/products">Shop</a></section>',
  }));

  const dossier = result.pages[0].components[0];
  assert.equal(dossier.componentTypeId, 'hero-banner');
  assert.equal(dossier.actualFunctionName, '首屏横幅');
  assert.equal(dossier.nameMatchStatus, 'matched');
  assert.ok(dossier.nameDecisionEvidence.some((item) => item.kind === 'markup'));
});

test('does not promote a whole-page generic container as a reusable component', () => {
  const result = buildFrom(component({
    sourceSectionId: 'root',
    sourceSectionType: 'top-level-container',
    sourceMarkup: '<div class="page"><header class="site-header"></header><main><section class="hero-banner"></section></main><footer class="site-footer"></footer></div>',
  }));

  const dossier = result.pages[0].components[0];
  assert.equal(dossier.nameMatchStatus, 'review-required');
  assert.equal(dossier.classification, 'review-required');
  assert.equal(dossier.componentTypeId, 'top-level-container');
});
