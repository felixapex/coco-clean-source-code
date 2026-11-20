import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGlobalSettingsSchema,
  buildThemeBlockCatalog,
  convertMarkupToEditableSection,
} from '../scripts/lib/editable-component-contract.mjs';

test('theme block catalog exposes reusable content blocks with presets and responsive typography controls', () => {
  const catalog = buildThemeBlockCatalog();
  assert.deepEqual(Object.keys(catalog).sort(), ['button', 'group', 'heading', 'image', 'text', 'video']);
  for (const block of Object.values(catalog)) {
    assert.ok(block.name);
    assert.ok(Array.isArray(block.presets) && block.presets.length > 0);
  }
  const headingIds = new Set(catalog.heading.settings.map((setting) => setting.id));
  assert.deepEqual([...['text', 'font_role', 'font_size', 'font_weight', 'line_height', 'letter_spacing', 'alignment']].filter((id) => !headingIds.has(id)), []);
  assert.equal(catalog.image.settings.find((setting) => setting.id === 'image').default, undefined);
  assert.ok(catalog.image.settings.some((setting) => setting.id === 'image_ratio'));
  assert.ok(catalog.button.settings.some((setting) => setting.id === 'link'));
});

test('global settings provide brand identity, responsive type scale, and three font pickers', () => {
  const groups = buildGlobalSettingsSchema();
  const settings = groups.flatMap((group) => group.settings || []);
  const byId = new Map(settings.map((setting) => [setting.id, setting]));
  assert.equal(byId.get('heading_font').type, 'font_picker');
  assert.equal(byId.get('body_font').type, 'font_picker');
  assert.equal(byId.get('button_font').type, 'font_picker');
  assert.equal(byId.get('brand_name').type, 'text');
  assert.equal(byId.get('type_scale').type, 'select');
});

test('section conversion extracts visible content into theme block settings and emits two-way bindings', () => {
  const result = convertMarkupToEditableSection({
    sectionId: 'home__hero',
    sectionType: 'hero-banner',
    markup: '<section class="hero"><h1>Factory direct furniture</h1><p>Made for your project.</p><a href="/products">View products</a><img src="/assets/hero.jpg" alt="Workshop"></section>',
  });
  assert.equal(result.sectionSchema.blocks[0].type, '@theme');
  assert.ok(result.sectionSchema.presets.length > 0);
  assert.deepEqual(result.blocks.map((block) => block.type), ['heading', 'text', 'button', 'image']);
  assert.equal(result.blocks[0].settings.text, 'Factory direct furniture');
  assert.equal(result.blocks[2].settings.link, '/products');
  assert.equal(result.blocks[3].settings.image, '/assets/hero.jpg');
  assert.match(result.annotatedMarkup, /data-section-id="home__hero"/);
  assert.match(result.annotatedMarkup, /data-block-type="heading"/);
  assert.match(result.annotatedMarkup, /data-setting="text"/);
  assert.ok(result.renderedManifest.visibleValues.every((value) => value.source === 'component_setting'));
  const headingVisibleSettingIds = result.renderedManifest.visibleValues
    .filter((value) => value.blockId === result.blocks[0].id)
    .map((value) => value.settingId);
  const headingBindingIds = result.renderedManifest.bindings
    .filter((binding) => binding.blockId === result.blocks[0].id)
    .map((binding) => binding.settingId);
  assert.deepEqual(headingBindingIds, headingVisibleSettingIds);
});

test('imported images stay in instance settings and never become illegal image_picker defaults', () => {
  const result = convertMarkupToEditableSection({
    sectionId: 'home__image',
    sectionType: 'image-banner',
    markup: '<section><img src="/assets/banner.jpg" alt="Banner"></section>',
  });
  const imageSchema = result.themeBlocks.image.settings.find((setting) => setting.id === 'image');
  assert.equal(Object.hasOwn(imageSchema, 'default'), false);
  assert.equal(result.blocks[0].settings.image, '/assets/banner.jpg');
});

test('imported video becomes an editable theme block with source, poster and playback settings', () => {
  const result = convertMarkupToEditableSection({
    sectionId: 'home__video',
    sectionType: 'video-banner',
    markup: '<section><video poster="/assets/poster.jpg" autoplay muted loop><source src="/assets/hero.mp4" type="video/mp4"></video></section>',
  });

  assert.deepEqual(result.blocks.map((block) => block.type), ['video']);
  assert.equal(result.blocks[0].settings.video, '/assets/hero.mp4');
  assert.equal(result.blocks[0].settings.video_url, '');
  assert.equal(result.blocks[0].settings.poster, '/assets/poster.jpg');
  assert.equal(result.blocks[0].settings.autoplay, true);
  assert.match(result.annotatedMarkup, /data-block-type="video"/);
  assert.match(result.annotatedMarkup, /data-setting="video"/);
  assert.ok(result.renderedManifest.bindings.some((binding) => binding.blockId === result.blocks[0].id && binding.settingId === 'video'));
});

test('imported image geometry becomes per-instance source evidence and rendered manifest evidence', () => {
  const result = convertMarkupToEditableSection({
    sectionId: 'home__measured-image',
    sectionType: 'image-banner',
    markup: '<section><img src="/assets/banner.jpg" alt="Banner" data-matbox-image-intrinsic-width="2400" data-matbox-image-intrinsic-height="1200" data-matbox-image-rendered-width="1440" data-matbox-image-rendered-height="810" data-matbox-image-container-width="1440" data-matbox-image-container-height="810" data-matbox-image-object-fit="cover" data-matbox-image-object-position="30% 60%" data-matbox-image-viewport="desktop" data-matbox-image-viewport-width="1440" data-matbox-image-viewport-height="900" data-matbox-image-overflow-px="0"></section>',
  });

  const block = result.blocks[0];
  assert.equal(block.settings.image_fit, 'cover');
  assert.equal(block.settings.image_position, '30% 60%');
  assert.deepEqual(block.sourceEvidence, {
    intrinsicWidth: 2400,
    intrinsicHeight: 1200,
    renderedWidth: 1440,
    renderedHeight: 810,
    containerWidth: 1440,
    containerHeight: 810,
    renderedAspectRatio: 1440 / 810,
    intrinsicAspectRatio: 2,
    sourceObjectFit: 'cover',
    objectPosition: '30% 60%',
    viewport: 'desktop',
    viewportWidth: 1440,
    viewportHeight: 900,
    overflowPx: 0,
    sourceAsset: {
      source: '/assets/banner.jpg',
      intrinsicWidth: 2400,
      intrinsicHeight: 1200,
      intrinsicAspectRatio: 2,
    },
    presentation: {
      visible: true,
      renderedWidth: 1440,
      renderedHeight: 810,
      containerWidth: 1440,
      containerHeight: 810,
      renderedAspectRatio: 1440 / 810,
      containerAspectRatio: 1440 / 810,
      sourceObjectFit: 'cover',
      objectFit: 'cover',
      objectPosition: '30% 60%',
      viewport: 'desktop',
      viewportWidth: 1440,
      viewportHeight: 900,
      overflowPx: 0,
    },
  });
  assert.deepEqual(result.instance.blocks[block.id].sourceEvidence, block.sourceEvidence);
  assert.deepEqual(result.renderedManifest.requiredViewports, ['desktop']);
  assert.equal(result.renderedManifest.images.length, 1);
  assert.equal(result.renderedManifest.images[0].blockId, block.id);
  assert.equal(result.renderedManifest.images[0].renderedWidth, 1440);
  assert.equal(result.renderedManifest.images[0].renderedHeight, 810);
});

test('imported images retain separate source-asset and presentation layers', () => {
  const result = convertMarkupToEditableSection({
    sectionId: 'home__cropped-image',
    sectionType: 'image-card',
    markup: '<section><img src="/assets/card.jpg" data-matbox-image-visible="true" data-matbox-image-intrinsic-width="1200" data-matbox-image-intrinsic-height="800" data-matbox-image-rendered-width="500" data-matbox-image-rendered-height="300" data-matbox-image-container-width="500" data-matbox-image-container-height="300" data-matbox-image-object-fit="cover" data-matbox-image-object-position="35% 50%" data-matbox-image-viewport="desktop" data-matbox-image-viewport-width="1440" data-matbox-image-viewport-height="900" data-matbox-image-overflow-px="0"></section>',
  });

  const evidence = result.blocks[0].sourceEvidence;
  assert.deepEqual(evidence.sourceAsset, {
    source: '/assets/card.jpg',
    intrinsicWidth: 1200,
    intrinsicHeight: 800,
    intrinsicAspectRatio: 1.5,
  });
  assert.deepEqual(evidence.presentation, {
    visible: true,
    renderedWidth: 500,
    renderedHeight: 300,
    containerWidth: 500,
    containerHeight: 300,
    renderedAspectRatio: 5 / 3,
    containerAspectRatio: 5 / 3,
    sourceObjectFit: 'cover',
    objectFit: 'cover',
    objectPosition: '35% 50%',
    viewport: 'desktop',
    viewportWidth: 1440,
    viewportHeight: 900,
    overflowPx: 0,
  });
  assert.deepEqual(result.renderedManifest.images[0].sourceAsset, evidence.sourceAsset);
  assert.deepEqual(result.renderedManifest.images[0].presentation, evidence.presentation);
});

test('sections with more than fifty editable values are packed into nested theme groups without dropping content', () => {
  const markup = `<section>${Array.from({ length: 121 }, (_, index) => `<p>Line ${index + 1}</p>`).join('')}</section>`;
  const result = convertMarkupToEditableSection({
    sectionId: 'page__long-content',
    sectionType: 'rich-content',
    markup,
  });

  const topLevel = Object.values(result.instance.blocks);
  assert.equal(result.blocks.length, 121);
  assert.ok(topLevel.length <= 50);
  assert.equal(result.sectionSchema.max_blocks, topLevel.length);
  assert.ok(topLevel.every((block) => block.type === 'group'));
  assert.equal(topLevel.flatMap((block) => Object.values(block.blocks || {})).length, 121);
  assert.ok(topLevel.every((block) => Object.keys(block.blocks || {}).length <= 50));
});

test('section conversion preserves source container hierarchy for editor nesting', () => {
  const result = convertMarkupToEditableSection({
    sectionId: 'home__category-grid',
    sectionType: 'collection-list',
    markup: `
      <section class="sale-categories">
        <div class="category-grid">
          <article class="category-card"><img src="/sofas.jpg" alt="Sofas"><h3>Sofas</h3></article>
          <article class="category-card"><img src="/beds.jpg" alt="Beds"><h3>Beds</h3></article>
        </div>
      </section>`,
  });

  const [grid] = Object.values(result.instance.blocks);
  assert.equal(grid.type, 'group');
  assert.equal(grid.sourceHierarchy.tag, 'div');
  assert.equal(grid.sourceHierarchy.depth, 1);

  const cards = Object.values(grid.blocks || {});
  assert.equal(cards.length, 2);
  assert.ok(cards.every((card) => card.type === 'group'));
  assert.ok(cards.every((card) => card.sourceHierarchy.tag === 'article'));
  assert.ok(cards.every((card) => card.sourceHierarchy.parentNodeId === grid.sourceHierarchy.nodeId));

  const firstCardChildren = Object.values(cards[0].blocks || {});
  assert.deepEqual(firstCardChildren.map((block) => block.type), ['image', 'heading']);
  assert.ok(firstCardChildren.every((block) => block.sourceHierarchy.parentNodeId === cards[0].sourceHierarchy.nodeId));
  assert.deepEqual(cards[0].block_order, Object.keys(cards[0].blocks));

  const hierarchy = result.renderedManifest.hierarchy;
  assert.equal(hierarchy.rootNodeIds.length, 1);
  assert.ok(hierarchy.nodes.some((node) => node.tag === 'div' && node.role === 'group'));
  assert.equal(hierarchy.nodes.filter((node) => node.tag === 'article' && node.role === 'group').length, 2);
});

test('imported component markup cannot execute source scripts or load source iframes', () => {
  const result = convertMarkupToEditableSection({
    sectionId: 'section-safe',
    sectionType: 'embedded-form',
    markup: '<section><script src="https://tracker.example/pixel.js"></script><iframe src="https://captcha.example/frame"></iframe><p>Safe content</p></section>',
  });

  assert.doesNotMatch(result.annotatedMarkup, /<script\b/i);
  assert.doesNotMatch(result.annotatedMarkup, /\s+src="https:\/\/captcha\.example/i);
  assert.match(result.annotatedMarkup, /data-source-src="https:\/\/captcha\.example\/frame"/i);
  assert.match(result.annotatedMarkup, /src="about:blank"/i);
  assert.match(result.annotatedMarkup, /Safe content/);
});
