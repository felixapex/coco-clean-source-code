import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSettingMutationExpression,
  selectRepresentativeComponents,
} from '../scripts/lib/dynamic-component-verifier.mjs';

function component(type, id = type) {
  return {
    matboxComponentId: `matbox.section.${id}`,
    sourceSectionType: type,
    variants: [{ markupHref: `/component-library/variants/${id}.html` }],
  };
}

test('representative selection covers different functional component families before filling extras', () => {
  const registry = {
    components: [
      component('header-section'),
      component('hero-banner'),
      component('product-grid'),
      component('newsletter-form'),
      component('footer'),
      component('alert-modal'),
      component('rich-content'),
      component('navigation-menu'),
      component('hero-banner', 'duplicate-hero'),
    ],
  };

  const selected = selectRepresentativeComponents(registry, 8);

  assert.equal(selected.length, 8);
  assert.equal(new Set(selected.map((item) => item.family)).size, 8);
  assert.equal(selected.some((item) => item.component.sourceSectionType === 'hero-banner'), true);
  assert.equal(selected.some((item) => item.component.sourceSectionType === 'header-section'), true);
});

test('setting mutation expression targets real annotated nodes and never external navigation', () => {
  const expression = buildSettingMutationExpression({
    settingId: 'text',
    settingType: 'inline_richtext',
    blockId: 'heading-1',
    marker: 'MATBOX_TEST',
  });

  assert.match(expression, /data-block-id/);
  assert.match(expression, /data-setting/);
  assert.match(expression, /MATBOX_TEST/);
  assert.doesNotMatch(expression, /location\s*=/);
  assert.doesNotMatch(expression, /window\.open/);
});

test('section padding mutation changes the annotated section root', () => {
  const expression = buildSettingMutationExpression({
    settingId: 'padding_top',
    settingType: 'range',
    marker: 'MATBOX_TEST',
  });

  assert.match(expression, /data-section-id/);
  assert.match(expression, /paddingTop/);
});
