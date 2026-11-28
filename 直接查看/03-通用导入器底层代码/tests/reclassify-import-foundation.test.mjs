import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { reclassifyImportFoundationFile } from '../scripts/reclassify-import-foundation.mjs';

function component(componentInstanceId, schema) {
  return {
    componentTypeId: 'hero-banner',
    componentInstanceId,
    nameMatchStatus: 'matched',
    schema,
    functionFingerprint: 'fn:hero',
    structureInteractionFingerprint: 'si:hero',
    responsiveFingerprint: 'rsp:hero',
    sourceEvidence: [{ route: '/', sourceSectionId: componentInstanceId }],
    version: '1.0.0',
  };
}

test('rewrites only component classification data and emits a reuse report', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-reclassify-'));
  const input = path.join(directory, 'import-foundation.json');
  const report = path.join(directory, 'reuse-report.json');
  const original = {
    schemaVersion: 1,
    pages: [{ route: '/', untouched: true }],
    componentLibrary: [
      component('one', { settings: [{ type: 'text', id: 'heading', default: 'A' }] }),
      component('two', { settings: [{ type: 'text', id: 'heading', default: 'B' }] }),
    ],
  };
  await fs.writeFile(input, JSON.stringify(original), 'utf8');

  const result = await reclassifyImportFoundationFile({ input, report });
  const migrated = JSON.parse(await fs.readFile(input, 'utf8'));
  const audit = JSON.parse(await fs.readFile(report, 'utf8'));
  const backup = JSON.parse(await fs.readFile(result.backupPath, 'utf8'));

  assert.deepEqual(migrated.pages, original.pages);
  assert.deepEqual(migrated.componentLibrary.map((item) => item.classification), ['new', 'duplicate']);
  assert.deepEqual(backup, original);
  assert.equal(audit.componentInstanceCount, 2);
  assert.equal(audit.reusableInstanceCount, 1);
  assert.equal(audit.relations[0].route, '/');
});
