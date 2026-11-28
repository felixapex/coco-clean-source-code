import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as componentRegistry from '../scripts/lib/component-registry.mjs';
import { createDiskBackedImportFoundation } from '../scripts/lib/disk-backed-import-foundation.mjs';

const { extractPageComponents } = componentRegistry;

function reassembleExtracted(extracted) {
  let html = extracted.composition.prefix || '';
  extracted.components.forEach((component, index) => {
    html += component.sourceMarkup;
    html += extracted.composition.suffixes?.[index] || '';
  });
  return html;
}

test('component extraction preserves Shopify IDs and assigns stable Matbox IDs', () => {
  const html = '<main><section id="shopify-section-template--1__hero_banner" class="shopify-section hero"><div data-block-id="cta_1">Buy</div></section><section id="shopify-section-template--1__rich_text" class="shopify-section rich"><p>Hello</p></section></main>';
  const first = extractPageComponents(html, '/');
  const second = extractPageComponents(html, '/');
  assert.equal(first.components.length, 2);
  assert.equal(first.components[0].sourceSectionId, 'template--1__hero_banner');
  assert.equal(first.components[0].sourceBlockIds[0], 'cta_1');
  assert.equal(first.components[0].matboxComponentId, second.components[0].matboxComponentId);
  assert.match(first.components[0].matboxComponentId, /^matbox\.section\.hero-banner\.v1\./);
});

test('component contracts retain responsive width semantics from capture', () => {
  const html = '<main><section id="shopify-section-template--1__product_grid"><div data-matbox-frozen-layout-box="true" data-matbox-responsive-width="fluid" data-matbox-captured-width="1377" data-matbox-captured-parent-width="1377" data-matbox-width-ratio="1"></div><aside data-matbox-frozen-layout-box="true" data-matbox-responsive-width="constrained" data-matbox-captured-width="420" data-matbox-captured-parent-width="1377" data-matbox-width-ratio="0.305"></aside></section></main>';
  const result = extractPageComponents(html, '/products');
  assert.deepEqual(result.components[0].contract.responsiveLayout, [
    { mode: 'fluid', capturedWidth: 1377, capturedParentWidth: 1377, widthRatio: 1 },
    { mode: 'constrained', capturedWidth: 420, capturedParentWidth: 1377, widthRatio: 0.305 },
  ]);
  const registry = componentRegistry.buildComponentRegistry([{ route: '/products', html }]);
  assert.equal(registry.report.responsiveComponentCount, 1);
  assert.equal(registry.report.fluidLayoutRuleCount, 1);
  assert.equal(registry.report.constrainedLayoutRuleCount, 1);
});

test('component asset contracts ignore original-source evidence attributes', () => {
  const localAsset = '/component-library/assets/recovered.webp';
  const originalSource = 'https://cdn.example.test/missing.jpg';
  const html = `<main><section id="shopify-section-home__blog"><img src="${localAsset}" data-matbox-original-src="${originalSource}" data-matbox-original-source-url="${originalSource}"></section></main>`;
  const result = extractPageComponents(html, '/blog');

  assert.deepEqual(result.components[0].contract.assets, [localAsset]);
});

test('component asset contracts ignore references inside HTML comments', () => {
  const html = '<main><section id="shopify-section-home__product"><!-- <img src="/content/img/inactive-logo.png"> --><h1>Product</h1></section></main>';
  const result = extractPageComponents(html, '/products/item');

  assert.deepEqual(result.components[0].contract.assets, []);
});

test('component extraction stores measured container geometry on each page instance', () => {
  const html = '<main><section id="shopify-section-template--1__hero_banner" data-matbox-component-x="0" data-matbox-component-y="120" data-matbox-component-width="1440" data-matbox-component-height="720" data-matbox-component-parent-width="1440" data-matbox-component-parent-height="900" data-matbox-component-display="grid" data-matbox-component-grid-columns="720px 720px" data-matbox-component-gap="24px" data-matbox-component-viewport="desktop" data-matbox-component-viewport-width="1440" data-matbox-component-viewport-height="900"><h1>Hero</h1></section></main>';
  const result = extractPageComponents(html, '/');
  const expected = {
    x: 0,
    y: 120,
    width: 1440,
    height: 720,
    parentWidth: 1440,
    parentHeight: 900,
    display: 'grid',
    flexDirection: 'row',
    gridTemplateColumns: '720px 720px',
    gap: '24px',
    justifyContent: 'normal',
    alignItems: 'normal',
    viewport: 'desktop',
    viewportWidth: 1440,
    viewportHeight: 900,
    visible: true,
  };
  assert.deepEqual(result.components[0].sourceGeometry, expected);
  assert.deepEqual(result.composition.instances[0].sourceGeometry, expected);
});

test('strict component geometry gate rejects a component without measured dimensions', () => {
  assert.throws(
    () => componentRegistry.buildComponentRegistry([
      { route: '/', html: '<main><section id="shopify-section-home__hero"><h1>Hero</h1></section></main>' },
    ], { requireGeometryEvidence: true }),
    /COMPONENT_GEOMETRY_EVIDENCE_FAILED.*home__hero/,
  );
});

test('strict component geometry gate accepts an explicitly measured hidden popup without invented dimensions', () => {
  const html = '<main><div id="modal" class="modal" data-matbox-component-x="0" data-matbox-component-y="0" data-matbox-component-width="0" data-matbox-component-height="0" data-matbox-component-parent-width="1440" data-matbox-component-parent-height="900" data-matbox-component-display="none" data-matbox-component-viewport="desktop" data-matbox-component-viewport-width="1440" data-matbox-component-viewport-height="900" data-matbox-component-visible="false">Modal</div></main>';
  const result = componentRegistry.buildComponentRegistry([{ route: '/', html }], { requireGeometryEvidence: true });
  assert.equal(result.registry.components.length, 1);
  assert.equal(result.registry.components[0].sourceGeometry.visible, false);
  assert.equal(result.registry.components[0].sourceGeometry.width, 0);
});

test('page composition maps every extracted section in original order', () => {
  const html = '<section id="shopify-section-a__hero"></section><section id="shopify-section-a__footer"></section>';
  const result = extractPageComponents(html, '/pages/a');
  assert.deepEqual(result.composition.instances.map((item) => item.sourceSectionId), ['a__hero', 'a__footer']);
  assert.equal(result.coverage, 1);
});

test('registry deduplicates equivalent structures and reports complete coverage', () => {
  assert.equal(typeof componentRegistry.buildComponentRegistry, 'function');
  const result = componentRegistry.buildComponentRegistry([
    { route: '/', html: '<section id="shopify-section-home__hero" class="hero"><h1>Home</h1></section>' },
    { route: '/pages/about', html: '<section id="shopify-section-about__hero" class="hero"><h1>About</h1></section>' },
  ]);
  assert.equal(result.registry.components.length, 1);
  assert.equal(result.compositions.length, 2);
  assert.equal(result.report.sourceSectionCount, 2);
  assert.equal(result.report.mappedSectionCount, 2);
  assert.equal(result.report.unmappedSectionCount, 0);
  assert.equal(result.report.componentIdCollisionCount, 0);
  assert.equal(result.report.coverage, 1);
});

test('incremental component registry analysis is byte-equivalent to one-shot analysis', () => {
  assert.equal(typeof componentRegistry.createComponentRegistryAccumulator, 'function');
  const pages = [
    { route: '/', html: '<main><section id="shopify-section-home__hero" class="hero"><h1>Home</h1></section></main>' },
    { route: '/about', html: '<main><section id="shopify-section-about__hero" class="hero"><h1>About</h1></section></main>' },
  ];
  const expected = componentRegistry.buildComponentRegistry(pages);
  const accumulator = componentRegistry.createComponentRegistryAccumulator();
  accumulator.addPages([pages[0]]);
  accumulator.addPages([pages[1]]);
  assert.deepEqual(accumulator.finish(), expected);
});

test('incremental import foundation analysis is byte-equivalent to one-shot analysis', () => {
  assert.equal(typeof componentRegistry.createImportFoundationAccumulator, 'function');
  const pages = [
    { route: '/', sourceUrl: 'https://example.test/', html: '<main><section id="shopify-section-home__hero"><h1>Home</h1></section></main>' },
    { route: '/about', sourceUrl: 'https://example.test/about', html: '<main><section id="shopify-section-about__hero"><h1>About</h1></section></main>' },
  ];
  const options = { platform: 'web', sourceOrigin: 'https://example.test', importRunId: 'incremental-test' };
  const expected = componentRegistry.buildImportFoundationRecords(pages, options);
  const accumulator = componentRegistry.createImportFoundationAccumulator(options);
  accumulator.addPages([pages[0]]);
  accumulator.addPages([pages[1]]);
  const withoutTimestamps = (value) => JSON.parse(JSON.stringify(value), (key, item) => (
    ['firstImportedAt', 'lastImportedAt'].includes(key) ? '<timestamp>' : item
  ));
  assert.deepEqual(withoutTimestamps(accumulator.finish()), withoutTimestamps(expected));
});

test('disk-backed import foundation is equivalent without retaining full component records', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-foundation-disk-'));
  const outputPath = path.join(directory, 'import-foundation.json');
  const pages = [
    { route: '/', sourceUrl: 'https://example.test/', html: '<main><section id="shopify-section-home__hero"><h1>Home</h1></section></main>' },
    { route: '/about', sourceUrl: 'https://example.test/about', html: '<main><section id="shopify-section-about__hero"><h1>About</h1></section></main>' },
  ];
  const options = { platform: 'web', sourceOrigin: 'https://example.test', importRunId: 'disk-test' };
  const expected = componentRegistry.compactImportFoundationRecords(
    componentRegistry.buildImportFoundationRecords(pages, options),
  );
  const accumulator = await createDiskBackedImportFoundation({
    ...options,
    workDir: path.join(directory, 'work'),
    outputPath,
  });
  await accumulator.addPages([pages[0]]);
  await accumulator.addPages([pages[1]]);
  const report = await accumulator.finish();
  const actual = JSON.parse(await fs.readFile(outputPath, 'utf8'));
  const withoutTimestamps = (value) => JSON.parse(JSON.stringify(value), (key, item) => (
    ['firstImportedAt', 'lastImportedAt'].includes(key) ? '<timestamp>' : item
  ));
  assert.deepEqual(withoutTimestamps(actual), withoutTimestamps(expected));
  assert.equal(report.retainedFullComponentCount, 0);
  assert.equal(report.pageIdentityByRoute.size, 2);
});

test('registry can reassemble every page byte-for-byte from ordered component variants', () => {
  assert.equal(typeof componentRegistry.reassemblePage, 'function');
  const pages = [
    { route: '/', html: '<!doctype html><body><section id="shopify-section-home__hero" class="hero"><h1>Home</h1></section><footer>Tail</footer></body>' },
    { route: '/pages/about', html: '<!doctype html><body><section id="shopify-section-about__hero" class="hero"><h1>About</h1></section><footer>Other tail</footer></body>' },
  ];
  const result = componentRegistry.buildComponentRegistry(pages);
  for (const page of pages) {
    const composition = result.compositions.find((item) => item.route === page.route);
    assert.equal(componentRegistry.reassemblePage(composition, result.registry), page.html);
  }
  assert.equal(result.report.reassemblyFailureCount, 0);
});

test('component markup stops at its own closing tag while page shell fragments remain reassemblable', () => {
  const html = '<!doctype html><body><main><section class="hero-banner"><h1>Hero</h1></section><div id="alert-modal" role="dialog">Alert</div></main><footer>Footer shell</footer></body>';
  const extracted = extractPageComponents(html, '/');
  assert.equal(extracted.components.length, 2);
  assert.doesNotMatch(extracted.components[0].sourceMarkup, /alert-modal|Footer shell/);
  assert.doesNotMatch(extracted.components[1].sourceMarkup, /Footer shell/);
  assert.equal(extracted.composition.suffixes.length, 2);
  assert.match(extracted.composition.suffixes[1], /Footer shell/);
  const registry = componentRegistry.buildComponentRegistry([{ route: '/', html }]);
  assert.equal(componentRegistry.reassemblePage(registry.compositions[0], registry.registry), html);
});

test('published component registry references deduplicated variant files instead of embedding full markup', () => {
  const repeated = `<section id="shopify-section-template--1__hero" class="hero"><h1>${'Large component '.repeat(5000)}</h1></section>`;
  const result = componentRegistry.buildComponentRegistry([
    { route: '/a', html: repeated },
    { route: '/b', html: repeated },
  ]);
  const published = componentRegistry.externalizeComponentVariantMarkup(result.registry);
  const serialized = JSON.stringify(published.registry);
  assert.equal(published.variants.length, 1);
  assert.doesNotMatch(serialized, /Large component/);
  assert.match(published.registry.components[0].variants[0].markupHref, /^\/component-library\/variants\/[a-f0-9]{24}\.html$/);
  assert.equal(published.registry.components[0].sourceMarkup, undefined);
  assert.match(published.variants[0].content, /data-section-id="template--1__hero"/);
  assert.match(published.variants[0].content, /data-block-type="heading"/);
  assert.match(published.variants[0].content, /data-setting="text"/);
});

test('the build writes external component variant files and publishes the compact registry', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
  assert.match(source, /publishComponentVariantMarkup/);
  assert.match(source, /componentVariants\.registry/);
  assert.match(source, /createComponentRegistryAccumulator\(\{\s*requireGeometryEvidence:\s*true\s*\}\)/);
  assert.doesNotMatch(source, /JSON\.stringify\(componentArtifacts\.registry/);
});

test('the full-site build analyzes replay pages in bounded batches instead of retaining every HTML page', async () => {
  const source = await fs.readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
  assert.match(source, /createDiskBackedImportFoundation/);
  assert.match(source, /createComponentRegistryAccumulator/);
  assert.match(source, /MATBOX_BUILD_ANALYSIS_BATCH_SIZE/);
  assert.doesNotMatch(source, /let componentPages\s*=\s*\[\]/);
  assert.doesNotMatch(source, /componentPages\.push/);
});

test('streaming component publisher writes annotated variants without retaining their contents', async (t) => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-variants-'));
  t.after(() => fs.rm(outputDir, { recursive: true, force: true }));
  const built = componentRegistry.buildComponentRegistry([{
    route: '/',
    html: '<main><section id="shopify-section-home__hero"><h1>Editable title</h1></section></main>',
  }]);
  const published = await componentRegistry.publishComponentVariantMarkup(built.registry, outputDir);
  const variant = published.variants[0];
  const content = await fs.readFile(path.join(outputDir, variant.filename), 'utf8');
  assert.equal(variant.content, undefined);
  assert.match(content, /data-section-id="home__hero"/);
  assert.match(content, /data-block-type="heading"/);
  assert.match(content, /data-setting="text"/);
});

test('published page compositions reference deduplicated prefix files instead of embedding full markup', () => {
  const prefix = `<!doctype html><head>${'Shared shell '.repeat(5000)}</head><body>`;
  const published = componentRegistry.externalizePageCompositionMarkup([
    { schemaVersion: 1, route: '/a', prefix, instances: [] },
    { schemaVersion: 1, route: '/b', prefix, instances: [] },
  ]);
  const serialized = JSON.stringify(published.compositions);
  assert.equal(published.fragments.length, 1);
  assert.doesNotMatch(serialized, /Shared shell/);
  assert.match(published.compositions[0].prefixHref, /^\/component-library\/compositions\/[a-f0-9]{24}\.html$/);
  assert.equal(published.compositions[0].prefix, undefined);
});

test('published page compositions externalize inter-component and trailing shell fragments', () => {
  const published = componentRegistry.externalizePageCompositionMarkup([{
    schemaVersion: 1,
    route: '/a',
    prefix: '<body><main>',
    instances: [{ matboxComponentId: 'component-a', variantId: 'variant-a' }],
    suffixes: ['</main><footer>Footer shell</footer></body>'],
  }]);
  assert.equal(published.compositions[0].suffixes, undefined);
  assert.equal(published.compositions[0].suffixHrefs.length, 1);
  assert.match(published.compositions[0].suffixHrefs[0], /^\/component-library\/compositions\/[a-f0-9]{24}\.html$/);
  assert.ok(published.fragments.some((fragment) => /Footer shell/.test(fragment.content)));
});

test('the build writes external composition fragments and publishes compact compositions', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
  assert.match(source, /externalizePageCompositionMarkup/);
  assert.match(source, /publishedCompositions\.fragments/);
  assert.match(source, /publishedCompositions\.compositions/);
  assert.doesNotMatch(source, /JSON\.stringify\(componentArtifacts\.compositions/);
});

test('published import foundation reuses compact page compositions', () => {
  const largePrefix = `<!doctype html><body>${'Foundation shell '.repeat(5000)}`;
  const foundation = {
    schemaVersion: 1,
    pages: [{ route: '/a', composition: { route: '/a', prefix: largePrefix, instances: [] }, components: [] }],
  };
  const compact = [{ route: '/a', prefixHref: '/component-library/compositions/a.html', instances: [] }];
  const published = componentRegistry.compactImportFoundationRecords(foundation, compact);
  assert.doesNotMatch(JSON.stringify(published), /Foundation shell/);
  assert.equal(published.pages[0].composition.prefixHref, compact[0].prefixHref);
  assert.equal(published.pages[0].components, undefined);
  assert.deepEqual(published.pages[0].componentInstanceIds, []);
});

test('import foundation can externalize its own page composition before the component registry exists', () => {
  const largePrefix = `<!doctype html><body>${'Early foundation shell '.repeat(5000)}`;
  const foundation = {
    schemaVersion: 1,
    pages: [{
      route: '/early',
      composition: { route: '/early', prefix: largePrefix, instances: [] },
      components: [{ componentInstanceId: 'instance-1' }],
    }],
  };
  const published = componentRegistry.compactImportFoundationRecords(foundation);
  assert.doesNotMatch(JSON.stringify(published), /Early foundation shell/);
  assert.match(published.pages[0].composition.prefixHref, /^\/component-library\/compositions\/[a-f0-9]{24}\.html$/);
  assert.deepEqual(published.pages[0].componentInstanceIds, ['instance-1']);
});

test('the build publishes the compact import foundation', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
  const diskBackedSource = await (await import('node:fs/promises')).readFile(new URL('../scripts/lib/disk-backed-import-foundation.mjs', import.meta.url), 'utf8');
  assert.match(source, /createDiskBackedImportFoundation/);
  assert.match(diskBackedSource, /compactImportFoundationRecords/);
  assert.match(diskBackedSource, /writeJsonObjectFromJsonLineArrays/);
  assert.doesNotMatch(source, /JSON\.stringify\(importFoundation\s*,\s*null/);
});

test('non-Shopify pages map direct main regions to stable Matbox sections', () => {
  const html = '<!doctype html><body><header>Header</header><main><div class="hero-banner"><h1>Home</h1></div><section class="product-grid"><img src="data:image/png;base64,AAAA"></section><div id="journal">Journal</div></main><footer>Footer</footer></body>';
  const first = extractPageComponents(html, '/');
  const second = extractPageComponents(html, '/');
  assert.equal(first.components.length, 3);
  assert.deepEqual(first.components.map((item) => item.sourceSectionType), ['hero-banner', 'product-grid', 'journal']);
  assert.deepEqual(first.components.map((item) => item.matboxComponentId), second.components.map((item) => item.matboxComponentId));
  assert.doesNotMatch(first.composition.prefix, /data:image/);
  const registry = componentRegistry.buildComponentRegistry([{ route: '/', html }]);
  assert.equal(componentRegistry.reassemblePage(registry.compositions[0], registry.registry), html.replace('data:image/png;base64,AAAA', registry.assets[0].href));
  assert.equal(registry.report.reassemblyFailureCount, 0);
});

test('non-Shopify coarse page wrappers decompose into functional inner sections without losing support markup', () => {
  const html = '<!doctype html><body><main><div class="container top_level_container"><script>window.shell=true</script><link rel="stylesheet" href="/page.css"><div class="main full"><div class="hero-banner"><img src="/hero.jpg"><h1>Image hero</h1></div><section class="video-hero"><video src="/hero.mp4"></video></section><div class="carousel"><button>Previous slide</button><div class="slide">One</div><button>Next slide</button></div><div id="searchspring-product"></div></div></div></main></body>';
  const extracted = extractPageComponents(html, '/');
  assert.deepEqual(extracted.components.map((item) => item.sourceSectionType), ['hero-banner', 'video-hero', 'carousel']);
  assert.ok(extracted.components.every((item) => item.sourceSectionType !== 'top-level-container'));
  const registry = componentRegistry.buildComponentRegistry([{ route: '/', html }]);
  assert.equal(componentRegistry.reassemblePage(registry.compositions[0], registry.registry), html);
  assert.equal(registry.report.reassemblyFailureCount, 0);
});

test('non-Shopify product wrappers keep real product regions and reject scripts and empty placeholders as components', () => {
  const html = '<!doctype html><body><main><div class="top_level_container"><script src="/runtime.js"></script><div id="sticky-add"><button>Add to cart</button></div><div id="searchspring-product"></div><div class="productView"><div class="product-form"><button class="add-to-cart">Buy</button></div></div><div id="product-info">Specifications</div><div id="alert-modal" role="dialog">Alert</div><script>window.after=true</script></div></main></body>';
  const extracted = extractPageComponents(html, '/product');
  assert.deepEqual(extracted.components.map((item) => item.sourceSectionType), ['sticky-add', 'product-view', 'product-info', 'alert-modal']);
  assert.ok(extracted.components.every((item) => !['script', 'searchspring-product', 'top-level-container'].includes(item.sourceSectionType)));
  const registry = componentRegistry.buildComponentRegistry([{ route: '/product', html }]);
  assert.equal(componentRegistry.reassemblePage(registry.compositions[0], registry.registry), html);
  assert.equal(registry.report.reassemblyFailureCount, 0);
});

test('opaque numeric product ids do not replace a semantic product view component name', () => {
  const html = '<!doctype html><body><main><div class="top_level_container"><div id="21208" class="productView"><div class="carousel"><img src="/product.jpg"><button>Next slide</button></div><form class="product-form"><button class="add-to-cart">Buy</button></form></div></div></main></body>';
  const extracted = extractPageComponents(html, '/product');
  assert.deepEqual(extracted.components.map((item) => item.sourceSectionType), ['product-view']);
  assert.equal(reassembleExtracted(extracted), html);
});

test('data layout instance ids do not replace the semantic component type', () => {
  const html = '<!doctype html><body><main><section data-layout-id="c4ad3db5-1aa9-43db-97e8-5fe1d47850d5" class="image-with-text">Story</section></main></body>';
  const extracted = extractPageComponents(html, '/story');
  assert.deepEqual(extracted.components.map((item) => item.sourceSectionType), ['image-with-text']);
});

test('coarse content wrappers decompose even when modal regions are siblings', () => {
  const html = '<!doctype html><body><main><div class="top_level_container"><section class="hero-banner">Hero</section><section class="product-grid">Products</section></div><div id="modal" role="dialog">Modal</div><div id="alert-modal" role="dialog">Alert</div></main></body>';
  const extracted = extractPageComponents(html, '/category');
  assert.deepEqual(extracted.components.map((item) => item.sourceSectionType), ['hero-banner', 'product-grid', 'modal', 'alert-modal']);
  assert.equal(reassembleExtracted(extracted), html);
});

test('page-builder content regions are transparent and screen-reader labels are not components', () => {
  const html = '<!doctype html><body><main><div class="main full"><div data-content-region="home_hero"><section class="video-hero"><video autoplay></video></section></div><h2 class="sr-only">Main content</h2><div data-content-region="main_content"><section class="image-with-text">Story</section><section class="product-grid">Products</section></div></div></main></body>';
  const extracted = extractPageComponents(html, '/');
  assert.deepEqual(extracted.components.map((item) => item.sourceSectionType), ['video-hero', 'image-with-text', 'product-grid']);
  assert.equal(reassembleExtracted(extracted), html);
});

test('empty generic layout shells are preserved as page fragments but are not registered as components', () => {
  const html = '<!doctype html><body><main><section class="product-grid">Products</section><div class="clearfix"></div><div data-content-region="category_below_content"></div><div id="alert-modal" role="dialog">Alert</div></main></body>';
  const extracted = extractPageComponents(html, '/collection');
  assert.deepEqual(extracted.components.map((item) => item.sourceSectionType), ['product-grid', 'alert-modal']);
  assert.equal(reassembleExtracted(extracted), html);
});

test('style-only page-builder layout shells stay in composition but do not become components', () => {
  const html = '<!doctype html><body><main><div data-layout-id="layout"><div data-sub-layout-container="container"><style>[data-sub-layout-container="container"] { display:flex; }</style><div data-sub-layout="column"><style>[data-sub-layout="column"] { flex-basis:100%; }</style></div></div></div><h1 class="page-heading">404 Error</h1></main></body>';
  const extracted = extractPageComponents(html, '/missing');
  assert.deepEqual(extracted.components.map((item) => item.sourceSectionType), ['page-heading']);
  assert.equal(reassembleExtracted(extracted), html);
});

test('BigCommerce page-builder layout layers are transparent and widget ids define component candidates', () => {
  const html = '<!doctype html><body><main><div data-layout-id="layout"><div data-sub-layout-container="container"><div data-sub-layout="column"><div id="11111111-1111-1111-1111-111111111111" data-widget-id="11111111-1111-1111-1111-111111111111" class="hero-widget"><video autoplay></video><h1>Hero</h1></div><div id="22222222-2222-2222-2222-222222222222" data-widget-id="22222222-2222-2222-2222-222222222222" class="offer-widget"><article class="offer">Service</article></div></div></div></div></main></body>';
  const extracted = extractPageComponents(html, '/');
  assert.deepEqual(extracted.components.map((item) => item.sourceSectionType), ['hero-widget', 'offer-widget']);
  assert.match(extracted.components[0].sourceSectionId, /^widget-11111111-1111-1111-1111-111111111111__/);
  assert.equal(reassembleExtracted(extracted), html);
});

test('multi-section custom HTML widgets decompose into semantic child components without changing the page', () => {
  const html = '<!doctype html><body><main><div data-layout-id="layout"><div data-sub-layout="column"><div data-widget-id="custom-landing"><section class="ap-hero"><h1>Pay later</h1></section><style>.ap-intro{padding:1rem}</style><section class="ap-intro"><p>Introduction</p></section><section class="ap-how"><h2>How it works</h2><ol><li>Step one</li></ol></section><section class="ap-why"><h2>Why use it</h2></section><section class="ap-cta"><a href="/products">Shop now</a></section></div></div></div></main></body>';
  const extracted = extractPageComponents(html, '/payment-plan');
  assert.deepEqual(extracted.components.map((item) => item.sourceSectionType), [
    'ap-hero',
    'ap-intro',
    'ap-how',
    'ap-why',
    'ap-cta',
  ]);
  assert.equal(reassembleExtracted(extracted), html);
});

test('nested custom microsites decompose through their page wrapper into namespaced sections', () => {
  const html = '<!doctype html><body><main><div data-widget-id="microsite"><style>.sl-page{display:block}</style><div class="sl-page"><div class="sl-open"><h1>Story</h1></div><figure class="sl-block sl-full"><img src="/one.jpg"></figure><figure class="sl-block sl-pair"><img src="/two.jpg"></figure><div class="sl-close"><a href="/collections/story">Shop</a></div></div></div></main></body>';
  const extracted = extractPageComponents(html, '/story');
  assert.deepEqual(extracted.components.map((item) => item.sourceSectionType), ['sl-open', 'sl-block', 'sl-block', 'sl-close']);
  assert.equal(reassembleExtracted(extracted), html);
});

test('semantic component internals stay atomic after a namespaced custom widget is decomposed', () => {
  const html = '<!doctype html><body><main><div data-widget-id="payment"><section class="ap-hero"><svg class="ap-hero-logo"></svg><p class="ap-hero-text">Pay later</p><span class="ap-hero-limit">Up to $3,000</span></section><section class="ap-intro"><p>Intro</p></section><section class="ap-how"><h2>How</h2></section><section class="ap-cta"><a href="/products">Shop</a></section></div></main></body>';
  const extracted = extractPageComponents(html, '/payment');
  assert.deepEqual(extracted.components.map((item) => item.sourceSectionType), ['ap-hero', 'ap-intro', 'ap-how', 'ap-cta']);
  assert.equal(reassembleExtracted(extracted), html);
});

test('empty and style-only page-builder widgets stay in composition but not in the component library', () => {
  const html = '<!doctype html><body><main><div data-layout-id="layout"><div data-sub-layout="column"><div data-widget-id="empty"> </div><div data-widget-id="style"><style>.promo{background:red}</style></div><div data-widget-id="content"><article class="offer-widget"><p>Service</p></article></div></div></div></main></body>';
  const extracted = extractPageComponents(html, '/');
  assert.deepEqual(extracted.components.map((item) => item.sourceSectionType), ['widget']);
  assert.match(extracted.components[0].sourceSectionId, /^widget-content__/);
  assert.equal(reassembleExtracted(extracted), html);
});

test('PLP landing wrappers decompose into their header widgets and product page regions', () => {
  const html = '<!doctype html><body><main><div class="container container-plp-landing"><div id="clp-header"><div data-content-region="category_below_description"><div data-layout-id="layout"><div data-sub-layout="column"><div data-widget-id="hero"><div class="hero-widget inner-hero"><h1>Collection</h1></div></div></div></div></div></div><div class="page"><div class="searchspring-category"><article class="product-card">Product</article></div></div></div></main></body>';
  const extracted = extractPageComponents(html, '/collection');
  assert.deepEqual(extracted.components.map((item) => item.sourceSectionType), ['widget', 'searchspring-category']);
  assert.equal(reassembleExtracted(extracted), html);
});

test('empty collection landing header shells remain page fragments instead of components', () => {
  const html = '<!doctype html><body><main><div id="clp-header"></div><section class="searchspring-category"><article class="product-card">Product</article></section></main></body>';
  const extracted = extractPageComponents(html, '/collections');
  assert.deepEqual(extracted.components.map((item) => item.sourceSectionType), ['searchspring-category']);
  assert.equal(reassembleExtracted(extracted), html);
});

test('non-Shopify page compositions reference large section assets instead of duplicating them', () => {
  const payload = 'A'.repeat(200_000);
  const html = `<!doctype html><body><main><section class="hero"><img src="data:image/png;base64,${payload}"></section><section class="products">Products</section></main></body>`;
  const result = componentRegistry.buildComponentRegistry([{ route: '/large', html }]);
  assert.ok(JSON.stringify(result.compositions).length < 1000);
  assert.equal(result.assets.length, 1);
  assert.match(result.assets[0].href, /^\/component-library\/assets\/[a-f0-9]{24}\.png$/);
  assert.equal(result.assets[0].mimeType, 'image/png');
  assert.ok(result.assets[0].buffer.length > 0);
  const serializedRegistry = JSON.stringify(result.registry);
  assert.doesNotMatch(serializedRegistry, new RegExp(payload.slice(0, 1000)));
  assert.match(serializedRegistry, /\/component-library\/assets\//);
  assert.equal(componentRegistry.reassemblePage(result.compositions[0], result.registry), html.replace(`data:image/png;base64,${payload}`, result.assets[0].href));
  assert.equal(result.report.reassemblyFailureCount, 0);
});

test('replay asset bundle externalizes shared image and font data URLs before page and registry output', () => {
  assert.equal(typeof componentRegistry.externalizePageAssetBundle, 'function');
  const image = 'data:image/png;base64,QUJDRA==';
  const font = 'data:font/woff2;base64,RUZHSA==';
  const pages = [
    { route: '/a', replayFile: 'a.html', html: `<style>@font-face{src:url("${font}")}</style><img src="${image}">` },
    { route: '/b', replayFile: 'b.html', html: `<div style="background-image:url('${image}')">B</div>` },
  ];
  const bundle = componentRegistry.externalizePageAssetBundle(pages);
  assert.equal(bundle.pages.length, 2);
  assert.equal(bundle.assets.length, 2);
  assert.doesNotMatch(bundle.pages.map((page) => page.html).join(''), /data:(?:image|font)\//);
  assert.match(bundle.pages[0].html, /\/component-library\/assets\/[a-f0-9]{24}\.woff2/);
  assert.match(bundle.pages[1].html, /\/component-library\/assets\/[a-f0-9]{24}\.png/);
  assert.equal(bundle.pages[0].replayFile, 'a.html');
});

test('replay asset bundle externalizes captured stylesheet data URLs before pages enter the registry', () => {
  const css = `data:text/css;base64,${Buffer.from('body{margin:0}.hero{display:grid}', 'utf8').toString('base64')}`;
  const pages = [
    { route: '/a', replayFile: 'a.html', html: `<link rel="stylesheet" href="${css}"><main><section class="hero">A</section></main>` },
    { route: '/b', replayFile: 'b.html', html: `<link rel="stylesheet" href="${css}"><main><section class="hero">B</section></main>` },
  ];
  const bundle = componentRegistry.externalizePageAssetBundle(pages);
  assert.equal(bundle.assets.length, 1);
  assert.equal(bundle.assets[0].mimeType, 'text/css');
  assert.match(bundle.assets[0].href, /^\/component-library\/assets\/[a-f0-9]{24}\.css$/);
  assert.doesNotMatch(bundle.pages.map((page) => page.html).join(''), /data:text\/css/);
  assert.ok(bundle.pages.every((page) => page.html.includes(bundle.assets[0].href)));
});

test('validation hydration restores frozen component assets without source network access', () => {
  assert.equal(typeof componentRegistry.hydratePageAssetsForValidation, 'function');
  const html = '<head><base href="/"><link rel="stylesheet" href="/component-library/assets/theme.css"></head><body><img src="/component-library/assets/hero.png"></body>';
  const assets = [
    { href: '/component-library/assets/hero.png', mimeType: 'image/png', buffer: Buffer.from('PNG') },
    { href: '/component-library/assets/theme.css', mimeType: 'text/css', buffer: Buffer.from('body{background-image:url("/component-library/assets/hero.png")}') },
  ];
  const hydrated = componentRegistry.hydratePageAssetsForValidation(html, assets);
  assert.doesNotMatch(hydrated, /\/component-library\/assets\//);
  assert.match(hydrated, /src="data:image\/png;base64,/);
  assert.match(hydrated, /href="data:text\/css;base64,/);
  const cssData = hydrated.match(/href="data:text\/css;base64,([^"]+)/)?.[1] || '';
  assert.match(Buffer.from(cssData, 'base64').toString('utf8'), /data:image\/png;base64,/);
});

test('published replay uses the current deployment origin for shared component assets', () => {
  assert.equal(typeof componentRegistry.normalizeReplayBase, 'function');
  const html = '<head><base href="https://source.example/catalog/"><link href="https://source.example/site.css"></head>';
  const normalized = componentRegistry.normalizeReplayBase(html);
  assert.match(normalized, /<base href="\/">/);
  assert.match(normalized, /href="https:\/\/source\.example\/site\.css"/);
});

test('published replay localizes every captured source-site navigation target', () => {
  assert.equal(typeof componentRegistry.localizeCapturedRouteLinks, 'function');
  const html = '<a href="https://www.cocorepublic.com.au/sofas/?sort=new#grid">Sofas</a><a href="/living/">Living</a><a href="https://example.com/help">External</a><form action="https://www.cocorepublic.com.au/search.php"><button>Search</button></form>';
  const localized = componentRegistry.localizeCapturedRouteLinks(html, {
    sourceOrigin: 'https://www.cocorepublic.com.au',
    capturedRoutes: ['/', '/sofas', '/living'],
  });
  assert.match(localized, /href="\/sofas\?sort=new#grid"/);
  assert.match(localized, /href="\/living"/);
  assert.match(localized, /href="https:\/\/example\.com\/help"/);
  assert.match(localized, /action="https:\/\/www\.cocorepublic\.com\.au\/search\.php"/);
  assert.doesNotMatch(localized, /href="https:\/\/www\.cocorepublic\.com\.au/);
});

test('strict standalone publishing never leaves source-site navigation anchors external', () => {
  const html = '<a href="https://www.cocorepublic.com.au/unknown-product.html?sku=1">Product</a><a href="https://example.com/help">External service</a>';
  const localized = componentRegistry.localizeCapturedRouteLinks(html, {
    sourceOrigin: 'https://www.cocorepublic.com.au',
    capturedRoutes: ['/'],
    localizeAllSourceLinks: true,
  });
  assert.match(localized, /href="\/unknown-product\.html\?sku=1"/);
  assert.match(localized, /href="https:\/\/example\.com\/help"/);
  assert.doesNotMatch(localized, /href="https:\/\/www\.cocorepublic\.com\.au/);
});

test('strict standalone publishing treats the bare source host as the same storefront', () => {
  const html = '<a href="https://cocorepublic.com.au/705936-aster-bedside-table.html?sku=706238">Aster</a>';
  const localized = componentRegistry.localizeCapturedRouteLinks(html, {
    sourceOrigin: 'https://www.cocorepublic.com.au',
    capturedRoutes: ['/705936-aster-bedside-table.html'],
    localizeAllSourceLinks: true,
  });
  assert.match(localized, /href="\/705936-aster-bedside-table\.html\?sku=706238"/);
  assert.doesNotMatch(localized, /cocorepublic\.com\.au/);
});

test('strict standalone publishing unwraps an external URL accidentally prefixed by the source storefront', () => {
  const html = '<a href="https://www.cocorepublic.com.au/https://www.lamericano.com.au/adelaide">Restaurant</a>';
  const localized = componentRegistry.localizeCapturedRouteLinks(html, {
    sourceOrigin: 'https://www.cocorepublic.com.au',
    capturedRoutes: ['/'],
    localizeAllSourceLinks: true,
  });
  assert.match(localized, /href="https:\/\/www\.lamericano\.com\.au\/adelaide"/);
  assert.doesNotMatch(localized, /href="\/https:/);
});

test('strict standalone publishing recovers a same-store URL concatenated after an encoded space', () => {
  const html = '<a href="/win-a-3000-shopping-experience/%20https:/www.cocorepublic.com.au/privacy-policy/">Privacy policy</a>';
  const localized = componentRegistry.localizeCapturedRouteLinks(html, {
    sourceOrigin: 'https://www.cocorepublic.com.au',
    capturedRoutes: ['/privacy-policy'],
    localizeAllSourceLinks: true,
  });
  assert.match(localized, /href="\/privacy-policy"/);
  assert.doesNotMatch(localized, /win-a-3000-shopping-experience|%20https/);
});

test('published replay unwraps Zendesk related-click tracking links to their real local article', () => {
  const articleRoute = '/hc/en-us/articles/46217419439641-Do-your-products-come-with-a-warranty';
  const payload = `${Buffer.from(`binary-prefix${articleRoute}`).toString('base64')}--signed-digest`;
  const html = `<a href="/hc/en-us/related/click?data=${encodeURIComponent(payload)}">Warranty</a>`;
  const localized = componentRegistry.localizeCapturedRouteLinks(html, {
    sourceOrigin: 'https://cocorepublichelp.zendesk.com',
    capturedRoutes: [articleRoute],
    localizeAllSourceLinks: true,
  });

  assert.match(localized, new RegExp(`href="${articleRoute}"`));
  assert.doesNotMatch(localized, /related\/click/);
});

test('published replay localizes links to another captured source origin when the target route exists', () => {
  const html = '<a href="https://cocorepublichelp.zendesk.com/hc/en-us">Contact us</a><a href="https://unrelated.example/hc/en-us">Unrelated</a>';
  const localized = componentRegistry.localizeCapturedRouteLinks(html, {
    sourceOrigin: 'https://www.cocorepublic.com.au',
    capturedOrigins: ['https://www.cocorepublic.com.au', 'https://cocorepublichelp.zendesk.com'],
    capturedRoutes: ['/hc/en-us'],
    localizeAllSourceLinks: true,
  });

  assert.match(localized, /href="\/hc\/en-us">Contact us/);
  assert.match(localized, /href="https:\/\/unrelated\.example\/hc\/en-us">Unrelated/);
});

test('published replay cleans trailing pipe markers on links to another captured source origin', () => {
  const html = '<a href="https://www.cocorepublic.com.au/cancellation-and-returns%7C%7C">Returns</a>';
  const localized = componentRegistry.localizeCapturedRouteLinks(html, {
    sourceOrigin: 'https://cocorepublichelp.zendesk.com',
    capturedOrigins: ['https://www.cocorepublic.com.au'],
    capturedRoutes: ['/cancellation-and-returns'],
    localizeAllSourceLinks: true,
  });

  assert.equal(localized, '<a href="/cancellation-and-returns">Returns</a>');
});

test('replay source origin uses the reference URL for local authored pages and base URL otherwise', () => {
  assert.equal(
    componentRegistry.replaySourceOrigin('<base href="/"><meta name="matbox-reference-url" content="https://local.example/page">'),
    'https://local.example',
  );
  assert.equal(
    componentRegistry.replaySourceOrigin('<base href="https://captured.example/path/">'),
    'https://captured.example',
  );
});

test('published replay preserves the captured frozen video frame as a visible image', () => {
  assert.equal(typeof componentRegistry.restoreFrozenVideoBackgrounds, 'function');
  const html = '<div id="video-viewport"><img id="video_desk_campaign" data-matbox-frozen-video="true" src="/assets/baked-overlay.png" style="background-image:url(&quot;/assets/clean-frame.webp&quot;);background-size:cover"></div><div class="text-wrap"><h1>Sale</h1><a href="/sale">Shop</a></div>';
  const restored = componentRegistry.restoreFrozenVideoBackgrounds(html);
  assert.match(restored, /<img id="video_desk_campaign"/);
  assert.match(restored, /src="\/assets\/baked-overlay\.png"/);
  assert.match(restored, /data-matbox-frozen-video="true"/);
  assert.match(restored, /background-image:url\(&quot;\/assets\/clean-frame\.webp&quot;\)/);
  assert.equal((restored.match(/<h1>Sale<\/h1>/g) || []).length, 1);
});
