import fs from 'node:fs/promises';
import path from 'node:path';

import { promoteDirectoryAtomically } from './incremental-build-gate.mjs';
import { writeAtomicVerified } from './verified-write.mjs';

export function evaluateExistingStagePromotion({ stageDir, evidence = {} } = {}) {
  if (!stageDir) throw new TypeError('stageDir is required');
  const failures = [];
  const {
    stageStatus,
    checkpointIntegrity,
    editableContractAudit,
    routeLinkAudit,
    imageRecoveryBlockers,
    validationIssues,
    componentRegistry,
    pageCompositions,
  } = evidence;
  if (!stageStatus || stageStatus.failedGates?.length > 0) {
    failures.push({ gate: 'stage-status', failures: stageStatus?.failedGates || ['missing-stage-status'] });
  }
  if (!stageStatus?.routeLinkAudit?.pass || !stageStatus?.stylesheetRecovery?.pass) {
    failures.push({ gate: 'stage-status-details', type: 'required-stage-gate-failed' });
  }
  if (!checkpointIntegrity?.pass
    || checkpointIntegrity.failureCount !== 0
    || path.resolve(checkpointIntegrity.stageDir || '') !== path.resolve(stageDir)) {
    failures.push({ gate: 'checkpoint-integrity', type: 'checkpoint-integrity-not-current' });
  }
  if (!editableContractAudit?.pass) failures.push({ gate: 'editable-contract', failures: editableContractAudit?.failures || [] });
  if (!routeLinkAudit?.pass) failures.push({ gate: 'route-links', failures: routeLinkAudit?.failures || [] });
  if (!imageRecoveryBlockers?.pass
    || Number(imageRecoveryBlockers.blockedUniqueSourceCount || 0) !== 0
    || Number(imageRecoveryBlockers.blockedRouteCount || 0) !== 0) {
    failures.push({ gate: 'image-recovery', type: 'image-recovery-blockers-remain' });
  }
  if (!validationIssues?.pass || Number(validationIssues?.summary?.blocking || 0) !== 0) {
    failures.push({ gate: 'validation-issues', type: 'blocking-validation-issues-remain' });
  }
  const components = Array.isArray(componentRegistry?.components) ? componentRegistry.components.length : 0;
  const pages = Array.isArray(pageCompositions) ? pageCompositions.length : 0;
  const replayFiles = Number(checkpointIntegrity?.replayFileCount || 0);
  if (components < 1) failures.push({ gate: 'component-library', type: 'component-registry-empty' });
  if (pages < 1 || replayFiles < 1) failures.push({ gate: 'page-inventory', type: 'page-inventory-empty' });
  return {
    pass: failures.length === 0,
    failures,
    summary: { replayFiles, pages, components },
  };
}

export async function promoteExistingStage({ stageDir, acceptedDir, evidence } = {}) {
  if (!acceptedDir) throw new TypeError('acceptedDir is required');
  const evaluation = evaluateExistingStagePromotion({ stageDir, evidence });
  if (!evaluation.pass) return { ...evaluation, promoted: false };
  const verifiedDelivery = {
    version: 1,
    generatedAt: new Date().toISOString(),
    pass: true,
    summary: evaluation.summary,
    gates: {
      checkpointIntegrity: true,
      editableContract: true,
      routeLinks: true,
      imageRecovery: true,
      validationIssues: true,
      componentLibrary: true,
    },
  };
  await writeAtomicVerified(
    path.join(stageDir, 'VERIFIED-DELIVERY.json'),
    `${JSON.stringify(verifiedDelivery, null, 2)}\n`,
  );
  await fs.rm(path.join(stageDir, 'UNVERIFIED-STAGING.json'), { force: true });
  await promoteDirectoryAtomically({ stagingDir: stageDir, acceptedDir });
  return {
    ...evaluation,
    promoted: true,
    acceptedDir: path.resolve(acceptedDir),
    verifiedDelivery,
  };
}
