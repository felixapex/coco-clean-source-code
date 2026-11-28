import test from 'node:test';
import assert from 'node:assert/strict';
import { validateComponentSchemaContract } from '../scripts/lib/component-schema-contract.mjs';

function validSectionSchema() {
  return {
    name: '首屏大图',
    tag: 'section',
    limit: 1,
    settings: [
      { type: 'image_picker', id: 'image', label: '背景大图' },
      {
        type: 'select',
        id: 'image_ratio',
        label: '图片比例',
        options: [
          { value: 'original', label: '原图' },
          { value: '16:9', label: '16:9' },
          { value: '4:3', label: '4:3' },
          { value: '1:1', label: '1:1' },
        ],
        default: 'original',
      },
      {
        type: 'select',
        id: 'image_fit',
        label: '填充方式',
        options: [
          { value: 'cover', label: '裁切填充' },
          { value: 'contain', label: '完整显示' },
        ],
        default: 'cover',
      },
      { type: 'text', id: 'image_position', label: '图片焦点', default: '50% 50%' },
      { type: 'inline_richtext', id: 'heading', label: '标题', default: '示例标题' },
      { type: 'url', id: 'link', label: '链接' },
      { type: 'color_scheme', id: 'color_scheme', label: '配色', default: 'scheme-1' },
      { type: 'text_alignment', id: 'alignment', label: '对齐', default: 'left' },
      { type: 'range', id: 'padding_top', label: '上间距', min: 0, max: 100, step: 4, unit: 'px', default: 40 },
    ],
    blocks: [{ type: '@theme' }],
    max_blocks: 4,
    presets: [{ name: '首屏大图' }],
    enabled_on: { templates: ['index'] },
  };
}

function validRenderedManifest() {
  return {
    componentKind: 'section',
    section: { id: 'section-1', type: 'hero-banner' },
    bindings: [
      { settingId: 'image', kind: 'image', visible: true, editable: true },
      { settingId: 'image_ratio', kind: 'style', visible: true, editable: true },
      { settingId: 'image_fit', kind: 'style', visible: true, editable: true },
      { settingId: 'image_position', kind: 'style', visible: true, editable: true },
      { settingId: 'heading', kind: 'text', visible: true, editable: true },
      { settingId: 'link', kind: 'link', visible: true, editable: true },
      { settingId: 'color_scheme', kind: 'style', visible: true, editable: true },
      { settingId: 'alignment', kind: 'style', visible: true, editable: true },
      { settingId: 'padding_top', kind: 'style', visible: true, editable: true },
    ],
    visibleValues: [
      { kind: 'image', settingId: 'image', source: 'setting' },
      { kind: 'text', settingId: 'heading', source: 'setting' },
      { kind: 'link', settingId: 'link', source: 'setting' },
    ],
    emptySafeSettingIds: ['image', 'link'],
    images: [
      { settingId: 'image', viewport: 'desktop', ratio: '16:9', intrinsicWidth: 1600, intrinsicHeight: 900, renderedWidth: 1600, renderedHeight: 900, containerWidth: 1600, containerHeight: 900, objectFit: 'cover', objectPosition: '50% 50%', overflowPx: 0 },
      { settingId: 'image', viewport: 'mobile', ratio: '16:9', intrinsicWidth: 1600, intrinsicHeight: 900, renderedWidth: 360, renderedHeight: 202.5, containerWidth: 360, containerHeight: 202.5, objectFit: 'cover', objectPosition: '50% 50%', overflowPx: 0 },
    ],
    requiredViewports: ['desktop', 'mobile'],
  };
}

test('valid Shopify-compatible section schema and rendered bindings pass', () => {
  const result = validateComponentSchemaContract(validSectionSchema(), validRenderedManifest());
  assert.equal(result.pass, true);
  assert.deepEqual(result.failures, []);
});

test('missing presets, mixed block models, duplicate IDs, and enabled/disabled conflict fail', () => {
  const schema = validSectionSchema();
  schema.presets = [];
  schema.blocks.push({ type: 'heading' });
  schema.settings.push({ type: 'text', id: 'heading', label: '重复标题' });
  schema.disabled_on = { groups: ['footer'] };

  const result = validateComponentSchemaContract(schema, validRenderedManifest());
  assert.equal(result.pass, false);
  assert.deepEqual(result.failures.map((failure) => failure.type), [
    'missing-component-preset',
    'mixed-component-block-models',
    'duplicate-setting-id',
    'enabled-disabled-conflict',
  ]);
});

test('unsupported settings, invalid range/options, and illegal resource defaults fail', () => {
  const schema = validSectionSchema();
  schema.settings.push(
    { type: 'css_editor', id: 'css', label: 'CSS' },
    { type: 'range', id: 'gap', label: '间距', min: '0', max: 100, default: 20 },
    { type: 'select', id: 'layout', label: '布局', options: [{ value: 'grid' }] },
    { type: 'image_picker', id: 'logo', label: 'Logo', default: '/logo.png' },
  );
  const manifest = validRenderedManifest();
  manifest.inactiveSettingIds = ['css', 'gap', 'layout', 'logo'];
  manifest.emptySafeSettingIds.push('logo');

  const result = validateComponentSchemaContract(schema, manifest);
  assert.equal(result.pass, false);
  assert.deepEqual(result.failures.map((failure) => failure.type), [
    'unsupported-setting-type',
    'invalid-range-setting',
    'invalid-setting-options',
    'illegal-resource-default',
  ]);
});

test('visible editable values and declared settings must have two-way data-setting bindings', () => {
  const manifest = validRenderedManifest();
  manifest.visibleValues.push({ kind: 'text', source: 'hard-coded' });
  manifest.bindings = manifest.bindings.filter((binding) => binding.settingId !== 'heading');
  manifest.bindings.push({ settingId: 'not_declared', kind: 'text', visible: true, editable: true });

  const result = validateComponentSchemaContract(validSectionSchema(), manifest);
  assert.equal(result.pass, false);
  assert.deepEqual(result.failures.map((failure) => failure.type), [
    'hard-coded-visible-value',
    'missing-rendered-setting-binding',
    'unknown-rendered-setting-binding',
  ]);
});

test('global, resource, locale, computed, and fixed values are classified but not exposed as component settings', () => {
  const manifest = validRenderedManifest();
  manifest.visibleValues.push(
    { kind: 'text', source: 'global_setting', globalSettingId: 'brand_name', editableHere: false },
    { kind: 'text', source: 'resource_field', resourceType: 'product', fieldPath: 'title', editableHere: false },
    { kind: 'text', source: 'locale_text', localeKey: 'products.add_to_cart', editableHere: false },
    { kind: 'text', source: 'computed_state', stateSource: 'inventory', editableHere: false },
    { kind: 'structure', source: 'fixed_structure', structureRole: 'product-grid', editableHere: false },
  );

  const result = validateComponentSchemaContract(validSectionSchema(), manifest);
  assert.equal(result.pass, true);
});

test('resource settings must prove empty-value safety', () => {
  const manifest = validRenderedManifest();
  manifest.emptySafeSettingIds = ['link'];
  const result = validateComponentSchemaContract(validSectionSchema(), manifest);
  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, [{ type: 'missing-empty-value-behavior', settingId: 'image' }]);
});

test('image ratio evidence must cover desktop and mobile with fit, position, and no overflow', () => {
  const manifest = validRenderedManifest();
  manifest.images = [
    { settingId: 'image', viewport: 'desktop', ratio: '16:9', intrinsicWidth: 1600, intrinsicHeight: 900, renderedWidth: 1600, renderedHeight: 700, objectFit: '', objectPosition: '', overflowPx: 180 },
  ];

  const result = validateComponentSchemaContract(validSectionSchema(), manifest);
  assert.equal(result.pass, false);
  assert.deepEqual(result.failures.map((failure) => failure.type), [
    'image-ratio-mismatch',
    'missing-image-fit',
    'missing-image-position',
    'image-layout-overflow',
    'missing-image-viewport-evidence',
  ]);
});

test('an editable image binding without measured image evidence fails closed', () => {
  const manifest = validRenderedManifest();
  manifest.images = [];

  const result = validateComponentSchemaContract(validSectionSchema(), manifest);
  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, [{ type: 'missing-image-evidence', settingId: 'image' }]);
});

test('a visible cover crop validates source dimensions and presentation geometry as separate layers', () => {
  const manifest = validRenderedManifest();
  manifest.requiredViewports = ['desktop'];
  manifest.images = [{
    settingId: 'image',
    viewport: 'desktop',
    ratio: 'original',
    intrinsicWidth: 1200,
    intrinsicHeight: 800,
    renderedWidth: 500,
    renderedHeight: 300,
    containerWidth: 500,
    containerHeight: 300,
    objectFit: 'cover',
    objectPosition: '35% 50%',
    overflowPx: 0,
    sourceAsset: { intrinsicWidth: 1200, intrinsicHeight: 800 },
    presentation: {
      visible: true,
      renderedWidth: 500,
      renderedHeight: 300,
      containerWidth: 500,
      containerHeight: 300,
      objectFit: 'cover',
      objectPosition: '35% 50%',
      viewport: 'desktop',
      overflowPx: 0,
    },
  }];

  const result = validateComponentSchemaContract(validSectionSchema(), manifest);
  assert.equal(result.pass, true);
  assert.deepEqual(result.failures, []);
});

test('a visible broken image reports missing source evidence instead of a misleading ratio mismatch', () => {
  const manifest = validRenderedManifest();
  manifest.requiredViewports = ['desktop'];
  manifest.images = [{
    settingId: 'image',
    viewport: 'desktop',
    ratio: 'original',
    sourceAsset: { source: 'https://cdn.test/missing.jpg', intrinsicWidth: 0, intrinsicHeight: 0 },
    presentation: {
      visible: true,
      renderedWidth: 570,
      renderedHeight: 16,
      containerWidth: 570,
      containerHeight: 752,
      objectFit: 'contain',
      objectPosition: '50% 50%',
      viewport: 'desktop',
      overflowPx: 0,
    },
  }];

  const result = validateComponentSchemaContract(validSectionSchema(), manifest);
  assert.equal(result.pass, false);
  assert.deepEqual(result.failures, [{
    type: 'missing-image-source-evidence',
    settingId: 'image',
    viewport: 'desktop',
    source: 'https://cdn.test/missing.jpg',
  }]);
});

test('intentional clipped crop is valid but visible layout overflow still fails', () => {
  const clipped = validRenderedManifest();
  clipped.requiredViewports = ['desktop'];
  clipped.images = [{
    settingId: 'image',
    viewport: 'desktop',
    ratio: 'original',
    intrinsicWidth: 1600,
    intrinsicHeight: 900,
    renderedWidth: 1200,
    renderedHeight: 600,
    containerWidth: 920,
    containerHeight: 600,
    objectFit: 'cover',
    objectPosition: '50% 50%',
    overflowPx: 280,
    overflowXPx: 280,
    overflowYPx: 0,
    containerOverflowX: 'visible',
    containerOverflowY: 'visible',
    clippedX: true,
    clippedY: false,
    sourceAsset: { intrinsicWidth: 1600, intrinsicHeight: 900 },
    presentation: {
      visible: true,
      renderedWidth: 1200,
      renderedHeight: 600,
      containerWidth: 920,
      containerHeight: 600,
      objectFit: 'cover',
      objectPosition: '50% 50%',
      viewport: 'desktop',
      overflowPx: 280,
      overflowXPx: 280,
      overflowYPx: 0,
      containerOverflowX: 'visible',
      containerOverflowY: 'visible',
      clippedX: true,
      clippedY: false,
    },
  }];
  assert.equal(validateComponentSchemaContract(validSectionSchema(), clipped).pass, true);

  clipped.images[0].presentation.clippedX = false;
  const visibleOverflow = validateComponentSchemaContract(validSectionSchema(), clipped);
  assert.equal(visibleOverflow.pass, false);
  assert.ok(visibleOverflow.failures.some((failure) => failure.type === 'image-layout-overflow'));
});

test('a hidden responsive image remains recorded without pretending it has visible geometry', () => {
  const manifest = validRenderedManifest();
  manifest.requiredViewports = ['desktop'];
  manifest.images = [{
    settingId: 'image',
    viewport: 'desktop',
    ratio: 'original',
    intrinsicWidth: 0,
    intrinsicHeight: 0,
    renderedWidth: 0,
    renderedHeight: 0,
    containerWidth: 0,
    containerHeight: 0,
    objectFit: 'contain',
    objectPosition: '50% 50%',
    overflowPx: 0,
    sourceAsset: { intrinsicWidth: 0, intrinsicHeight: 0 },
    presentation: {
      visible: false,
      renderedWidth: 0,
      renderedHeight: 0,
      containerWidth: 0,
      containerHeight: 0,
      objectFit: 'contain',
      objectPosition: '50% 50%',
      viewport: 'desktop',
      overflowPx: 0,
    },
  }];

  const result = validateComponentSchemaContract(validSectionSchema(), manifest);
  assert.equal(result.pass, true);
  assert.deepEqual(result.failures, []);
});

