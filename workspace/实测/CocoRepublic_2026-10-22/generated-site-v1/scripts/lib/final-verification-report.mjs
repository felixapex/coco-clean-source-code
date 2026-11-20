import fs from 'node:fs/promises';
import path from 'node:path';

export function buildStylesheetRecoveryGate(ledger) {
  const pages = Array.isArray(ledger?.pages) ? ledger.pages : [];
  if (!ledger) {
    return {
      pass: false,
      code: 'stylesheet-recovery-ledger-missing',
      total: 0,
      recovered: 0,
      sourceProtected: 0,
      unresolved: 0,
      failureCount: 0,
      failures: [],
    };
  }
  const recovered = pages.filter((page) => page.status === 'recovered-and-validated').length;
  const sourceProtected = pages.filter((page) => page.status === 'source-protected').length;
  const failures = pages.filter((page) => page.status !== 'recovered-and-validated');
  return {
    pass: failures.length === 0,
    code: failures.length ? 'stylesheet-recovery-incomplete' : null,
    total: pages.length,
    recovered,
    sourceProtected,
    unresolved: failures.length - sourceProtected,
    failureCount: failures.length,
    failures: failures.slice(0, 20),
  };
}

export function buildFinalVerificationReport({
  routeLinkAudit = null,
  responsiveAudit = null,
  interactionAudit = null,
  editableAudit = null,
  stylesheetRecovery = null,
  generationTiming = null,
  baseline = null,
  extraGates = {},
} = {}) {
  const gates = {
    'route-links': routeLinkAudit,
    responsive: responsiveAudit,
    interactions: interactionAudit,
    editable: editableAudit,
    'stylesheet-recovery': stylesheetRecovery,
    ...extraGates,
  };
  const failedGates = Object.entries(gates)
    .filter(([, evidence]) => evidence && evidence.pass !== true)
    .map(([name]) => name);
  const recoveryTargets = routeLinkAudit?.uniqueMissingTargets || [];
  const bestElapsedMs = baseline?.bestMeasured?.elapsedMs ?? null;
  const elapsedMs = generationTiming?.elapsedMs ?? null;
  return {
    generatedAt: new Date().toISOString(),
    publishable: failedGates.length === 0 && recoveryTargets.length === 0,
    failedGates,
    gates,
    recovery: {
      targets: recoveryTargets,
      total: recoveryTargets.length,
      recovered: recoveryTargets.filter((item) => item.status === 'completed' || item.status === 'recovered').length,
      sourceProtected: recoveryTargets.filter((item) => item.status === 'source-protected').length,
      unresolved: recoveryTargets.filter((item) => item.status === 'unresolved').length,
    },
    timing: {
      elapsedMs,
      bestElapsedMs,
      deltaFromBestMs: elapsedMs != null && bestElapsedMs != null ? elapsedMs - bestElapsedMs : null,
      stages: generationTiming?.timings || [],
    },
  };
}

export async function writeFinalVerificationReport(outputPath, report) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryPath, outputPath);
}
