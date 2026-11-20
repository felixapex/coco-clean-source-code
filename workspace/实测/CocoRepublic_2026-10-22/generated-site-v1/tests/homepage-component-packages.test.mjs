import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

import {
  buildHomepageFormalComponents,
  buildHomepagePackageRecords,
} from '../scripts/lib/homepage-component-packages.mjs';
import { auditEditableImportFoundation } from '../scripts/lib/editable-import-audit.mjs';
import {
  auditPortableComponentPackage,
  REQUIRED_COMPONENT_PACKAGE_FILES,
  REQUIRED_COMPONENT_VERIFICATION_GATES,
} from '../../../../packages/import-foundation/component-package.mjs';

test('homepage extraction produces eight named editable formal components', async () => {
  const html = await fs.readFile(new URL('../artifacts/homepage-component-probe/measured-homepage.html', import.meta.url), 'utf8');
  const result = buildHomepageFormalComponents(html);

  assert.equal(result.components.length, 8);
  assert.deepEqual(result.components.map((component) => component.actualFunctionTypeId), [
    'email-signup',
    'modal',
    'alert-modal',
    'multicolumn',
    'collection-list',
    'spacer',
    'spacer',
    'video-banner',
  ]);
  assert.equal(new Set(result.components.map((component) => component.matboxComponentId)).size, 8);
  for (const component of result.components) {
    assert.match(component.matboxComponentId, new RegExp(`^matbox\\.section\\.${component.actualFunctionTypeId.replaceAll('-', '\\-')}\\.v1\\.[a-f0-9]{12}$`));
    assert.equal(component.schema.name, component.actualFunctionName);
    assert.equal(component.schema.presets[0].name, component.actualFunctionName);
    assert.ok(component.variants[0].markup.includes('data-section-id='));
    assert.ok(component.variants[0].markup.includes('data-section-type='));
    assert.doesNotMatch(component.variants[0].markup, /https?:\/\/(?:www\.)?cocorepublic\.com\.au/i);
    assert.doesNotMatch(component.variants[0].markup, /https?:\/\/store-[^"']+\.mybigcommerce\.com/i);
    assert.equal(component.editableInstance.id, component.matboxComponentId);
    assert.ok(component.editableInstance.blocks && typeof component.editableInstance.blocks === 'object');
  }
  assert.ok(result.themeBlockCatalog.heading);
  assert.ok(result.themeBlockCatalog.text);
  assert.ok(result.themeBlockCatalog.button);
  assert.ok(result.themeBlockCatalog.image);
  assert.ok(result.themeBlockCatalog.video);
  assert.ok(result.themeBlockCatalog.group);

  const editableAudit = auditEditableImportFoundation({
    themeBlockCatalog: result.themeBlockCatalog,
    componentLibrary: result.components.map((component) => ({
      componentInstanceId: component.matboxComponentId,
      schema: component.schema,
      settings: component.editableInstance.settings,
      blocks: component.editableInstance.blocks,
      editableContract: { renderedManifest: component.editableContract },
    })),
    pages: [{ route: '/', componentInstanceIds: result.components.map((component) => component.matboxComponentId) }],
  });
  assert.deepEqual(editableAudit.failures, []);
  assert.equal(editableAudit.pass, true);

  const verificationById = Object.fromEntries(result.components.map((component) => [
    component.matboxComponentId,
    Object.fromEntries(REQUIRED_COMPONENT_VERIFICATION_GATES.map((gate) => [gate, { pass: true, failures: [] }])),
  ]));
  const assetManifest = result.components
    .flatMap((component) => component.contract.assets)
    .map((href) => ({ href, resolved: true }));
  const packages = buildHomepagePackageRecords({
    components: result.components,
    assetManifest,
    verificationById,
  });
  assert.equal(packages.length, 8);
  for (const packageRecord of packages) {
    assert.deepEqual(Object.keys(packageRecord.files).sort(), [...REQUIRED_COMPONENT_PACKAGE_FILES].sort());
    assert.equal(auditPortableComponentPackage(packageRecord).pass, true);
  }
});

