import fs from 'node:fs/promises';
import path from 'node:path';
import { promoteDirectoryAtomically } from './incremental-build-gate.mjs';

const REQUIRED_VIEWPORTS = Object.freeze(['desktop', 'mobile']);

function appendGateFailures(failures, gate, result) {
  if (!result || typeof result.pass !== 'boolean') {
    failures.push({ gate, type: 'missing-gate-evidence' });
    return;
  }
  if (result.pass) return;
  const reasons = Array.isArray(result.failures) && result.failures.length > 0
    ? result.failures
    : [{ type: 'gate-failed-without-reason' }];
  for (const reason of reasons) failures.push({ gate, ...reason });
}

export function evaluatePageAssembly(evidence = {}) {
  const failures = [];
  const componentIds = Array.isArray(evidence.componentIds) ? evidence.componentIds : [];
  const accepted = new Set(Array.isArray(evidence.acceptedComponentIds) ? evidence.acceptedComponentIds : []);
  for (const componentId of componentIds) {
    if (!accepted.has(componentId)) failures.push({ gate: 'components', type: 'unverified-component', componentId });
  }
  if (componentIds.length === 0) failures.push({ gate: 'components', type: 'missing-page-components' });

  for (const viewport of REQUIRED_VIEWPORTS) {
    const viewportEvidence = evidence.viewports?.[viewport];
    if (!viewportEvidence) {
      failures.push({ gate: 'viewport', type: 'missing-viewport-evidence', viewport });
      continue;
    }
    appendGateFailures(failures, `${viewport}-visual`, viewportEvidence.visual);
    appendGateFailures(failures, `${viewport}-geometry`, viewportEvidence.geometry);
  }

  const interactions = evidence.interactions;
  appendGateFailures(failures, 'interactions', interactions);
  if (interactions?.pass === true) {
    const total = Number(interactions.total);
    const verified = Number(interactions.verified);
    if (!Number.isInteger(total) || total < 0 || !Number.isInteger(verified) || verified !== total) {
      failures.push({ gate: 'interactions', type: 'incomplete-control-coverage', total, verified });
    }
  }

  return { pass: failures.length === 0, failures };
}

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function verifyAndPromotePage({ pageId, stagingDir, acceptedDir, evidence } = {}) {
  const result = evaluatePageAssembly(evidence);
  if (!result.pass) return { ...result, pageId: pageId || '', promoted: false };
  if (!pageId || !stagingDir || !acceptedDir || !await pathExists(stagingDir)) {
    return {
      pass: false,
      pageId: pageId || '',
      promoted: false,
      failures: [{ gate: 'promotion', type: 'invalid-or-missing-page-candidate' }],
    };
  }
  const manifest = {
    contractVersion: 1,
    pageId,
    route: evidence.route || '',
    pass: true,
    componentIds: evidence.componentIds,
    viewports: evidence.viewports,
    interactions: evidence.interactions,
  };
  await fs.writeFile(path.join(stagingDir, 'accepted-page-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await promoteDirectoryAtomically({ stagingDir, acceptedDir });
  return { pass: true, pageId, promoted: true, failures: [], manifest };
}

