import assert from 'node:assert/strict';
import test from 'node:test';

import { createComponentDossier } from '../component-dossier.mjs';

const completeInput = {
  componentTypeId: 'hero-banner',
  componentInstanceId: 'instance-001',
  sourceComponentName: 'hero_banner',
  actualFunctionName: '首屏横幅',
  nameMatchStatus: 'matched',
  schema: { settings: [], blocks: [], presets: [{ name: '首屏横幅' }] },
  functionFingerprint: 'fn:abc',
  structureInteractionFingerprint: 'si:def',
  responsiveFingerprint: 'rsp:ghi',
  classification: 'new',
  sourceEvidence: [{ id: 'ev-1', kind: 'dom' }],
  version: '1.0.0',
  platformPageId: '1234567890123456',
  parentInstanceId: null,
  order: 0,
  settings: {},
};

test('creates the complete candidate component dossier with all thirteen standard fields', () => {
  const dossier = createComponentDossier(completeInput);
  const required = [
    'componentTypeId', 'componentInstanceId', 'sourceComponentName', 'actualFunctionName',
    'nameMatchStatus', 'schema', 'functionFingerprint', 'structureInteractionFingerprint',
    'responsiveFingerprint', 'classification', 'sourceEvidence', 'version', 'platformComponentId',
  ];

  for (const field of required) assert.ok(Object.hasOwn(dossier, field), field);
  assert.equal(dossier.platformPageId, '1234567890123456');
  assert.equal(dossier.platformComponentId, null);
  assert.equal(dossier.order, 0);
});

test('rejects a dossier without a permanent platform page id', () => {
  assert.throws(() => createComponentDossier({
    ...completeInput,
    platformPageId: null,
  }), /platformPageId/);
});

test('rejects an approved component without source evidence', () => {
  assert.throws(() => createComponentDossier({
    ...completeInput,
    sourceEvidence: [],
  }), /sourceEvidence/);
});

