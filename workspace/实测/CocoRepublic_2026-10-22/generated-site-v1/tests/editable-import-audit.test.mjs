import test from 'node:test';
import assert from 'node:assert/strict';

import { auditEditableImportFoundation } from '../scripts/lib/editable-import-audit.mjs';
import { convertMarkupToEditableSection } from '../scripts/lib/editable-component-contract.mjs';

function foundation() {
  const converted = convertMarkupToEditableSection({
    sectionId: 'home__hero',
    sectionType: 'hero-banner',
    markup: '<section><h1>Factory furniture</h1><a href="/products">Products</a><img src="/hero.jpg" alt="Workshop" data-matbox-image-intrinsic-width="1600" data-matbox-image-intrinsic-height="900" data-matbox-image-rendered-width="1600" data-matbox-image-rendered-height="900" data-matbox-image-container-width="1600" data-matbox-image-container-height="900" data-matbox-image-object-fit="cover" data-matbox-image-object-position="50% 50%" data-matbox-image-viewport="desktop" data-matbox-image-viewport-width="1600" data-matbox-image-viewport-height="900" data-matbox-image-overflow-px="0"></section>',
  });
  const component = {
    componentInstanceId: 'instance-1',
    schema: { status: 'candidate', ...converted.sectionSchema },
    settings: converted.instance.settings,
    blocks: converted.instance.blocks,
    editableContract: {
      themeBlockTypes: Object.keys(converted.themeBlocks),
      renderedManifest: converted.renderedManifest,
    },
  };
  return {
    themeBlockCatalog: converted.themeBlocks,
    componentLibrary: [component],
    pages: [{ route: '/', componentInstanceIds: ['instance-1'] }],
  };
}

test('complete editable import foundation passes schema, binding, hierarchy, and reference audit', () => {
  const result = auditEditableImportFoundation(foundation());
  assert.equal(result.pass, true);
  assert.deepEqual(result.failures, []);
  assert.equal(result.coverage.components, 1);
  assert.equal(result.coverage.pageReferences, 1);
  assert.equal(result.coverage.leafBlocks, 3);
});

test('missing setting bindings and unresolved page component references fail closed', () => {
  const input = foundation();
  const component = input.componentLibrary[0];
  const headingId = Object.keys(component.blocks)[0];
  component.editableContract.renderedManifest.bindings = component.editableContract.renderedManifest.bindings
    .filter((binding) => !(binding.blockId === headingId && binding.settingId === 'text'));
  input.pages[0].componentInstanceIds.push('missing-instance');
  const result = auditEditableImportFoundation(input);
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.type === 'missing-visible-setting-binding' && failure.settingId === 'text'));
  assert.ok(result.failures.some((failure) => failure.type === 'unknown-component-instance-reference'));
});

test('any block container over fifty fails even when nested content exists', () => {
  const input = foundation();
  const component = input.componentLibrary[0];
  const sample = Object.values(component.blocks)[0];
  component.blocks = Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`copy-${index}`, structuredClone(sample)]));
  const result = auditEditableImportFoundation(input);
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.type === 'block-container-limit-exceeded' && failure.count === 51));
});

test('foundation audit rejects an image block whose measured evidence was dropped', () => {
  const input = foundation();
  input.componentLibrary[0].editableContract.renderedManifest.images = [];
  const result = auditEditableImportFoundation(input);
  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.type === 'missing-image-evidence' && failure.blockType === 'image'));
});

test('foundation audit rejects missing and inconsistent source hierarchy evidence', () => {
  const converted = convertMarkupToEditableSection({
    sectionId: 'home__grid',
    sectionType: 'collection-list',
    markup: '<section><div class="grid"><article><img src="/one.jpg"><h3>One</h3></article><article><img src="/two.jpg"><h3>Two</h3></article></div></section>',
  });
  const input = foundation();
  input.componentLibrary[0].blocks = converted.instance.blocks;
  input.componentLibrary[0].schema = { status: 'candidate', ...converted.sectionSchema };
  input.componentLibrary[0].editableContract.renderedManifest = converted.renderedManifest;

  const grid = Object.values(input.componentLibrary[0].blocks)[0];
  const firstCard = Object.values(grid.blocks)[0];
  firstCard.sourceHierarchy.parentNodeId = 'missing-parent-node';
  const result = auditEditableImportFoundation(input);

  assert.equal(result.pass, false);
  assert.ok(result.failures.some((failure) => failure.type === 'hierarchy-parent-mismatch'));

  delete input.componentLibrary[0].editableContract.renderedManifest.hierarchy;
  const missing = auditEditableImportFoundation(input);
  assert.equal(missing.pass, false);
  assert.ok(missing.failures.some((failure) => failure.type === 'missing-source-hierarchy'));
});
