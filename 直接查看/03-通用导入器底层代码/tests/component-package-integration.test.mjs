import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

test('Coco build materializes complete component packages before promotion and audits delivery counts', async () => {
  const source = await fs.readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
  assert.match(source, /createPortableComponentPackage/);
  assert.match(source, /materializePortableComponentPackage/);
  assert.match(source, /auditComponentDelivery/);
  assert.match(source, /component-library[\\/'].*packages|componentPackagesDir/);
  assert.match(source, /component-package-report\.json/);
  assert.match(source, /component-package-registry\.json/);
  assert.doesNotMatch(source, /writeFile\(path\.join\(stagingDir, 'component\.json'/);
});

test('page assembly consumes only accepted and registered component ids', async () => {
  const source = await fs.readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
  assert.match(source, /registeredComponentIds/);
  assert.match(source, /unregistered-page-component-reference|Component delivery gate failed/);
  assert.match(source, /acceptedComponentIds/);
});
