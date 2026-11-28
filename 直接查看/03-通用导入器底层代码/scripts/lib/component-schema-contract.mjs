const ALLOWED_SETTING_TYPES = new Set([
  'text', 'textarea', 'number', 'checkbox', 'radio', 'select', 'range',
  'richtext', 'inline_richtext', 'image_picker', 'video', 'video_url', 'url',
  'color', 'color_background', 'color_scheme', 'font_picker', 'text_alignment',
  'product', 'product_list', 'collection', 'collection_list', 'page', 'link_list',
]);

const NO_DEFAULT_TYPES = new Set(['image_picker', 'video', 'product', 'collection', 'page']);
const EMPTY_SAFE_TYPES = new Set([
  'image_picker', 'video', 'video_url', 'product', 'product_list',
  'collection', 'collection_list', 'page', 'link_list',
]);
const ALLOWED_TAGS = new Set(['section', 'div', 'header', 'footer', 'article', 'aside']);
const SUPPORTED_IMAGE_RATIOS = new Set(['original', '16:9', '4:3', '1:1']);

function uniqueDuplicates(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function validOptions(options) {
  return Array.isArray(options)
    && options.length > 0
    && options.every((option) => (
      option && typeof option.value === 'string' && option.value.length > 0
      && typeof option.label === 'string' && option.label.length > 0
    ));
}

function ratioNumber(value, image) {
  if (value === '16:9') return 16 / 9;
  if (value === '4:3') return 4 / 3;
  if (value === '1:1') return 1;
  if (value === 'original' && Number(image?.intrinsicWidth) > 0 && Number(image?.intrinsicHeight) > 0) {
    return Number(image.intrinsicWidth) / Number(image.intrinsicHeight);
  }
  return null;
}

function validateImageEvidence(manifest, failures) {
  const images = Array.isArray(manifest.images) ? manifest.images : [];
  const requiredViewports = Array.isArray(manifest.requiredViewports) ? manifest.requiredViewports : [];
  const imageSettingIds = new Set(images.map((image) => image.settingId).filter(Boolean));
  const imageBindings = (Array.isArray(manifest.bindings) ? manifest.bindings : [])
    .filter((binding) => binding?.kind === 'image' && binding?.settingId);

  for (const binding of imageBindings) {
    const hasEvidence = images.some((image) => (
      image.settingId === binding.settingId
      && (!binding.blockId || image.blockId === binding.blockId)
    ));
    if (!hasEvidence) failures.push({ type: 'missing-image-evidence', settingId: binding.settingId });
  }

  for (const image of images) {
    const sourceAsset = image.sourceAsset || image;
    const presentation = image.presentation || image;
    const visible = presentation.visible !== false;
    const hasSourceGeometry = Number(sourceAsset.intrinsicWidth) > 0 && Number(sourceAsset.intrinsicHeight) > 0;
    const expectedRatio = ratioNumber(image.ratio, sourceAsset);
    const width = Number(presentation.renderedWidth);
    const height = Number(presentation.renderedHeight);
    const containerWidth = Number(presentation.containerWidth);
    const containerHeight = Number(presentation.containerHeight);
    const hasVisibleGeometry = width > 0 && height > 0 && containerWidth > 0 && containerHeight > 0;
    const standardRatio = image.ratio !== 'original';
    if (visible && !hasSourceGeometry) {
      failures.push({
        type: 'missing-image-source-evidence',
        settingId: image.settingId,
        viewport: image.viewport,
        source: sourceAsset.source || image.source || null,
      });
    } else if (visible && (!SUPPORTED_IMAGE_RATIOS.has(image.ratio) || !expectedRatio || !hasVisibleGeometry
      || (standardRatio && Math.abs((width / height) - expectedRatio) > 0.03))) {
      failures.push({ type: 'image-ratio-mismatch', settingId: image.settingId, viewport: image.viewport });
    }
    if (visible && !['cover', 'contain'].includes(presentation.objectFit)) {
      failures.push({ type: 'missing-image-fit', settingId: image.settingId, viewport: image.viewport });
    }
    if (visible && (typeof presentation.objectPosition !== 'string' || presentation.objectPosition.trim() === '')) {
      failures.push({ type: 'missing-image-position', settingId: image.settingId, viewport: image.viewport });
    }
    const overflowPx = Number(presentation.overflowPx);
    const overflowXPx = Number.isFinite(Number(presentation.overflowXPx))
      ? Number(presentation.overflowXPx)
      : overflowPx;
    const overflowYPx = Number.isFinite(Number(presentation.overflowYPx))
      ? Number(presentation.overflowYPx)
      : overflowPx;
    const clips = (value) => ['hidden', 'clip', 'auto', 'scroll'].includes(String(value || '').trim().toLowerCase());
    const clippedX = presentation.clippedX === true || clips(presentation.containerOverflowX);
    const clippedY = presentation.clippedY === true || clips(presentation.containerOverflowY);
    const unclippedOverflow = (overflowXPx > 0 && !clippedX)
      || (overflowYPx > 0 && !clippedY);
    if (visible && overflowPx > 0 && unclippedOverflow) {
      failures.push({ type: 'image-layout-overflow', settingId: image.settingId, viewport: image.viewport, overflowPx: Number(presentation.overflowPx) });
    }
  }

  for (const settingId of imageSettingIds) {
    const covered = new Set(images.filter((image) => image.settingId === settingId).map((image) => image.viewport));
    for (const viewport of requiredViewports) {
      if (!covered.has(viewport)) failures.push({ type: 'missing-image-viewport-evidence', settingId, viewport });
    }
  }
}

export function validateComponentSchemaContract(schema = {}, renderedManifest = {}) {
  const failures = [];
  const settings = Array.isArray(schema.settings) ? schema.settings : [];
  const settingIds = settings.map((setting) => setting?.id).filter(Boolean);

  if (!Array.isArray(schema.presets) || schema.presets.length === 0 || schema.presets.some((preset) => !preset?.name)) {
    failures.push({ type: 'missing-component-preset' });
  }

  const blocks = Array.isArray(schema.blocks) ? schema.blocks : [];
  if (renderedManifest.componentKind === 'section' && blocks.some((block) => block?.type !== '@theme')) {
    failures.push({ type: 'mixed-component-block-models' });
  }

  for (const settingId of uniqueDuplicates(settingIds)) {
    failures.push({ type: 'duplicate-setting-id', settingId });
  }

  if (schema.enabled_on && schema.disabled_on) failures.push({ type: 'enabled-disabled-conflict' });
  if (schema.tag && !ALLOWED_TAGS.has(schema.tag)) failures.push({ type: 'invalid-component-tag', tag: schema.tag });
  if (schema.limit !== undefined && schema.limit !== 1 && schema.limit !== 2) failures.push({ type: 'invalid-component-limit', limit: schema.limit });
  if (schema.max_blocks !== undefined && (!Number.isInteger(schema.max_blocks) || schema.max_blocks < 0 || schema.max_blocks > 50)) {
    failures.push({ type: 'invalid-component-max-blocks', maxBlocks: schema.max_blocks });
  }

  for (const setting of settings) {
    if (!setting || typeof setting.id !== 'string' || !setting.id || typeof setting.label !== 'string' || !setting.label) {
      failures.push({ type: 'invalid-setting-shape', settingId: setting?.id || null });
      continue;
    }
    if (!ALLOWED_SETTING_TYPES.has(setting.type)) {
      failures.push({ type: 'unsupported-setting-type', settingId: setting.id, settingType: setting.type });
      continue;
    }
    if (setting.type === 'range') {
      const numeric = ['min', 'max', 'default'].every((key) => typeof setting[key] === 'number' && Number.isFinite(setting[key]));
      const stepValid = setting.step === undefined || (typeof setting.step === 'number' && Number.isFinite(setting.step) && setting.step > 0);
      if (!numeric || !stepValid || setting.min > setting.max || setting.default < setting.min || setting.default > setting.max) {
        failures.push({ type: 'invalid-range-setting', settingId: setting.id });
      }
    }
    if ((setting.type === 'select' || setting.type === 'radio') && !validOptions(setting.options)) {
      failures.push({ type: 'invalid-setting-options', settingId: setting.id });
    }
    if (NO_DEFAULT_TYPES.has(setting.type) && Object.hasOwn(setting, 'default')) {
      failures.push({ type: 'illegal-resource-default', settingId: setting.id, settingType: setting.type });
    }
  }

  const bindings = Array.isArray(renderedManifest.bindings) ? renderedManifest.bindings : [];
  const visibleValues = Array.isArray(renderedManifest.visibleValues) ? renderedManifest.visibleValues : [];
  const inactiveSettingIds = new Set(renderedManifest.inactiveSettingIds || []);
  const boundIds = new Set(bindings.filter((binding) => binding?.editable !== false).map((binding) => binding.settingId).filter(Boolean));
  const declaredIds = new Set(settingIds);

  for (const value of visibleValues) {
    const source = value?.source;
    const validSource = (
      ((source === 'setting' || source === 'component_setting') && Boolean(value.settingId))
      || ((source === 'global' || source === 'global_setting') && Boolean(value.globalSettingId || value.settingId))
      || ((source === 'resource' || source === 'resource_field') && Boolean(value.resourceType) && Boolean(value.fieldPath))
      || ((source === 'locale' || source === 'locale_text') && Boolean(value.localeKey))
      || (source === 'computed_state' && Boolean(value.stateSource))
      || (source === 'fixed_structure' && Boolean(value.structureRole))
    );
    if (!validSource) {
      failures.push({ type: 'hard-coded-visible-value', kind: value?.kind || 'unknown' });
    }
    if (!['setting', 'component_setting'].includes(source) && value?.editableHere === true) {
      failures.push({ type: 'non-component-value-exposed-as-setting', kind: value?.kind || 'unknown', source });
    }
  }
  for (const settingId of settingIds) {
    if (!inactiveSettingIds.has(settingId) && !boundIds.has(settingId)) {
      failures.push({ type: 'missing-rendered-setting-binding', settingId });
    }
  }
  for (const binding of bindings) {
    if (binding?.settingId && !declaredIds.has(binding.settingId)) {
      failures.push({ type: 'unknown-rendered-setting-binding', settingId: binding.settingId });
    }
  }

  const emptySafe = new Set(renderedManifest.emptySafeSettingIds || []);
  for (const setting of settings) {
    if (EMPTY_SAFE_TYPES.has(setting.type) && !emptySafe.has(setting.id)) {
      failures.push({ type: 'missing-empty-value-behavior', settingId: setting.id });
    }
  }

  validateImageEvidence(renderedManifest, failures);

  return { pass: failures.length === 0, failures };
}

