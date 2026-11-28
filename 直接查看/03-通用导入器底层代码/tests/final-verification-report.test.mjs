import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildFinalVerificationReport, buildStylesheetRecoveryGate, writeFinalVerificationReport } from '../scripts/lib/final-verification-report.mjs';

test('final verification never publishes while any required gate or recovery target is unresolved', () => {
  const report = buildFinalVerificationReport({
    routeLinkAudit: { pass: false, uniqueMissingTargets: [{ targetRoute: '/contact-us', status: 'source-protected' }] },
    responsiveAudit: { pass: true, routeCount: 8, passedCells: 40, failedCells: 0 },
    interactionAudit: { pass: false, failures: [{ type: 'source-domain-escape' }] },
    editableAudit: { pass: true, failures: [] },
    generationTiming: { elapsedMs: 1_231_658, timings: [] },
    baseline: { bestMeasured: { elapsedMs: 962_566 } },
  });
  assert.equal(report.publishable, false);
  assert.deepEqual(report.failedGates, ['route-links', 'interactions']);
  assert.equal(report.recovery.sourceProtected, 1);
  assert.equal(report.timing.deltaFromBestMs, 269_092);
});

test('final verification report is written atomically', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'matbox-final-report-'));
  const outputPath = path.join(directory, 'final-verification.json');
  await writeFinalVerificationReport(outputPath, { publishable: false, failedGates: ['route-links'] });
  assert.deepEqual(JSON.parse(await fs.readFile(outputPath, 'utf8')).failedGates, ['route-links']);
  assert.deepEqual(await fs.readdir(directory), ['final-verification.json']);
  await fs.rm(directory, { recursive: true, force: true });
});

test('stylesheet recovery remains a hard failure while any desktop or mobile page is protected', () => {
  const gate = buildStylesheetRecoveryGate({
    pages: [
      { route: '/product', viewport: 'desktop', status: 'recovered-and-validated' },
      { route: '/help', viewport: 'mobile', status: 'source-protected' },
    ],
  });
  assert.equal(gate.pass, false);
  assert.equal(gate.recovered, 1);
  assert.equal(gate.sourceProtected, 1);
  const report = buildFinalVerificationReport({ stylesheetRecovery: gate });
  assert.equal(report.publishable, false);
  assert.deepEqual(report.failedGates, ['stylesheet-recovery']);
});

test('a missing stylesheet recovery ledger fails closed', () => {
  assert.deepEqual(buildStylesheetRecoveryGate(null), {
    pass: false,
    code: 'stylesheet-recovery-ledger-missing',
    total: 0,
    recovered: 0,
    sourceProtected: 0,
    unresolved: 0,
    failureCount: 0,
    failures: [],
  });
});
