import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const packageModule = await import('../component-package.mjs').catch(() => null);

function passed(name) {
  return { gate: name, pass: true, failures: [] };
}

function completeVerification() {
  return Object.fromEntries([
    'contract',
    'visual',
    'interaction',
    'coverage',
    'assets',
    'schema',
    'bindings',
    'imageRatio',
    'mutations',
  ].map((gate) => [gate, passed(gate)]));
}

function component(overrides = {}) {
  return {
    matboxComponentId: 'matbox.section.hero-banner.v1.abc123',
    sourceSectionId: 'home__hero',
    sourceSectionType: 'hero-banner',
    sourceGeometry: {
      x: 0,
      y: 100,
      width: 1440,
      height: 720,
      parentWidth: 1440,
      parentHeight: 900,
      viewport: 'desktop',
      viewportWidth: 1440,
      viewportHeight: 900,
      visible: true,
    },
    schema: {
      status: 'candidate',
      name: '首屏横幅',
      tag: 'section',
      settings: [{ type: 'text', id: 'heading', label: '标题', default: '新品系列' }],
      blocks: [{ type: '@theme' }],
      max_blocks: 4,
      presets: [{ name: '首屏横幅', settings: { heading: '新品系列' } }],
    },
    contract: {
      assets: ['/component-library/assets/hero.webp'],
      interactionStates: ['aria-expanded'],
      responsiveLayout: [{ mode: 'fluid', widthRatio: 1 }],
    },
    variants: [{
      variantId: 'variant.default',
      sourceFingerprint: 'source-1',
      markup: '<section data-section-id="home__hero" data-section-type="hero-banner"><style>.hero{width:100%}</style><div class="hero"><h1 data-setting="heading">新品系列</h1><a href="/products">查看产品</a><img src="/component-library/assets/hero.webp" alt="Hero"></div></section>',
    }],
    ...overrides,
  };
}

test('portable component package module and required file contract exist', () => {
  assert.ok(packageModule, 'component-package.mjs must exist');
  assert.equal(typeof packageModule.createPortableComponentPackage, 'function');
  assert.equal(typeof packageModule.auditPortableComponentPackage, 'function');
  assert.deepEqual(packageModule.REQUIRED_COMPONENT_PACKAGE_FILES, [
    'manifest.json',
    'schema.json',
    'presets.json',
    'implementation.html',
    'styles.css',
    'assets.json',
    'interactions.json',
    'preview.html',
    'verification.json',
  ]);
});

test('a candidate record or component.json alone is not a delivered component package', () => {
  assert.ok(packageModule);
  const result = packageModule.auditPortableComponentPackage({
    componentId: 'matbox.section.hero-banner.v1.abc123',
    status: 'candidate',
    files: { 'component.json': '{}' },
  });
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.type === 'invalid-package-status'));
  assert.ok(result.failures.some((failure) => failure.type === 'missing-package-file' && failure.file === 'implementation.html'));
});

test('component package contains implementation, schema, presets, dependencies, preview and verification', () => {
  assert.ok(packageModule);
  const record = packageModule.createPortableComponentPackage(component(), {
    assetManifest: [{ href: '/component-library/assets/hero.webp', assetId: 'hero', mimeType: 'image/webp', byteLength: 42 }],
    verification: completeVerification(),
  });
  assert.equal(record.status, 'materialized');
  assert.deepEqual(Object.keys(record.files).sort(), [...packageModule.REQUIRED_COMPONENT_PACKAGE_FILES].sort());
  assert.doesNotMatch(record.files['implementation.html'], /<style\b/i);
  assert.match(record.files['implementation.html'], /data-setting="heading"/);
  assert.match(record.files['styles.css'], /\.hero\{width:100%\}/);
  assert.match(record.files['preview.html'], /implementation/);
  assert.deepEqual(JSON.parse(record.files['assets.json']).assets.map((asset) => asset.href), ['/component-library/assets/hero.webp']);
  assert.equal(JSON.parse(record.files['presets.json']).presets.length, 1);
  assert.equal(packageModule.auditPortableComponentPackage(record).pass, true);
});

test('section-level color and spacing settings resolve through the section root instead of fake data-setting nodes', () => {
  const base = component();
  const record = packageModule.createPortableComponentPackage({
    ...base,
    schema: {
      ...base.schema,
      settings: [
        { type: 'color_scheme', id: 'color_scheme', label: '配色方案', default: 'scheme-1' },
        { type: 'range', id: 'padding_top', label: '上间距', min: 0, max: 100, default: 40 },
        { type: 'range', id: 'padding_bottom', label: '下间距', min: 0, max: 100, default: 40 },
      ],
    },
    variants: [{
      variantId: 'variant.default',
      markup: '<section data-section-id="home__hero" data-section-type="hero-banner"><p>Content</p></section>',
    }],
  }, {
    assetManifest: [{ href: '/component-library/assets/hero.webp', assetId: 'hero' }],
    verification: completeVerification(),
  });

  assert.equal(packageModule.auditPortableComponentPackage(record).pass, true);
});

test('interaction manifest declares navigation, submission, and overlay-close outcomes', () => {
  const base = component();
  const record = packageModule.createPortableComponentPackage({
    ...base,
    contract: { ...base.contract, assets: [] },
    schema: { ...base.schema, settings: [] },
    variants: [{
      variantId: 'variant.interactions',
      markup: '<section data-section-id="overlay" data-section-type="modal"><a href="/products">Products</a><form action="/contact" method="post"><button type="submit">Send</button></form><button class="modal-close" data-reveal-close>Close</button></section>',
    }],
  }, { verification: completeVerification() });
  const interactions = JSON.parse(record.files['interactions.json']);

  assert.equal(interactions.anchors[0].action, 'navigate');
  assert.equal(interactions.anchors[0].target, '/products');
  assert.equal(interactions.forms[0].action, 'submit-form');
  assert.equal(interactions.buttons[0].action, 'submit-form');
  assert.equal(interactions.buttons[1].action, 'close-overlay');
});

test('unresolved assets and active source scripts fail closed', () => {
  assert.ok(packageModule);
  const record = packageModule.createPortableComponentPackage(component({
    variants: [{
      variantId: 'variant.unsafe',
      markup: '<section data-section-id="home__hero" data-section-type="hero-banner"><h1 data-setting="heading">Title</h1><img src="/component-library/assets/missing.webp"><script src="https://source.example/runtime.js"></script></section>',
    }],
  }), { assetManifest: [], verification: completeVerification() });
  const result = packageModule.auditPortableComponentPackage(record);
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.type === 'unresolved-package-asset'));
  assert.ok(result.failures.some((failure) => failure.type === 'active-source-script'));
});

test('materializer writes every required package file and directory audit reads it back', async (t) => {
  assert.equal(typeof packageModule.materializePortableComponentPackage, 'function');
  assert.equal(typeof packageModule.auditMaterializedComponentPackage, 'function');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-component-package-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const record = packageModule.createPortableComponentPackage(component(), {
    assetManifest: [{ href: '/component-library/assets/hero.webp', assetId: 'hero' }],
    verification: completeVerification(),
  });

  const written = await packageModule.materializePortableComponentPackage(record, root);
  assert.equal(written.pass, true);
  assert.equal(written.written, true);
  assert.deepEqual((await fs.readdir(root)).sort(), [...packageModule.REQUIRED_COMPONENT_PACKAGE_FILES].sort());
  assert.equal((await packageModule.auditMaterializedComponentPackage(root)).pass, true);
});

test('directory audit rejects a component.json-only directory', async (t) => {
  assert.equal(typeof packageModule.auditMaterializedComponentPackage, 'function');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-incomplete-component-package-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'component.json'), '{}');
  const result = await packageModule.auditMaterializedComponentPackage(root);
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.type === 'missing-package-file' && failure.file === 'implementation.html'));
});

test('delivery audit rejects missing packages, duplicate ids, status skips and unregistered page references', () => {
  assert.equal(typeof packageModule.auditComponentDelivery, 'function');
  const validRecord = packageModule.createPortableComponentPackage(component(), {
    assetManifest: [{ href: '/component-library/assets/hero.webp', assetId: 'hero' }],
    verification: completeVerification(),
  });
  const result = packageModule.auditComponentDelivery({
    candidates: ['hero-source', 'grid-source', 'spacer-source'],
    excluded: [{ candidateId: 'spacer-source', reason: 'spacing-only' }],
    formalComponents: [
      { componentId: 'matbox.section.hero-banner.v1.abc123', sourceCandidateId: 'hero-source' },
      { componentId: 'matbox.section.product-grid.v1.def456', sourceCandidateId: 'grid-source' },
    ],
    packages: [validRecord, validRecord],
    acceptedIds: ['matbox.section.hero-banner.v1.abc123'],
    registeredIds: ['matbox.section.product-grid.v1.def456'],
    pageReferences: [{ pageId: '1001', componentIds: ['matbox.section.missing.v1.none'] }],
  });
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.type === 'duplicate-package-id'));
  assert.ok(result.failures.some((failure) => failure.type === 'missing-formal-component-package'));
  assert.ok(result.failures.some((failure) => failure.type === 'registered-component-not-accepted'));
  assert.ok(result.failures.some((failure) => failure.type === 'unregistered-page-component-reference'));
});

test('delivery audit reports all six counts and passes only when every formal component is packaged accepted and registered', () => {
  assert.equal(typeof packageModule.auditComponentDelivery, 'function');
  const first = packageModule.createPortableComponentPackage(component(), {
    assetManifest: [{ href: '/component-library/assets/hero.webp', assetId: 'hero' }],
    verification: completeVerification(),
  });
  const secondComponent = component({
    matboxComponentId: 'matbox.section.rich-text.v1.def456',
    sourceSectionId: 'home__intro',
    sourceSectionType: 'rich-text',
    sourceMarkup: '<section data-section-id="home__intro" data-section-type="rich-text"><p>Intro</p></section>',
    variants: [{ variantId: 'variant.default', markup: '<section data-section-id="home__intro" data-section-type="rich-text"><p>Intro</p></section>' }],
    schema: { name: '富文本', tag: 'section', settings: [], blocks: [{ type: '@theme' }], max_blocks: 4, presets: [{ name: '富文本' }] },
    contract: { assets: [], interactionStates: [], responsiveLayout: [] },
  });
  const second = packageModule.createPortableComponentPackage(secondComponent, { verification: completeVerification() });
  const ids = [first.componentId, second.componentId];
  const result = packageModule.auditComponentDelivery({
    candidates: ['hero-source', 'intro-source', 'spacer-source'],
    excluded: [{ candidateId: 'spacer-source', reason: 'spacing-only' }],
    formalComponents: [
      { componentId: ids[0], sourceCandidateId: 'hero-source' },
      { componentId: ids[1], sourceCandidateId: 'intro-source' },
    ],
    packages: [first, second],
    acceptedIds: ids,
    registeredIds: ids,
    pageReferences: [{ pageId: '1001', componentIds: ids }],
  });
  assert.equal(result.pass, true, JSON.stringify(result.failures));
  assert.deepEqual(result.counts, {
    candidates: 3,
    excluded: 1,
    formal: 2,
    materialized: 2,
    accepted: 2,
    registered: 2,
  });
});
