import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

test('Web build writes the shared page identity and component dossier artifacts', async () => {
  const source = await fs.readFile(new URL('../scripts/build.mjs', import.meta.url), 'utf8');
  assert.match(source, /buildImportFoundationRecords/);
  assert.match(source, /platform:\s*'web'/);
  assert.match(source, /import-foundation\.json/);
  assert.match(source, /page-identity-registry\.json/);
  assert.match(source, /pageIdentityByRoute/);
  assert.match(source, /auditEditableImportFoundation/);
  assert.match(source, /editable-contract-audit\.json/);
  assert.match(source, /Editable component contract gate failed/);
  assert.match(source, /platformPageId/);
  assert.doesNotMatch(source, /const pageId = composition\.route/);
  assert.match(source, /const stagingRoot = path\.join\(root, '\.dist-staging'\)/);
  assert.match(source, /process\.pid/);
  assert.match(source, /component-package-report\.json/);
  assert.match(source, /component-package-registry\.json/);
});
