import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  evaluateExistingStagePromotion,
  promoteExistingStage,
} from '../scripts/lib/existing-stage-promotion.mjs';

function passingEvidence(stageDir) {
  return {
    stageStatus: { failedGates: [], routeLinkAudit: { pass: true }, stylesheetRecovery: { pass: true } },
    checkpointIntegrity: { pass: true, stageDir: path.resolve(stageDir), replayFileCount: 2, failureCount: 0 },
    editableContractAudit: { pass: true, failures: [] },
    routeLinkAudit: { pass: true, inspectedPageCount: 2, failures: [] },
    imageRecoveryBlockers: { pass: true, blockedUniqueSourceCount: 0, blockedRouteCount: 0 },
    validationIssues: { pass: true, summary: { blocking: 0, open: 0 } },
    componentRegistry: { components: [{ componentId: 'hero' }] },
    pageCompositions: [{ route: '/' }, { route: '/products/chair' }],
  };
}

test('existing stage promotion fails closed when any saved gate is incomplete', () => {
  const stageDir = path.resolve('candidate');
  const evidence = passingEvidence(stageDir);
  evidence.routeLinkAudit.pass = false;
  evidence.routeLinkAudit.failures = [{ type: 'missing-target' }];
  const result = evaluateExistingStagePromotion({ stageDir, evidence });
  assert.equal(result.pass, false);
  assert.deepEqual(result.failures.map((failure) => failure.gate), ['route-links']);
});

test('existing stage is promoted without rebuilding pages when all saved gates pass', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-promote-stage-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const stageDir = path.join(root, 'stage');
  const acceptedDir = path.join(root, 'dist');
  await fs.mkdir(path.join(stageDir, 'replay'), { recursive: true });
  await fs.writeFile(path.join(stageDir, 'replay', 'page.html'), '<!doctype html>');
  await fs.writeFile(path.join(stageDir, 'UNVERIFIED-STAGING.json'), '{}');
  await fs.mkdir(acceptedDir, { recursive: true });
  await fs.writeFile(path.join(acceptedDir, 'old.txt'), 'old');

  const result = await promoteExistingStage({
    stageDir,
    acceptedDir,
    evidence: passingEvidence(stageDir),
  });

  assert.equal(result.pass, true);
  assert.equal(result.promoted, true);
  assert.equal(await fs.readFile(path.join(acceptedDir, 'replay', 'page.html'), 'utf8'), '<!doctype html>');
  await assert.rejects(fs.access(path.join(acceptedDir, 'UNVERIFIED-STAGING.json')));
  const verified = JSON.parse(await fs.readFile(path.join(acceptedDir, 'VERIFIED-DELIVERY.json'), 'utf8'));
  assert.equal(verified.pass, true);
  assert.equal(verified.summary.replayFiles, 2);
  assert.equal(verified.summary.pages, 2);
  assert.equal(verified.summary.components, 1);
});
